#!/usr/bin/env bash
# #1302: sign a verified unsigned Production AAB with the Google Play upload key (PKCS#12, alias "upload").
# Inputs come only from the environment; secrets never appear in arguments or output; the keystore exists only in a private temp dir.
#   UNSIGNED_AAB, SIGNED_AAB, EXPECTED_UPLOAD_CERT_SHA256 (public, AA:BB:... upper case)
#   ANDROID_UPLOAD_KEYSTORE_BASE64, ANDROID_UPLOAD_STORE_PASSWORD, optional ANDROID_UPLOAD_KEY_PASSWORD (defaults to the store password)
set -euo pipefail
umask 077
fail() { echo "sign_release_aab_STOP $1" >&2; exit 1; }

ALIAS=upload
[ -n "${UNSIGNED_AAB:-}" ] && [ -f "$UNSIGNED_AAB" ] || fail unsigned_aab_missing
[ -n "${SIGNED_AAB:-}" ] && [ ! -e "$SIGNED_AAB" ] || fail signed_aab_target_invalid
PIN="${EXPECTED_UPLOAD_CERT_SHA256:-}"
[[ "$PIN" =~ ^([0-9A-F]{2}:){31}[0-9A-F]{2}$ ]] || fail upload_certificate_pin_invalid
[ -n "${ANDROID_UPLOAD_KEYSTORE_BASE64:-}" ] || fail keystore_secret_missing
[ -n "${ANDROID_UPLOAD_STORE_PASSWORD:-}" ] || fail store_password_secret_missing

work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/sign-aab.XXXXXX")"
trap 'rm -rf "$work"' EXIT
printf '%s' "$ANDROID_UPLOAD_KEYSTORE_BASE64" | base64 -d > "$work/upload.p12" 2>/dev/null || fail keystore_secret_malformed
[ -s "$work/upload.p12" ] || fail keystore_secret_malformed
# Passwords reach the JDK tools only by environment variable name (:env), never as arguments or files.
export ANDROID_UPLOAD_KEY_PASSWORD="${ANDROID_UPLOAD_KEY_PASSWORD:-$ANDROID_UPLOAD_STORE_PASSWORD}"

# The key must be the pinned upload key before anything is signed: the first certificate of the alias chain is its own.
key_fp="$(keytool -list -v -storetype PKCS12 -keystore "$work/upload.p12" -storepass:env ANDROID_UPLOAD_STORE_PASSWORD -alias "$ALIAS" 2>/dev/null \
  | awk '$1 == "SHA256:" && !done { print $2; done = 1 }')" || fail keystore_unreadable
[ "$key_fp" = "$PIN" ] || fail upload_certificate_mismatch

jarsigner -verify "$UNSIGNED_AAB" 2>/dev/null | grep -q 'jar is unsigned' || fail input_not_unsigned
jarsigner -storetype PKCS12 -keystore "$work/upload.p12" -storepass:env ANDROID_UPLOAD_STORE_PASSWORD -keypass:env ANDROID_UPLOAD_KEY_PASSWORD \
  -sigalg SHA256withRSA -digestalg SHA-256 -signedjar "$work/signed.aab" "$UNSIGNED_AAB" "$ALIAS" >/dev/null 2>&1 || fail signing_failed

# No -strict: the upload certificate is self-signed. Identity is proven by the single pinned signer instead.
verify="$(jarsigner -verify -verbose "$work/signed.aab" 2>&1)" || fail signature_verify_failed
grep -q 'jar verified' <<<"$verify" || fail signature_verify_failed
if grep -qi -e 'unsigned entries' -e 'jar is unsigned' <<<"$verify"; then fail unsigned_entries; fi
# Exactly one signer, and its own (first) certificate is the pinned one; issuer certificates may follow it.
printcert="$(keytool -printcert -jarfile "$work/signed.aab" 2>/dev/null)" || fail signer_count_invalid
[ "$(grep -c '^Signer #' <<<"$printcert")" = 1 ] || fail signer_count_invalid
signer="$(awk '/^Signer #/ { want = 1; next } want && $1 == "SHA256:" { print $2; want = 0 }' <<<"$printcert")"
[ "$signer" = "$PIN" ] || fail signed_certificate_mismatch

mv "$work/signed.aab" "$SIGNED_AAB"
echo "sign_release_aab_PASS"
