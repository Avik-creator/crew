import { Check, Copy, ExternalLink } from "lucide-react"
import { useEffect, useState } from "react"
import type { LinkSafetyModalProps } from "streamdown"

import { Button } from "./ui/button"
import { Dialog, DialogContent } from "./ui/dialog"

// Streamdown's "open this link?" step, drawn with our own dialog
export function LinkSafetyDialog({ isOpen, onClose, onConfirm, url }: LinkSafetyModalProps) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent
        title="Open external link?"
        description="This link opens in your browser."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(url).then(() => setCopied(true))
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                onConfirm()
                onClose()
              }}
            >
              <ExternalLink />
              Open
            </Button>
          </>
        }
      >
        <div className="selectable max-h-32 overflow-y-auto break-all rounded-lg border border-line bg-raised px-3 py-2 font-mono text-[12.5px] text-fg">
          {url}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function renderLinkSafetyModal(props: LinkSafetyModalProps) {
  return <LinkSafetyDialog {...props} />
}
