// The routing header the hub puts on every message it forwards, plus deterministic
// parsing of Telegram commands. Worker hooks only act on turns whose prompt starts
// with a header whose `from` is the configured hub name.

export const HEADER_RE = /\[telepilot from=([\w.-]+) chat=([^\s\]]+) to=([\w.-]+)\]/
export const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/i
export const CODE_RE = /^[a-z2-9]{6}$/

// Prefix on everything telepilot posts over iMessage. In a self-chat our own posts come back
// to the hub as if the user typed them; the hub ignores anything starting with this mark.
export const ECHO_MARK = '🤖'

export type Header = { from: string; chatId: string; to: string }

export function makeHeader(chatId: string, to: string, from: string): string {
  return `[telepilot from=${from} chat=${chatId} to=${to}]`
}

export function parseHeader(text: string): Header | null {
  const m = HEADER_RE.exec(text)
  return m ? { from: m[1]!, chatId: m[2]!, to: m[3]! } : null
}

export type Parsed =
  | { kind: 'approve'; decision: 'allow' | 'deny'; code: string }
  | { kind: 'new'; name: string; dir?: string; task?: string }
  | { kind: 'switch'; name: string }
  | { kind: 'logs'; name: string }
  | { kind: 'stop'; name: string }
  | { kind: 'sessions' }
  | { kind: 'help' }
  | { kind: 'screenshot' }
  | { kind: 'to'; name: string; text: string; explicit: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'echo' }
  | { kind: 'panic' }
  | { kind: 'unlock' }
  | { kind: 'photo' }
  | { kind: 'allowtools' }
  | { kind: 'lock' }
  | { kind: 'audit' }
  | { kind: 'bare-answer'; text: string }

const unquote = (s: string) => s.replace(/^(["'])(.*)\1$/s, '$2')

export function parseCommand(input: string): Parsed {
  const text = input.trim()
  let m: RegExpExecArray | null
  if (text.startsWith(ECHO_MARK)) return { kind: 'echo' }
  if (/^\/?(panic|stopall|stop-all)$/i.test(text)) return { kind: 'panic' }
  if (/^\/audit$/i.test(text)) return { kind: 'audit' }
  if (/^\/?(unlock( (it|(the|my) (mac|mac screen|screen|computer|laptop)))?|open (the|my) mac( screen)?)[.!?]*$/i.test(text)) return { kind: 'unlock' }
  if (/^\/?(allowtools|allow-tools|allow tools|allow telepilot tools)[.!?]*$/i.test(text)) return { kind: 'allowtools' }
  if (/^\/?lock( (it|(the|my) (mac|screen|computer|laptop)))?[.!?]*$/i.test(text)) return { kind: 'lock' }
  if (/^\/?(photo|camera|selfie)[.!?]*$|^(please\s+)?(open (the )?camera( and)? )?(take|click|snap|capture) (a |me a )?(photo|picture|pic|selfie)( (with|from) (the )?(camera|webcam))?( please)?[.!?]*$/i.test(text)) return { kind: 'photo' }

  if ((m = /^(approve|allow|yes|y|deny|reject|no|n)\s+([a-z2-9]{6})$/i.exec(text))) {
    const allow = /^(approve|allow|yes|y)$/i.test(m[1]!)
    return { kind: 'approve', decision: allow ? 'allow' : 'deny', code: m[2]!.toLowerCase() }
  }
  if (/^(yes|y|yep|yeah|ok|okay|sure|approve|allow|no|n|nope|deny|reject)[.!]*$/i.test(text)) return { kind: 'bare-answer', text }
  if ((m = /^\/new\s+([\w.-]+)(?:\s+((?:~|\/|\.)\S*))?(?:\s+([\s\S]+))?$/i.exec(text))) {
    return { kind: 'new', name: m[1]!, dir: m[2], task: m[3] ? unquote(m[3].trim()) : undefined }
  }
  if ((m = /^\/(switch|use)\s+([\w.-]+)$/i.exec(text))) return { kind: 'switch', name: m[2]! }
  if ((m = /^\/logs\s+([\w.-]+)$/i.exec(text))) return { kind: 'logs', name: m[1]! }
  if ((m = /^\/(stop|kill)\s+([\w.-]+)$/i.exec(text))) return { kind: 'stop', name: m[2]! }
  if (/^\/(sessions|list|ls|status)$/i.test(text)) return { kind: 'sessions' }
  if (/^\/(help|start)$/i.test(text)) return { kind: 'help' }
  if (/^\/(screenshot|screen|ss)$/i.test(text)) return { kind: 'screenshot' }
  if ((m = /^@([\w.-]+)[\s,:]+([\s\S]+)$/.exec(text))) return { kind: 'to', name: m[1]!, text: m[2]!.trim(), explicit: true }
  // "api: run the tests" — only a candidate; the router checks the name is a real session
  if ((m = /^([\w.-]{1,40})\s*:\s+([\s\S]+)$/.exec(text))) return { kind: 'to', name: m[1]!, text: m[2]!.trim(), explicit: false }
  return { kind: 'text', text }
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]!
}

// Ranked candidate names for a (possibly misspelled) query.
export function fuzzyMatch(query: string, names: string[]): string[] {
  const q = query.toLowerCase()
  const scored = [...new Set(names)].map(name => {
    const n = name.toLowerCase()
    let score = 0
    if (n === q) score = 100
    else if (n.startsWith(q) || q.startsWith(n)) score = 80
    else if (n.includes(q) || q.includes(n)) score = 60
    else {
      const d = editDistance(n, q)
      if (d <= Math.max(1, Math.floor(Math.min(n.length, q.length) / 4))) score = 50 - d * 10
    }
    return { name, score }
  })
  return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).map(s => s.name)
}
