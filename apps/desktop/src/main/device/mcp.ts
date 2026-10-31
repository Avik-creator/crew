import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"

type Send = (frame: { type: "mcp_frame"; sessionId: string; frame: unknown } | { type: "mcp_closed"; sessionId: string; error?: string }) => void

// Local-command MCP servers the bots use on this Mac. Each session is one
// spawned process; JSON-RPC frames are passed through untouched.
export class McpSessions {
  private sessions = new Map<string, StdioClientTransport>()

  constructor(private send: Send) {}

  async open(opts: { sessionId: string; command: string; args: string[]; env: Record<string, string> }) {
    const transport = new StdioClientTransport({
      command: opts.command,
      args: opts.args,
      env: { ...(process.env as Record<string, string>), ...opts.env },
      stderr: "ignore",
    })
    transport.onmessage = (frame) => this.send({ type: "mcp_frame", sessionId: opts.sessionId, frame })
    transport.onclose = () => {
      if (this.sessions.delete(opts.sessionId)) this.send({ type: "mcp_closed", sessionId: opts.sessionId })
    }
    transport.onerror = (err) => this.send({ type: "mcp_closed", sessionId: opts.sessionId, error: err.message })
    this.sessions.set(opts.sessionId, transport)
    try {
      await transport.start()
    } catch (err) {
      this.sessions.delete(opts.sessionId)
      this.send({ type: "mcp_closed", sessionId: opts.sessionId, error: err instanceof Error ? err.message : String(err) })
    }
  }

  frame(sessionId: string, frame: unknown) {
    void this.sessions.get(sessionId)?.send(frame as JSONRPCMessage)
  }

  close(sessionId: string) {
    const t = this.sessions.get(sessionId)
    this.sessions.delete(sessionId)
    void t?.close()
  }

  closeAll() {
    for (const id of [...this.sessions.keys()]) this.close(id)
  }
}
