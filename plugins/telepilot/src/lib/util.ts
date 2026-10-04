// Shared helpers: paths, JSON state files, locking, subprocesses, logging.
// Everything telepilot persists lives under ~/.telepilot (TELEPILOT_HOME overrides),
// so the hub's MCP server, worker hooks, and the launcher script all agree on it.

import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

export const HOME = () => process.env.TELEPILOT_HOME ?? join(homedir(), '.telepilot')
export const CLAUDE_DIR = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
export const paths = {
  config: () => join(HOME(), 'config.json'),
  state: () => join(HOME(), 'state.json'),
  approvals: () => join(HOME(), 'approvals'),
  shots: () => join(HOME(), 'shots'),
  outbox: () => join(HOME(), 'outbox.jsonl'),
  log: () => join(HOME(), 'telepilot.log'),
  locks: () => join(HOME(), 'locks'),
}

export function expandHome(p: string): string {
  return p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function writeJsonAtomic(file: string, value: unknown, mode = 0o600): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode })
  renameSync(tmp, file)
}

// mkdir is atomic, so a lock directory works across the hub server and every hook process.
export async function withLock<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  const dir = join(paths.locks(), `${name}.lock`)
  mkdirSync(paths.locks(), { recursive: true, mode: 0o700 })
  for (let attempt = 0; ; attempt++) {
    try {
      mkdirSync(dir)
      break
    } catch {
      try {
        if (Date.now() - statSync(dir).mtimeMs > 10_000) rmSync(dir, { recursive: true, force: true })
      } catch {}
      if (attempt > 200) throw new Error(`telepilot: lock ${name} busy`)
      await Bun.sleep(25)
    }
  }
  try {
    return await fn()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export type RunResult = { code: number; stdout: string; stderr: string; timedOut: boolean }

export async function run(
  cmd: string[],
  opts: { cwd?: string; input?: string; timeoutMs?: number; env?: Record<string, string | undefined> } = {},
): Promise<RunResult> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env: (opts.env ?? process.env) as Record<string, string>,
    stdin: opts.input !== undefined ? new Blob([opts.input]) : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, opts.timeoutMs ?? 30_000)
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const code = await proc.exited
  clearTimeout(timer)
  return { code, stdout, stderr, timedOut }
}

export function log(message: string): void {
  const line = `${new Date().toISOString()} [${process.env.TELEPILOT_ROLE ?? 'worker'}:${process.pid}] ${message}\n`
  try {
    mkdirSync(HOME(), { recursive: true, mode: 0o700 })
    appendFileSync(paths.log(), line, { mode: 0o600 })
  } catch {}
  process.stderr.write(line)
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
