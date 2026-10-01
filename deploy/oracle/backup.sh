#!/usr/bin/env bash
set -euo pipefail
umask 077
database=/opt/ageoffronts/data/multiplayer.sqlite
[[ -f "$database" ]] || exit 0
directory=/opt/ageoffronts/backups
install -d -m 0700 "$directory"
target="$directory/multiplayer-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
sqlite3 "$database" ".backup '$target'"
[[ "$(sqlite3 "$target" 'PRAGMA integrity_check;')" == ok ]]
# Retain seven days locally. These copies share the server disk; keep an OCI
# boot-volume backup as well for recovery if that disk or instance is lost.
find "$directory" -maxdepth 1 -type f -name 'multiplayer-*.sqlite' -mtime +7 -delete
