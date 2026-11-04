#!/usr/bin/env bash
# Publishes the build outputs in DIR as the GitHub release for TAG.
#
#   TAG=v1.4.35 GH_REPO=owner/name GH_TOKEN=... publish-release.sh artifacts
#
# Called by the "Publish release" job in .github/workflows/release.yml. It
# replaces softprops/action-gh-release, which from 2026-11-04 kept dying in the
# middle of its parallel uploads without printing an error, leaving an
# `untagged-…` draft with some files missing; rerunning the job then failed
# because the action could not find that draft by its tag.
#
# Every step here can be run again and picks up where the last run stopped:
#
#   1. Check DIR: at least MIN_FILES files, the three latest*.yml updater files,
#      every file those name, and (for vX.Y.Z tags) the version they announce.
#   2. Reuse the release for TAG, published or draft, or create it as a draft.
#      Everything after this works on the release id, never the tag, so a
#      draft is as easy to find as a published release.
#   3. Upload the files one at a time with retries. A file already on the
#      release with the same sha256 is left alone; anything else under that
#      name is deleted first.
#   4. Check every file on the release against DIR by sha256, and the three
#      latest*.yml byte for byte. Nothing is published unless this passes.
#   5. Publish (draft=false) without touching Latest.
#   6. vX.Y.Z tags only: mark the highest published vX.Y.Z release Latest.
#      Releases tagged minutes apart can finish in either order, so each run
#      sets Latest to the highest version that is published right now, and
#      checks again a little later. An older tag never takes Latest from a
#      newer one.
#
# Any other tag (v1.4.34-test.1, say) is published as a pre-release and never
# touches Latest. The desktop updater reads only the Latest release, so such a
# tag is a safe way to exercise this script.
#
# CHECK_ONLY=1 runs step 1 and compares DIR with the existing release (step 4)
# without changing anything on GitHub. DRAFT_ONLY=1 stops after step 4, leaving
# a checked draft that nobody but the repository's writers can see.
set -euo pipefail

TAG=${TAG:?TAG is required, e.g. v1.4.35}
DIR=${1:-artifacts}
MIN_FILES=${MIN_FILES:-13}
CHECK_ONLY=${CHECK_ONLY:-}
DRAFT_ONLY=${DRAFT_ONLY:-}
: "${GH_REPO:?GH_REPO is required, e.g. owner/name}"
: "${GH_TOKEN:?GH_TOKEN is required}"
export GH_REPO GH_TOKEN

API="repos/$GH_REPO"
UPLOADS="https://uploads.github.com/$API"

log() { printf '%s\n' "$*"; }
fail() { printf '::error::%s\n' "$*"; exit 1; }

