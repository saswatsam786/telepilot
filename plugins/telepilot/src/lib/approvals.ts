// Remote approvals for worker sessions. The PermissionRequest hook creates a pending
// approval and sends its code ONLY to Telegram; the hub's `approve` tool decides it when
// the user types "approve <code>". Codes are random, single-use, expire, and three
// wrong codes in ten minutes lock approvals for ten minutes.

import { randomBytes } from 'crypto'
import { mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { audit } from './audit'
import { loadState, updateState } from './registry'
import { paths, readJson, withLock, writeJsonAtomic } from './util'

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789' // no l/o/i/0/1: easy to type on a phone
const LOCK_WINDOW_MS = 10 * 60_000
const MAX_FAILURES = 3

export type Approval = {
  code: string
  session: string
  chatId?: string
  tool: string
  preview: string
  createdAt: number
  expiresAt: number
  status: 'pending' | 'allow' | 'deny' | 'expired'
  decidedAt?: number
  action?: 'unlock' | 'allow-tools' // a built-in action to run once the owner says yes
}

const fileFor = (code: string) => join(paths.approvals(), `${code}.json`)

export function newCode(): string {
  return [...randomBytes(6)].map(b => ALPHABET[b % ALPHABET.length]).join('')
}

export async function createApproval(a: { session: string; chatId?: string; tool: string; preview: string; ttlSec: number; action?: 'unlock' | 'allow-tools' }): Promise<Approval> {
  mkdirSync(paths.approvals(), { recursive: true, mode: 0o700 })
  const now = Date.now()
  const approval: Approval = {
    code: newCode(),
    session: a.session,
    chatId: a.chatId,
    tool: a.tool,
    preview: a.preview,
    createdAt: now,
    expiresAt: now + a.ttlSec * 1000,
    status: 'pending',
    ...(a.action ? { action: a.action } : {}),
  }
  writeJsonAtomic(fileFor(approval.code), approval)
  return approval
}

export function getApproval(code: string): Approval | null {
  return readJson<Approval | null>(fileFor(code), null)
}

export function listPending(): Approval[] {
  let files: string[] = []
  try {
    files = readdirSync(paths.approvals()).filter(f => f.endsWith('.json'))
  } catch {}
  return files
    .map(f => readJson<Approval | null>(join(paths.approvals(), f), null))
    .filter((a): a is Approval => !!a && a.status === 'pending' && a.expiresAt > Date.now())
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function decide(code: string, decision: 'allow' | 'deny'): Promise<{ ok: boolean; message: string }> {
  const recent = loadState().approvalFailures.filter(t => Date.now() - t < LOCK_WINDOW_MS)
  if (recent.length >= MAX_FAILURES) {
    return { ok: false, message: 'Too many wrong approval codes — approvals are locked for 10 minutes.' }
  }
  const result = await withLock(`approval-${code}`, () => {
    const a = readJson<Approval | null>(fileFor(code), null)
    if (!a) return { ok: false, message: `No pending request with code ${code}.`, failure: true }
    if (a.status !== 'pending') return { ok: false, message: `Request ${code} was already ${a.status}.`, failure: false }
    if (Date.now() > a.expiresAt) {
      writeJsonAtomic(fileFor(code), { ...a, status: 'expired' })
      return { ok: false, message: `Request ${code} expired.`, failure: false }
    }
    writeJsonAtomic(fileFor(code), { ...a, status: decision, decidedAt: Date.now() })
    return { ok: true, message: `${decision === 'allow' ? '✅ Approved' : '❌ Denied'} [${a.session}] ${a.tool}`, failure: false }
  })
  audit('approval', { code, decision, ok: result.ok, result: result.message })
  if (result.failure) {
    await updateState(s => {
      s.approvalFailures = [...s.approvalFailures.filter(t => Date.now() - t < LOCK_WINDOW_MS), Date.now()]
    })
  }
  return { ok: result.ok, message: result.message }
}

export async function waitForDecision(code: string, timeoutMs: number, pollMs = 1000): Promise<'allow' | 'deny' | 'timeout'> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const a = readJson<Approval | null>(fileFor(code), null)
    if (a?.status === 'allow' || a?.status === 'deny') return a.status
    await Bun.sleep(pollMs)
  }
  await withLock(`approval-${code}`, () => {
    const a = readJson<Approval | null>(fileFor(code), null)
    if (a?.status === 'pending') writeJsonAtomic(fileFor(code), { ...a, status: 'expired' })
  })
  return 'timeout'
}
