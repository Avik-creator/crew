import type { BrowserControl, ComputerDriver, DesktopAction } from "./driver"

// Defers getting a driver until a tool actually needs one, so a chat turn that
// never touches the screen never starts or resumes the computer
export class LazyDriver implements ComputerDriver {
  private driver?: Promise<ComputerDriver>
  openApp?: (name: string) => Promise<string>
  saveLogins?: () => Promise<string[]>
  browser?: BrowserControl

  constructor(
    readonly kind: "cloud" | "device",
    private factory: () => Promise<ComputerDriver>,
    features: { openApp?: boolean; saveLogins?: boolean; browser?: boolean } = {},
  ) {
    if (features.openApp) this.openApp = async (name) => (await this.get()).openApp!(name)
    if (features.saveLogins) this.saveLogins = async () => (await this.get()).saveLogins!()
    if (features.browser) {
      this.browser = {
        read: async (maxChars) => (await this.get()).browser!.read(maxChars),
        controls: async () => (await this.get()).browser!.controls(),
        act: async (action) => (await this.get()).browser!.act(action),
      }
    }
  }

  private get() {
    this.driver ??= this.factory().catch((err) => {
      this.driver = undefined
      throw err
    })
    return this.driver
  }

  async bash(command: string, opts?: { timeoutMs?: number; cwd?: string }) {
    return (await this.get()).bash(command, opts)
  }
  async readFile(path: string) {
    return (await this.get()).readFile(path)
  }
  async writeFile(path: string, content: string) {
    return (await this.get()).writeFile(path, content)
  }
  async listFiles(path: string) {
    return (await this.get()).listFiles(path)
  }
  async screenshot() {
    return (await this.get()).screenshot()
  }
  async act(actions: DesktopAction[]) {
    return (await this.get()).act(actions)
  }
  async openUrl(url: string) {
    return (await this.get()).openUrl(url)
  }
}
