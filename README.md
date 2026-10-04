<div align="center">

<a href="https://saswatsam786.github.io/telepilot/">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/banner-light.svg">
  <img src="assets/banner-dark.svg" alt="telepilot — your Claude Code, in your pocket" width="100%">
</picture>
</a>

# Your Claude Code, in your pocket.

**Ship from the couch. Nothing runs without your yes.**

**Text any Claude Code session from Telegram or iMessage.<br>It does the work on your Mac and texts you back.**

[![Website](https://img.shields.io/badge/✨_website-live-7a5cff?style=flat-square)](https://saswatsam786.github.io/telepilot/)
[![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-d97757?style=flat-square&logo=anthropic&logoColor=white)](#-quick-start)
[![Telegram](https://img.shields.io/badge/Telegram-2AABEE?style=flat-square&logo=telegram&logoColor=white)](#-how-it-works)
[![iMessage](https://img.shields.io/badge/iMessage-34C759?style=flat-square&logo=imessage&logoColor=white)](#-how-it-works)
[![macOS](https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white)](#-requirements)
[![Bun](https://img.shields.io/badge/runs_on-Bun-f9f1e1?style=flat-square&logo=bun&logoColor=black)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/license-MIT-3b82f6?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/saswatsam786/telepilot?style=flat-square&color=f5c518)](https://github.com/saswatsam786/telepilot/stargazers)

[**Quick start**](#-quick-start) · [**Features**](#-features) · [**How it works**](#-how-it-works) · [**Commands**](#-commands) · [**Security**](#-nothing-runs-without-your-yes) · [**Live demo ↗**](https://saswatsam786.github.io/telepilot/)

</div>

<br>

<table>
<tr>
<td width="55%" valign="middle">

### You left a refactor running. You're on the train.

Did the tests pass? Is it stuck waiting on a permission prompt?

**telepilot turns your chat app into a remote control for every Claude Code session on your Mac.**

- 💬 &nbsp;Message any session by name, or start a new one in any repo
- ✅ &nbsp;Approve risky actions with **one tap**
- 📸 &nbsp;Grab a screenshot or camera photo, open apps, **unlock the Mac**
- 🎙 &nbsp;Send voice notes; they're transcribed on your Mac

It's not another agent. **It's _your_ Claude Code**, with your plan, sessions, skills, MCP servers and permissions. The chat app is just the pipe.

</td>
<td width="45%" align="center" valign="middle">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/demo-chat.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/demo-chat-light.svg">
  <img src="assets/demo-chat-light.svg" alt="telepilot chat demo" width="300">
</picture>

</td>
</tr>
</table>

## ⚡ Quick start

One line in your terminal:

```bash
claude plugin marketplace add saswatsam786/telepilot && claude plugin install telepilot@telepilot
```

Then start Claude Code and run `/telepilot:setup`. If a session was already open, run `/reload-plugins` in it first. Or, from inside Claude Code, paste these commands:

```bash
/plugin marketplace add saswatsam786/telepilot
/plugin install telepilot@telepilot
/reload-plugins
/telepilot:setup
```

Setup asks which app you want (Telegram or iMessage), then walks you through the rest. **It takes about 2 minutes.** It:

- installs Bun and tmux with Homebrew if they're missing,
- connects your bot (paste the token from [@BotFather](https://t.me/BotFather)),
- starts the hub. The first time, it asks you to trust the hub's folder once: run `telepilot attach`, press Enter, then Ctrl-b d,
- pairs your account (tap **Start** on the bot, then confirm it's you),
- adds one permission rule (`mcp__plugin_telepilot_telepilot`) to `~/.claude/settings.json` so your sessions can use telepilot's Mac tools. It keeps a backup.
- offers to keep the hub always on.

> [!TIP]
> Setup puts the `telepilot` command in `~/.local/bin`. If you skipped always-on, run `telepilot service install` later. It starts the hub at login and restarts it if anything dies.

## ✨ Features

<table>
<tr>
<td colspan="2" valign="top">

### 🧭 &nbsp;Talk to any session
`@api fix the build` goes to a running session. If that session is stopped, it's resumed, and `/new blog ~/code/blog` starts one in any folder. Don't name a session and the hub picks the right one, or asks you.

</td>
<td valign="top">

### ✅ &nbsp;One-tap approvals
Permission prompts arrive as **yes / no buttons**. Claude Code's safety system stays on.

</td>
</tr>
<tr>
<td valign="top">

### 📬 &nbsp;Results come to you
Every session posts its own answer, with live typing and "still working" pings.

</td>
<td colspan="2" valign="top">

### 💻 &nbsp;Your Mac, remotely
Take screenshots and camera photos, open apps, run Shortcuts, read the clipboard, set the volume, check the battery, and use `/unlock` and `/lock`. Your password stays in the Keychain and never goes through chat.

</td>
</tr>
<tr>
<td valign="top">

### 🎙 &nbsp;Voice notes
Voice notes are transcribed locally with whisper.cpp. No cloud.

</td>
<td valign="top">

### 🛡 &nbsp;Safe by default
You get an allowlist, guard hooks, single-use codes, `/panic` and `/audit`.

</td>
<td valign="top">

### 🪶 &nbsp;No extra servers
Everything runs on first-party Claude Code features and nothing else.

</td>
</tr>
</table>

## 💡 Use cases

| | |
|:--|:--|
| 🛋 **Fix a failing CI from the couch** | "CI is red on main, fix it." The session reads the logs, patches, pushes and replies when it's green. |
| 🐕 **Walk the dog, ship a PR** | Dictate a voice note. It's transcribed on your Mac, routed, coded, and the PR is opened. |
| 👥 **What's everyone doing?** | Run backend, app and infra sessions at once and get one status roll-up. |
| 🔐 **Approve from anywhere** | Risky commands wait for your yes / no tap. |
| 💻 **Your Mac, remotely** | Lock or unlock, open apps, take a screenshot or photo, find and send a file. |
| ☕ **Morning briefing** | Calendar, PRs and alerts summed up in chat, using your own connectors. |
| 🌙 **Overnight refactor** | Start it before bed and wake up to a summary and the diff. |
| 🚨 **Incident response** | A Sentry alert comes in, the session investigates and proposes a fix. You decide. |
| 🚀 **Deploys, one step at a time** | Build, test, merge, deploy, with a confirmation at each risky step. |
| 💬 **Ask anything about your code** | "Where do we refresh auth tokens?" answered from anywhere. |

## 🧠 How it works

```mermaid
flowchart LR
    P(["📱 You<br/>Telegram · iMessage"]) <--> C["Official channel plugin"]
    C --> H{{"🧭 hub<br/>routes only"}}
    H -- "SendMessage" --> A["api · running"]
    H -- "resume" --> B["blog · stopped"]
    H -- "new" --> N["any folder · new"]
    H -- "delegate" --> M["mac · camera · apps"]
    A & B & N & M -. "results + yes/no buttons" .-> P
```

1. **The hub only routes.** It runs Anthropic's official Telegram channel plus telepilot's dispatcher. It never does heavy work, so it always answers quickly.
2. **Workers are ordinary Claude Code sessions.** Their hooks post results and approval buttons straight to your chat, so no hub tokens are spent relaying.
3. **No telepilot server.** It runs on your Mac, built on Claude Code's background sessions, cross-session messaging and hooks. Only Claude Code and your chat app talk to the cloud.

<details>
<summary><b>Why not just use the official Telegram plugin?</b></summary>

<br>

The official channel connects Telegram to **one** session. telepilot adds:

- routing to many named, new and stopped sessions
- approvals relayed from background sessions
- Mac tools, unlock and lock
- an always-on supervisor
- guard rails for phone-driven turns

</details>

## 📟 Commands

| Send | What happens |
|:--|:--|
| `@name <task>` | Send to that session |
| `<anything>` | Send to the active session ★, or let the hub decide |
| `/new <name> [folder] [task]` | Start a background session |
| `/sessions` | List sessions, with tap-to-switch buttons |
| `/switch` · `/logs` · `/stop <name>` | Manage sessions |
| `/screenshot` · `/photo` | Screenshot or camera photo of the Mac |
| `/unlock` · `/lock` | Unlock (after you tap yes) or lock the Mac |
| `/panic` | Stop every session telepilot started and deny pending requests |
| `/audit` | Recent remote actions |
| 🎙 voice note | Transcribed locally, then routed |

<details>
<summary><b>🖥 Launcher commands (on the Mac)</b></summary>

<br>

```bash
telepilot setup             # re-run setup any time; it only fixes what's missing
telepilot pair              # pair your Telegram account again
telepilot start | stop | restart | status | logs | attach | doctor
telepilot stop --all        # kill switch: hub + every session telepilot started
telepilot permissions       # trigger the macOS permission pop-ups once
telepilot unlock-setup      # store your login password in the Keychain for /unlock
telepilot allow-tools       # let sessions use telepilot's Mac tools without prompts
telepilot service install   # LaunchAgent: start at login, self-heal (undo: service uninstall)
```

</details>

<details id="-requirements">
<summary><b>📋 Requirements</b></summary>

<br>

- macOS only. telepilot uses tmux, launchd and AppleScript.
- The Claude Code CLI 2.1.288 or newer, logged in with claude.ai (Pro/Max) or an API key. On Team and Enterprise plans, an admin must enable Channels. Open Claude Code once before you install. Its first launch adds Anthropic's official plugin marketplace, which provides the Telegram and iMessage channel plugins.
- git, from the Xcode Command Line Tools (`xcode-select --install`). Claude Code needs it to add the marketplace.
- [Bun](https://bun.sh) and tmux. Setup installs them with [Homebrew](https://brew.sh) if they're missing. Without Homebrew, install them yourself first.
- Telegram: a bot from [@BotFather](https://t.me/BotFather), which setup walks you through. iMessage: your terminal app needs Full Disk Access.
- Optional, for voice notes: `brew install ffmpeg whisper-cpp` plus the whisper model:
  `mkdir -p ~/.telepilot/models && curl -L -o ~/.telepilot/models/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin`

</details>

<details>
<summary><b>🩺 Troubleshooting install</b></summary>

<br>

| You see | Do this |
|:--|:--|
| `Premature close` / clone failed on `marketplace add` | Install git: `xcode-select --install` |
| `Plugin "telegram" not found in marketplace "claude-plugins-official"` | `claude plugin marketplace add anthropics/claude-plugins-official`, then run setup again |
| `/telepilot:setup` isn't recognized | Run `/reload-plugins` or start a new Claude Code session |
| `Claude Code is not logged in` | `claude auth login` |
| `Telegram rejected that token` | Copy the token again from @BotFather. The same message appears if `api.telegram.org` can't be reached, so check your network or VPN. |
| `telepilot: command not found` | Setup installs it in `~/.local/bin`. Add that folder to your `PATH`, or finish `/telepilot:setup` first. |
| iMessage: `needs Full Disk Access` | Turn it on for your terminal app, quit and reopen it, then run setup again |
| Anything else | `telepilot doctor` |

</details>

## 🔐 Nothing runs without your yes

> [!IMPORTANT]
> Whoever controls your Telegram account can drive your Mac. **Turn on Telegram two-step verification.**

- **Only you get in.** The official pairing allowlist means only your account reaches the hub.
- **Permissions stay on.** Risky actions need your tap. Codes are random, single-use and expiring, and 3 wrong codes lock approvals for 10 minutes.
- **Guard hooks** block `sudo`, deleting `/` or `~`, disk erasing, `curl | sh`, and reading secrets or the bot token. They also block edits to Claude settings.
- **Trusted routing only.** Workers trust routing headers only from the real hub process, checked by name and PID.
- **Know the channel.** Telegram bot chats aren't end-to-end encrypted. iMessage chats are.

<details>
<summary><b>⚠️ Limitations</b></summary>

<br>

- Channels are a Claude Code research preview.
- A message can't interrupt a session mid-task. It's queued until the current turn ends.
- Terminal-only dialogs, such as workspace trust and MCP logins, need you at the Mac once.

</details>

## 🛠 Development

```bash
bun install && bun test     # unit + integration tests, no network, fake claude
```

The plugin lives in [`plugins/telepilot`](plugins/telepilot) and has no runtime dependencies. The landing page is [`docs/index.html`](docs/index.html). See the plugin's [README](plugins/telepilot/README.md) for the fakechat dev loop.

## 🙏 Credits

Smooth scrolling on the [landing page](https://saswatsam786.github.io/telepilot/) by [Lenis](https://github.com/darkroomengineering/lenis) (MIT).

<div align="center">
<br>

### If telepilot saved you a walk back to your desk, drop a ⭐

<sub>MIT © <a href="https://github.com/saswatsam786">saswatsam786</a></sub>

</div>
