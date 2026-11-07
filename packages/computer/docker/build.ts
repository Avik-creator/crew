// Builds the docker provider's image ahead of the first bot that needs it.
// Run: pnpm computer:docker
import { ensureDockerImage } from "../src/docker"

console.log(`Ready: ${await ensureDockerImage()}`)
