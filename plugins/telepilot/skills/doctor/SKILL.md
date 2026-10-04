---
name: doctor
description: Diagnose telepilot problems (hub not answering, messages not reaching sessions, results not posted, approvals not arriving). Use when the user runs /telepilot:doctor or reports telepilot isn't working.
user-invocable: true
allowed-tools:
  - Bash(bash *telepilot* doctor)
  - Bash(bash *telepilot* status)
  - Bash(bash *telepilot* logs*)
  - Bash(tail -n * ~/.telepilot/telepilot.log)
  - Read
---

# /telepilot:doctor

1. Run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/telepilot" doctor` and `… status`.
2. Explain every ✗ line and the fix. `telepilot setup` repairs most of them and is safe to re-run. Common ones:
   - **Hub not running:** `telepilot start`. If it exits right away, use `telepilot attach` to see why. The usual causes are workspace trust and login.
   - **Poller dead or 409 conflicts:** another session is running the Telegram plugin. Make sure `enabledPlugins` has `"telegram@claude-plugins-official": false` in `~/.claude/settings.json`, then `telepilot restart`.
   - **No token or not paired:** `/telegram:configure <token>`, then DM the bot and run `/telegram:access pair <code>`.
   - **Results not posted:** check `~/.telepilot/telepilot.log`. Check whether `~/.telepilot/outbox.jsonl` is growing; that means sends are in dry-run because no token or chat id was found.
   - **Messages held, not delivered:** set `"crossSessionInbound": "accept"` in `~/.claude/settings.json`.
3. Read the last 40 lines of `~/.telepilot/telepilot.log` for errors. Never print the bot token.
