#!/usr/bin/env bash
set -euo pipefail

# Deletes files listed under CANDIDATE_FILES in client/safe-files.txt.
# Safety features:
# - Dry run by default
# - Verifies SAFE_FILES and CANDIDATE_FILES sections exist
# - Ensures no candidate is also listed as safe
# - Only deletes files under client/app
# - Requires explicit --force to delete

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT="$ROOT_DIR/client/safe-files.txt"
APP_DIR="$ROOT_DIR/client/app"

DRY_RUN=1
if [[ "${1:-}" == "--force" ]]; then
  DRY_RUN=0
fi

if [[ ! -f "$REPORT" ]]; then
  echo "Report not found: $REPORT" >&2
  exit 1
fi

safe=()
cand=()
mode=""

tmp_safe="$(mktemp)"
tmp_cand="$(mktemp)"
trap 'rm -f "$tmp_safe" "$tmp_cand"' EXIT

while IFS= read -r line; do
  if [[ "$line" == "SAFE_FILES" ]]; then
    mode="safe"
    continue
  fi
  if [[ "$line" == "CANDIDATE_FILES" ]]; then
    mode="cand"
    continue
  fi
  if [[ -z "$line" ]]; then
    continue
  fi
  if [[ "$mode" == "safe" ]]; then
    safe+=("$line")
  elif [[ "$mode" == "cand" ]]; then
    cand+=("$line")
  fi
done < "$REPORT"

if [[ "${#safe[@]}" -eq 0 || "${#cand[@]}" -eq 0 ]]; then
  echo "Report sections missing or empty. Aborting." >&2
  exit 1
fi

for p in "${safe[@]}"; do
  if [[ "$p" != client/app/* ]]; then
    echo "Safe entry outside client/app detected: $p" >&2
    exit 1
  fi
  printf '%s\n' "$p" >> "$tmp_safe"
done

filtered=()
for p in "${cand[@]}"; do
  if [[ "$p" != client/app/* ]]; then
    echo "Candidate outside client/app detected: $p" >&2
    exit 1
  fi
  filtered+=("$p")
  printf '%s\n' "$p" >> "$tmp_cand"
done

# Ensure no candidate is also marked safe.
if awk 'NR==FNR {safe[$0]=1; next} {if (safe[$0]) {print $0; found=1}} END {exit found}' "$tmp_safe" "$tmp_cand"; then
  :
else
  echo "One or more candidates are also marked safe. Aborting." >&2
  exit 1
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry run: no files will be deleted."
  echo "Candidates: ${#filtered[@]}"
  for p in "${filtered[@]}"; do
    echo "[DRY] rm -f \"$ROOT_DIR/$p\""
  done
  echo ""
  echo "Run with --force to delete."
  exit 0
fi

count=0
for p in "${filtered[@]}"; do
  target="$ROOT_DIR/$p"
  if [[ -f "$target" ]]; then
    rm -f "$target"
    count=$((count + 1))
  fi
done

echo "Deleted $count files listed as candidates."
