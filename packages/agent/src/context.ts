import type { Bot, Thread } from "@crew/db"
import type { AppEvent, TurnPayload } from "@crew/shared"

// Queues another bot turn and returns its run id. TurnRunner implements it;
// tests can collect payloads instead.
export interface TurnDispatcher {
  enqueue(payload: TurnPayload): Promise<string>
}

// Tells the person's open apps that something changed
export interface EventSink {
  emit(userId: string, event: AppEvent): Promise<void>
}

export type TurnContext = {
  userId: string
  userName: string
  bot: Bot
  thread: Thread
  runId: string
  payload: TurnPayload
  background: boolean
  dispatcher: TurnDispatcher
  events: EventSink
}
