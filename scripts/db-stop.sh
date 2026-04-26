#!/usr/bin/env bash
set -euo pipefail

docker stop tixflo-postgres >/dev/null

echo "tixflo-postgres stopped"
