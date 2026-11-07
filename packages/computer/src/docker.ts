import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { PORTS } from "@crew/shared"

import type { ComputerHandle, ComputerProvider, ExecOptions, ExecResult, FileEntry, PortEndpoint } from "./provider"

// The computer as a container on the machine running the server, through the
// docker CLI. The image is built from ../docker/Dockerfile and named after its
// contents, so a changed Dockerfile builds a new one. Pausing freezes the
// container with its memory, like E2B. Screens and bridges are published on
// localhost only, on ports Docker picks.

const CONTEXT = fileURLToPath(new URL("../docker", import.meta.url))
// One container serves this many screens and stdio bridges
const SCREENS = 20
const BRIDGES = 20

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

function image() {
  if (process.env.DOCKER_COMPUTER_IMAGE) return process.env.DOCKER_COMPUTER_IMAGE
  const hash = createHash("sha256").update(readFileSync(`${CONTEXT}/Dockerfile`)).digest("hex").slice(0, 12)
  return `crew-computer:${hash}`
}

type Run = { code: number; stdout: string; stderr: string }

function docker(args: string[], opts: { input?: string; timeoutMs?: number } = {}): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on("data", (d: Buffer) => out.push(d))
    child.stderr.on("data", (d: Buffer) => err.push(d))
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : undefined
    child.on("error", (e) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout: "", stderr: /ENOENT/.test(e.message) ? "Docker isn't installed on the server" : e.message })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") })
    })
    child.stdin.end(opts.input ?? "")
  })
}

async function must(args: string[], what: string, timeoutMs = 120_000) {
  const r = await docker(args, { timeoutMs })
  if (r.code !== 0) {
    const reason = r.stderr.trim().split("\n").pop() || `exit ${r.code}`
    // Matches the "gone" check in service.ts, which then starts a fresh computer
    throw new Error(/no such (container|object)/i.test(reason) ? `${what}: computer not found` : `${what}: ${reason}`)
  }
  return r.stdout.trim()
}

let building: Promise<string> | undefined

// Builds the image the first time it's needed. Takes several minutes once.
export function ensureDockerImage(): Promise<string> {
  building ??= (async () => {
    const tag = image()
    if ((await docker(["image", "inspect", tag])).code === 0) return tag
    if (process.env.DOCKER_COMPUTER_IMAGE) throw new Error(`The image ${tag} from DOCKER_COMPUTER_IMAGE isn't on this machine`)
    console.log(`Building the computer image ${tag}. This takes a few minutes the first time.`)
    await must(["build", "-t", tag, CONTEXT], "Couldn't build the computer image", 30 * 60_000)
    return tag
  })().finally(() => (building = undefined))
  return building
}

// Idle containers are paused after their idle time, like E2B sandboxes. The
// timers live in this process; the maintenance job catches what a restart drops.
const idle = new Map<string, NodeJS.Timeout>()
function idleAfter(id: string, ms: number) {
  clearTimeout(idle.get(id))
  const timer = setTimeout(() => {
    idle.delete(id)
    void docker(["pause", id])
  }, ms)
  timer.unref()
  idle.set(id, timer)
}

class DockerHandle implements ComputerHandle {
  constructor(
    readonly sandboxId: string,
    private idleMs: number,
  ) {}

  async exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
    const env = Object.entries(opts.envs ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`])
    const base = ["exec", "-u", "user", "-w", opts.cwd ?? "/home/user", ...env]
    if (opts.background) {
      await docker([...base, "-d", this.sandboxId, "bash", "-lc", cmd])
      return { exitCode: 0, stdout: "", stderr: "" }
    }
    // timeout ends the command inside the container too; it exits 124
    const secs = Math.ceil((opts.timeoutMs ?? 120_000) / 1000)
    const r = await docker([...base, this.sandboxId, "timeout", "-k", "5", String(secs), "bash", "-lc", cmd], {
      timeoutMs: (secs + 15) * 1000,
    })
    return { exitCode: r.code, stdout: r.stdout, stderr: r.stderr }
  }

  async readFile(path: string) {
    const r = await docker(["exec", "-u", "user", this.sandboxId, "cat", path])
    if (r.code !== 0) throw new Error(r.stderr.trim() || `Couldn't read ${path}`)
    return r.stdout
  }

