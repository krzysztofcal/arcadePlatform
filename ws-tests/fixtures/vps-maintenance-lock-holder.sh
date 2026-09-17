#!/usr/bin/env bash
set -Eeuo pipefail

exec 9<> "$1"
flock -n 9
printf 'ready'
read -r ignored
