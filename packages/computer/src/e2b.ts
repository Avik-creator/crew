import { Sandbox } from "e2b"

import type { ComputerHandle, ComputerProvider, ExecOptions, ExecResult, FileEntry, PortEndpoint } from "./provider"

const TRAFFIC_HEADER = "e2b-traffic-access-token"

// Our template when built (pnpm template:build), else E2B's stock desktop
// template; missing tools are installed on first use by the supervisor.
function templateId() {
  return process.env.E2B_TEMPLATE_ID || "desktop"
}

class E2BHandle implements ComputerHandle {
  constructor(private sbx: Sandbox) {}

  get sandboxId() {
    return this.sbx.sandboxId
  }

  async exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
    if (opts.background) {
      await this.sbx.commands.run(cmd, {
        background: true,
        envs: opts.envs,
        cwd: opts.cwd,
        timeoutMs: 0,
      })
      return { exitCode: 0, stdout: "", stderr: "" }
    }
    try {
      const r = await this.sbx.commands.run(cmd, {
        envs: opts.envs,
        cwd: opts.cwd,
        timeoutMs: opts.timeoutMs ?? 120_000,
      })
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }
    } catch (err) {
      // A non-zero exit throws CommandExitError carrying the result
      const result = (err as { result?: ExecResult }).result
      if (result) return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
      return { exitCode: -1, stdout: "", stderr: err instanceof Error ? err.message : String(err) }
    }
  }

  readFile(path: string) {
    return this.sbx.files.read(path)
  }

  async writeFile(path: string, content: string) {
    await this.sbx.files.write(path, content)
  }

  async listFiles(path: string): Promise<FileEntry[]> {
    const entries = await this.sbx.files.list(path)
    return entries.map((e) => ({
      name: e.name,
      path: e.path,
      type: String(e.type) === "dir" ? "dir" : "file",
      size: e.size,
    }))
  }

  async portEndpoint(port: number): Promise<PortEndpoint> {
    const token = this.sbx.trafficAccessToken
    return {
      url: `https://${this.sbx.getHost(port)}`,
      headers: token ? { [TRAFFIC_HEADER]: token } : ({} as Record<string, string>),
    }
  }

  async keepAlive(ms: number) {
    await this.sbx.setTimeout(ms).catch(() => {})
  }
}

export class E2BProvider implements ComputerProvider {
  readonly name = "e2b" as const

  async create({ userId, resolution, idleMs }: { userId: string; resolution: [number, number]; idleMs: number }) {
    const template = templateId()
    const sbx = await Sandbox.create(template, {
      timeoutMs: idleMs,
      metadata: { app: "crew", userId, resolution: resolution.join("x") },
      lifecycle: { onTimeout: "pause" },
      network: { allowPublicTraffic: false },
    })
    return { sandboxId: sbx.sandboxId, templateId: template }
  }

  async connect(sandboxId: string, idleMs: number) {
    // connect() resumes a paused sandbox (memory included) in about a second
    const sbx = await Sandbox.connect(sandboxId, { timeoutMs: idleMs })
    return new E2BHandle(sbx)
  }

  async pause(sandboxId: string) {
    await Sandbox.pause(sandboxId)
  }

  async destroy(sandboxId: string) {
    await Sandbox.kill(sandboxId)
  }

  async isRunning(sandboxId: string) {
    const info = await Sandbox.getInfo(sandboxId).catch(() => null)
    return info?.state === "running"
  }
}
