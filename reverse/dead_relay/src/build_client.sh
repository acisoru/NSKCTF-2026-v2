#!/usr/bin/env bash
set -euo pipefail

task_dir="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "${1:-}" == "--local" ]]; then
    g++ -std=c++20 -O2 -Wall -Wextra "$task_dir/src/client/game.cpp" -o "$task_dir/public/dead_relay" \
        -lraylib -lGL -lm -lpthread -ldl -lrt -lX11
    strip --strip-all "$task_dir/public/dead_relay"
else
    docker build -q -f "$task_dir/src/client_builder.Dockerfile" -t dead-relay-client-builder "$task_dir" >/dev/null
    docker run --rm --user "$(id -u):$(id -g)" -v "$task_dir:/work" dead-relay-client-builder \
        sh -c 'PKG_CONFIG_PATH=/opt/raylib/lib/pkgconfig g++ -std=c++20 -O2 -Wall -Wextra -Wno-missing-field-initializers -static-libstdc++ -static-libgcc -Isrc/client -Isrc/shared src/client/game.cpp -o public/dead_relay $(PKG_CONFIG_PATH=/opt/raylib/lib/pkgconfig pkg-config --static --cflags --libs raylib) -lX11 -lXrandr -lXi -lXcursor -lXinerama -lGL -lm -lpthread -ldl -lrt && strip --strip-all public/dead_relay'
fi
python3 "$task_dir/src/pack_assets.py"
chmod +x "$task_dir/public/dead_relay"
