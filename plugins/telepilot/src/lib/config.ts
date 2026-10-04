// User config (~/.telepilot/config.json) plus the bits we borrow from the official
// Telegram channel's state dir: the bot token (.env) and the owner's chat id (access.json).

import { readFileSync } from 'fs'
import { join } from 'path'
import { CLAUDE_DIR, expandHome, paths, readJson } from './util'

export type Config = {
  hubName: string // session name of the hub; workers only trust routing headers from it
  transport: 'telegram' | 'imessage' // how workers reach the phone (matches the hub's channel)
  telegramStateDir?: string // the official plugin's state dir (default ~/.claude/channels/telegram)
  ownerChatId?: string // default (telegram): first allowFrom entry in access.json (DM chat id == user id)
  workerModel?: string
  workerPermissionMode?: string
  approvalTimeoutSec: number
  projectRoots: string[]
  whisperModel?: string
  hubDir?: string // remembered by the launcher; the default folder for the "mac" session
}

const DEFAULTS: Config = {
  hubName: 'hub',
  transport: 'telegram',
  approvalTimeoutSec: 540,
  projectRoots: ['~/code', '~/Code', '~/Projects', '~/projects', '~/Developer', '~/dev', '~/Desktop', '~/Documents/GitHub'],
}

export function loadConfig(): Config {
  return { ...DEFAULTS, ...readJson<Partial<Config>>(paths.config(), {}) }
}

export function telegramStateDir(cfg = loadConfig()): string {
  return expandHome(process.env.TELEGRAM_STATE_DIR ?? cfg.telegramStateDir ?? join(CLAUDE_DIR(), 'channels', 'telegram'))
}

export function botToken(cfg = loadConfig()): string | undefined {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN
  try {
    const env = readFileSync(join(telegramStateDir(cfg), '.env'), 'utf8')
    const m = env.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m)
    return m?.[1]?.trim() || undefined
  } catch {
    return undefined
  }
}

export function ownerChatId(cfg = loadConfig()): string | undefined {
  if (cfg.ownerChatId || cfg.transport !== 'telegram') return cfg.ownerChatId
  const access = readJson<{ allowFrom?: string[] }>(join(telegramStateDir(cfg), 'access.json'), {})
  return access.allowFrom?.[0]
}
