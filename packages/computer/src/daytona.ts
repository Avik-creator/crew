import { Daytona, type Sandbox } from "@daytona/sdk"

import type { ComputerHandle, ComputerProvider, ExecOptions, ExecResult, FileEntry } from "./provider"

// Alternative provider. Same contract as E2B; port access uses Daytona's
// preview token header instead of E2B's traffic token.

let client: Daytona | undefined
const daytona = () => (client ??= new Daytona({ apiKey: process.env.DAYTONA_API_KEY }))

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

class DaytonaHandle implements ComputerHandle {
  constructor(private sbx: Sandbox) {}

  get sandboxId() {
    return this.sbx.id
  }

  async exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
    const wrapped = opts.background ? `nohup bash -c ${q(cmd)} >/dev/null 2>&1 &` : `bash -c ${q(cmd)}`
    try {
      const r = await this.sbx.process.executeCommand(
        wrapped,
        opts.cwd,
        opts.envs,
        Math.ceil((opts.timeoutMs ?? 120_000) / 1000),
      )
      // Daytona merges stdout and stderr into one result
      return { exitCode: r.exitCode, stdout: r.result, stderr: r.exitCode === 0 ? "" : r.result }
    } catch (err) {
      return { exitCode: -1, stdout: "", stderr: err instanceof Error ? err.message : String(err) }
    }
  }

  async readFile(path: string) {
    const buf = await this.sbx.fs.downloadFile(path)
    return buf.toString("utf8")
  }

  async writeFile(path: string, content: string) {
    await this.sbx.fs.uploadFile(Buffer.from(content, "utf8"), path)
  }

  async listFiles(path: string): Promise<FileEntry[]> {
    const entries = await this.sbx.fs.listFiles(path)
    return entries.map((e) => ({
      name: e.name,
      path: `${path.replace(/\/$/, "")}/${e.name}`,
      type: e.isDir ? "dir" : "file",
      size: e.size,
    }))
  }

  async portEndpoint(port: number) {
    const link = await this.sbx.getPreviewLink(port)
    return { url: link.url.replace(/\/$/, ""), headers: { "x-daytona-preview-token": link.token } }
  }

  async keepAlive() {
    await this.sbx.refreshActivity().catch(() => {})
  }
}

export class DaytonaProvider implements ComputerProvider {
  readonly name = "daytona" as const

  async create({ userId, idleMs }: { userId: string; resolution: [number, number]; idleMs: number }) {
    const snapshot = process.env.DAYTONA_SNAPSHOT || undefined
    const sbx = await daytona().create({
      snapshot,
      labels: { app: "crew", userId },
      autoStopInterval: Math.max(1, Math.round(idleMs / 60_000)),
    })
    return { sandboxId: sbx.id, templateId: snapshot ?? "default" }
  }

  async connect(sandboxId: string) {
    const sbx = await daytona().get(sandboxId)
    if (sbx.state !== "started") await sbx.start(120)
    return new DaytonaHandle(sbx)
  }

  async pause(sandboxId: string) {
    const sbx = await daytona().get(sandboxId)
    await sbx.stop()
  }

  async destroy(sandboxId: string) {
    const sbx = await daytona().get(sandboxId)
    await daytona().delete(sbx)
  }

  async isRunning(sandboxId: string) {
    const sbx = await daytona()
      .get(sandboxId)
      .catch(() => null)
    return sbx?.state === "started"
  }
}
