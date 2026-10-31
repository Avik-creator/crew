# Crew

AI teammates with their own computer. Each bot has a job, its own screen on a shared cloud computer (or your Mac), the apps you connect, and it works with the other bots. See [PRD.md](PRD.md) for the full design and the build log.

## Layout

| Path | What it is |
|---|---|
| `apps/desktop` | Electron app: the UI, plus the device agent that lets bots use your Mac |
| `apps/server` | Hono API: auth, REST, live events (SSE), screen proxy, device relay, OAuth callbacks, first-party MCP |
| `apps/tasks` | Trigger.dev tasks: bot turns, schedules, computer maintenance |
| `packages/agent` | The turn runner, tools, prompts and group router (AI SDK v7 + Neon AI Gateway) |
| `packages/computer` | Cloud computers behind `ComputerProvider` (E2B, Daytona), displays, drivers |
| `packages/mcp` | The connector layer: catalog, OAuth, transports, approval policy, Google server |
| `packages/db` | Drizzle schema and client (Neon Postgres) |
| `packages/shared` | Types, limits, device protocol, crypto helpers |

## Run it locally

You need Node 22+, pnpm 10, a Neon database with the AI Gateway enabled, a Trigger.dev project and an E2B key.

```bash
pnpm install
cp .env.example .env          # fill it in
pnpm db:push                  # create the tables
pnpm template:build           # optional: faster computer starts
```

Then run these in three terminals:

```bash
pnpm dev:server               # API on http://localhost:8787
pnpm dev:tasks                # Trigger.dev tasks (runs them on your machine)
pnpm dev:desktop              # the app
```

Sign up in the app, create a bot, and send it a message.

## Checks

```bash
pnpm typecheck
pnpm --filter @crew/computer smoke    # live E2B check: displays, VNC, pause/resume
pnpm --filter @crew/server exec tsx scripts/relay-smoke.ts   # device relay (needs SESSION, SERVER, INTERNAL_API_SECRET)
```

## Release (macOS)

```bash
pnpm --filter @crew/desktop dist:mac
```

The app updates itself from this repo's GitHub Releases (`electron-updater`).
