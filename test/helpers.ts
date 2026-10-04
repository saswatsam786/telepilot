import { chmodSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export const PLUGIN = join(import.meta.dir, '..', 'plugins', 'telepilot')

// Fresh ~/.telepilot for each test file; modules read TELEPILOT_HOME lazily.
export function freshHome(config: Record<string, unknown> = {}): string {
  const home = mkdtempSync(join(tmpdir(), 'telepilot-test-'))
  process.env.TELEPILOT_HOME = home
  process.env.TELEPILOT_DRY_RUN = '1'
  process.env.TELEGRAM_STATE_DIR = join(home, 'tg') // never read the real bot's files
  writeFileSync(join(home, 'config.json'), JSON.stringify({ hubName: 'hub', ...config }))
  return home
}

export const header = (to = 'api', chat = '111', from = 'hub') => `[telepilot from=${from} chat=${chat} to=${to}]`

export const human = (text: string) => ({ type: 'user', message: { role: 'user', content: text }, origin: { kind: 'human' } })
// Matches Claude Code 2.1.288: peer messages are user lines with isMeta: true and the raw text in origin.body.
export const peer = (body: string, name = 'hub', pid = 4242) => ({
  type: 'user',
  isMeta: true,
  message: { role: 'user', content: `Another Claude session sent a message:\n<cross-session-message from-name="${name}">\n${body}\n</cross-session-message>` },
  origin: { kind: 'peer', from: 'uds:/tmp/cc-socks/x.sock', verifiedPeerPid: pid, name, fromMode: 'prompting', body },
})
export const assistant = (text: string, tools: Array<{ name: string; input?: object }> = []) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [...tools.map(t => ({ type: 'tool_use', id: 't', name: t.name, input: t.input ?? {} })), { type: 'text', text }] },
})
export const toolResult = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } })

export function writeTranscript(home: string, lines: object[], name = 'session.jsonl'): string {
  const p = join(home, name)
  writeFileSync(p, lines.map(l => JSON.stringify(l)).join('\n') + '\n')
  return p
}

// A stand-in `claude` binary: answers `agents --json` from a fixture and records --bg calls.
export function fakeClaude(home: string, agents: object[]): string {
  const bin = join(home, 'fake-claude')
  writeFileSync(join(home, 'agents.json'), JSON.stringify(agents))
  writeFileSync(
    bin,
    `#!/bin/sh
echo "$@" >> "${home}/claude-calls.log"
case "$1" in
  agents) cat "${home}/agents.json" ;;
  stop) echo "stopped $2" ;;
  --bg) shift; name=""; resume=""; while [ $# -gt 0 ]; do [ "$1" = "--name" ] && name="$2"; [ "$1" = "--resume" ] && resume="$2"; shift; done
        [ -n "$resume" ] && { echo "backgrounded · abc12345 · resumed"; exit 0; }
        bun -e "const f='${home}/agents.json',fs=require('fs');const a=JSON.parse(fs.readFileSync(f,'utf8'));a.push({pid:9,cwd:process.cwd(),kind:'background',id:'abc12345',sessionId:'sess-'+process.argv[1],name:process.argv[1],status:'busy'});fs.writeFileSync(f,JSON.stringify(a))" "$name"
        echo "backgrounded · abc12345 · $name" ;;
esac
`,
  )
  chmodSync(bin, 0o755)
  process.env.CLAUDE_BIN = bin
  return bin
}

export async function runHook(event: string, input: object, env: Record<string, string> = {}): Promise<{ stdout: string; code: number }> {
  const proc = Bun.spawn(['bun', join(PLUGIN, 'src', 'hooks.ts'), event], {
    stdin: new Blob([JSON.stringify(input)]),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env } as Record<string, string>,
  })
  const stdout = await new Response(proc.stdout).text()
  return { stdout, code: await proc.exited }
}
