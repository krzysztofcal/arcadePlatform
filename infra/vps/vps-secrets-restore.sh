#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly FORMAT="arcadeplatform-vps-secret-backup"
readonly VERSION=1
readonly ENCRYPTED_OBJECT="vps-secrets.tar.age"
readonly MEMBER_PRODUCTION="etc/arcadeplatform/ws-server.env"
readonly MEMBER_PREVIEW="opt/arcade-ws-preview/.env.preview"
readonly LIVE_PRODUCTION_ROOT="/etc/arcadeplatform"
readonly LIVE_PREVIEW_ROOT="/opt/arcade-ws-preview"
readonly LIVE_RELEASE_ROOT="/opt/ws-server"

ARTIFACT_DIR=""
RESTORE_DIR=""
IDENTITY_STDIN=0
RESTORE_DIR_CREATED=0
TEMP_DIR=""
DECRYPTED_ARCHIVE=""

die() {
  echo "vps-secrets-restore: $*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage:
  OWNER_OFF_HOST_IDENTITY_STREAM | \
    vps-secrets-restore.sh \
      --artifact-dir DIR \
      --restore-dir ISOLATED_DIR \
      --identity-stdin

Only an isolated restore directory is supported. Live restore is intentionally
disabled in this Phase C contract.
USAGE
}

file_sha256() {
  sha256sum -- "$1" | awk '{print $1}'
}

file_size() {
  wc -c < "$1"
}

