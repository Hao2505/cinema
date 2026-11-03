#!/usr/bin/env bash
# Xem log pm2 của VibeCinema trên VPS (50 dòng cuối). Không in thông tin đăng nhập.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./deploy/vps.env; set +a
export SSHPASS="$VPS_PASS"
sshpass -e ssh -o StrictHostKeyChecking=accept-new -p "$VPS_PORT" "$VPS_USER@$VPS_HOST" "su - deploy -c 'pm2 logs vibecinema --lines ${1:-50} --nostream'"
