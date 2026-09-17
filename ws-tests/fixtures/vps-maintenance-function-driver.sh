#!/usr/bin/env bash
set -Eeuo pipefail

source "$1"
shift
"$@"
