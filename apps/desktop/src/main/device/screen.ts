import type { ScreenshotPayload } from "@crew/shared"
import { desktopCapturer, screen } from "electron"

// Screenshots are scaled down to this width; the model clicks in these
// coordinates and input.ts scales them back to real screen points
const MAX_WIDTH = 1280

export type ScreenGeometry = { width: number; height: number; scale: number }

export async function captureScreen(): Promise<{ shot: ScreenshotPayload; geometry: ScreenGeometry }> {
  const display = screen.getPrimaryDisplay()
  const { width, height } = display.size
  const scale = Math.max(1, width / MAX_WIDTH)
  const target = { width: Math.round(width / scale), height: Math.round(height / scale) }
  const [source] = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: target })
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error("Crew can't see the screen. Allow Screen Recording for Crew in System Settings → Privacy & Security.")
  }
  const image = source.thumbnail
  const size = image.getSize()
  return {
    shot: { base64: image.toJPEG(70).toString("base64"), mediaType: "image/jpeg", width: size.width, height: size.height },
    geometry: { width: size.width, height: size.height, scale: width / size.width },
  }
}
