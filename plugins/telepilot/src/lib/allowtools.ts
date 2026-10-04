// One-time consent, given by the owner's own tap in Telegram: add a single rule so sessions may
// use telepilot's tools without asking each time. Validates, backs up, and restores on failure,
// so it can never leave settings.json broken.

import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { audit } from './audit'
import { CLAUDE_DIR } from './util'

export const TOOLS_RULE = 'mcp__plugin_telepilot_telepilot'
const settingsFile = () => process.env.TELEPILOT_SETTINGS_FILE ?? join(CLAUDE_DIR(), 'settings.json')

export function toolsAllowed(): boolean {
  try {
    return (JSON.parse(readFileSync(settingsFile(), 'utf8')).permissions?.allow ?? []).includes(TOOLS_RULE)
  } catch {
    return false
  }
}

export function allowTelepilotTools(): { ok: boolean; text: string } {
  const f = settingsFile()
  let s: any = {}
  if (existsSync(f)) {
    try {
      s = JSON.parse(readFileSync(f, 'utf8'))
    } catch {
      return { ok: false, text: `⚠️ ${f} isn't valid JSON, so I didn't touch it. Fix it at the Mac first.` }
    }
    copyFileSync(f, `${f}.bak-telepilot`)
  }
  s.permissions ??= {}
  s.permissions.allow ??= []
  if (!s.permissions.allow.includes(TOOLS_RULE)) s.permissions.allow.push(TOOLS_RULE)
  try {
    writeFileSync(`${f}.tmp`, JSON.stringify(s, null, 2) + '\n')
    JSON.parse(readFileSync(`${f}.tmp`, 'utf8'))
    renameSync(`${f}.tmp`, f)
  } catch (err) {
    if (existsSync(`${f}.bak-telepilot`)) copyFileSync(`${f}.bak-telepilot`, f)
    return { ok: false, text: `⚠️ Couldn't update settings (${err}); nothing changed.` }
  }
  audit('allow-tools', { rule: TOOLS_RULE })
  return { ok: true, text: "✅ telepilot's tools are allowed. Try: take a photo" }
}
