import type { OAuthAuthorizationServerInformation } from "@ai-sdk/mcp"

// Built-in connectors. The catalog in code is the source of truth; seedCatalog()
// mirrors it into mcp_servers so custom and built-in servers share one table.

export type CatalogEntry = {
  slug: string
  name: string
  description: string
  icon: string
  transport: "http" | "stdio"
  url?: string
  command?: string
  args?: string[]
  envKeys?: string[]
  runOn?: "cloud_computer" | "device"
  authMode: "oauth" | "token" | "none" | "first_party"
  // Pre-registered OAuth app read from env (<PREFIX>_CLIENT_ID / _SECRET)
  staticClientEnv?: string
  // Required for pre-registered confidential clients
  authorizationServer?: OAuthAuthorizationServerInformation
  scopes?: string
  authParams?: Record<string, string>
  // Never "always allow"; never offered in background runs when sending
  hardApprovalTools?: string[]
  // Tools that run without asking even without a readOnly hint
  autoTools?: string[]
  // Shown as a template in "Add local-command server", not connected directly
  template?: boolean
}

export const CATALOG: CatalogEntry[] = [
  {
    slug: "gitlab",
    name: "GitLab",
    description: "Issues, merge requests, pipelines and code on gitlab.com.",
    icon: "gitlab",
    transport: "http",
    url: "https://gitlab.com/api/v4/mcp",
    authMode: "oauth",
    scopes: "mcp",
    hardApprovalTools: ["merge_merge_request"],
  },
  {
    slug: "github",
    name: "GitHub",
    description: "Repositories, issues, pull requests and Actions on github.com.",
    icon: "github",
    transport: "http",
    url: "https://api.githubcopilot.com/mcp/",
    authMode: "oauth",
    staticClientEnv: "GITHUB_OAUTH",
    scopes: "repo read:org workflow",
    authorizationServer: {
      issuer: "https://github.com/login/oauth",
      authorizationServerUrl: "https://github.com/login/oauth",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
    },
    hardApprovalTools: ["merge_pull_request", "delete_file"],
  },
  {
    slug: "google",
    name: "Google",
    description: "Gmail, Calendar and Drive for your Google account (works with personal Gmail).",
    icon: "google",
    transport: "http",
    url: "/mcp/google",
    authMode: "first_party",
    staticClientEnv: "GOOGLE_OAUTH",
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.readonly",
    ].join(" "),
    authParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    hardApprovalTools: ["gmail_send_draft", "drive_share_file", "calendar_invite"],
  },
  {
    slug: "linear",
    name: "Linear",
    description: "Issues, projects and cycles in Linear.",
    icon: "linear",
    transport: "http",
    url: "https://mcp.linear.app/mcp",
    authMode: "oauth",
  },
  {
    slug: "notion",
    name: "Notion",
    description: "Search, read and write pages and databases in Notion.",
    icon: "notion",
    transport: "http",
    url: "https://mcp.notion.com/mcp",
    authMode: "oauth",
  },
  {
    slug: "sentry",
    name: "Sentry",
    description: "Errors, issues and releases in Sentry.",
    icon: "sentry",
    transport: "http",
    url: "https://mcp.sentry.dev/mcp",
    authMode: "oauth",
  },
  // Local-command templates
  {
    slug: "filesystem",
    name: "Filesystem",
    description: "Read and write files in a folder (runs as a local command).",
    icon: "folder",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/workspace"],
    runOn: "cloud_computer",
    authMode: "none",
    template: true,
  },
  {
    slug: "postgres",
    name: "Postgres",
    description: "Query a Postgres database (read-only).",
    icon: "database",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost:5432/postgres"],
    runOn: "device",
    authMode: "none",
    template: true,
  },
]

export const catalogBySlug = (slug: string) => CATALOG.find((c) => c.slug === slug)
