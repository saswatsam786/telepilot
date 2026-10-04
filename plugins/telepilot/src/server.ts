// telepilot MCP server: stdio JSON-RPC, no dependencies. stdout carries protocol only;
// logs go to stderr / ~/.telepilot/telepilot.log.
//
// Every session gets the Mac tools. Only the hub (TELEPILOT_ROLE=hub, set by the
// launcher) gets the session/routing tools, so workers can't spawn or steer sessions.

import { updateState } from './lib/registry'
import { log } from './lib/util'
import { audioTools } from './tools/audio'
import { macTools } from './tools/mac'
import { sessionTools } from './tools/sessions'
import { fail, type Tool, type ToolResult } from './tools/types'

const VERSION = '0.1.0'
const KNOWN_PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']
const isHub = process.env.TELEPILOT_ROLE === 'hub'

// The hub only talks and routes, so it gets the routing tools (+ transcribe for voice notes);
// every session it routes to gets the Mac tools.
const tools: Tool[] = isHub
  ? [...sessionTools, ...audioTools]
  : [...macTools, ...audioTools, ...(process.env.TELEPILOT_EXPOSE_SESSION_TOOLS === '1' ? sessionTools : [])]
const byName = new Map(tools.map(t => [t.name, t]))

const INSTRUCTIONS = isHub
  ? 'You are the telepilot hub. For every inbound <channel> message call the `route` tool first and follow the action it returns (see the telepilot:dispatcher skill).'
  : 'telepilot Mac tools: screenshot, system_status, open, apps, shortcuts, spotlight, clipboard, notify, volume, display, run_applescript, share_file (sends a file to the user\'s Telegram), transcribe.'

const send = (msg: object) => process.stdout.write(JSON.stringify(msg) + '\n')

async function handle(msg: any): Promise<void> {
  const { id, method, params } = msg ?? {}
  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: KNOWN_PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'telepilot', version: VERSION },
          instructions: INSTRUCTIONS,
        },
      })
      return
    case 'tools/list':
      send({ jsonrpc: '2.0', id, result: { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } })
      return
    case 'tools/call': {
      const tool = byName.get(params?.name)
      let result: ToolResult
      try {
        result = tool ? await tool.run(params?.arguments ?? {}) : fail(`unknown tool: ${params?.name}`)
      } catch (err) {
        result = fail(err instanceof Error ? err.message : String(err))
        log(`tool ${params?.name} failed: ${err}`)
      }
      send({ jsonrpc: '2.0', id, result })
      return
    }
    case 'ping':
      send({ jsonrpc: '2.0', id, result: {} })
      return
    default:
      if (id !== undefined && id !== null && method) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
  }
}

if (isHub) {
  // Claude Code spawns this server directly (scripts/bun.sh execs bun), so our parent is
  // the hub's Claude process — the pid workers see as `verifiedPeerPid` on its messages.
  await updateState(s => {
    s.hub = { ...s.hub, pid: process.ppid, startedAt: Date.now() }
  }).catch(err => log(`could not record hub pid: ${err}`))
}

for await (const line of console) {
  if (!line.trim()) continue
  let msg: unknown
  try {
    msg = JSON.parse(line)
  } catch {
    continue
  }
  void handle(msg) // concurrent: a slow tool must not block pings
}
