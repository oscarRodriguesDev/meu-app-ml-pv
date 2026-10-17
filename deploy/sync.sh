#!/bin/sh
set -eu
: "${CRON_SECRET:?CRON_SECRET ausente}"
printf 'header = "Authorization: Bearer %s"\n' "$CRON_SECRET" |
  /usr/bin/curl --config - --fail-with-body --silent --show-error --max-time 850 \
  http://127.0.0.1:3000/api/cron/sync
