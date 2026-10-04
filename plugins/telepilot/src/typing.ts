// Typing pump: bun typing.ts <marker-file> <chat_id> [session]. Keeps "typing…" alive every 4 s
// while the marker exists (the Stop hook removes it), for at most 30 minutes. For a named session
// it also posts "⏳ still working" at 2, 5, 10 and 20 minutes so long jobs never look silent.

import { existsSync } from 'fs'
import { sendText, sendTyping } from './lib/notify'

const [marker, chatId, label] = process.argv.slice(2)
const start = Date.now()
const deadline = start + 30 * 60_000
const pings = [2, 5, 10, 20]
process.on('SIGHUP', () => {}) // outlive the hook that started us
while (marker && chatId && existsSync(marker) && Date.now() < deadline) {
  await sendTyping(chatId).catch(() => {})
  const mins = (Date.now() - start) / 60_000
  if (label && pings.length && mins >= pings[0]!) {
    const m = pings.shift()!
    await sendText(`⏳ [${label}] still working (${m} min)`, chatId).catch(() => {})
  }
  await Bun.sleep(4000)
}
