import { TRIGGER } from "@crew/shared"
import { streams } from "@trigger.dev/sdk"
import type { UIMessageChunk } from "ai"

// The live reply of a turn, read by the app with useRealtimeStream
export const uiStream = streams.define<UIMessageChunk>({ id: TRIGGER.uiStream })
