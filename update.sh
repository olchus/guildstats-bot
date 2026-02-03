#!/usr/bin/env bash
set -euo pipefail

cd /opt/guildstats-bot

echo "==> Pull..."
git pull --rebase

echo "==> Build + restart..."
docker compose up -d --build

echo "==> Tail logs:"
docker logs --tail 60 guildstats-bot
