import { CLOUD_SCREEN, PORTS } from "@crew/shared"

import type { ComputerHandle } from "./provider"
import { appsScript } from "./apps-script"
import { browserScript, CREW_DIR, HOME, SCRIPTS_VERSION, TOOLCHAINS, WORKSPACE, type Toolchain } from "./scripts"
import { Supervisor } from "./supervisor"

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// Everything above the raw provider: one-time setup, per-bot displays with VNC,
// and stdio MCP bridges. Works the same on any ComputerProvider.
export class Workstation {
  readonly supervisor: Supervisor

  constructor(readonly computer: ComputerHandle) {
    this.supervisor = new Supervisor(computer)
  }

  // Cheap when already done: one exec to compare the version marker
  async bootstrap() {
    const marker = `${CREW_DIR}/VERSION`
    const cur = await this.computer.exec(`cat ${marker} 2>/dev/null; true`)
    if (cur.stdout.trim() === SCRIPTS_VERSION) return
    await this.computer.exec(`mkdir -p ${CREW_DIR} ${WORKSPACE}/.sessions ${WORKSPACE}`)
    await this.computer.writeFile(`${CREW_DIR}/browser.py`, browserScript)
    await this.computer.writeFile(`${CREW_DIR}/apps.py`, appsScript)
    await this.supervisor.ready()
    // Browser automation is needed for shared logins; install in the background
    await this.computer.exec(`(${TOOLCHAINS.playwright}) >/tmp/crew-playwright.log 2>&1`, { background: true })
    await this.computer.writeFile(marker, SCRIPTS_VERSION)
  }

  async ensureToolchain(name: Toolchain) {
    const r = await this.computer.exec(`(${TOOLCHAINS[name]}) >/tmp/crew-${name}.log 2>&1`, { timeoutMs: 300_000 })
    if (r.exitCode !== 0) {
      const log = await this.computer.exec(`tail -20 /tmp/crew-${name}.log`)
      throw new Error(`Could not install ${name}: ${log.stdout}`)
    }
  }

  // Display :n with a window manager, x11vnc on 5900+n and noVNC on 6080+n
  async ensureDisplay(n: number, vncPassword: string) {
    const { width, height } = CLOUD_SCREEN
    const passFile = `${CREW_DIR}/vnc-${n}.pass`
    await this.computer.exec(`x11vnc -storepasswd ${q(vncPassword)} ${passFile} >/dev/null 2>&1`)
    const vnc = PORTS.vnc(n)
    const web = PORTS.novnc(n)
    await this.supervisor.ensureGroup(`display-${n}`, [
      {
        name: "xvfb",
        command: `Xvfb :${n} -ac -screen 0 ${width}x${height}x24 -dpi 96 -nolisten tcp`,
        priority: 10,
      },
      {
        name: "wm",
        // A solid backdrop so the screen's edges read clearly in the app
        command: `sh -c 'xsetroot -solid "#23232f" 2>/dev/null; exec xfwm4 --compositor=off'`,
        env: { DISPLAY: `:${n}` },
        priority: 20,
      },
      {
        name: "panel",
        command: "xfce4-panel --disable-wm-check",
        env: { DISPLAY: `:${n}` },
        priority: 30,
      },
      {
        name: "vnc",
        command: `x11vnc -display :${n} -forever -shared -rfbport ${vnc} -rfbauth ${passFile} -noxdamage -quiet`,
        priority: 40,
      },
      {
        name: "novnc",
        command: `/opt/noVNC/utils/novnc_proxy --vnc localhost:${vnc} --listen ${web} --web /opt/noVNC`,
        priority: 50,
      },
    ])
    if (!(await this.supervisor.waitForPort(web))) {
      const log = await this.supervisor.tail(`display-${n}`, "novnc")
      throw new Error(`The screen for display :${n} did not start. ${log}`)
    }
    return { vncPort: vnc, webPort: web }
  }

  async removeDisplay(n: number) {
    await this.supervisor.removeGroup(`display-${n}`)
    await this.computer.exec(`pkill -f "user-data-dir=${HOME}/.profiles/bot-${n}" ; true`)
  }

  // A stdio MCP server exposed as streamable HTTP on the given port
  async ensureBridge(opts: { id: string; port: number; command: string; args: string[]; env: Record<string, string> }) {
    const full = [opts.command, ...opts.args].map(q).join(" ")
    await this.ensureToolchain("node")
    if (/\buvx?\b/.test(opts.command)) await this.ensureToolchain("uv")
    await this.supervisor.ensureGroup(`bridge-${opts.id}`, [
      {
        name: "server",
        command: `npx -y supergateway@3 --stdio ${q(full)} --outputTransport streamableHttp --stateful --sessionTimeout 900000 --port ${opts.port}`,
        env: { ...opts.env, PATH: "/usr/local/bin:/usr/bin:/bin:/home/user/.local/bin" },
        directory: WORKSPACE,
      },
    ])
    if (!(await this.supervisor.waitForPort(opts.port, 90_000))) {
      const log = await this.supervisor.tail(`bridge-${opts.id}`, "server")
      throw new Error(`The connector did not start on the computer. ${log}`)
    }
    return { path: "/mcp" }
  }

  removeBridge(id: string) {
    return this.supervisor.removeGroup(`bridge-${id}`)
  }
}
