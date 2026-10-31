/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly RENDERER_VITE_TRIGGER_API_URL?: string
}

declare module "@novnc/novnc" {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: { credentials?: { password?: string }; wsProtocols?: string[] })
    viewOnly: boolean
    scaleViewport: boolean
    resizeSession: boolean
    clipViewport: boolean
    background: string
    qualityLevel: number
    compressionLevel: number
    focusOnClick: boolean
    disconnect(): void
    focus(): void
    sendCtrlAltDel(): void
  }
}