cleanup() {
  local operation_status=$?
  local cleanup_failed=0
  trap - EXIT

  if [[ -n "${DECRYPTED_ARCHIVE:-}" && -e "$DECRYPTED_ARCHIVE" ]]; then
    rm -f -- "$DECRYPTED_ARCHIVE" || cleanup_failed=1
    [[ ! -e "$DECRYPTED_ARCHIVE" ]] || cleanup_failed=1
  fi
  if [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR" ]]; then
    rmdir -- "$TEMP_DIR" || cleanup_failed=1
    [[ ! -e "$TEMP_DIR" ]] || cleanup_failed=1
  fi

  if (( (operation_status != 0 || cleanup_failed != 0) && RESTORE_DIR_CREATED == 1 )); then
    rm -rf -- "$RESTORE_DIR" || cleanup_failed=1
    [[ ! -e "$RESTORE_DIR" ]] || cleanup_failed=1
  fi

  if (( cleanup_failed != 0 )); then
    echo "vps-secrets-restore: temporary plaintext cleanup failed" >&2
    operation_status=1
  fi
  exit "$operation_status"
}

verify_restored_file() {
  local path="$1"
  local expected_size="$2"
  local expected_sha256="$3"
  local actual_size
  local actual_sha256

  [[ -f "$path" && ! -L "$path" ]] || die "required restored file is missing or a symlink: $path"
  actual_size="$(file_size "$path")"
  actual_sha256="$(file_sha256 "$path")"
  [[ "$actual_size" == "$expected_size" ]] || die "restored byte size mismatch: $path"
  [[ "$actual_sha256" == "$expected_sha256" ]] || die "restored SHA-256 mismatch: $path"
}

while (($# > 0)); do
  case "$1" in
    --artifact-dir)
      [[ $# -ge 2 ]] || die "--artifact-dir requires a value"
      ARTIFACT_DIR="$2"
      shift 2
      ;;
    --restore-dir)
      [[ $# -ge 2 ]] || die "--restore-dir requires a value"
      RESTORE_DIR="$2"
      shift 2
      ;;
    --identity-stdin)
      IDENTITY_STDIN=1
      shift
      ;;
    --live|--restore-live|--target-live)
      die "live restore is disabled in Phase C; use a future owner-approved implementation"
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

[[ -n "$ARTIFACT_DIR" ]] || die "--artifact-dir is required"
[[ -n "$RESTORE_DIR" ]] || die "--restore-dir is required"
(( IDENTITY_STDIN == 1 )) || die "--identity-stdin is required; identity files are not supported"
[[ ! -t 0 ]] || die "the private identity must be supplied through stdin"
command -v age >/dev/null 2>&1 || die "age is required"
command -v node >/dev/null 2>&1 || die "Node.js is required to validate the manifest"

ARTIFACT_DIR="$(realpath -e -- "$ARTIFACT_DIR")"
[[ -d "$ARTIFACT_DIR" && ! -L "$ARTIFACT_DIR" ]] || die "artifact directory is not a directory"
manifest_path="$ARTIFACT_DIR/manifest.json"
[[ -f "$manifest_path" && ! -L "$manifest_path" ]] || die "manifest.json is missing"

manifest_values="$(node --input-type=module - "$manifest_path" <<'NODE'
import fs from "node:fs";

const manifestPath = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const expectedFiles = [
  {
    source_path: "/etc/arcadeplatform/ws-server.env",
    filename: "etc/arcadeplatform/ws-server.env"
  },
  {
    source_path: "/opt/arcade-ws-preview/.env.preview",
    filename: "opt/arcade-ws-preview/.env.preview"
  }
];
const sha256 = /^[0-9a-f]{64}$/;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function invalid(message) {
  throw new Error(`invalid secret backup manifest: ${message}`);
}

if (manifest.format !== "arcadeplatform-vps-secret-backup") invalid("format");
if (manifest.version !== 1) invalid("version");
if (typeof manifest.timestamp !== "string" || !timestamp.test(manifest.timestamp)) invalid("timestamp");
if (manifest.encrypted_object !== "vps-secrets.tar.age") invalid("encrypted_object");
if (!sha256.test(manifest.encrypted_sha256)) invalid("encrypted_sha256");
if (!Array.isArray(manifest.files) || manifest.files.length !== expectedFiles.length) invalid("files");

const values = [];
for (let index = 0; index < expectedFiles.length; index += 1) {
  const actual = manifest.files[index];
  const expected = expectedFiles[index];
  if (actual.source_path !== expected.source_path) invalid(`files[${index}].source_path`);
  if (actual.filename !== expected.filename) invalid(`files[${index}].filename`);
  if (!Number.isSafeInteger(actual.plaintext_byte_size) || actual.plaintext_byte_size < 0) {
    invalid(`files[${index}].plaintext_byte_size`);
  }
  if (!sha256.test(actual.plaintext_sha256)) invalid(`files[${index}].plaintext_sha256`);
  values.push(actual.filename, String(actual.plaintext_byte_size), actual.plaintext_sha256);
}

process.stdout.write([
  manifest.encrypted_object,
  manifest.encrypted_sha256,
  ...values
].join("\t"));
NODE
)"
IFS=$'\t' read -r encrypted_object expected_encrypted_sha \
  production_filename production_size production_sha256 \
  preview_filename preview_size preview_sha256 <<< "$manifest_values"

[[ "$encrypted_object" == "$ENCRYPTED_OBJECT" ]] || die "manifest object name mismatch"
[[ "$production_filename" == "$MEMBER_PRODUCTION" ]] || die "Production member name mismatch"
[[ "$preview_filename" == "$MEMBER_PREVIEW" ]] || die "Preview member name mismatch"
encrypted_path="$ARTIFACT_DIR/$encrypted_object"
[[ -f "$encrypted_path" && ! -L "$encrypted_path" ]] || die "encrypted object is missing"
actual_encrypted_sha="$(file_sha256 "$encrypted_path")"
[[ "$actual_encrypted_sha" == "$expected_encrypted_sha" ]] || die "encrypted artifact SHA-256 mismatch"

RESTORE_DIR="$(realpath -m -- "$RESTORE_DIR")"
case "$RESTORE_DIR" in
  /|"$LIVE_PRODUCTION_ROOT"|"$LIVE_PRODUCTION_ROOT"/*|"$LIVE_PREVIEW_ROOT"|"$LIVE_PREVIEW_ROOT"/*|"$LIVE_RELEASE_ROOT"|"$LIVE_RELEASE_ROOT"/*)
    die "restore target is a live path; only an isolated directory is allowed"
    ;;
esac
[[ ! -e "$RESTORE_DIR" && ! -L "$RESTORE_DIR" ]] || die "restore directory must not already exist"
trap cleanup EXIT
RESTORE_DIR_CREATED=1
mkdir -p -- "$RESTORE_DIR"

TEMP_DIR="$(mktemp -d "$RESTORE_DIR/.vps-secrets-restore.XXXXXX")"
DECRYPTED_ARCHIVE="$TEMP_DIR/decrypted.tar"

age --decrypt --identity - --output "$DECRYPTED_ARCHIVE" "$encrypted_path"

expected_members=$'etc/arcadeplatform/ws-server.env\nopt/arcade-ws-preview/.env.preview'
actual_members="$(tar --list --file="$DECRYPTED_ARCHIVE")"
[[ "$actual_members" == "$expected_members" ]] || die "encrypted archive member list mismatch"

tar --extract --file="$DECRYPTED_ARCHIVE" --directory="$RESTORE_DIR" \
  --no-same-owner --no-same-permissions --no-overwrite-dir

verify_restored_file "$RESTORE_DIR/$production_filename" "$production_size" "$production_sha256"
verify_restored_file "$RESTORE_DIR/$preview_filename" "$preview_size" "$preview_sha256"

rm -f -- "$DECRYPTED_ARCHIVE"
[[ ! -e "$DECRYPTED_ARCHIVE" ]] || die "decrypted temporary archive was not removed"
rmdir -- "$TEMP_DIR"
[[ ! -e "$TEMP_DIR" ]] || die "temporary restore directory was not removed"
DECRYPTED_ARCHIVE=""
TEMP_DIR=""

echo "isolated VPS secret restore verified: $RESTORE_DIR"