# retry <command...>: up to 5 attempts, 5/10/20/40 s apart.
retry() {
  local attempt=1 delay=5
  until "$@"; do
    if ((attempt >= 5)); then
      log "Giving up after $attempt attempts: $*"
      return 1
    fi
    log "Attempt $attempt failed, retrying in ${delay}s: $*"
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

sha256_of() { printf 'sha256:%s' "$(sha256sum "$1" | cut -d' ' -f1)"; }

# Tags go into jq filters below, so keep them to characters that cannot break one.
[[ $TAG =~ ^v[0-9A-Za-z.+-]+$ ]] || fail "Unexpected tag '$TAG'."
STABLE=
[[ $TAG =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] && STABLE=1

# --- 1. Check the build outputs -------------------------------------------
[ -d "$DIR" ] || fail "No '$DIR' folder."
mapfile -t FILES < <(find "$DIR" -maxdepth 1 -type f -printf '%f\n' | LC_ALL=C sort)
log "Files to publish (${#FILES[@]}):"
for f in "${FILES[@]}"; do log "  $f  $(stat -c %s "$DIR/$f") bytes"; done
((${#FILES[@]} >= MIN_FILES)) || fail "Expected at least $MIN_FILES files, found ${#FILES[@]}."

for yml in latest.yml latest-mac.yml latest-linux.yml; do
  [ -f "$DIR/$yml" ] || fail "$yml is missing; installed copies would not see this release."
  if [ -n "$STABLE" ]; then
    announced=$(sed -n 's/^version: *//p' "$DIR/$yml" | tr -d "\"'\r")
    [ "v$announced" = "$TAG" ] || fail "$yml announces version '$announced', not ${TAG#v}."
  fi
  # electron-builder lists each download as `url:` and the main one as `path:`.
  while read -r ref; do
    [ -f "$DIR/$ref" ] || fail "$yml points at $ref, which is not in $DIR."
  done < <(sed -n 's/^ *-\{0,1\} *\(url\|path\): *//p' "$DIR/$yml" | tr -d "\"'\r")
done

# --- 2. Find or create the release ----------------------------------------
# The release list includes drafts (the token can push), unlike the by-tag API.
# Published first, then oldest, so a stray duplicate draft is never preferred.
find_release() {
  gh api "$API/releases?per_page=50" \
    --jq "[.[] | select(.tag_name == \"$TAG\")] | sort_by(.draft, .id) | map(.id) | join(\" \")"
}

ids=$(retry find_release)
if [ -z "$ids" ] && [ -z "$CHECK_ONLY" ]; then
  log "Creating draft release $TAG..."
  for attempt in 1 2 3; do
    if gh api -X POST "$API/releases" -f tag_name="$TAG" -f name="$TAG" \
      -F draft=true -F prerelease="$([ -n "$STABLE" ] && echo false || echo true)" \
      -F generate_release_notes=true --jq .id >/dev/null; then
      break
    fi
    # The create may have gone through even though the call failed; look
    # before trying again so a retry never makes a second draft.
    sleep 10
    ids=$(retry find_release)
    [ -n "$ids" ] && break
    ((attempt < 3)) || fail "Could not create release $TAG."
  done
  for _ in 1 2 3 4 5 6; do
    ids=$(retry find_release)
    [ -n "$ids" ] && break
    sleep 5
  done
fi
[ -n "$ids" ] || fail "No release for $TAG."
read -r -a id_list <<<"$ids"
RELEASE_ID=${id_list[0]}
((${#id_list[@]} == 1)) ||
  log "::warning::$TAG has ${#id_list[@]} releases (${ids}); using $RELEASE_ID. Delete the other drafts by hand."
log "Release $TAG is id $RELEASE_ID."

# name<TAB>id<TAB>state<TAB>digest<TAB>size for every asset on the release.
assets() {
  gh api "$API/releases/$RELEASE_ID/assets?per_page=100" --paginate \
    --jq '.[] | [.name, .id, .state, (.digest // ""), .size] | @tsv'
}

# --- 3. Upload --------------------------------------------------------------
upload() {
  local name=$1 file="$DIR/$1" want existing aid state digest
  want=$(sha256_of "$file")
  existing=$(assets | awk -F'\t' -v n="$name" '$1 == n') || return 1
  if [ -n "$existing" ]; then
    IFS=$'\t' read -r _ aid state digest _ <<<"$existing"
    if [ "$state" = uploaded ] && [ "$digest" = "$want" ]; then
      log "  $name is already there."
      return 0
    fi
    log "  Replacing $name ($state, ${digest:-no digest})..."
    gh api -X DELETE "$API/releases/assets/$aid" >/dev/null || return 1
  fi
  log "  Uploading $name..."
  curl --fail-with-body --silent --show-error --max-time 900 -o /dev/null \
    -X POST -T "$file" \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Type: application/octet-stream" \
    "$UPLOADS/releases/$RELEASE_ID/assets?name=$name"
}

if [ -z "$CHECK_ONLY" ]; then
  log "Uploading to release $RELEASE_ID:"
  for f in "${FILES[@]}"; do retry upload "$f" || fail "Could not upload $f."; done
fi

# --- 4. Check what is on the release ----------------------------------------
check_release() {
  local listing ok=1 f line want state digest aid
  listing=$(retry assets) || return 1
  for f in "${FILES[@]}"; do
    line=$(awk -F'\t' -v n="$f" '$1 == n' <<<"$listing")
    want=$(sha256_of "$DIR/$f")
    if [ -z "$line" ]; then
      log "  MISSING  $f"
      ok=
      continue
    fi
    IFS=$'\t' read -r _ aid state digest _ <<<"$line"
    if [ "$state" != uploaded ] || [ "$digest" != "$want" ]; then
      log "  WRONG    $f ($state, ${digest:-no digest}; expected $want)"
      ok=
      continue
    fi
    log "  ok       $f"
  done
  # The updater files once more, byte for byte, as GitHub serves them.
  for f in latest.yml latest-mac.yml latest-linux.yml; do
    aid=$(awk -F'\t' -v n="$f" '$1 == n {print $2}' <<<"$listing")
    [ -n "$aid" ] || continue
    if ! gh api -H "Accept: application/octet-stream" "$API/releases/assets/$aid" |
      cmp -s - "$DIR/$f"; then
      log "  WRONG    $f differs from CI's file"
      ok=
    fi
  done
  while IFS=$'\t' read -r f _; do
    [ -n "$f" ] || continue
    printf '%s\n' "${FILES[@]}" | grep -qxF -- "$f" || log "::warning::Release also has $f, which this build did not produce."
  done <<<"$listing"
  [ -n "$ok" ]
}

log "Checking release $RELEASE_ID against $DIR:"
check_release || fail "Release $TAG does not match the build; left as it is."
if [ -n "$CHECK_ONLY" ]; then
  log "CHECK_ONLY: release $TAG matches the build. Nothing changed."
  exit 0
fi
if [ -n "$DRAFT_ONLY" ]; then
  log "DRAFT_ONLY: release $RELEASE_ID for $TAG is uploaded and checked; not published."
  exit 0
fi

# --- 5. Publish -------------------------------------------------------------
log "Publishing $TAG..."
retry gh api -X PATCH "$API/releases/$RELEASE_ID" -F draft=false -f make_latest=false \
  -F prerelease="$([ -n "$STABLE" ] && echo false || echo true)" >/dev/null ||
  fail "Could not publish $TAG."
for _ in 1 2 3 4 5 6; do
  [ "$(gh api "$API/releases/$RELEASE_ID" --jq .draft)" = false ] && break
  sleep 5
done
[ "$(gh api "$API/releases/$RELEASE_ID" --jq .draft)" = false ] || fail "$TAG is still a draft."

# --- 6. Latest --------------------------------------------------------------
if [ -z "$STABLE" ]; then
  log "$TAG is not a vX.Y.Z tag: published as a pre-release, Latest left alone."
  exit 0
fi

highest_published() {
  gh api "$API/releases?per_page=50" \
    --jq '.[] | select((.draft or .prerelease) | not) | [.tag_name, .id] | @tsv' |
    grep -E '^v[0-9]+\.[0-9]+\.[0-9]+'$'\t' | sort -V -k1,1 | tail -n 1
}

set_latest() {
  local top tag id current
  top=$(retry highest_published) || return 1
  IFS=$'\t' read -r tag id <<<"$top"
  current=$(gh api "$API/releases/latest" --jq .tag_name 2>/dev/null || true)
  if [ "$current" = "$tag" ]; then
    log "Latest is $tag."
    return 0
  fi
  log "Marking $tag Latest (was ${current:-none})..."
  retry gh api -X PATCH "$API/releases/$id" -f make_latest=true >/dev/null
}

set_latest
# A release tagged just before or after this one may be finishing right now;
# look again once it has had time to, so the newer one ends up Latest.
sleep 20
set_latest

latest=$(gh api "$API/releases/latest" --jq .tag_name)
if [ "$latest" = "$TAG" ]; then
  log "🎉 $TAG is published and Latest."
else
  log "$TAG is published; $latest stays Latest because it is newer."
fi
