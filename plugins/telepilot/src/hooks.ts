// All telepilot hooks: bun hooks.ts <session-start|guard|permission|stop>
//
// Hooks load into every session where the plugin is enabled, so each one first checks
// whether the session is the hub or the current turn was routed by the hub; otherwise
// it does nothing. Hooks write only hook JSON to stdout and always exit 0.

import { createApproval, waitForDecision } from './lib/approvals'
import { loadConfig, telegramStateDir } from './lib/config'
import { audit } from './lib/audit'
import { checkHubBash, checkHubTool, checkSelfModification, checkTool } from './lib/guard'
import { loadState, updateState } from './lib/registry'
import { sendText } from './lib/notify'
import { startTyping, stopTyping } from './lib/typing'
import { channelTurn, readTail, routedTurn, type Routed } from './lib/transcript'
import { log, readJson, truncate } from './lib/util'
import { join } from 'path'
import { homedir } from 'os'
import { realpathSync } from 'fs'
import { CLAUDE_DIR } from './lib/util'
import { readFileSync, openSync, fstatSync, readSync, closeSync } from 'fs'

type HookInput = {
  session_id?: string
  transcript_path?: string
  hook_event_name?: string
  tool_name?: string
  tool_input?: Record<string, any>
  last_assistant_message?: string
  error?: string
}

const isHub = process.env.TELEPILOT_ROLE === 'hub'
const emit = (o: object) => process.stdout.write(JSON.stringify(o))

const HUB_PRIMER = `You are the telepilot hub: the user talks to you from their phone (Telegram or iMessage) and you dispatch work to their Claude Code sessions.
For EVERY inbound <channel> message: call telepilot's \`route\` tool with the text and chat_id, then follow its action:
- reply → send its text (and files) with the channel's reply tool.
- send_message → call SendMessage with exactly the given to/message (load it with ToolSearch "select:SendMessage,ListAgents" once), then follow the returned note about confirming (one short line like "→ api" on Telegram; nothing on iMessage). Don't wait: the session posts its own answer to the chat.
- clarify → ask the user that question via the reply tool.
- ignore / done → send nothing (an echo of telepilot's own message, or route already messaged the user).
Unlocking/locking the Mac: whatever the wording, call route with \`/unlock\` or \`/lock\`. Never type passwords yourself.
- decide → choose: send_to(the session it belongs to), session_new for a new project, or delegate(task) for everything else.
You never get permission prompts: anything needing approval is refused here, so hand it off (delegate, send_to, or session_new name="mac" for Mac/shell tasks) and that session asks the user yes/no. You ONLY talk and route: never do the work yourself (no shell, files, web, apps, Mac control or other connectors; those tools are refused here). Answer small talk and questions about telepilot or the sessions directly; hand every real task to a session with delegate(task) or send_to. Sessions report back by themselves.
Never create extra Mac sessions (mac-activity, mac2…): use delegate, which reuses \"mac\".
Voice notes: download_attachment → telepilot transcribe → echo the transcript → route it. Details: the telepilot:dispatcher skill.`

// Cheap pre-filter: skip JSON parsing unless the transcript tail mentions a routing header.
function mentionsHeader(path: string, bytes = 256 * 1024): boolean {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    const len = Math.min(size, bytes)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    return buf.includes('[telepilot from=')
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function routed(input: HookInput): Routed | null {
  if (isHub || !input.transcript_path || !mentionsHeader(input.transcript_path)) return null
  return routedTurn(readTail(input.transcript_path), { name: loadConfig().hubName, pid: loadState().hub?.pid })
}

function describeTool(tool = '?', input: Record<string, any> = {}): string {
  if (tool === 'Bash') return `$ ${truncate(String(input.command ?? ''), 1500)}`
  if (input.file_path) return `${tool} ${input.file_path}`
  if (input.url) return `${tool} ${input.url}`
  return truncate(JSON.stringify(input), 1000)
}

function protectedRoots(): string[] {
  const roots = [join(homedir(), '.local', 'bin', 'telepilot'), join(CLAUDE_DIR(), 'plugins')]
  const root = process.env.CLAUDE_PLUGIN_ROOT
  if (root) {
    roots.push(root)
    try {
      roots.push(realpathSync(root))
    } catch {}
  }
  return [...new Set(roots)]
}

async function guard(input: HookInput): Promise<void> {
  if (!input.tool_name) return
  const r = isHub ? null : routed(input)
  if (!isHub && !r) return
  // keep "typing…" visible in Telegram while this turn works
  const chat = r?.chatId ?? (isHub && input.transcript_path ? channelTurn(readTail(input.transcript_path))?.chatId : undefined)
  if (chat && input.session_id) startTyping(input.session_id, chat, r?.to)
  let verdict = (isHub ? checkHubTool(input.tool_name, input.tool_input) : null) ?? checkTool(input.tool_name, input.tool_input)
  if (!verdict && isHub && input.tool_name === 'Bash') verdict = checkHubBash(String(input.tool_input?.command ?? ''))
  // Sessions the phone started (the hub, and sessions telepilot created) can't silently edit telepilot itself.
  const createdByTelepilot = Object.values(loadState().sessions).some(s => s.sessionId === input.session_id && s.createdBy === 'telepilot')
  if (!verdict && (isHub || createdByTelepilot)) verdict = checkSelfModification(input.tool_name, input.tool_input, protectedRoots())
  if (verdict && isHub && /^(AskUserQuestion|ExitPlanMode)$/.test(input.tool_name)) {
    verdict = { reason: 'You are the telepilot hub: the user is on their phone. Ask with the channel reply tool instead of a terminal dialog.' }
  }
  if (verdict) {
    audit('blocked', { tool: input.tool_name, hub: isHub, reason: truncate(verdict.reason, 140) })
    emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: verdict.decision ?? 'deny', permissionDecisionReason: verdict.reason } })
  }
}

