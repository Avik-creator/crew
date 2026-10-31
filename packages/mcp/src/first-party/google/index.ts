import type { FirstPartyConnector } from "../types"
import { googleAuth, googleFlow } from "./auth"
import { createGoogleServer } from "./server"

export const google: FirstPartyConnector = {
  slug: "google",
  flow: googleFlow,
  createServer: (connection, server) => createGoogleServer(googleAuth(connection, server)),
}
