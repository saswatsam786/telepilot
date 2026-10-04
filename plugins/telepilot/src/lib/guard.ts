// Safety net for sessions driven from Telegram (the hub, and worker turns routed by it).
// Denies a short list of high-blast-radius actions. It complements, not replaces,
// Claude Code's permission prompts, which still reach the phone.

export type Verdict = { reason: string; decision?: 'deny' | 'ask' } | null

const HOME = String.raw`(?:~|\$HOME|\$\{HOME\}|/Users/[^/\s"']+)`

const SECRET_PATHS: Array<[RegExp, string]> = [
  [new RegExp(String.raw`${HOME}/\.(ssh|aws|gnupg|kube|docker|netrc|npmrc|pypirc)\b`), 'credential files'],
  [new RegExp(String.raw`${HOME}/\.config/(gcloud|gh)\b`), 'credential files'],
  [/Library\/Keychains/, 'keychain files'],
  [/\.claude\/channels\/[^/\s"']+\/(\.env|access\.json|approved)/, 'the Telegram bot token and access list'],
  [/\.telepilot\/(approvals|state\.json|config\.json|locks)/, "telepilot's approval and state files"],
]

const SHELL_RULES: Array<[RegExp, string]> = [
  [/(^|[;&|`(\n]|\$\()\s*(exec\s+|xargs\s+(-\S+\s+)*)?sudo\b/, 'sudo'],
  [
    new RegExp(String.raw`\brm\s+(?:-\w+\s+)*-\w*[rR]\w*\s+(?:-\w+\s+)*["']?(?:/|${HOME}/?)\*?["']?(?=\s|$|[;&|])`),
    'recursive delete of / or your home folder',
  ],
  [/\bdiskutil\s+(erase\w*|partitionDisk|zeroDisk|secureErase|reformat)\b|\bmkfs(\.\w+)?\b|\bdd\b[^|;&]*\bof=\/dev\//, 'erasing or formatting disks'],
  [/\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da|fi|k)?sh\b/, 'piping a download into a shell'],
  [/\b(curl|wget)\b[^|;&]*\|\s*(python3?|node|bun|ruby|perl)\b/, 'piping a download into an interpreter'],
  [/\bsecurity\s+(find-(generic|internet)-password|dump-keychain|export)\b/, 'reading keychain secrets'],
  [/\.claude\/settings(\.local)?\.json/, 'changing Claude Code settings'],
  [/Library\/Launch(Agents|Daemons)/, 'installing launch agents'],
  [/\bcsrutil\b|\bspctl\s+--master-disable\b|\bnvram\b/, 'changing system security settings'],
]

const REMOTE_DIALOG =
  'This session is being driven from Telegram, so terminal dialogs are invisible to the user. ' +
  'Ask in plain text in your final message instead; their answer will arrive as the next message.'

function checkText(text: string, rules: Array<[RegExp, string]>): Verdict {
  for (const [re, what] of rules) if (re.test(text)) return { reason: `Blocked by telepilot (remote session): ${what}.` }
  return null
}

const HUB_BLOCKING: Array<[RegExp, string]> = [
  [/\bsleep\s+([1-9]\d+|\d{3,})/, 'long sleeps'],
  [/\b(for|while|until)\b[\s\S]*\bsleep\b/, 'polling loops'],
  [/--watch\b|(^|[\s;&|])watch\s|\btail\s+-\w*f/, 'watching output'],
]

// The hub must stay free to read new messages; waiting belongs in a session.
export function checkHubBash(command: string): Verdict {
  for (const [re, what] of HUB_BLOCKING) {
    if (re.test(command)) {
      return {
        reason: `Not run in the hub (${what}): the hub must stay free for new messages. Call delegate(task=…) instead: it runs in a background session and reports back when done.`,
      }
    }
  }
  return null
}

const HUB_TOOLS = new Set(['ToolSearch', 'SendMessage', 'ListAgents', 'Skill', 'TodoWrite'])
const HUB_PREFIXES = ['mcp__plugin_telepilot_telepilot__', 'mcp__plugin_telegram_telegram__', 'mcp__plugin_imessage_imessage__', 'mcp__plugin_fakechat_fakechat__']

// The hub is for talking and routing only; everything else is a session's job.
export function checkHubTool(tool: string, input: Record<string, any> = {}): Verdict {
  if (HUB_TOOLS.has(tool) || HUB_PREFIXES.some(p => tool.startsWith(p))) return null
  if (tool === 'Read' && /\/\.claude\/channels\/[^/]+\/inbox\//.test(String(input.file_path ?? ''))) return null // photos the user sent
  if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') return null // handled by checkTool's hub message
  return {
    reason: `The hub only talks to the user and routes; it doesn't run ${tool} itself. Hand this to a session: delegate(task) (the general "mac" session, or a fresh job if it's busy), or send_to the session it belongs to.`,
  }
}

const WRITE_SHELL = /(^|[\s;&|(])(sed\s+-i|tee|mv|cp|rm|ln|chmod|truncate|install|patch|perl\s+-[a-z]*i)\b|>>?|\bgit\s+(checkout|apply|reset|restore)\b/

// Changes to telepilot itself (its code, command, installed plugins) from a session the phone
// started need the user's explicit yes/no. A remote-control tool must not quietly rewrite itself.
export function checkSelfModification(tool: string, input: Record<string, any> = {}, protectedRoots: string[] = []): Verdict {
  const roots = protectedRoots.filter(Boolean)
  if (!roots.length) return null
  const hits = (s: string) => roots.some(r => s.includes(r))
  const ask = { decision: 'ask' as const, reason: 'This changes telepilot itself (the remote control). It needs your explicit approval.' }
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) return hits(String(input.file_path ?? input.notebook_path ?? '')) ? ask : null
  if (tool === 'Bash') {
    const cmd = String(input.command ?? '')
    return hits(cmd) && WRITE_SHELL.test(cmd) ? ask : null
  }
  return null
}

export function checkTool(tool: string, input: Record<string, any> = {}): Verdict {
  if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') return { reason: REMOTE_DIALOG }
  if (tool === 'Bash') return checkText(String(input.command ?? ''), [...SECRET_PATHS, ...SHELL_RULES])
  if (tool.endsWith('__run_applescript')) {
    return checkText(String(input.script ?? ''), [
      [/with\s+administrator\s+privileges|do\s+shell\s+script\s+"[^"]*\bsudo\b/i, 'running shell commands as administrator'],
      ...SECRET_PATHS,
      ...SHELL_RULES,
    ])
  }
  const path = String(input.file_path ?? input.notebook_path ?? input.path ?? '')
  if (!path) return null
  if (tool === 'Read' || tool.endsWith('__share_file') || tool.endsWith('__transcribe')) return checkText(path, SECRET_PATHS)
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) {
    return checkText(path, [
      ...SECRET_PATHS,
      [/\.claude\/settings(\.local)?\.json$/, 'changing Claude Code settings'],
      [/Library\/Launch(Agents|Daemons)\//, 'installing launch agents'],
      [/\/\.(zshrc|zprofile|bashrc|bash_profile|profile)$/, 'changing shell startup files'],
    ])
  }
  return null
}
