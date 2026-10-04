// Runs the real hook and server processes against fixture transcripts and a fake `claude`.

import { beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { assistant, fakeClaude, freshHome, header, human, peer, PLUGIN, runHook, writeTranscript } from './helpers'

let home = ''
async function userSays(text: string) {
  const t = writeTranscript(home, [{ type: 'user', message: { content: `<channel source="plugin:imessage:imessage" chat_id="111">${text}</channel>` } }], 'hub-transcript.jsonl')
  const { updateState } = await import('../plugins/telepilot/src/lib/registry')
  await updateState(st => {
    st.hub = { ...st.hub, transcript: t }
  })
}
const outbox = () =>
  existsSync(join(home, 'outbox.jsonl'))
    ? readFileSync(join(home, 'outbox.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
    : []

beforeAll(() => {
  home = freshHome({ approvalTimeoutSec: 20 })
  fakeClaude(home, [
    { pid: 1, cwd: '/tmp', kind: 'interactive', sessionId: 'sess-api', name: 'api', status: 'idle', startedAt: 2 },
    { pid: 2, cwd: '/tmp', kind: 'background', id: 'b0b0b0b0', sessionId: 'sess-docs', name: 'docs', status: 'idle', startedAt: 1 },
    { pid: 3, cwd: '/tmp', kind: 'interactive', sessionId: 'sess-hub', name: 'hub', status: 'busy', startedAt: 3 },
  ])
})

describe('hooks', () => {
  test('Stop posts a routed result to Telegram, tagged with the session', async () => {
    const t = writeTranscript(home, [peer(`${header('api', '111')} run tests`, 'hub', 0), assistant('42 tests pass')], 'stop.jsonl')
    const r = await runHook('stop', { hook_event_name: 'Stop', transcript_path: t, last_assistant_message: '42 tests pass' })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('')
    expect(outbox().pop()).toMatchObject({ kind: 'text', chat_id: '111', text: '[api] 42 tests pass' })
  })

  test('Stop stays silent for local turns', async () => {
    const before = outbox().length
    const t = writeTranscript(home, [human('local stuff'), assistant('done')], 'local.jsonl')
    await runHook('stop', { hook_event_name: 'Stop', transcript_path: t, last_assistant_message: 'done' })
    expect(outbox().length).toBe(before)
  })

  test('hub fallback: a Telegram turn that never called reply still gets an answer', async () => {
    const ch = { type: 'user', message: { content: '<channel source="plugin:telegram:telegram" chat_id="777">hi</channel>' } }
    const t = writeTranscript(home, [ch, assistant('hello there')], 'hub.jsonl')
    await runHook('stop', { hook_event_name: 'Stop', transcript_path: t, last_assistant_message: 'hello there' }, { TELEPILOT_ROLE: 'hub' })
    expect(outbox().pop()).toMatchObject({ chat_id: '777', text: 'hello there' })
  })

  test('guard denies dangerous commands only in routed turns', async () => {
    const routed = writeTranscript(home, [human(`${header()} clean up`)], 'g1.jsonl')
    const local = writeTranscript(home, [human('clean up')], 'g2.jsonl')
    const input = { tool_name: 'Bash', tool_input: { command: 'sudo rm -rf /opt/x' } }
    const denied = await runHook('guard', { ...input, transcript_path: routed })
    expect(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
    expect((await runHook('guard', { ...input, transcript_path: local })).stdout).toBe('')
  })

  test('PermissionRequest is relayed to Telegram and answered with the code', async () => {
    const t = writeTranscript(home, [human(`${header('api', '111')} publish`)], 'perm.jsonl')
    const hook = runHook('permission', { tool_name: 'Bash', tool_input: { command: 'npm publish' }, transcript_path: t })
    let code = ''
    for (let i = 0; i < 100 && !code; i++) {
      await Bun.sleep(50)
      code = /code ([a-z2-9]{6})/.exec(outbox().map(m => m.text).join('\n'))?.[1] ?? ''
    }
    expect(code).not.toBe('')
    expect(outbox().pop().text).toContain('$ npm publish')
    const { decide } = await import('../plugins/telepilot/src/lib/approvals')
    expect((await decide(code, 'allow')).ok).toBe(true)
    const r = await hook
    expect(JSON.parse(r.stdout).hookSpecificOutput).toEqual({ hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } })
  })
})

describe('router (hub tools, fake claude)', async () => {
  const { route } = await import('../plugins/telepilot/src/tools/sessions')
  const { loadState } = await import('../plugins/telepilot/src/lib/registry')

  test('@name → SendMessage payload with routing header; hub excluded', async () => {
    const d: any = await route('@api run the tests', '111')
    expect(d).toMatchObject({ action: 'send_message', to: 'api', message: `${header('api', '111')} run the tests` })
    expect(loadState().active).toBe('api')
  })

  test('unknown name → suggestions', async () => {
    const d: any = await route('@dcs hi', '111')
    expect(d.action).toBe('clarify')
    expect(d.text).toContain('docs')
    expect((await route('@hub hi', '111') as any).action).toBe('clarify')
  })

  test('/new starts a background session in the folder', async () => {
    const d: any = await route('/new blog /tmp fix the README typo', '111')
    expect(d.action).toBe('reply')
    const calls = readFileSync(join(home, 'claude-calls.log'), 'utf8')
    expect(calls).toContain('--bg --name blog')
    expect(calls).toContain(`${header('blog', '111')} fix the README typo`)
    expect(loadState().sessions.blog).toMatchObject({ cwd: '/tmp', createdBy: 'telepilot', shortId: 'abc12345', sessionId: 'sess-blog' })
  })

  test('stopped session is resumed in the background', async () => {
    writeFileSync(join(home, 'agents.json'), JSON.stringify([]))
    const d: any = await route('@blog also fix the footer', '111')
    expect(d.action).toBe('reply')
    expect(readFileSync(join(home, 'claude-calls.log'), 'utf8')).toContain('--bg --resume')
  })

  test('plain text → decide with the active session', async () => {
    const d: any = await route("what's the status?", '111')
    expect(d).toMatchObject({ action: 'decide', active: 'blog' })
  })

  test('approve with a bad code is refused', async () => {
    await userSays('approve zzzzzz')
    const d: any = await route('approve zzzzzz', '111')
    expect(d.text).toMatch(/No pending request|locked/)
  })
})

describe('MCP server', () => {
  async function listTools(env: Record<string, string>): Promise<string[]> {
    const proc = Bun.spawn(['bun', join(PLUGIN, 'src', 'server.ts')], {
      stdin: 'pipe',
      stdout: 'pipe',
      env: { ...process.env, ...env } as Record<string, string>,
    })
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28' } }) + '\n')
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n')
    proc.stdin.end()
    const lines = (await new Response(proc.stdout).text()).trim().split('\n').map(l => JSON.parse(l))
    expect(lines.find(l => l.id === 1).result.protocolVersion).toBe('2025-11-25')
    return lines.find(l => l.id === 2).result.tools.map((t: any) => t.name)
  }

  test('workers get Mac tools only; the hub also gets routing tools', async () => {
    const worker = await listTools({})
    expect(worker).toContain('screenshot')
    expect(worker).not.toContain('route')
    const hub = await listTools({ TELEPILOT_ROLE: 'hub' })
    expect(hub).toEqual(expect.arrayContaining(['route', 'send_to', 'delegate', 'session_new', 'approve', 'transcribe']))
    expect(hub).not.toContain('screenshot') // the hub only talks and routes; sessions do the work
  })
})

describe('router: echoes', async () => {
  const { route } = await import('../plugins/telepilot/src/tools/sessions')
  test('telepilot\'s own iMessage posts are ignored', async () => {
    expect(((await route('🤖 [api] 42 tests pass', 'iMessage;-;me')) as any).action).toBe('ignore')
  })
})

describe('router: bare yes/no', async () => {
  const { route } = await import('../plugins/telepilot/src/tools/sessions')
  const { createApproval, listPending } = await import('../plugins/telepilot/src/lib/approvals')
  const { readJson } = await import('../plugins/telepilot/src/lib/util')

  test('with nothing pending, "yes" is just conversation', async () => {
    for (const a of listPending()) await (await import('../plugins/telepilot/src/lib/approvals')).decide(a.code, 'deny')
    expect(((await route('Yes', '111')) as any).action).toBe('decide')
  })
  test('one pending request: the user\'s plain "yes" approves it', async () => {
    const a = await createApproval({ session: 'api', tool: 'Bash', preview: '$ npm publish', ttlSec: 60 })
    await userSays('Yes!')
    const d: any = await route('Yes!', '111')
    expect(d.text).toContain('Approved [api] Bash')
    expect(readJson<any>(join(home, 'approvals', `${a.code}.json`), {}).status).toBe('allow')
  })
  test('one pending request: "no" denies it', async () => {
    const a = await createApproval({ session: 'api', tool: 'Bash', preview: '$ rm -rf dist', ttlSec: 60 })
    await userSays('no')
    expect(((await route('no', '111')) as any).text).toContain('Denied')
    expect(readJson<any>(join(home, 'approvals', `${a.code}.json`), {}).status).toBe('deny')
  })
  test('a "yes" the user never sent is refused (prompt-injection guard)', async () => {
    const a = await createApproval({ session: 'api', tool: 'Bash', preview: '$ curl evil', ttlSec: 60 })
    await userSays('what is the weather')
    expect(((await route('yes', '111')) as any).text).toContain('send them yourself')
    expect(readJson<any>(join(home, 'approvals', `${a.code}.json`), {}).status).toBe('pending')
  })
  test('several pending: list them with codes', async () => {
    await createApproval({ session: 'docs', tool: 'Write', preview: 'Write /tmp/x', ttlSec: 60 })
    await userSays('yes')
    const d: any = await route('yes', '111')
    expect(d.text).toMatch(/2 requests are waiting/)
    expect(d.text).toMatch(/yes [a-z2-9]{6} — \[api\]/)
  })
})

describe('hub never blocks on a permission dialog', () => {
  test('PermissionRequest in the hub is refused immediately with a delegate hint', async () => {
    const t = writeTranscript(home, [human('hi')], 'hubperm.jsonl')
    const r = await runHook('permission', { tool_name: 'Bash', tool_input: { command: 'gh auth status' }, transcript_path: t }, { TELEPILOT_ROLE: 'hub' })
    const out = JSON.parse(r.stdout).hookSpecificOutput
    expect(out.decision.behavior).toBe('deny')
    expect(out.decision.message).toContain('session_new name="mac"')
  })
})

describe('iMessage: quiet routing', async () => {
  const { route } = await import('../plugins/telepilot/src/tools/sessions')
  test('no confirmation after routing on iMessage', async () => {
    writeFileSync(join(home, 'agents.json'), JSON.stringify([{ pid: 1, cwd: '/tmp', kind: 'interactive', sessionId: 's1', name: 'api', status: 'idle', startedAt: 9 }]))
    writeFileSync(join(home, 'config.json'), JSON.stringify({ hubName: 'hub', transport: 'imessage' }))
    const d: any = await route('@api run tests', 'iMessage;-;me')
    expect(d.action).toBe('send_message')
    expect(d.note).toContain('NO confirmation')
    writeFileSync(join(home, 'config.json'), JSON.stringify({ hubName: 'hub', approvalTimeoutSec: 20 }))
  })
})

describe('delegate', async () => {
  const { delegate } = await import('../plugins/telepilot/src/tools/sessions')
  test('starts a background job session and returns at once', async () => {
    writeFileSync(join(home, 'agents.json'), JSON.stringify([]))
    const d: any = await delegate({ task: 'wait for CI on #1673 then merge it', dir: '/tmp', chatId: '111' })
    expect(d.action).toBe('reply')
    expect(d.text).toContain('On it (mac)') // first delegated task creates the general "mac" session
    expect(readFileSync(join(home, 'claude-calls.log'), 'utf8')).toContain('wait for CI on #1673 then merge it')
  })
  test('reuses a running session when named', async () => {
    writeFileSync(join(home, 'agents.json'), JSON.stringify([{ pid: 1, cwd: '/tmp', kind: 'background', id: 'aa11', sessionId: 's-ci', name: 'ci', status: 'idle', startedAt: 5 }]))
    const d: any = await delegate({ task: 'merge #1674 when green', name: 'ci', chatId: '111' })
    expect(d).toMatchObject({ action: 'send_message', to: 'ci' })
  })
})

describe('panic + audit', async () => {
  const { route } = await import('../plugins/telepilot/src/tools/sessions')
  const { createApproval, getApproval } = await import('../plugins/telepilot/src/lib/approvals')
  const { updateState } = await import('../plugins/telepilot/src/lib/registry')
  test('/panic stops telepilot background sessions and denies pending requests', async () => {
    writeFileSync(join(home, 'agents.json'), JSON.stringify([
      { pid: 7, cwd: '/tmp', kind: 'background', id: 'dead01', sessionId: 's-p', name: 'job-p', status: 'busy', startedAt: 9 },
      { pid: 8, cwd: '/tmp', kind: 'interactive', sessionId: 's-mine', name: 'my-terminal', status: 'idle', startedAt: 8 },
    ]))
    await updateState(s => { s.sessions['job-p'] = { name: 'job-p', shortId: 'dead01', sessionId: 's-p', cwd: '/tmp', createdBy: 'telepilot', createdAt: 1 } })
    const a = await createApproval({ session: 'job-p', tool: 'Bash', preview: '$ rm -rf build', ttlSec: 60 })
    const d: any = await route('/panic', '111')
    expect(d.text).toMatch(/Stopped 1 background session\(s\) and denied \d+ pending/)
    expect(readFileSync(join(home, 'claude-calls.log'), 'utf8')).toContain('stop dead01')
    expect(readFileSync(join(home, 'claude-calls.log'), 'utf8')).not.toContain('stop s-mine')
    expect(getApproval(a.code)?.status).toBe('deny')
  })
  test('/audit lists recent remote actions', async () => {
    const d: any = await route('/audit', '111')
    expect(d.text).toContain('Recent remote activity')
    expect(d.text).toContain('panic')
  })
})

describe('workers never load chat channel plugins', () => {
  test('new and resumed sessions get the channel plugins disabled via --settings', () => {
    const calls = readFileSync(join(home, 'claude-calls.log'), 'utf8').split('\n').filter(l => l.startsWith('--bg'))
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) expect(c).toContain('"telegram@claude-plugins-official":false')
  })
})

describe('telepilot protects itself', async () => {
  const { updateState } = await import('../plugins/telepilot/src/lib/registry')
  const root = join(home, 'plugin-root')
  test('a session telepilot started must ask before editing telepilot', async () => {
    await updateState(s => { s.sessions['job-x'] = { name: 'job-x', sessionId: 'sess-job-x', cwd: '/tmp', createdBy: 'telepilot', createdAt: 1 } })
    const t = writeTranscript(home, [human(`${header('job-x')} add an unlock tool`)], 'self.jsonl')
    const r = await runHook('guard', { session_id: 'sess-job-x', tool_name: 'Edit', tool_input: { file_path: `${root}/src/tools/mac.ts` }, transcript_path: t }, { CLAUDE_PLUGIN_ROOT: root })
    expect(JSON.parse(r.stdout).hookSpecificOutput).toMatchObject({ permissionDecision: 'ask' })
    const sh = await runHook('guard', { session_id: 'sess-job-x', tool_name: 'Bash', tool_input: { command: `sed -i '' s/a/b/ ${root}/src/lib/guard.ts` }, transcript_path: t }, { CLAUDE_PLUGIN_ROOT: root })
    expect(JSON.parse(sh.stdout).hookSpecificOutput.permissionDecision).toBe('ask')
  })
  test("the user's own routed session (not created by telepilot) is unaffected", async () => {
    const t = writeTranscript(home, [human(`${header('my-dev')} improve the plugin`)], 'dev.jsonl')
    const r = await runHook('guard', { session_id: 'sess-mine', tool_name: 'Edit', tool_input: { file_path: `${root}/src/tools/mac.ts` }, transcript_path: t }, { CLAUDE_PLUGIN_ROOT: root })
    expect(r.stdout).toBe('')
  })
  test('reading telepilot code is fine', async () => {
    const t = writeTranscript(home, [human(`${header('job-x')} read it`)], 'read.jsonl')
    const r = await runHook('guard', { session_id: 'sess-job-x', tool_name: 'Bash', tool_input: { command: `cat ${root}/src/server.ts` }, transcript_path: t }, { CLAUDE_PLUGIN_ROOT: root })
    expect(r.stdout).toBe('')
  })
})

describe('hub = talk and route only', async () => {
  const { checkHubTool } = await import('../plugins/telepilot/src/lib/guard')
  const { delegate } = await import('../plugins/telepilot/src/tools/sessions')
  test.each(['Bash', 'Write', 'Edit', 'WebFetch', 'Agent', 'mcp__claude_ai_Slack__slack_read_channel', 'mcp__claude-in-chrome__navigate'])('hub refuses %p', tool => {
    expect(checkHubTool(tool, {})?.reason).toContain('hub only talks')
  })
  test.each(['ToolSearch', 'SendMessage', 'ListAgents', 'mcp__plugin_telepilot_telepilot__route', 'mcp__plugin_telegram_telegram__reply'])('hub allows %p', tool => {
    expect(checkHubTool(tool, {})).toBeNull()
  })
  test('hub may look at photos the user sent, nothing else', () => {
    expect(checkHubTool('Read', { file_path: '/Users/x/.claude/channels/telegram/inbox/1.jpg' })).toBeNull()
    expect(checkHubTool('Read', { file_path: '/Users/x/code/app/.env' })).not.toBeNull()
  })
  test('hub Bash is refused by the hook with a delegate hint', async () => {
    const t = writeTranscript(home, [human('hi')], 'hubbash.jsonl')
    const r = await runHook('guard', { tool_name: 'Bash', tool_input: { command: 'gh pr list' }, transcript_path: t }, { TELEPILOT_ROLE: 'hub' })
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason).toContain('delegate(task)')
  })
  test('delegate reuses an idle "mac" session', async () => {
    writeFileSync(join(home, 'agents.json'), JSON.stringify([{ pid: 3, cwd: '/tmp', kind: 'background', id: 'mm01', sessionId: 's-mac', name: 'mac', status: 'idle', startedAt: 4 }]))
    expect(await delegate({ task: 'check slack', chatId: '111' })).toMatchObject({ action: 'send_message', to: 'mac' })
  })
  test('a busy "mac" session gets a parallel job instead', async () => {
    writeFileSync(join(home, 'agents.json'), JSON.stringify([{ pid: 3, cwd: '/tmp', kind: 'background', id: 'mm01', sessionId: 's-mac', name: 'mac', status: 'busy', state: 'working', startedAt: 4 }]))
    const d: any = await delegate({ task: 'merge #1674 when CI is green', dir: '/tmp', chatId: '111' })
    expect(d.text).toMatch(/On it \(job-[a-z0-9]{1,4}\)/)
  })
})

describe('/unlock (owner-approved)', async () => {
  const { route } = await import('../plugins/telepilot/src/tools/sessions')
  const approvals = await import('../plugins/telepilot/src/lib/approvals')
  const { updateState } = await import('../plugins/telepilot/src/lib/registry')
  const clearPending = async () => { for (const a of approvals.listPending()) await approvals.decide(a.code, 'deny') }
  const askCode = () => /code ([a-z2-9]{6})/.exec(outbox().pop().text)![1]!
  test('not set up → tells the owner to run unlock-setup at the Mac', async () => {
    process.env.TELEPILOT_FAKE_UNLOCK = 'nopw'
    expect(((await route('/unlock', '111')) as any).text).toContain('telepilot unlock-setup')
  })
  test('asks with yes/no buttons, then unlocks after the owner taps yes', async () => {
    await clearPending()
    await updateState(s => { s.unlockFailures = []; s.approvalFailures = [] })
    process.env.TELEPILOT_FAKE_UNLOCK = 'ok'
    expect(((await route('unlock the mac', '111')) as any).action).toBe('done')
    const code = askCode()
    await userSays(`yes ${code}`)
    expect(((await route(`yes ${code}`, '111')) as any).text).toContain('Unlocked')
  })
  test('the model cannot approve an unlock on its own', async () => {
    await clearPending()
    process.env.TELEPILOT_FAKE_UNLOCK = 'ok'
    await route('/unlock', '111')
    const code = askCode()
    await userSays('what is the weather')
    expect(((await route(`yes ${code}`, '111')) as any).text).toContain('send them yourself')
  })
  test('three failed unlocks pause it', async () => {
    process.env.TELEPILOT_FAKE_UNLOCK = 'fail'
    for (let i = 0; i < 3; i++) {
      await clearPending()
      await route('/unlock', '111')
      const code = askCode()
      await userSays(`yes ${code}`)
      expect(((await route(`yes ${code}`, '111')) as any).text).toContain('Still locked')
    }
    expect(((await route('/unlock', '111')) as any).text).toContain('paused')
    delete process.env.TELEPILOT_FAKE_UNLOCK
  })
  test('/lock needs no approval', async () => {
    process.env.TELEPILOT_FAKE_UNLOCK = 'ok'
    expect(((await route('/lock', '111')) as any).text).toContain('Locked')
    delete process.env.TELEPILOT_FAKE_UNLOCK
  })
})

describe('/photo', async () => {
  const { route } = await import('../plugins/telepilot/src/tools/sessions')
  test('goes to the mac session with the exact imagesnap command', async () => {
    writeFileSync(join(home, 'agents.json'), JSON.stringify([{ pid: 3, cwd: '/tmp', kind: 'background', id: 'mm01', sessionId: 's-mac', name: 'mac', status: 'idle', startedAt: 4 }]))
    const d: any = await route('take a photo', '111')
    expect(d).toMatchObject({ action: 'send_message', to: 'mac' })
    expect(d.message).toContain('camera_photo')
    expect(d.message).toContain('share=true')
  })
})

describe('/allowtools (owner taps yes)', async () => {
  const { route } = await import('../plugins/telepilot/src/tools/sessions')
  const approvals = await import('../plugins/telepilot/src/lib/approvals')
  test('asks with buttons, then adds the single rule safely', async () => {
    for (const a of approvals.listPending()) await approvals.decide(a.code, 'deny')
    const f = join(home, 'settings.json')
    writeFileSync(f, JSON.stringify({ theme: 'dark', permissions: { allow: ['Bash(ls:*)'] } }))
    process.env.TELEPILOT_SETTINGS_FILE = f
    expect(((await route('/allowtools', '111')) as any).action).toBe('done')
    const code = /code ([a-z2-9]{6})/.exec(outbox().pop().text)![1]!
    await userSays(`yes ${code}`)
    expect(((await route(`yes ${code}`, '111')) as any).text).toContain('allowed')
    const s = JSON.parse(readFileSync(f, 'utf8'))
    expect(s).toMatchObject({ theme: 'dark', permissions: { allow: ['Bash(ls:*)', 'mcp__plugin_telepilot_telepilot'] } })
  })
  test('never touches a broken settings file', async () => {
    const f = join(home, 'settings.json')
    writeFileSync(f, '{ broken')
    const { allowTelepilotTools } = await import('../plugins/telepilot/src/lib/allowtools')
    expect(allowTelepilotTools().ok).toBe(false)
    expect(readFileSync(f, 'utf8')).toBe('{ broken')
    delete process.env.TELEPILOT_SETTINGS_FILE
  })
})

describe('session fixes', async () => {
  const { route, newSession } = await import('../plugins/telepilot/src/tools/sessions')
  const { loadState } = await import('../plugins/telepilot/src/lib/registry')
  test('"mac-activity" reuses the existing mac session', async () => {
    writeFileSync(join(home, 'agents.json'), JSON.stringify([{ pid: 3, cwd: '/tmp', kind: 'background', id: 'mm01', sessionId: 's-mac', name: 'mac', status: 'idle', startedAt: 4 }]))
    expect(await newSession({ name: 'mac-activity', task: 'check battery', chatId: '111' })).toMatchObject({ action: 'send_message', to: 'mac' })
  })
  test('/sessions sends readable status with tap-to-switch buttons', async () => {
    writeFileSync(join(home, 'agents.json'), JSON.stringify([{ pid: 3, cwd: '/tmp', kind: 'background', id: 'mm01', sessionId: 's-mac', name: 'mac', status: 'busy', state: 'blocked', startedAt: 4 }]))
    expect(((await route('/sessions', '111')) as any).action).toBe('done')
    expect(outbox().pop().text).toContain('waiting for your approval')
  })
  test('the session that just answered becomes active', async () => {
    const t = writeTranscript(home, [human(`${header('docs', '111')} hi`), assistant('hello')], 'act.jsonl')
    await runHook('stop', { hook_event_name: 'Stop', transcript_path: t, last_assistant_message: 'hello' })
    expect(loadState().active).toBe('docs')
  })
})
