#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="tixflo-postgres"
VOLUME_NAME="tixflo_postgres_data"
IMAGE="postgres:16-alpine"
PORT="5432"

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  docker start "$CONTAINER_NAME" >/dev/null
else
  docker volume create "$VOLUME_NAME" >/dev/null
  docker run -d \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=tixflo \
    -p ${PORT}:5432 \
    -v ${VOLUME_NAME}:/var/lib/postgresql/data \
    "$IMAGE" >/dev/null
fi

for _ in $(seq 1 30); do
  if docker exec "$CONTAINER_NAME" pg_isready -U postgres -d tixflo >/dev/null 2>&1; then
    echo "tixflo-postgres is ready"
    exit 0
  fi
  sleep 1
done

echo "Timed out waiting for tixflo-postgres" >&2
exit 1
