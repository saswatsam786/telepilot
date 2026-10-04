// Narrow Mac-control tools. Each does one thing, so users can pre-allow the harmless
// ones (screenshot, status, notify, ...) without pre-allowing raw Bash or AppleScript.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { checkTool } from '../lib/guard'
import { sendFile } from '../lib/notify'
import { expandHome, paths, run, truncate } from '../lib/util'
import { fail, obj, str, text, type Tool, type ToolResult } from './types'

const osa = (lines: string[], args: string[] = [], timeoutMs = 15_000) =>
  run(['osascript', ...lines.flatMap(l => ['-e', l]), ...args], { timeoutMs })

// Turn macOS privacy (TCC) failures into something the user can act on from the phone.
export function explainFailure(stderr: string, timedOut: boolean): string | undefined {
  if (timedOut) return 'Timed out. macOS may be showing a permission pop-up on the Mac that someone has to click Allow on (or run `telepilot permissions` there once).'
  if (/-1743|not authori[sz]ed to send apple events/i.test(stderr)) {
    return 'macOS blocked this: the terminal running Claude needs Automation permission for that app. Someone at the Mac must click Allow once, or run `telepilot permissions` there.'
  }
  if (/-25211|-1719|assistive access|not allowed to send keystrokes|accessibility/i.test(stderr)) {
    return 'macOS blocked this: the terminal running Claude needs Accessibility permission (System Settings → Privacy & Security → Accessibility).'
  }
  return undefined
}

const out = (r: { code: number; stdout: string; stderr: string; timedOut: boolean }, okText?: string): ToolResult => {
  if (r.code === 0) return text(okText ?? (truncate(r.stdout.trim(), 8000) || 'done'))
  const raw = (r.stderr || r.stdout).trim()
  return fail(explainFailure(raw, r.timedOut) ?? (truncate(raw, 2000) || `exit ${r.code}`))
}

const SCREEN_JXA = `ObjC.import("CoreGraphics");
const d = ObjC.deepUnwrap(ObjC.castRefToObject($.CGSessionCopyCurrentDictionary()));
JSON.stringify({ locked: !!(d && d.CGSSessionScreenIsLocked), displayAsleep: !!$.CGDisplayIsAsleep($.CGMainDisplayID()) })`

export type ScreenState = { locked: boolean; displayAsleep: boolean; idleSec?: number }

export function describeScreen(s: ScreenState): string {
  const line = `Display: ${s.displayAsleep ? 'asleep' : 'awake'} · Screen: ${s.locked ? 'locked' : 'unlocked'}${s.idleSec !== undefined ? ` · Idle: ${s.idleSec}s` : ''}`
  if (s.locked) {
    return `${line}\nLocked: clicking and typing on screen won't work until the Mac is unlocked. The owner can send /unlock (it asks for their OK, then types the login password from their Keychain); never type a password yourself. Shell commands, files, opening apps and background tasks still work.`
  }
  return `${line}\n${s.displayAsleep ? 'Unlocked but asleep: call wake_screen before screenshots or screen actions.' : 'Ready for screen actions.'}`
}

export async function screenState(): Promise<ScreenState> {
  const [r, idle] = await Promise.all([
    run(['osascript', '-l', 'JavaScript', '-e', SCREEN_JXA], { timeoutMs: 10_000 }),
    run(['sh', '-c', "ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'"]),
  ])
  if (r.code !== 0) throw new Error(`screen state unavailable: ${r.stderr.trim()}`)
  const s = JSON.parse(r.stdout.trim()) as ScreenState
  const sec = parseInt(idle.stdout.trim(), 10)
  return { ...s, idleSec: Number.isNaN(sec) ? undefined : sec }
}

