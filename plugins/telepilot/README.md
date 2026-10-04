# telepilot

Drive all of your Claude Code sessions from your phone. Telegram (or iMessage) is just the
pipe; your own Claude Code — with your plan, your sessions, skills, MCP servers and
permissions — does the work.

```
you: @api run the tests and fix anything that fails
hub: → api
api: [api] 3 tests were failing on the date parser; fixed in src/date.ts, all 128 pass ✅

you: /new blog ~/code/blog fix the typo in the README
hub: 🆕 blog started in ~/code/blog (★ active). Its answer will be posted here.
blog: 🔐 [blog] wants to run: git push   [ yes ] [ no ]
you: *taps yes*
blog: [blog] Fixed "recieve" → "receive" and pushed to main.
```

## How it works

One **hub** session runs Anthropic's official Telegram channel
(`telegram@claude-plugins-official`) and telepilot's dispatcher. For each message it:

- delivers it to a **running** named session (built-in cross-session messaging),
- resumes a **stopped** one in the background, or
- starts a **new** background session in the right folder.

Each worker session posts its own final answer back to your chat (a Stop hook — no relaying
through the hub) and relays its permission prompts to your phone with a one-time code
(a PermissionRequest hook). Quick Mac requests ("screenshot", "battery?", "open Spotify")
are handed to a `mac` session with telepilot's Mac tools. Anything that needs real work (Mac control, shell, waiting on CI or
builds) goes to a background session with `delegate`, which reports back when it's done, so the hub
never stops answering.

## Requirements

- macOS only. Claude Code CLI (2.1.288+ tested), logged in with claude.ai (Pro/Max) or a Console API key.
  Team/Enterprise: an admin must enable Channels. Open Claude Code once before installing. Its first
  launch adds the official `claude-plugins-official` marketplace, which provides the Telegram/iMessage plugin.
- git, from the Xcode Command Line Tools (`xcode-select --install`), to add the marketplace.
- [Bun](https://bun.sh) (`brew install oven-sh/bun/bun`) and tmux (`brew install tmux`). Setup installs
  both with [Homebrew](https://brew.sh) if they're missing.
- Optional, for voice notes: `brew install ffmpeg whisper-cpp` plus the model:
  `mkdir -p ~/.telepilot/models && curl -L -o ~/.telepilot/models/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin`

## Install (about 2 minutes)

In Claude Code:

```
/plugin marketplace add saswatsam786/telepilot
/plugin install telepilot@telepilot
/reload-plugins
/telepilot:setup
```

Or in a terminal: `claude plugin marketplace add saswatsam786/telepilot && claude plugin install telepilot@telepilot`,
then run `/telepilot:setup` in a new Claude Code session.

Setup asks which app you want (Telegram or iMessage), then does the rest. It:

- installs Bun and tmux with Homebrew if they're missing,
- connects your bot (you paste the token from @BotFather),
- starts the hub with the chat plugin enabled only there,
- the first time, asks you to trust the hub's folder once (`telepilot attach`, press Enter, then Ctrl-b d),
- pairs your account (tap **Start** on the bot, then say yes),
- adds one rule, `mcp__plugin_telepilot_telepilot`, to `~/.claude/settings.json` so sessions can use
  telepilot's Mac tools. It keeps a backup.
- optionally keeps the hub always on.

Setup also installs the `telepilot` command in `~/.local/bin`. After that, `telepilot setup` works from
any terminal. It's safe to re-run, and it only fixes what's missing. To run setup from a terminal
before the command exists, use
`bash "$(ls -d ~/.claude/plugins/cache/telepilot/telepilot/*/ | tail -1)scripts/telepilot" setup`.
If it can't find `telegram@claude-plugins-official`, run
`claude plugin marketplace add anthropics/claude-plugins-official` and run setup again.

## Commands (from your phone)

| message | effect |
|---|---|
| `@name <task>` or `name: <task>` | send to that session |
| `<task>` | send to the active session ★ (or let the hub decide) |
| `/new <name> [folder] [task]` | start a background session |
| `/sessions` · `/switch <name>` · `/logs <name>` · `/stop <name>` | manage sessions |
| `/screenshot` · `/photo` | screenshot or camera photo of your Mac |
| `/unlock` / `/lock` | unlock the Mac (asks your OK with buttons, then types your Keychain-stored password) / lock it |
| `/panic` | stop every background session telepilot started and deny pending requests |
| `/audit` | recent remote actions: routing, approvals, blocks |
| `yes` / `no` (or tap the buttons) | answer a session's permission request |
| voice note | transcribed locally, then routed |

## Launcher (on the Mac)

```
telepilot setup               # re-run setup; safe, only fixes what's missing
telepilot pair                # pair your Telegram account again
telepilot start | stop | restart | status | logs | attach | doctor
telepilot stop --all          # kill switch: hub + every session telepilot started
telepilot permissions         # trigger macOS permission pop-ups once (run it at the Mac)
telepilot unlock-setup        # once, at the Mac: store your login password in the Keychain + self-test /unlock
telepilot allow-tools         # let sessions use telepilot's Mac tools without prompts
telepilot service install     # LaunchAgent: start at login, restart if the hub or bot poller dies
telepilot service uninstall   # remove the LaunchAgent
```

## Security

- Only paired Telegram accounts reach the hub (official pairing + allowlist). Turn on Telegram
  two-step verification: whoever controls your Telegram can drive your Mac.
- Claude Code's permission system stays on. Risky actions in any session need your approval;
  worker approvals use random, single-use, expiring codes (3 wrong codes lock approvals for 10 min).
- A guard hook blocks high-risk actions in phone-driven turns: `sudo`, deleting `/` or `~`,
  disk erasing, `curl | sh`, reading SSH/AWS/keychain secrets or the bot token, editing Claude
  settings or launch agents.
- Workers only act on routing headers sent by the hub session (checked by name and process id).
- No telepilot server: it runs on your Mac. Your chat messages go through Telegram (or iMessage) and your sessions talk to Anthropic as Claude Code always does. Note that Telegram bot chats are
  not end-to-end encrypted (iMessage is).

## Limitations

- Channels are a Claude Code research preview; the Telegram plugin must stay enabled only in the
  hub (setup handles this) or other sessions will take over the bot.
- A message can't interrupt a session mid-task; it is queued until the current turn ends.
- Terminal-only dialogs (workspace trust, MCP logins) need you at the Mac once.

## Development

```
bun test                                     # unit + integration tests (no network, fake claude)
claude plugin install fakechat@claude-plugins-official --scope local
TELEPILOT_HOME=/tmp/tp ./scripts/telepilot start --channel plugin:fakechat@claude-plugins-official --plugin-dir "$PWD"
# open http://127.0.0.1:8787 and chat; worker results land in /tmp/tp/outbox.jsonl
```

MIT licensed.
