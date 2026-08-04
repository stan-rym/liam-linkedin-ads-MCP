#!/usr/bin/env bash
# Install the Liam skills into an agent's skills directory.
# Default: symlink (git pull keeps them current). --copy to copy instead.
set -euo pipefail

MODE="${1:-link}"
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"

mkdir -p "$DEST"

for dir in "$SRC"/liam-*/ "$SRC"/gads-*/; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  target="$DEST/$name"
  if [ -e "$target" ] && [ ! -L "$target" ] && [ "$MODE" != "--copy" ]; then
    echo "skip    $name (a real directory already exists at $target; remove it or use --copy)"
    continue
  fi
  rm -rf "$target"
  if [ "$MODE" = "--copy" ]; then
    cp -R "${dir%/}" "$target"
    echo "copied  $name -> $target"
  else
    ln -sfn "${dir%/}" "$target"
    echo "linked  $name -> $target"
  fi
done

echo
echo "Done. Restart your Claude Code session to pick up the skills."
