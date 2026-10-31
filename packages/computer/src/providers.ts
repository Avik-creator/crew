import { DaytonaProvider } from "./daytona"
import { E2BProvider } from "./e2b"
import type { ComputerProvider } from "./provider"

type ProviderName = ComputerProvider["name"]

const registry: Record<ProviderName, () => ComputerProvider> = {
  e2b: () => new E2BProvider(),
  daytona: () => new DaytonaProvider(),
}
const instances = new Map<ProviderName, ComputerProvider>()

// An existing computer keeps its provider; new ones use COMPUTER_PROVIDER
export function getProvider(name?: ProviderName | null): ComputerProvider {
  const key = name ?? ((process.env.COMPUTER_PROVIDER as ProviderName | undefined) || "e2b")
  const make = registry[key]
  if (!make) throw new Error(`Unknown computer provider "${key}"`)
  let p = instances.get(key)
  if (!p) instances.set(key, (p = make()))
  return p
}
