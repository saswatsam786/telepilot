// Outbound messages to the user's phone, independent of the hub's inbound channel.
//   telegram: Bot API (send-only; never conflicts with the official channel's poller)
//   imessage: Messages.app via AppleScript, the same way the official iMessage channel replies
// With no destination (or TELEPILOT_DRY_RUN=1) messages go to ~/.telepilot/outbox.jsonl,
// which keeps tests and the fakechat dev loop working without a real chat.

import { appendFileSync, mkdirSync, statSync } from 'fs'
import { basename, extname } from 'path'
import { botToken, loadConfig, ownerChatId } from './config'
import { ECHO_MARK } from './routing'
import { HOME, log, paths, run } from './util'

export const TEXT_LIMIT = 4000 // Telegram rejects > 4096; leave room for the [session] prefix
const PHOTO_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

export function chunk(text: string, limit = TEXT_LIMIT): string[] {
  const out: string[] = []
  let rest = text.trim()
  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    let cut = window.lastIndexOf('\n\n')
    if (cut < limit * 0.5) cut = window.lastIndexOf('\n')
    if (cut < limit * 0.5) cut = window.lastIndexOf(' ')
    if (cut < limit * 0.5) cut = limit
    out.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  if (rest) out.push(rest)
  return out.length ? out : ['(empty)']
}

export type SendResult = { ok: boolean; dryRun?: boolean; error?: string }

function outbox(entry: Record<string, unknown>): SendResult {
  mkdirSync(HOME(), { recursive: true, mode: 0o700 })
  appendFileSync(paths.outbox(), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 })
  return { ok: true, dryRun: true }
}

// Retries network errors, 429 (honouring retry_after) and 5xx; client errors fail fast.
async function telegram(token: string, method: string, body: string | FormData, json: boolean): Promise<SendResult> {
  let last: SendResult = { ok: false, error: 'not sent' }
  for (let attempt = 0; attempt < 3; attempt++) {
    let wait = 1000 * 2 ** attempt
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: json ? { 'content-type': 'application/json' } : undefined,
        body,
        signal: AbortSignal.timeout(20_000),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; parameters?: { retry_after?: number } }
      if (data.ok) return { ok: true }
      last = { ok: false, error: data.description ?? `HTTP ${res.status}` }
      if (res.status !== 429 && res.status < 500) return last
      if (data.parameters?.retry_after !== undefined) wait = data.parameters.retry_after * 1000
    } catch (err) {
      last = { ok: false, error: String(err).replaceAll(token, '<token>') } // fetch errors can include the URL
    }
    if (attempt < 2) await Bun.sleep(Math.min(wait, 30_000))
  }
  return last
}

const tagged = (text: string) => (text.startsWith(ECHO_MARK) ? text : `${ECHO_MARK} ${text}`)

async function imessage(chat: string, payload: { text?: string; file?: string }): Promise<SendResult> {
  const what = payload.file ? '(POSIX file (item 1 of argv))' : '(item 1 of argv)'
  const r = await run(
    ['osascript', '-e', 'on run argv', '-e', `tell application "Messages" to send ${what} to chat id (item 2 of argv)`, '-e', 'end run', payload.file ?? payload.text ?? '', chat],
    { timeoutMs: 30_000 },
  )
  return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() || `osascript exit ${r.code}` }
}

export async function sendText(text: string, chatId?: string, opts: { buttons?: string[][] } = {}): Promise<SendResult> {
  const cfg = loadConfig()
  const chat = chatId ?? ownerChatId(cfg)
  const dry = process.env.TELEPILOT_DRY_RUN === '1'
  if (cfg.transport === 'imessage') {
    if (dry || !chat) return outbox({ kind: 'text', transport: 'imessage', chat_id: chat ?? null, text: tagged(text) })
    for (const part of chunk(tagged(text), 15_000)) {
      const r = await imessage(chat, { text: part })
      if (!r.ok) return (log(`imessage send failed: ${r.error}`), r)
    }
    return { ok: true }
  }
  const token = dry ? undefined : botToken(cfg)
  if (!token || !chat) return outbox({ kind: 'text', chat_id: chat ?? null, text })
  const parts = chunk(text)
  for (const [i, part] of parts.entries()) {
    const keyboard =
      opts.buttons && i === parts.length - 1
        ? { reply_markup: { keyboard: opts.buttons.map(row => row.map(t => ({ text: t }))), one_time_keyboard: true, resize_keyboard: true } }
        : {}
    const body = JSON.stringify({ chat_id: chat, text: part, link_preview_options: { is_disabled: true }, ...keyboard })
    const r = await telegram(token, 'sendMessage', body, true)
    if (!r.ok) {
      log(`telegram send failed: ${r.error}`)
      outbox({ kind: 'text', chat_id: chat, text: part, failed: true, error: r.error })
      return r
    }
  }
  return { ok: true }
}

// "typing…" in Telegram lasts ~5 s; the pump (src/typing.ts) repeats it until the turn ends.
export async function sendTyping(chatId: string): Promise<void> {
  const cfg = loadConfig()
  const token = process.env.TELEPILOT_DRY_RUN === '1' ? undefined : botToken(cfg)
  if (cfg.transport !== 'telegram' || !token) return
  await telegram(token, 'sendChatAction', JSON.stringify({ chat_id: chatId, action: 'typing' }), true)
}

export async function sendFile(path: string, caption?: string, chatId?: string): Promise<SendResult> {
  const cfg = loadConfig()
  const chat = chatId ?? ownerChatId(cfg)
  const dry = process.env.TELEPILOT_DRY_RUN === '1'
  if (cfg.transport === 'imessage') {
    if (dry || !chat) return outbox({ kind: 'file', transport: 'imessage', chat_id: chat ?? null, path, caption })
    await imessage(chat, { text: tagged(caption ?? '📎') })
    return imessage(chat, { file: path })
  }
  const token = dry ? undefined : botToken(cfg)
  if (!token || !chat) return outbox({ kind: 'file', chat_id: chat ?? null, path, caption })
  const asPhoto = PHOTO_EXTS.has(extname(path).toLowerCase()) && statSync(path).size <= 10 * 1024 * 1024
  const form = new FormData()
  form.set('chat_id', chat)
  if (caption) form.set('caption', caption.slice(0, 1000))
  form.set(asPhoto ? 'photo' : 'document', Bun.file(path), basename(path))
  const r = await telegram(token, asPhoto ? 'sendPhoto' : 'sendDocument', form, false)
  if (!r.ok) {
    log(`telegram send file failed: ${r.error}`)
    outbox({ kind: 'file', chat_id: chat, path, caption, failed: true, error: r.error })
  }
  return r
}
