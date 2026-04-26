#!/usr/bin/env bash
set -euo pipefail

docker rm -f tixflo-postgres >/dev/null 2>&1 || true
docker volume rm tixflo_postgres_data >/dev/null 2>&1 || true

echo "tixflo-postgres container and volume reset"
