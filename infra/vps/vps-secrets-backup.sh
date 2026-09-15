#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly FORMAT="arcadeplatform-vps-secret-backup"
readonly VERSION=1
readonly SOURCE_PRODUCTION="/etc/arcadeplatform/ws-server.env"
readonly SOURCE_PREVIEW="/opt/arcade-ws-preview/.env.preview"
readonly MEMBER_PRODUCTION="etc/arcadeplatform/ws-server.env"
readonly MEMBER_PREVIEW="opt/arcade-ws-preview/.env.preview"
readonly ENCRYPTED_OBJECT="vps-secrets.tar.age"

OUTPUT_ROOT=""
AGE_RECIPIENT=""
ARTIFACT_STAGE=""

die() {
  echo "vps-secrets-backup: $*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage:
  vps-secrets-backup.sh --output-dir DIR --recipient AGE_RECIPIENT

The recipient is public. The corresponding private age identity never belongs
on the VPS. The artifact contains only the two active WS environment files.
USAGE
}

file_sha256() {
  sha256sum -- "$1" | awk '{print $1}'
}

file_size() {
  wc -c < "$1"
}

source_present() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" ]] || die "required source is missing or a symlink: $path"
}

source_stable() {
  local path="$1"
  local expected_size="$2"
  local expected_sha256="$3"
  local actual_size
  local actual_sha256

  source_present "$path"
  actual_size="$(file_size "$path")"
  actual_sha256="$(file_sha256 "$path")"
  [[ "$actual_size" == "$expected_size" && "$actual_sha256" == "$expected_sha256" ]]
}

cleanup() {
  local status=$?
  trap - EXIT

  if [[ -n "${ARTIFACT_STAGE:-}" && -d "$ARTIFACT_STAGE" ]]; then
    rm -f -- "$ARTIFACT_STAGE/$ENCRYPTED_OBJECT" "$ARTIFACT_STAGE/manifest.json" || status=1
    rmdir -- "$ARTIFACT_STAGE" || status=1
  fi

  if (( status != 0 )); then
    echo "vps-secrets-backup: cleanup failed; refusing to report success" >&2
  fi
  exit "$status"
}

while (($# > 0)); do
  case "$1" in
    --output-dir)
      [[ $# -ge 2 ]] || die "--output-dir requires a value"
      OUTPUT_ROOT="$2"
      shift 2
      ;;
    --recipient)
      [[ $# -ge 2 ]] || die "--recipient requires a value"
      AGE_RECIPIENT="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "$OUTPUT_ROOT" ]] || die "--output-dir is required"
[[ -n "$AGE_RECIPIENT" ]] || die "--recipient is required"
[[ "$AGE_RECIPIENT" == age1* ]] || die "--recipient must be an age public recipient"
command -v age >/dev/null 2>&1 || die "age is required"

source_present "$SOURCE_PRODUCTION"
source_present "$SOURCE_PREVIEW"

OUTPUT_ROOT="$(realpath -m -- "$OUTPUT_ROOT")"
case "$OUTPUT_ROOT" in
  /etc/arcadeplatform|/etc/arcadeplatform/*|/opt/arcade-ws-preview|/opt/arcade-ws-preview/*)
    die "artifact output must not be a live environment path"
    ;;
esac
mkdir -p -- "$OUTPUT_ROOT"
OUTPUT_ROOT="$(realpath -e -- "$OUTPUT_ROOT")"

created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
artifact_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
artifact_dir="$OUTPUT_ROOT/arcadeplatform-vps-secrets-$artifact_stamp"
if [[ -e "$artifact_dir" || -L "$artifact_dir" ]]; then
  die "artifact directory already exists: $artifact_dir"
fi

ARTIFACT_STAGE="$(mktemp -d "$OUTPUT_ROOT/.vps-secrets.XXXXXX")"
trap cleanup EXIT
encrypted_path="$ARTIFACT_STAGE/$ENCRYPTED_OBJECT"

stable=0
for attempt in 1 2 3; do
  production_size="$(file_size "$SOURCE_PRODUCTION")"
  production_sha256="$(file_sha256 "$SOURCE_PRODUCTION")"
  preview_size="$(file_size "$SOURCE_PREVIEW")"
  preview_sha256="$(file_sha256 "$SOURCE_PREVIEW")"

  for value in "$production_sha256" "$preview_sha256"; do
    [[ "$value" =~ ^[0-9a-f]{64}$ ]] || die "unexpected source checksum format"
  done

  rm -f -- "$encrypted_path"

  # The archive is streamed directly into age. No plaintext tar/archive file
  # is created on the VPS.
  tar --create --file=- --directory=/ --format=pax --owner=0 --group=0 \
    --numeric-owner --mode=0600 -- \
    etc/arcadeplatform/ws-server.env \
    opt/arcade-ws-preview/.env.preview \
    | age --encrypt --recipient "$AGE_RECIPIENT" --output "$encrypted_path"

  if source_stable "$SOURCE_PRODUCTION" "$production_size" "$production_sha256" \
    && source_stable "$SOURCE_PREVIEW" "$preview_size" "$preview_sha256"; then
    stable=1
    break
  fi

  rm -f -- "$encrypted_path"
  echo "vps-secrets-backup: source changed during attempt $attempt; retrying" >&2
done

if (( stable != 1 )); then
  die "source files did not remain stable during backup"
fi

encrypted_sha256="$(file_sha256 "$encrypted_path")"
[[ "$encrypted_sha256" =~ ^[0-9a-f]{64}$ ]] || die "unexpected encrypted checksum format"

cat > "$ARTIFACT_STAGE/manifest.json" <<EOF
{
  "format": "$FORMAT",
  "version": $VERSION,
  "timestamp": "$created_at",
  "encrypted_object": "$ENCRYPTED_OBJECT",
  "encrypted_sha256": "$encrypted_sha256",
  "files": [
    {
      "source_path": "$SOURCE_PRODUCTION",
      "filename": "$MEMBER_PRODUCTION",
      "plaintext_byte_size": $production_size,
      "plaintext_sha256": "$production_sha256"
    },
    {
      "source_path": "$SOURCE_PREVIEW",
      "filename": "$MEMBER_PREVIEW",
      "plaintext_byte_size": $preview_size,
      "plaintext_sha256": "$preview_sha256"
    }
  ]
}
EOF

mv -T -- "$ARTIFACT_STAGE" "$artifact_dir"
ARTIFACT_STAGE=""
echo "encrypted VPS secret artifact created: $artifact_dir"
