#!/bin/sh
set -eu
umask 077
config=${1:?Provide external env file}
destination=${2:?Provide external backup directory}
case "$destination" in /*) ;; *) echo 'Use an absolute external backup directory' >&2; exit 1;; esac
mkdir -p "$destination"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
database="$destination/database-$stamp.dump"
media="$destination/media-$stamp.tar.gz"
trap 'rm -f "$database.partial" "$media.partial"' EXIT
docker compose --env-file "$config" -f docker-compose.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$database.partial"
docker compose --env-file "$config" -f docker-compose.yml exec -T web tar -C /data/media -czf - . > "$media.partial"
mv "$database.partial" "$database"
mv "$media.partial" "$media"
echo 'Backup complete'
