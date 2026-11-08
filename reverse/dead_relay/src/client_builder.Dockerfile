# Build the public Linux client against Debian 12, so its glibc requirement is
# older than the organizer's workstation and raylib is linked into the binary.
FROM debian:bookworm
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential cmake git pkg-config ca-certificates \
    libx11-dev libxrandr-dev libxi-dev libxcursor-dev libxinerama-dev libgl1-mesa-dev \
    libasound2-dev && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch 6.0 https://github.com/raysan5/raylib.git /opt/raylib-src && \
    cmake -S /opt/raylib-src -B /opt/raylib-build \
      -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_EXAMPLES=OFF \
      -DBUILD_GAMES=OFF -DCMAKE_INSTALL_PREFIX=/opt/raylib && \
    cmake --build /opt/raylib-build -j 4 && cmake --install /opt/raylib-build
WORKDIR /work