export async function takeScreenshot(display?: number): Promise<string> {
  const dir = paths.shots()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const shots = readdirSync(dir).filter(f => f.endsWith('.png')).sort()
  for (const old of shots.slice(0, Math.max(0, shots.length - 30))) rmSync(join(dir, old), { force: true })
  const file = join(dir, `shot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`)
  const r = await run(['screencapture', '-x', ...(display ? ['-D', String(display)] : []), file], { timeoutMs: 20_000 })
  if (r.code !== 0 || !existsSync(file) || statSync(file).size === 0) {
    throw new Error(
      `screencapture failed (${r.stderr.trim() || r.code}). Grant Screen Recording to the app running Claude Code: System Settings → Privacy & Security → Screen Recording.`,
    )
  }
  return file
}

export const macTools: Tool[] = [
  {
    name: 'camera_photo',
    description: "Take a photo with the Mac's built-in camera (the camera light turns on) and, with share=true, send it to the owner's chat.",
    inputSchema: obj({ share: { type: 'boolean', description: 'send it to the chat (default true)' }, caption: str('caption') }),
    run: async a => {
      mkdirSync(paths.shots(), { recursive: true, mode: 0o700 })
      const file = join(paths.shots(), `camera-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`)
      const snap = Bun.which('imagesnap')
      const ffmpeg = Bun.which('ffmpeg')
      const r = snap
        ? await run([snap, '-w', '1.5', file], { timeoutMs: 30_000 })
        : ffmpeg
          ? await run([ffmpeg, '-nostdin', '-y', '-f', 'avfoundation', '-framerate', '30', '-i', '0', '-frames:v', '1', file], { timeoutMs: 30_000 })
          : null
      if (!r) return fail('No camera tool found. Install one with: brew install imagesnap')
      if (!existsSync(file) || statSync(file).size === 0) {
        return fail(explainFailure(r.stderr, r.timedOut) ?? `Camera capture failed: ${truncate(r.stderr.trim(), 300)}. macOS may need Camera permission for the terminal app running Claude (click Allow on the Mac once).`)
      }
      if (a.share !== false) await sendFile(file, a.caption ?? '📷')
      return text(a.share !== false ? `Photo taken and sent: ${file}` : file)
    },
  },
  {
    name: 'screen_state',
    description: 'Is the Mac display awake or asleep, the screen locked or unlocked, and how long idle? Check this before screenshots or any click/typing.',
    inputSchema: obj({}),
    run: async () => text(describeScreen(await screenState())),
  },
  {
    name: 'wake_screen',
    description: 'Wake the display (like moving the mouse). It does not unlock the Mac (the owner can send /unlock).',
    inputSchema: obj({}),
    run: async () => {
      await run(['caffeinate', '-u', '-t', '2'], { timeoutMs: 5_000 })
      return text(describeScreen(await screenState()))
    },
  },
  {
    name: 'screenshot',
    description:
      'Capture the Mac screen to a PNG and return its path. Hub: send it with the Telegram reply tool (files). Worker: set share=true to post it to Telegram. inline=true also returns the image to you.',
    inputSchema: obj({
      display: { type: 'number', description: 'display number (1 = main)' },
      share: { type: 'boolean', description: 'post the image to Telegram now' },
      inline: { type: 'boolean', description: 'also return the image content to the model' },
      caption: str('caption when sharing'),
    }),
    run: async a => {
      const file = await takeScreenshot(a.display)
      if (a.share) await sendFile(file, a.caption)
      const content: ToolResult['content'] = [{ type: 'text', text: file }]
      if (a.inline && statSync(file).size < 1_500_000) {
        content.push({ type: 'image', data: readFileSync(file).toString('base64'), mimeType: 'image/png' })
      }
      return { content }
    },
  },
  {
    name: 'system_status',
    description: 'Battery, disk space, uptime, idle time and the frontmost app.',
    inputSchema: obj({}),
    run: async () => {
      const [batt, disk, up, idle, front] = await Promise.all([
        run(['pmset', '-g', 'batt']),
        run(['df', '-h', '/']),
        run(['uptime']),
        run(['sh', '-c', "ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'"]),
        run(['sh', '-c', 'lsappinfo info -only name "$(lsappinfo front)"']),
      ])
      const diskLine = disk.stdout.trim().split('\n')[1]?.split(/\s+/) ?? []
      return text(
        [
          `Battery: ${batt.stdout.split('\n')[1]?.replace(/^\s*-InternalBattery-\d+\s*(\(id=\d+\))?\s*/, '').trim() || 'n/a'}`,
          `Disk /: ${diskLine[3] ?? '?'} free of ${diskLine[1] ?? '?'} (${diskLine[4] ?? '?'} used)`,
          `Uptime: ${up.stdout.trim()}`,
          `Idle: ${idle.stdout.trim() || '?'}s`,
          `Frontmost: ${/"LSDisplayName"="([^"]+)"/.exec(front.stdout)?.[1] ?? front.stdout.trim() ?? '?'}`,
        ].join('\n'),
      )
    },
  },
  {
    name: 'open',
    description: 'Open a URL, a file/folder, or an app by name (like `open`).',
    inputSchema: obj({ target: str('URL, path, or application name') }, ['target']),
    run: async a => {
      const t = String(a.target).trim()
      if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return out(await run(['open', t]), `opened ${t}`)
      const p = resolve(expandHome(t))
      if (existsSync(p)) return out(await run(['open', p]), `opened ${p}`)
      return out(await run(['open', '-a', t]), `opened ${t}`)
    },
  },
  {
    name: 'apps',
    description: 'List running apps, bring one to the front, or quit one.',
    inputSchema: obj({ action: { type: 'string', enum: ['list', 'activate', 'quit'] }, name: str('application name') }, ['action']),
    run: async a => {
      if (a.action === 'list') {
        return out(await osa(['tell application "System Events" to get name of every process whose background only is false']))
      }
      if (!a.name) return fail('name is required')
      if (a.action === 'activate') return out(await run(['open', '-a', String(a.name)]), `activated ${a.name}`)
      return out(await osa(['on run argv', 'tell application (item 1 of argv) to quit', 'end run'], [String(a.name)]), `quit ${a.name}`)
    },
  },
  {
    name: 'shortcuts_list',
    description: "List the user's Apple Shortcuts (their own automations — a safe way to do things on the Mac).",
    inputSchema: obj({}),
    run: async () => out(await run(['shortcuts', 'list'])),
  },
  {
    name: 'shortcuts_run',
    description: 'Run an Apple Shortcut by name, optionally with text input. Returns its output.',
    inputSchema: obj({ name: str('shortcut name'), input: str('optional text input') }, ['name']),
    run: async a => {
      const dir = join(tmpdir(), `telepilot-sc-${process.pid}-${Date.now()}`)
      mkdirSync(dir, { recursive: true })
      const args = ['shortcuts', 'run', String(a.name), '--output-path', join(dir, 'out')]
      if (a.input) {
        writeFileSync(join(dir, 'in.txt'), String(a.input))
        args.push('--input-path', join(dir, 'in.txt'))
      }
      const r = await run(args, { timeoutMs: 120_000 })
      const output = existsSync(join(dir, 'out')) ? readFileSync(join(dir, 'out'), 'utf8') : ''
      rmSync(dir, { recursive: true, force: true })
      return r.code === 0 ? text(truncate(output.trim(), 8000) || `ran ${a.name}`) : out(r)
    },
  },
  {
    name: 'spotlight',
    description: 'Find files with Spotlight (mdfind).',
    inputSchema: obj(
      { query: str('Spotlight query, e.g. a file name or kMDItem expression'), folder: str('limit to this folder (default home)'), limit: { type: 'number' } },
      ['query'],
    ),
    run: async a => {
      const r = await run(['mdfind', '-onlyin', expandHome(String(a.folder ?? '~')), String(a.query)], { timeoutMs: 20_000 })
      if (r.code !== 0) return out(r)
      const lines = r.stdout.trim().split('\n').filter(Boolean)
      const limit = Number(a.limit ?? 20)
      return text(lines.length ? `${lines.slice(0, limit).join('\n')}${lines.length > limit ? `\n… ${lines.length - limit} more` : ''}` : 'no matches')
    },
  },
  {
    name: 'clipboard',
    description: 'Read or replace the Mac clipboard text.',
    inputSchema: obj({ action: { type: 'string', enum: ['get', 'set'] }, text: str('text to copy (for set)') }, ['action']),
    run: async a =>
      a.action === 'get'
        ? out(await run(['pbpaste']))
        : out(await run(['pbcopy'], { input: String(a.text ?? '') }), 'copied to clipboard'),
  },
  {
    name: 'notify',
    description: 'Show a notification on the Mac.',
    inputSchema: obj({ message: str('notification text'), title: str('title (default telepilot)') }, ['message']),
    run: async a =>
      out(
        await osa(['on run argv', 'display notification (item 2 of argv) with title (item 1 of argv)', 'end run'], [String(a.title ?? 'telepilot'), String(a.message)]),
        'notification shown',
      ),
  },
  {
    name: 'volume',
    description: 'Set output volume (0-100) and/or mute.',
    inputSchema: obj({ level: { type: 'number', minimum: 0, maximum: 100 }, mute: { type: 'boolean' } }),
    run: async a => {
      const lines: string[] = ['on run argv']
      const args: string[] = []
      if (a.level !== undefined) {
        lines.push('set volume output volume ((item 1 of argv) as integer)')
        args.push(String(Math.round(Number(a.level))))
      }
      if (a.mute !== undefined) lines.push(a.mute ? 'set volume with output muted' : 'set volume without output muted')
      lines.push('end run')
      if (lines.length === 2) return out(await osa(['output volume of (get volume settings)']))
      return out(await osa(lines, args), 'volume updated')
    },
  },
  {
    name: 'display',
    description: 'Put the display to sleep now (this also locks the Mac when "require password after screen saver/sleep" is on).',
    inputSchema: obj({ action: { type: 'string', enum: ['sleep', 'lock'] } }, ['action']),
    run: async () => out(await run(['pmset', 'displaysleepnow']), 'display is asleep'),
  },
  {
    name: 'run_applescript',
    description: 'Run AppleScript or JXA (escape hatch for anything the other tools cannot do). Asks for approval unless the user pre-allowed it.',
    inputSchema: obj(
      {
        script: str('the script source'),
        language: { type: 'string', enum: ['applescript', 'javascript'] },
        timeout_sec: { type: 'number', description: 'default 30' },
      },
      ['script'],
    ),
    run: async a => {
      const args = ['osascript', ...(a.language === 'javascript' ? ['-l', 'JavaScript'] : []), '-e', String(a.script)]
      return out(await run(args, { timeoutMs: Number(a.timeout_sec ?? 30) * 1000 }))
    },
  },
  {
    name: 'share_file',
    description: "Send a file or image from this Mac to the user's Telegram chat (images as photos, other files as documents, max 50 MB).",
    inputSchema: obj({ path: str('absolute path'), caption: str('optional caption') }, ['path']),
    run: async a => {
      const p = resolve(expandHome(String(a.path)))
      const blocked = checkTool('Read', { file_path: p })
      if (blocked) return fail(blocked.reason)
      if (!existsSync(p) || !statSync(p).isFile()) return fail(`not a file: ${p}`)
      if (statSync(p).size > 50 * 1024 * 1024) return fail('file is larger than 50 MB (Telegram bot limit)')
      const r = await sendFile(p, a.caption)
      return r.ok ? text(r.dryRun ? `queued (dry run): ${p}` : `sent ${p}`) : fail(r.error ?? 'send failed')
    },
  },
]
