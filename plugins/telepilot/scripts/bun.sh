#!/bin/sh
# Run a telepilot entry point with Bun, even when Claude Code was started with a minimal PATH
# (Finder, launchd). Hooks stay silent if Bun is missing so they never break a session.
for b in "$(command -v bun 2>/dev/null)" "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do
  if [ -n "$b" ] && [ -x "$b" ]; then exec "$b" "$@"; fi
done
case "$1" in
  *hooks.ts) exit 0 ;;
esac
echo "telepilot: Bun is required — install it with: brew install oven-sh/bun/bun" >&2
exit 1
