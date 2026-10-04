// Keeps Telegram's "typing…" indicator alive for the length of a turn. The first tool call
// of a phone-driven turn starts a small detached pump (src/typing.ts); the Stop hook removes
// its marker file and the pump exits within a few seconds.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { loadConfig } from './config'
import { HOME } from './util'

const dir = () => join(HOME(), 'typing')
const marker = (sessionId: string) => join(dir(), `${sessionId.replace(/[^\w-]/g, '')}.json`)

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function startTyping(sessionId: string, chatId: string, label?: string): void {
  if (loadConfig().transport !== 'telegram' || process.env.TELEPILOT_DRY_RUN === '1') return
  const file = marker(sessionId)
  try {
    if (existsSync(file) && alive(JSON.parse(readFileSync(file, 'utf8')).pid)) return
  } catch {}
  mkdirSync(dir(), { recursive: true, mode: 0o700 })
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'typing.ts'), file, chatId, label ?? ''], {
    stdio: ['ignore', 'ignore', 'ignore'],
    env: process.env as Record<string, string>,
  })
  proc.unref()
  writeFileSync(file, JSON.stringify({ pid: proc.pid, chatId, startedAt: Date.now() }), { mode: 0o600 })
}

export function stopTyping(sessionId: string): void {
  rmSync(marker(sessionId), { force: true })
}
