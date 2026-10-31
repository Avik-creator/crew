import type { ComputerHandle } from "./provider"

// Long-running processes on the computer (displays, VNC, stdio bridges) are
// managed by supervisord: each group is one generated conf file, started with
// `supervisorctl update`, restarted if it crashes, and kept across pause/resume.

export type Program = {
  name: string
  command: string
  env?: Record<string, string>
  user?: string
  directory?: string
  priority?: number
}

const CONF_DIR = "/etc/supervisor/conf.d"
const LOG_DIR = "/tmp/crew-logs"

const envValue = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`

export function renderGroup(group: string, programs: Program[]) {
  const lines = [`[group:${group}]`, `programs=${programs.map((p) => `${group}-${p.name}`).join(",")}`, ""]
  for (const p of programs) {
    const env = { HOME: "/home/user", USER: "user", ...p.env }
    lines.push(
      `[program:${group}-${p.name}]`,
      `command=${p.command.replace(/%/g, "%%")}`,
      `user=${p.user ?? "user"}`,
      `directory=${p.directory ?? "/home/user"}`,
      `environment=${Object.entries(env)
        .map(([k, v]) => `${k}=${envValue(v)}`)
        .join(",")}`,
      `priority=${p.priority ?? 100}`,
      "autostart=true",
      "autorestart=true",
      "startsecs=1",
      "startretries=30",
      "stopasgroup=true",
      "killasgroup=true",
      `stdout_logfile=${LOG_DIR}/${group}-${p.name}.log`,
      "stdout_logfile_maxbytes=1MB",
      "redirect_stderr=true",
      "",
    )
  }
  return lines.join("\n")
}

export class Supervisor {
  // Staging dir for generated confs; owned by the sandbox user, unlike /tmp files
  constructor(
    private computer: ComputerHandle,
    private stagingDir = "/home/user/.crew/supervisor",
  ) {}

  private run(cmd: string, timeoutMs = 60_000) {
    return this.computer.exec(cmd, { timeoutMs })
  }

  // Installs supervisord when the image lacks it, and starts the daemon
  async ready() {
    const r = await this.run(
      [
        `mkdir -p ${LOG_DIR} ${this.stagingDir}`,
        "command -v supervisord >/dev/null || (sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq supervisor) >/tmp/crew-supervisor-install.log 2>&1",
        "pgrep -x supervisord >/dev/null || sudo supervisord -c /etc/supervisor/supervisord.conf",
        "for i in $(seq 1 25); do sudo supervisorctl status >/dev/null 2>&1; [ $? -le 3 ] && exit 0; sleep 0.2; done; exit 1",
      ].join(" && "),
      240_000,
    )
    if (r.exitCode !== 0) throw new Error(`supervisord not available: ${r.stderr || r.stdout}`)
  }

  // Idempotent: unchanged config is a no-op, changed config restarts the group
  async ensureGroup(group: string, programs: Program[]) {
    const conf = renderGroup(group, programs)
    const tmp = `${this.stagingDir}/${group}.conf`
    await this.computer.writeFile(tmp, conf)
    const r = await this.run(
      `cmp -s ${tmp} ${CONF_DIR}/crew-${group}.conf || sudo cp ${tmp} ${CONF_DIR}/crew-${group}.conf; ` +
        `sudo supervisorctl update ${group} >/dev/null; sudo supervisorctl start '${group}:*' >/dev/null 2>&1; true`,
    )
    if (r.exitCode !== 0) throw new Error(`Could not start ${group}: ${r.stderr}`)
  }

  async removeGroup(group: string) {
    await this.run(
      `sudo supervisorctl stop '${group}:*' >/dev/null 2>&1; sudo rm -f ${CONF_DIR}/crew-${group}.conf; sudo supervisorctl update >/dev/null 2>&1; true`,
    )
  }

  async status(group: string): Promise<Record<string, string>> {
    const r = await this.run(`sudo supervisorctl status '${group}:*' 2>/dev/null; true`)
    const out: Record<string, string> = {}
    for (const line of r.stdout.split("\n")) {
      const [name, state] = line.trim().split(/\s+/)
      if (name && state) out[name.replace(`${group}:${group}-`, "")] = state
    }
    return out
  }

  async waitForPort(port: number, timeoutMs = 15_000) {
    const tries = Math.ceil(timeoutMs / 250)
    const r = await this.run(
      `for i in $(seq 1 ${tries}); do (echo > /dev/tcp/127.0.0.1/${port}) 2>/dev/null && exit 0; sleep 0.25; done; exit 1`,
      timeoutMs + 5_000,
    )
    return r.exitCode === 0
  }

  async tail(group: string, program: string, lines = 40) {
    const r = await this.run(`tail -n ${lines} ${LOG_DIR}/${group}-${program}.log 2>/dev/null; true`)
    return r.stdout
  }
}
