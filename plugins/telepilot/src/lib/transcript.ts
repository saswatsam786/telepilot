// Reads Claude Code session transcripts (~/.claude/projects/<dir>/<session>.jsonl).
// Hooks use it to tell whether the current turn was routed from the hub, and the hub
// uses it to summarize what a session has been doing.
//
// Verified format (Claude Code 2.1.288): a cross-session message is a `user` line with
// origin {kind: "peer", name: <sender session name>, verifiedPeerPid, body: <raw text>};
// a typed or --bg prompt has origin {kind: "human"}.

import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync } from 'fs'
import { join } from 'path'
import { parseHeader, type Header } from './routing'
import { CLAUDE_DIR, truncate } from './util'

type Line = Record<string, any>

export function findTranscript(sessionId: string): string | undefined {
  const root = join(CLAUDE_DIR(), 'projects')
  try {
    for (const dir of readdirSync(root)) {
      const p = join(root, dir, `${sessionId}.jsonl`)
      if (existsSync(p)) return p
    }
  } catch {}
  return undefined
}

export function readTail(path: string, maxBytes = 768 * 1024): Line[] {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    const start = Math.max(0, size - maxBytes)
    const buf = Buffer.alloc(size - start)
    readSync(fd, buf, 0, buf.length, start)
    const lines = buf.toString('utf8').split('\n')
    if (start > 0) lines.shift() // partial first line
    const out: Line[] = []
    for (const l of lines) {
      if (!l.trim()) continue
      try {
        out.push(JSON.parse(l))
      } catch {}
    }
    return out
  } catch {
    return []
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

// Text of a user prompt line, or null for tool results, meta lines and non-user lines.
// Peer and channel messages are recorded with isMeta: true (origin.kind "peer" / "channel"), so they count too.
export function promptText(o: Line): string | null {
  if (o?.type !== 'user' || o.isCompactSummary) return null
  if (o.origin?.kind === 'peer' && typeof o.origin.body === 'string') return o.origin.body
  if (o.isMeta && !['human', 'channel'].includes(o.origin?.kind)) return null
  const c = o.message?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    const texts = c.filter((b: any) => b?.type === 'text').map((b: any) => b.text)
    return texts.length ? texts.join('\n') : null
  }
  return null
}

export type Routed = Header & { origin: 'peer' | 'human' }

// The latest prompt decides: a turn is routed only if that prompt carries a header from
// the hub (and, for peer messages, was really sent by the hub session).
export function routedTurn(lines: Line[], hub: { name: string; pid?: number }): Routed | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const o = lines[i]!
    const text = promptText(o)
    if (text === null) continue
    const h = parseHeader(text)
    if (!h || h.from !== hub.name) return null
    const kind = o.origin?.kind === 'peer' ? 'peer' : 'human'
    if (kind === 'peer') {
      if (o.origin?.name !== hub.name) return null
      if (hub.pid && o.origin?.verifiedPeerPid && o.origin.verifiedPeerPid !== hub.pid) return null
    }
    return { ...h, origin: kind }
  }
  return null
}

// For the hub: was the latest prompt a Telegram/iMessage channel event, and did a reply go out?
export function channelTurn(lines: Line[]): { chatId: string; replied: boolean } | null {
  let replied = false
  for (let i = lines.length - 1; i >= 0; i--) {
    const o = lines[i]!
    if (o?.type === 'assistant' && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b?.type === 'tool_use' && typeof b.name === 'string' && /(telegram|imessage).*__reply$/.test(b.name)) replied = true
      }
      continue
    }
    if (o?.type === 'user' && Array.isArray(o.message?.content) && /\\"action\\": \\"(done|ignore)\\"/.test(JSON.stringify(o.message.content))) replied = true
    const text = promptText(o)
    if (text === null) continue
    if (!/<channel\b[^>]*source="[^"]*(telegram|imessage)/.test(text)) return null
    if (/<channel\b[^>]*>\s*🤖/.test(text)) return null // our own echo: never answer it
    const chat = /chat_id="([^"]+)"/.exec(text)
    return chat ? { chatId: chat[1]!, replied } : null
  }
  return null
}

// Texts of the channel messages in the latest prompt (several can arrive together).
export function latestChannelTexts(lines: Line[]): string[] {
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = promptText(lines[i]!)
    if (text === null) continue
    return [...text.matchAll(/<channel\b[^>]*>([\s\S]*?)<\/channel>/g)].map(m => m[1]!.trim())
  }
  return []
}

export type ChannelMsg = { text: string; userId?: string; chatId?: string; ts?: number }

// Channel messages reach the hub as prompts (user lines, isMeta) or, mid-turn, as
// `queued_command` attachments. Both count as things the user really sent.
export function channelMessages(lines: Line[]): ChannelMsg[] {
  const out: ChannelMsg[] = []
  for (const o of lines) {
    let raw: string | null = null
    if (o?.type === 'user') raw = promptText(o)
    else if (o?.type === 'attachment' && o.attachment?.type === 'queued_command' && typeof o.attachment.prompt === 'string') raw = o.attachment.prompt
    if (!raw || !raw.includes('<channel')) continue
    for (const m of raw.matchAll(/<channel\b([^>]*)>([\s\S]*?)<\/channel>/g)) {
      const attr = (k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(m[1]!)?.[1]
      const ts = attr('ts')
      out.push({ text: m[2]!.trim(), userId: attr('user_id'), chatId: attr('chat_id'), ts: ts ? Date.parse(ts) : undefined })
    }
  }
  return out
}

// Did the owner send exactly `text` at or after `sinceMs`? (Approvals can't come from the model.)
export function ownerSaid(lines: Line[], text: string, sinceMs: number, ownerIds?: string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
  return channelMessages(lines).some(
    m =>
      norm(m.text) === norm(text) &&
      (m.ts === undefined || m.ts >= sinceMs - 5000) &&
      (!ownerIds?.length || !m.userId || ownerIds.includes(m.userId)),
  )
}

// Compact recent activity for /logs.
export function recentActivity(lines: Line[], max = 12): string {
  const out: string[] = []
  for (const o of lines) {
    const text = promptText(o)
    if (text !== null) {
      out.push(`› ${truncate(text.replace(/\[telepilot [^\]]*\]\s*/, '').replace(/\s+/g, ' '), 200)}`)
      continue
    }
    if (o?.type === 'assistant' && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b?.type === 'text' && b.text?.trim()) out.push(`‹ ${truncate(b.text.trim().replace(/\s+/g, ' '), 300)}`)
        else if (b?.type === 'tool_use') out.push(`· ${b.name}`)
      }
    }
  }
  return out.slice(-max).join('\n') || '(no activity yet)'
}
