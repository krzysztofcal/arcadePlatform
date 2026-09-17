#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_ROOT='/opt/ws-server'
readonly RELEASES_ROOT='/opt/ws-server/releases'
readonly CURRENT_RELEASE_LINK='/opt/ws-server/current'
readonly TMP_ROOT='/tmp'
readonly LOCK_FILE='/opt/ws-server/.deploy-maintenance.lock'
readonly RELEASE_RETENTION_SECONDS=604800
readonly TMP_RETENTION_MINUTES=2880

is_positive_decimal() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

is_nonnegative_decimal() {
  [[ "$1" =~ ^[0-9][0-9]*$ ]]
}

is_git_sha_release_name() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

is_known_tmp_name() {
  [[ "$1" =~ ^arcadeplatform-(ws|infra)-[0-9]+-[0-9]+$ ]]
}

is_safe_directory() {
  [[ -d "$1" && ! -L "$1" ]]
}

release_age_epoch() {
  local release_dir=$1 now_epoch=$2 marker timestamp epoch birth_epoch marker_bytes

  is_safe_directory "$release_dir" || return 1
  is_positive_decimal "$now_epoch" || return 1
  marker="$release_dir/.deployed-at"

  if [[ -e "$marker" || -L "$marker" ]]; then
    [[ -f "$marker" && ! -L "$marker" ]] || return 1
    marker_bytes=$(wc -c < "$marker")
    [[ "$marker_bytes" =~ ^[[:space:]]*21[[:space:]]*$ ]] || return 1
    IFS= read -r timestamp < "$marker" || return 1
    [[ "$timestamp" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || return 1
    [[ $(date -u -d "$timestamp" '+%Y-%m-%dT%H:%M:%SZ') == "$timestamp" ]] || return 1
    epoch=$(date -u -d "$timestamp" '+%s')
    is_nonnegative_decimal "$epoch" && (( epoch <= now_epoch )) || return 1
    printf '%s\n' "$epoch"
    return 0
  fi

  birth_epoch=$(stat -c %W -- "$release_dir") || return 1
  is_positive_decimal "$birth_epoch" && (( birth_epoch <= now_epoch )) || return 1
  printf '%s\n' "$birth_epoch"
}

cleanup_releases() {
  local releases_dir=$1 current_release_dir=$2 now_epoch=$3 dry_run=$4
  local releases_real current_real candidate candidate_real candidate_name age threshold sorted_output
  local -a candidates=() release_rows=() sorted_rows=()
  local protected_count=0 removed_count=0

  is_safe_directory "$releases_dir" || return 1
  is_safe_directory "$current_release_dir" || return 1
  is_positive_decimal "$now_epoch" || return 1
  [[ "$dry_run" == true || "$dry_run" == false ]] || return 1
  releases_real=$(realpath -e -- "$releases_dir") || return 1
  current_real=$(realpath -e -- "$current_release_dir") || return 1
  [[ $(dirname -- "$current_real") == "$releases_real" ]] || return 1
  candidate_name=$(basename -- "$current_real")
  is_git_sha_release_name "$candidate_name" || return 1
  [[ -d "$releases_real/$candidate_name" && ! -L "$releases_real/$candidate_name" ]] || return 1

  # Drain the NUL-delimited inventory, then check its producer before using it.
  mapfile -d '' -t candidates < <(find "$releases_real" -mindepth 1 -maxdepth 1 -type d -print0) || return 1
  wait "$!" || return 1

  for candidate in "${candidates[@]}"; do
    candidate_name=$(basename -- "$candidate")
    is_git_sha_release_name "$candidate_name" || continue
    candidate_real=$(realpath -e -- "$candidate") || return 1
    [[ $(dirname -- "$candidate_real") == "$releases_real" ]] || return 1
    [[ "$candidate_real" == "$releases_real/$candidate_name" ]] || return 1
    age=$(release_age_epoch "$candidate_real" "$now_epoch") || return 1
    release_rows+=("$age"$'\t'"$candidate_real")
  done

  (( ${#release_rows[@]} > 0 )) || return 1
  sorted_output=$(printf '%s\n' "${release_rows[@]}" | LC_ALL=C sort -t $'\t' -k1,1nr -k2,2) || return 1
  mapfile -t sorted_rows <<< "$sorted_output"
  threshold=$((now_epoch - RELEASE_RETENTION_SECONDS))

  for candidate in "${sorted_rows[@]}"; do
    age=${candidate%%$'\t'*}
    candidate_real=${candidate#*$'\t'}
    if [[ "$candidate_real" == "$current_real" ]]; then
      continue
    fi
    if (( protected_count < 5 )); then
      ((protected_count += 1))
      continue
    fi
    if (( age < threshold )); then
      candidate_name=$(basename -- "$candidate_real")
      is_git_sha_release_name "$candidate_name" || return 1
      [[ $(dirname -- "$candidate_real") == "$releases_real" ]] || return 1
      [[ -d "$releases_real/$candidate_name" && ! -L "$releases_real/$candidate_name" ]] || return 1
      if [[ "$dry_run" == false ]]; then
        rm -rf -- "$releases_real/$candidate_name"
      fi
      ((removed_count += 1))
    fi
  done

  printf 'release removals: %s\n' "$removed_count"
}

cleanup_known_tmp_dirs() {
  local tmp_root=$1 now_epoch=$2 dry_run=$3 candidate candidate_real candidate_name mtime
  local tmp_real removed_count=0 threshold
  local -a candidates=() eligible_candidates=()

  is_safe_directory "$tmp_root" || return 1
  is_positive_decimal "$now_epoch" || return 1
  [[ "$dry_run" == true || "$dry_run" == false ]] || return 1
  tmp_real=$(realpath -e -- "$tmp_root") || return 1
  threshold=$((now_epoch - TMP_RETENTION_MINUTES * 60))

  mapfile -d '' -t candidates < <(find "$tmp_real" -mindepth 1 -maxdepth 1 -type d \( -name 'arcadeplatform-ws-*' -o -name 'arcadeplatform-infra-*' \) -mmin +2880 -print0) || return 1
  wait "$!" || return 1

  for candidate in "${candidates[@]}"; do
    candidate_name=$(basename -- "$candidate")
    is_known_tmp_name "$candidate_name" || continue
    candidate_real=$(realpath -e -- "$candidate") || return 1
    [[ $(dirname -- "$candidate_real") == "$tmp_real" ]] || return 1
    [[ "$candidate_real" == "$tmp_real/$candidate_name" && ! -L "$candidate" ]] || return 1
    mtime=$(stat -c %Y -- "$candidate_real") || return 1
    is_nonnegative_decimal "$mtime" && (( mtime < threshold )) || continue
    eligible_candidates+=("$candidate_real")
  done

  for candidate_real in "${eligible_candidates[@]}"; do
    candidate_name=$(basename -- "$candidate_real")
    is_known_tmp_name "$candidate_name" || return 1
    [[ $(dirname -- "$candidate_real") == "$tmp_real" ]] || return 1
    [[ -d "$tmp_real/$candidate_name" && ! -L "$tmp_real/$candidate_name" ]] || return 1
    if [[ "$dry_run" == false ]]; then
      rm -rf -- "$tmp_real/$candidate_name"
    fi
    ((removed_count += 1))
  done

  printf 'temporary directory removals: %s\n' "$removed_count"
}

acquire_maintenance_lock() {
  local lock_file=$1

  [[ -f "$lock_file" && ! -L "$lock_file" ]] || return 1
  [[ "$(stat -c '%h' -- "$lock_file")" == 1 ]] || return 1
  exec 9<> "$lock_file" || return 1
  flock -n 9
}

main() {
  local dry_run=true current_app_dir current_release_dir

  if (( $# == 1 )); then
    if [[ "$1" == --apply ]]; then
      dry_run=false
    elif [[ "$1" != --dry-run ]]; then
      return 1
    fi
  elif (( $# != 0 )); then
    return 1
  fi

  is_safe_directory "$APP_ROOT" || return 1
  acquire_maintenance_lock "$LOCK_FILE" || return 1
  is_safe_directory "$RELEASES_ROOT" || return 1
  [[ -L "$CURRENT_RELEASE_LINK" ]] || return 1
  current_app_dir=$(realpath -e -- "$CURRENT_RELEASE_LINK") || return 1
  is_safe_directory "$current_app_dir" || return 1
  [[ $(basename -- "$current_app_dir") == ws-server ]] || return 1
  current_release_dir=$(dirname -- "$current_app_dir") || return 1
  cleanup_releases "$RELEASES_ROOT" "$current_release_dir" "$(date -u '+%s')" "$dry_run"
  cleanup_known_tmp_dirs "$TMP_ROOT" "$(date -u '+%s')" "$dry_run"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
