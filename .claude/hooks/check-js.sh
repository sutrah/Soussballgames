#!/usr/bin/env bash
# Hook PostToolUse (Write|Edit) : vérifie la syntaxe des fichiers .js
# modifiés avec `node --check` (analyse seule, n'exécute jamais le fichier).
# Ne dit rien si tout va bien ; renvoie l'erreur à Claude sinon.
set -euo pipefail

INPUT="$(cat)"
FILE="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')"

case "$FILE" in
  *.js)
    if ! OUTPUT="$(node --check "$FILE" 2>&1)"; then
      jq -n --arg f "$FILE" --arg out "$OUTPUT" \
        '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: ("Erreur de syntaxe JS dans " + $f + " :\n" + $out)}}'
    fi
    ;;
esac
