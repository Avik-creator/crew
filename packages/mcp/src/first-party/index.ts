import { google } from "./google"
import type { FirstPartyConnector } from "./types"

export type { FirstPartyConnector } from "./types"

const registry = new Map<string, FirstPartyConnector>([[google.slug, google]])

export const firstParty = (slug: string) => registry.get(slug)
