FROM gcc:14-bookworm AS build
WORKDIR /build
COPY src/ src/
RUN g++ -std=c++20 -O2 -pthread -static-libstdc++ -static-libgcc -s src/server/server.cpp -o relay-server

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=build /build/relay-server /app/relay-server
COPY src/shared/pulse.rom /app/pulse.rom
COPY flag.txt /flag
USER 65534:65534
EXPOSE 34320
CMD ["/app/relay-server", "/app/pulse.rom"]
