#!/usr/bin/env bash
set -Eeuo pipefail

exec 9<> "$1"
flock -n 9
status=0
bash "$2" || status=$?
exit "$status"
