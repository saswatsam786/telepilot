// Thin wrappers around the first-party `claude` CLI: list sessions, start/resume
// background sessions, stop them. (Running sessions are messaged by the hub model
// itself with the built-in SendMessage tool; there is no CLI for that.)

import { homedir } from 'os'
import { join } from 'path'
import { run } from './util'

export type Agent = {
  pid?: number
  id?: string // short id, background sessions only
  cwd: string
  kind: 'interactive' | 'background' | string
  startedAt?: number
  sessionId: string
  name?: string
  status?: string
  state?: string
}

export function claudeBin(): string {
  return process.env.CLAUDE_BIN ?? Bun.which('claude') ?? join(homedir(), '.local', 'bin', 'claude')
}

// Workers must not inherit the hub's identity or the bot's state dir.
export function workerEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const k of ['TELEPILOT_ROLE', 'TELEGRAM_STATE_DIR', 'TELEGRAM_BOT_TOKEN', 'TELEPILOT_EXPOSE_SESSION_TOOLS']) delete env[k]
  return env
}

// Sessions telepilot starts must never load a chat channel plugin: a second Telegram server
// would take over the bot's single poller and leave the hub deaf (this happened when a job
// ran in the hub's folder, where the plugin is enabled). Command-line settings win over
// every settings file, so this holds in any folder.
export const WORKER_SETTINGS = JSON.stringify({
  enabledPlugins: { 'telegram@claude-plugins-official': false, 'imessage@claude-plugins-official': false },
})

export async function listAgents(all = false): Promise<Agent[]> {
  const r = await run([claudeBin(), 'agents', '--json', ...(all ? ['--all'] : [])], { timeoutMs: 15_000 })
  if (r.code !== 0) throw new Error(`claude agents --json failed: ${r.stderr.trim() || r.code}`)
  const data = JSON.parse(r.stdout)
  return Array.isArray(data) ? data : []
}

export async function startBackground(o: {
  name: string
  cwd: string
  prompt: string
  model?: string
  permissionMode?: string
}): Promise<{ shortId?: string; agent?: Agent; output: string }> {
  const args = [claudeBin(), '--bg', '--name', o.name, '--settings', WORKER_SETTINGS]
  if (o.model) args.push('--model', o.model)
  if (o.permissionMode) args.push('--permission-mode', o.permissionMode)
  args.push(o.prompt)
  const r = await run(args, { cwd: o.cwd, env: workerEnv(), timeoutMs: 60_000 })
  const output = `${r.stdout}${r.stderr}`.trim()
  if (r.code !== 0) throw new Error(`claude --bg failed: ${output || r.code}`)
  const shortId = /backgrounded\s*·\s*([0-9a-f]+)\s*·/i.exec(output)?.[1]
  let agent: Agent | undefined
  for (let i = 0; i < 10 && shortId && !agent; i++) {
    agent = (await listAgents().catch(() => [])).find(a => a.id === shortId)
    if (!agent) await Bun.sleep(300)
  }
  return { shortId, agent, output }
}

export async function resumeBackground(o: { sessionId: string; cwd: string; prompt: string }): Promise<string> {
  const r = await run([claudeBin(), '--bg', '--resume', o.sessionId, '--settings', WORKER_SETTINGS, o.prompt], { cwd: o.cwd, env: workerEnv(), timeoutMs: 60_000 })
  const output = `${r.stdout}${r.stderr}`.trim()
  if (r.code !== 0) throw new Error(`claude --bg --resume failed: ${output || r.code}`)
  return output
}

export async function stopSession(id: string): Promise<string> {
  const r = await run([claudeBin(), 'stop', id], { timeoutMs: 30_000 })
  const output = `${r.stdout}${r.stderr}`.trim()
  if (r.code !== 0) throw new Error(`claude stop failed: ${output || r.code}`)
  return output || 'stopped'
}