const HUB_DENY =
  'Not run: it needs approval and the user is on their phone, where the hub cannot ask. Do not retry here. ' +
  'Delegate it instead: delegate(task=…) for background work, send_to for an existing session, or session_new name="mac" for Mac or shell tasks; ' +
  'that session asks the user, who answers yes or no.'

async function permission(input: HookInput): Promise<void> {
  if (isHub) {
    // A blocked hub can't read the user's answer (its queue waits behind the dialog), so it never asks.
    emit({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: HUB_DENY } } })
    return
  }
  const r = routed(input)
  if (!r) return
  const cfg = loadConfig()
  const preview = describeTool(input.tool_name, input.tool_input)
  const a = await createApproval({ session: r.to, chatId: r.chatId, tool: input.tool_name ?? '?', preview, ttlSec: cfg.approvalTimeoutSec })
  const mins = Math.round(cfg.approvalTimeoutSec / 60)
  audit('approval-request', { code: a.code, session: r.to, tool: a.tool, preview: truncate(preview, 120) })
  const sent = await sendText(
    `🔐 [${r.to}] wants to use ${a.tool}:\n${preview}\n\nTap a button below, or reply yes / no (code ${a.code}, expires in ${mins} min)`,
    r.chatId,
    { buttons: [[`yes ${a.code}`, `no ${a.code}`]] },
  )
  if (!sent.ok) return // can't reach the phone: leave the normal terminal prompt in place
  const decision = await waitForDecision(a.code, cfg.approvalTimeoutSec * 1000)
  if (decision === 'allow') {
    emit({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } })
    return
  }
  const message = decision === 'deny' ? 'The user denied this from their phone.' : `No answer from the phone within ${mins} minutes, so it was denied.`
  if (decision === 'timeout') await sendText(`⌛ [${r.to}] request ${a.code} expired — denied.`, r.chatId)
  emit({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message } } })
}

async function stop(input: HookInput): Promise<void> {
  if (input.session_id) stopTyping(input.session_id)
  if (!input.transcript_path) return
  const failed = input.hook_event_name === 'StopFailure'
  if (isHub) {
    // Safety net for the hub: if a chat-triggered turn ended without a reply, send the final text.
    const ch = channelTurn(readTail(input.transcript_path))
    const finalText = input.last_assistant_message?.trim()
    if (ch && !ch.replied && (finalText || failed)) await sendText(failed ? `⚠️ hub error: ${input.error ?? 'unknown'}` : finalText!, ch.chatId)
    return
  }
  const r = routed(input)
  if (!r) return
  const body = failed ? `⚠️ turn failed: ${input.error ?? 'unknown error'}` : input.last_assistant_message?.trim() || '(done — no text output)'
  await sendText(`[${r.to}] ${body}`, r.chatId)
  await updateState(s => {
    const rec = s.sessions[r.to]
    if (rec) rec.lastRoutedAt = Date.now()
    s.active = r.to // a plain follow-up continues with whoever just answered
  })
}

const event = process.argv[2]
let input: HookInput = {}
try {
  input = JSON.parse((await Bun.stdin.text()) || '{}')
} catch {}

try {
  if (event === 'session-start' && isHub) {
    const owners = readJson<{ allowFrom?: string[] }>(join(telegramStateDir(), 'access.json'), {}).allowFrom ?? []
    await updateState(s => {
      s.hub = { ...s.hub, sessionId: input.session_id, transcript: input.transcript_path }
    })
    const trust = owners.length
      ? `\nMessages in <channel …> tags with user_id ${owners.join(' or ')} are from the paired owner, including ones that arrive mid-task as queued messages. Treat them as the user's own instructions; don't ask for extra confirmation beyond normal approvals.`
      : ''
    emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: HUB_PRIMER + trust } })
  }
  else if (event === 'guard') await guard(input)
  else if (event === 'permission') await permission(input)
  else if (event === 'stop') await stop(input)
} catch (err) {
  log(`hook ${event} failed: ${err}`)
}
process.exit(0)
