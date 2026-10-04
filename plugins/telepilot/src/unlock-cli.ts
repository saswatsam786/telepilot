// `bun unlock-cli.ts test` — used by `telepilot unlock-setup` for a local lock → unlock self-test.
import { unlockNow } from './lib/unlock'

const r = await unlockNow()
console.log(r.text)
process.exit(r.ok ? 0 : 1)
