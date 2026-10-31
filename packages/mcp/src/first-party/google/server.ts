import { calendar } from "@googleapis/calendar"
import { drive } from "@googleapis/drive"
import { gmail, type gmail_v1 } from "@googleapis/gmail"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { OAuth2Client } from "google-auth-library"
import { createMimeMessage } from "mimetext"
import { z } from "zod"

const READ = { readOnlyHint: true, openWorldHint: true }
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
const SEND = { readOnlyHint: false, destructiveHint: true, openWorldHint: true }

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
})

const header = (msg: gmail_v1.Schema$Message, name: string) =>
  msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ""

// Plain text of a message: the first text/plain part, else stripped HTML
function bodyText(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return ""
  const decode = (d?: string | null) => (d ? Buffer.from(d, "base64url").toString("utf8") : "")
  if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data)
  for (const p of part.parts ?? []) {
    const t = bodyText(p)
    if (t) return t
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return decode(part.body.data)
      .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }
  return ""
}

// Gmail, Calendar and Drive tools for one Google account. Sending, sharing and
// inviting are separate tools so they can always require approval.
export function createGoogleServer(auth: OAuth2Client) {
  const server = new McpServer({ name: "crew-google", version: "1.0.0" })
  // googleapis-common pins its own google-auth-library; the client is compatible
  const opts = { auth: auth as never }
  const mail = gmail({ version: "v1", ...opts })
  const cal = calendar({ version: "v3", ...opts })
  const files = drive({ version: "v3", ...opts })

  server.registerTool(
    "gmail_search",
    {
      title: "Search email",
      description: "Search Gmail with Gmail search syntax (e.g. 'from:alice is:unread newer_than:7d').",
      inputSchema: { query: z.string(), max: z.number().int().min(1).max(50).default(10) },
      annotations: READ,
    },
    async ({ query, max }) => {
      const list = await mail.users.messages.list({ userId: "me", q: query, maxResults: max })
      const messages = await Promise.all(
        (list.data.messages ?? []).map(async (m) => {
          const { data } = await mail.users.messages.get({
            userId: "me",
            id: m.id!,
            format: "metadata",
            metadataHeaders: ["From", "To", "Subject", "Date"],
          })
          return {
            id: data.id,
            threadId: data.threadId,
            from: header(data, "From"),
            subject: header(data, "Subject"),
            date: header(data, "Date"),
            snippet: data.snippet,
            unread: data.labelIds?.includes("UNREAD") ?? false,
          }
        }),
      )
      return text(messages.length ? messages : "No messages matched.")
    },
  )

  server.registerTool(
    "gmail_read",
    {
      title: "Read email",
      description: "Read one email by id, with its full text.",
      inputSchema: { id: z.string() },
      annotations: READ,
    },
    async ({ id }) => {
      const { data } = await mail.users.messages.get({ userId: "me", id, format: "full" })
      return text({
        id: data.id,
        threadId: data.threadId,
        from: header(data, "From"),
        to: header(data, "To"),
        cc: header(data, "Cc"),
        subject: header(data, "Subject"),
        date: header(data, "Date"),
        messageId: header(data, "Message-ID"),
        body: bodyText(data.payload).slice(0, 30_000),
      })
    },
  )

  server.registerTool(
    "gmail_create_draft",
    {
      title: "Write a draft",
      description: "Create a draft email. Nothing is sent until gmail_send_draft. Pass replyToId to reply in a thread.",
      inputSchema: {
        to: z.array(z.string()).min(1),
        subject: z.string(),
        body: z.string(),
        cc: z.array(z.string()).optional(),
        replyToId: z.string().optional(),
      },
      annotations: WRITE,
    },
    async ({ to, subject, body, cc, replyToId }) => {
      const msg = createMimeMessage()
      const profile = await mail.users.getProfile({ userId: "me" })
      msg.setSender(profile.data.emailAddress!)
      msg.setTo(to)
      if (cc?.length) msg.setCc(cc)
      msg.setSubject(subject)
      msg.addMessage({ contentType: "text/plain", data: body })
      let threadId: string | undefined
      if (replyToId) {
        const { data } = await mail.users.messages.get({
          userId: "me",
          id: replyToId,
          format: "metadata",
          metadataHeaders: ["Message-ID", "References"],
        })
        threadId = data.threadId ?? undefined
        const parent = header(data, "Message-ID")
        if (parent) {
          msg.setHeader("In-Reply-To", parent)
          msg.setHeader("References", [header(data, "References"), parent].filter(Boolean).join(" "))
        }
      }
      const { data } = await mail.users.drafts.create({
        userId: "me",
        requestBody: { message: { raw: Buffer.from(msg.asRaw()).toString("base64url"), threadId } },
      })
      return text({ draftId: data.id, note: "Draft saved. Send it with gmail_send_draft." })
    },
  )

  server.registerTool(
    "gmail_send_draft",
    {
      title: "Send a draft",
      description: "Send a draft created with gmail_create_draft.",
      inputSchema: { draftId: z.string() },
      annotations: SEND,
    },
    async ({ draftId }) => {
      const { data } = await mail.users.drafts.send({ userId: "me", requestBody: { id: draftId } })
      return text({ sent: true, messageId: data.id, threadId: data.threadId })
    },
  )

  server.registerTool(
    "gmail_update_labels",
    {
      title: "Label email",
      description: "Add or remove labels on an email. Archive = remove INBOX; mark read = remove UNREAD.",
      inputSchema: { id: z.string(), add: z.array(z.string()).default([]), remove: z.array(z.string()).default([]) },
      annotations: WRITE,
    },
    async ({ id, add, remove }) => {
      await mail.users.messages.modify({
        userId: "me",
        id,
        requestBody: { addLabelIds: add, removeLabelIds: remove },
      })
      return text("Done.")
    },
  )

  server.registerTool(
    "calendar_list_events",
    {
      title: "List events",
      description: "List events on the primary calendar between two ISO times, optionally matching text.",
      inputSchema: {
        timeMin: z.string().describe("ISO 8601"),
        timeMax: z.string().describe("ISO 8601"),
        query: z.string().optional(),
      },
      annotations: READ,
    },
    async ({ timeMin, timeMax, query }) => {
      const { data } = await cal.events.list({
        calendarId: "primary",
        timeMin,
        timeMax,
        q: query,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 100,
      })
      return text(
        (data.items ?? []).map((e) => ({
          id: e.id,
          summary: e.summary,
          start: e.start?.dateTime ?? e.start?.date,
          end: e.end?.dateTime ?? e.end?.date,
          location: e.location,
          attendees: e.attendees?.map((a) => `${a.email} (${a.responseStatus})`),
          link: e.htmlLink,
        })),
      )
    },
  )

  server.registerTool(
    "calendar_create_event",
    {
      title: "Add an event",
      description: "Create an event on your own calendar without inviting anyone (use calendar_invite for guests).",
      inputSchema: {
        summary: z.string(),
        start: z.string().describe("ISO 8601 with offset"),
        end: z.string().describe("ISO 8601 with offset"),
        description: z.string().optional(),
        location: z.string().optional(),
      },
      annotations: WRITE,
    },
    async ({ summary, start, end, description, location }) => {
      const { data } = await cal.events.insert({
        calendarId: "primary",
        requestBody: { summary, description, location, start: { dateTime: start }, end: { dateTime: end } },
      })
      return text({ id: data.id, link: data.htmlLink })
    },
  )

  server.registerTool(
    "calendar_invite",
    {
      title: "Invite guests",
      description: "Add guests to an event and email them the invitation.",
      inputSchema: { eventId: z.string(), emails: z.array(z.string()).min(1) },
      annotations: SEND,
    },
    async ({ eventId, emails }) => {
      const { data: event } = await cal.events.get({ calendarId: "primary", eventId })
      const attendees = [...(event.attendees ?? []), ...emails.map((email) => ({ email }))]
      const { data } = await cal.events.patch({
        calendarId: "primary",
        eventId,
        sendUpdates: "all",
        requestBody: { attendees },
      })
      return text({ id: data.id, attendees: data.attendees?.map((a) => a.email) })
    },
  )

  server.registerTool(
    "drive_search",
    {
      title: "Search Drive",
      description: "Find files in Google Drive by name or content.",
      inputSchema: { query: z.string(), max: z.number().int().min(1).max(50).default(20) },
      annotations: READ,
    },
    async ({ query, max }) => {
      const escaped = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
      const { data } = await files.files.list({
        q: `(name contains '${escaped}' or fullText contains '${escaped}') and trashed = false`,
        pageSize: max,
        fields: "files(id,name,mimeType,modifiedTime,webViewLink,owners(emailAddress))",
      })
      return text(data.files ?? [])
    },
  )

  server.registerTool(
    "drive_read_file",
    {
      title: "Read a file",
      description: "Read a Drive file as text. Google Docs come back as text, Sheets as CSV.",
      inputSchema: { fileId: z.string() },
      annotations: READ,
    },
    async ({ fileId }) => {
      const { data: meta } = await files.files.get({ fileId, fields: "id,name,mimeType,size" })
      const exportAs: Record<string, string> = {
        "application/vnd.google-apps.document": "text/plain",
        "application/vnd.google-apps.spreadsheet": "text/csv",
        "application/vnd.google-apps.presentation": "text/plain",
      }
      const target = meta.mimeType ? exportAs[meta.mimeType] : undefined
      const res = target
        ? await files.files.export({ fileId, mimeType: target }, { responseType: "text" })
        : await files.files.get({ fileId, alt: "media" }, { responseType: "text" })
      return text({ name: meta.name, mimeType: meta.mimeType, content: String(res.data).slice(0, 50_000) })
    },
  )

  server.registerTool(
    "drive_create_file",
    {
      title: "Create a file",
      description: "Create a file in Drive. Use mimeType application/vnd.google-apps.document to make a Google Doc from text.",
      inputSchema: { name: z.string(), content: z.string(), mimeType: z.string().default("text/plain") },
      annotations: WRITE,
    },
    async ({ name, content, mimeType }) => {
      const { data } = await files.files.create({
        requestBody: { name, mimeType },
        media: { mimeType: "text/plain", body: content },
        fields: "id,name,webViewLink",
      })
      return text(data)
    },
  )

  server.registerTool(
    "drive_share_file",
    {
      title: "Share a file",
      description: "Share a Drive file with someone by email.",
      inputSchema: { fileId: z.string(), email: z.string(), role: z.enum(["reader", "commenter", "writer"]).default("reader") },
      annotations: SEND,
    },
    async ({ fileId, email, role }) => {
      await files.permissions.create({ fileId, requestBody: { type: "user", role, emailAddress: email } })
      return text(`Shared with ${email} as ${role}.`)
    },
  )

  return server
}
