import { TurnRunner } from "@crew/agent"

import { publish } from "./bus"

// Bot turns run in this process, so their events go straight to the open apps
export const runner = new TurnRunner({ emit: async (userId, event) => publish(userId, event) })
