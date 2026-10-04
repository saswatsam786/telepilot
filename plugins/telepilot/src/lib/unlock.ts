// Remote unlock/lock. /unlock is a fixed hub command: it always asks the owner (yes/no buttons),
// types the login password that only lives in their Keychain (service "telepilot-unlock", stored
// at the Mac with `telepilot unlock-setup`), re-checks the lock screen and reports honestly.
// Three failures in 30 minutes pause it, so macOS never locks the account for too many attempts.

import { audit } from './audit'
import { loadState, updateState } from './registry'
import { run } from './util'
import { explainFailure, screenState } from '../tools/mac'

const SERVICE = 'telepilot-unlock'
const WINDOW_MS = 30 * 60_000
const MAX_FAILURES = 3
// Tests: TELEPILOT_FAKE_UNLOCK = ok | fail | nopw, TELEPILOT_FAKE_LOCKED = 1 | 0
const fake = () => process.env.TELEPILOT_FAKE_UNLOCK

const JXA = `ObjC.import('Cocoa');
const pw = $.NSProcessInfo.processInfo.environment.objectForKey('TELEPILOT_UNLOCK_PW').js;
const se = Application('System Events');
se.keyCode(56); // shift: wake the password field without typing anything
delay(0.4);
se.keystroke(pw);
delay(0.2);
se.keyCode(36); // Return`

export async function hasUnlockPassword(): Promise<boolean> {
  if (fake()) return fake() !== 'nopw'
  return (await run(['security', 'find-generic-password', '-s', SERVICE], { timeoutMs: 8_000 })).code === 0
}

export async function isLocked(): Promise<boolean> {
  if (fake()) return process.env.TELEPILOT_FAKE_LOCKED !== '0'
  return (await screenState()).locked
}

export function unlockPaused(): boolean {
  const recent = (loadState().unlockFailures ?? []).filter(t => Date.now() - t < WINDOW_MS)
  return recent.length >= MAX_FAILURES
}

async function record(ok: boolean): Promise<void> {
  audit('unlock', { ok })
  await updateState(s => {
    s.unlockFailures = ok ? [] : [...(s.unlockFailures ?? []).filter(t => Date.now() - t < WINDOW_MS), Date.now()]
  })
}

export async function unlockNow(): Promise<{ ok: boolean; text: string }> {
  if (unlockPaused()) return { ok: false, text: '⏸ Unlock is paused after 3 failed tries (protects your account). Try again in 30 minutes, or unlock at the Mac.' }
  if (fake()) {
    const ok = fake() === 'ok'
    await record(ok)
    return { ok, text: ok ? '🔓 Unlocked ✅' : '🔒 Still locked.' }
  }
  await run(['caffeinate', '-u', '-t', '2'], { timeoutMs: 5_000 })
  if (!(await screenState()).locked) return { ok: true, text: '🔓 Your Mac is already unlocked.' }
  const kc = await run(['security', 'find-generic-password', '-s', SERVICE, '-w'], { timeoutMs: 8_000 })
  const pw = kc.stdout.replace(/\n+$/, '')
  if (kc.code !== 0 || !pw) return { ok: false, text: '🔐 Unlock isn\'t set up yet. At the Mac, run once: telepilot unlock-setup' }
  // the password goes to osascript through its environment, never its command line
  const r = await run(['osascript', '-l', 'JavaScript', '-e', JXA], { timeoutMs: 15_000, env: { ...process.env, TELEPILOT_UNLOCK_PW: pw } })
  await Bun.sleep(1_500)
  const ok = !(await screenState()).locked
  await record(ok)
  if (ok) return { ok, text: '🔓 Unlocked ✅' }
  const why = explainFailure((r.stderr || r.stdout).trim(), r.timedOut)
  return {
    ok,
    text: `🔒 Still locked. ${why ?? 'macOS blocked the typed password on the lock screen (Secure Input), or the stored password is wrong.'} Use Touch ID / Apple Watch, or re-run telepilot unlock-setup at the Mac.`,
  }
}

export async function lockNow(): Promise<string> {
  audit('lock', {})
  if (fake()) return '🔒 Locked.'
  const r = await run(['osascript', '-e', 'tell application "System Events" to keystroke "q" using {control down, command down}'], { timeoutMs: 10_000 })
  if (r.code === 0) return '🔒 Locked.'
  await run(['pmset', 'displaysleepnow'])
  return '🔒 Display is asleep (it locks if "require password after sleep" is on).'
}
