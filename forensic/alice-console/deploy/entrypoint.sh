#!/bin/bash
set -euo pipefail

# ФС собрана на build-стадии; запись закрыта chmod a-w и container read_only: true

# hidepid на /proc где поддерживается; при запуске без CAP_SYS_ADMIN просто пропускается
mount -o remount,hidepid=2 /proc 2>/dev/null || true

# страховка: user в терминале не должен видеть процессы хоста.
# PS1-обвязка не запускает ps/top (их нет в allowlist), а /proc/<pid> для user
# скрывается hidepid=2; в контейнере без PID-namespace sharing (pid: host не задан)
# /proc и так содержит только процессы контейнера.

exec python3 /app/console.py
