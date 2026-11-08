#!/bin/sh
set -e

(cd /app/admin && sleep 2 && exec python main.py) &

cd /app/public
exec python main.py
