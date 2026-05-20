#!/usr/bin/env bash
set -euo pipefail

NAME=upgrade-chess

if [ -n "$(docker ps -q -f name=^${NAME}$)" ]; then
  docker stop "${NAME}"
fi

docker run -d --rm --name "${NAME}" -p 8000:8000 --env-file .env upgrade-chess
