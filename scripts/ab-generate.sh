#!/usr/bin/env bash
# R2 generation, one arm. Runs Claude Code in print mode through the local Claude Code login
# (ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN removed), in an empty folder outside any project,
# with no user settings and no MCP servers. The "on" arm adds only --plugin-dir.
#   bash scripts/ab-generate.sh <off|on> <request file> <empty work dir>
set -euo pipefail
ARM="$1"; REQUEST="$2"; WORK="$3"
PLUGIN_DIR="${PLUGIN_DIR:-$HOME/.claude/plugins/cache/context-plugins/paypal/0.4.1}"
if [ -e "$WORK" ] && [ -n "$(ls -A "$WORK")" ]; then echo "Work dir $WORK is not empty" >&2; exit 1; fi
mkdir -p "$WORK"
EXTRA=()
if [ "$ARM" = "on" ]; then EXTRA=(--plugin-dir "$PLUGIN_DIR"); fi
cd "$WORK"
date -u +%Y-%m-%dT%H:%M:%SZ > ../"$(basename "$WORK")".started
env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN claude -p "$(cat "$REQUEST")" \
  --model claude-sonnet-5-5 --setting-sources "" --strict-mcp-config --no-session-persistence \
  --permission-mode bypassPermissions --output-format stream-json --verbose "${EXTRA[@]}" \
  > ../"$(basename "$WORK")".stream.jsonl 2> ../"$(basename "$WORK")".stderr.log
date -u +%Y-%m-%dT%H:%M:%SZ > ../"$(basename "$WORK")".finished
