// One interface over the sandbox vendor, so the shared computer can run on E2B
// (primary) or Daytona without anything above this layer changing.

export type ExecOptions = {
  timeoutMs?: number
  background?: boolean
  envs?: Record<string, string>
  cwd?: string
}

export type ExecResult = { exitCode: number; stdout: string; stderr: string }

export type FileEntry = { name: string; path: string; type: "file" | "dir"; size?: number }

export type PortEndpoint = {
  // https://host (no trailing slash); swap to wss:// for websockets
  url: string
  headers: Record<string, string>
}

export interface ComputerHandle {
  readonly sandboxId: string
  exec(cmd: string, opts?: ExecOptions): Promise<ExecResult>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  listFiles(path: string): Promise<FileEntry[]>
  portEndpoint(port: number): Promise<PortEndpoint>
  // Push the idle-pause deadline out
  keepAlive(ms: number): Promise<void>
}

export type CreatedComputer = { sandboxId: string; templateId: string }

export interface ComputerProvider {
  readonly name: "e2b" | "daytona"
  create(opts: { userId: string; resolution: [number, number]; idleMs: number }): Promise<CreatedComputer>
  // Resumes a paused computer if needed
  connect(sandboxId: string, idleMs: number): Promise<ComputerHandle>
  pause(sandboxId: string): Promise<void>
  destroy(sandboxId: string): Promise<void>
  isRunning(sandboxId: string): Promise<boolean>
}
