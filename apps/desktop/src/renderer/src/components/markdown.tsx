import { memo, useMemo, type ComponentProps, type ReactNode } from "react"
import { defaultComponents, Streamdown } from "streamdown"

import { linkMentions, MENTION_HREF } from "@/lib/mentions"
import { useBots } from "@/lib/queries"

import { MentionChip } from "./mention-chip"

// Message markdown, with "@Name" drawn as a chip for every bot on the team
export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const bots = useBots()
  const team = useMemo(() => bots.data ?? [], [bots.data])
  const source = useMemo(() => linkMentions(text, team), [text, team])
  const components = useMemo(
    () => ({
      a: ({ href, children, node: _node, ...rest }: ComponentProps<"a"> & { node?: unknown }) => {
        if (href?.startsWith(MENTION_HREF)) {
          return <MentionChip bot={team.find((b) => b.id === href.slice(MENTION_HREF.length))} at />
        }
        // Other links keep Streamdown's own link, with its confirm step
        const A = defaultComponents.a as (p: ComponentProps<"a"> & { node?: unknown }) => ReactNode
        return (
          <A href={href} node={_node} {...rest}>
            {children}
          </A>
        )
      },
    }),
    [team],
  )
  return (
    <Streamdown isAnimating={streaming} mode={streaming ? "streaming" : "static"} components={components}>
      {source}
    </Streamdown>
  )
})