  async writeFile(path: string, content: string) {
    const dir = path.replace(/\/[^/]*$/, "") || "/"
    const r = await docker(["exec", "-i", "-u", "user", this.sandboxId, "sh", "-c", `mkdir -p ${q(dir)} && cat > ${q(path)}`], {
      input: content,
      timeoutMs: 60_000,
    })
    if (r.code !== 0) throw new Error(r.stderr.trim() || `Couldn't write ${path}`)
  }

  async listFiles(path: string): Promise<FileEntry[]> {
    const r = await docker(["exec", "-u", "user", this.sandboxId, "find", path, "-mindepth", "1", "-maxdepth", "1", "-printf", "%f\\t%y\\t%s\\n"])
    if (r.code !== 0) throw new Error(r.stderr.trim() || `Couldn't list ${path}`)
    const base = path.replace(/\/$/, "")
    return r.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name = "", kind, size] = line.split("\t")
        return { name, path: `${base}/${name}`, type: kind === "d" ? ("dir" as const) : ("file" as const), size: Number(size) }
      })
  }

  async portEndpoint(port: number): Promise<PortEndpoint> {
    const r = await docker(["port", this.sandboxId, `${port}/tcp`])
    const bound = r.stdout.trim().split("\n")[0]
    if (r.code !== 0 || !bound) throw new Error(`Port ${port} isn't published from the computer. A container serves ${SCREENS} screens and ${BRIDGES} connectors.`)
    const hostPort = bound.slice(bound.lastIndexOf(":") + 1)
    return { url: `http://127.0.0.1:${hostPort}`, headers: {} }
  }

  async keepAlive(ms: number) {
    idleAfter(this.sandboxId, ms || this.idleMs)
  }
}

export class DockerProvider implements ComputerProvider {
  readonly name = "docker" as const

  async create({ userId, idleMs }: { userId: string; resolution: [number, number]; idleMs: number }) {
    const tag = await ensureDockerImage()
    const screens = `${PORTS.novnc(1)}-${PORTS.novnc(SCREENS)}`
    const bridges = `${PORTS.bridge(0)}-${PORTS.bridge(BRIDGES - 1)}`
    const id = await must(
      [
        "run",
        "-d",
        "--label",
        "app=crew",
        "--label",
        `crew.user=${userId}`,
        "--hostname",
        "crew",
        "--shm-size",
        "2g",
        "--restart",
        "unless-stopped",
        "-p",
        `127.0.0.1::${screens}`,
        "-p",
        `127.0.0.1::${bridges}`,
        tag,
      ],
      "Couldn't start the computer",
    )
    idleAfter(id, idleMs)
    return { sandboxId: id, templateId: tag }
  }

  // Unfreezes a paused container, or starts a stopped one
  async connect(sandboxId: string, idleMs: number) {
    const state = await must(["inspect", "-f", "{{.State.Status}}", sandboxId], "Couldn't reach the computer")
    if (state === "paused") await must(["unpause", sandboxId], "Couldn't wake the computer")
    else if (state !== "running") await must(["start", sandboxId], "Couldn't start the computer")
    idleAfter(sandboxId, idleMs)
    return new DockerHandle(sandboxId, idleMs)
  }

  async pause(sandboxId: string) {
    clearTimeout(idle.get(sandboxId))
    idle.delete(sandboxId)
    const state = await must(["inspect", "-f", "{{.State.Status}}", sandboxId], "Couldn't reach the computer")
    if (state === "running") await must(["pause", sandboxId], "Couldn't pause the computer")
  }

  async destroy(sandboxId: string) {
    clearTimeout(idle.get(sandboxId))
    idle.delete(sandboxId)
    await must(["rm", "-f", sandboxId], "Couldn't delete the computer")
  }

  async isRunning(sandboxId: string) {
    const r = await docker(["inspect", "-f", "{{.State.Status}}", sandboxId])
    return r.code === 0 && r.stdout.trim() === "running"
  }
}
