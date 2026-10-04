// Append-only record of everything done remotely: routing, approvals, guard blocks, panics.
// ~/.telepilot/audit.jsonl (owner-only). /audit shows the latest entries.

import { appendFileSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { HOME } from './util'

const file = () => join(HOME(), 'audit.jsonl')

export function audit(event: string, data: Record<string, unknown> = {}): void {
  try {
    mkdirSync(HOME(), { recursive: true, mode: 0o700 })
    appendFileSync(file(), JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + '\n', { mode: 0o600 })
  } catch {}
}

export function recentAudit(n = 12): Array<Record<string, any>> {
  try {
    return readFileSync(file(), 'utf8').trim().split('\n').slice(-n).map(l => JSON.parse(l))
  } catch {
    return []
  }
}
