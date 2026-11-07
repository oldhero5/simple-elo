#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
    # ./data is a bind mount; images before the non-root change left it owned by root.
    mkdir -p /app/data
    chown -R app:app /app/data
    exec setpriv --reuid=app --regid=app --init-groups "$@"
fi

exec "$@"
