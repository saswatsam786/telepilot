// telepilot's own memory of sessions: which ones it created, their ids and folders,
// the "active" session follow-ups go to, the project index, and the hub's identity.

import { paths, readJson, withLock, writeJsonAtomic } from './util'

export type SessionRec = {
  name: string
  sessionId?: string
  shortId?: string
  cwd: string
  createdBy: 'telepilot' | 'external'
  createdAt: number
  lastTask?: string
  lastRoutedAt?: number
}

export type State = {
  version: 1
  active?: string
  hub?: { pid?: number; sessionId?: string; transcript?: string; name?: string; startedAt?: number }
  sessions: Record<string, SessionRec>
  projects: Record<string, string>
  approvalFailures: number[]
  unlockFailures?: number[]
}

const EMPTY: State = { version: 1, sessions: {}, projects: {}, approvalFailures: [] }

export function loadState(): State {
  const s = readJson<Partial<State>>(paths.state(), {})
  return { ...EMPTY, ...s, sessions: s.sessions ?? {}, projects: s.projects ?? {}, approvalFailures: s.approvalFailures ?? [] }
}

export async function updateState(fn: (s: State) => void): Promise<State> {
  return withLock('state', () => {
    const s = loadState()
    fn(s)
    writeJsonAtomic(paths.state(), s)
    return s
  })
}
