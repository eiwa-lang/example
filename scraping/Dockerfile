# syntax=docker/dockerfile:1
#
# Eiwa Scraping Service (Phase 0: boot + noop run).
#
# Usage:
#   docker build -t eiwac/scraper .
#   docker compose up
#
# The builder uses the official Eiwa toolchain image (pinned release,
# never :latest). EIWA_BASELINE_CPU is already set there for portable
# binaries under emulation.

ARG EIWA_VERSION=v0.0.76

FROM eiwac/eiwa:${EIWA_VERSION} AS builder
# libpq headers: the postgres package compiles its C wrapper via @Source.
RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev \
    && rm -rf /var/lib/apt/lists/*
# The JIT C compiler only searches default include dirs.
ENV C_INCLUDE_PATH=/usr/include/postgresql
# Local path dependencies (../postgres) do not exist in the build
# context; mount them as named contexts (compose additional_contexts)
# and resolve via --module-path. Keep the last COPY in sync.
COPY --from=postgres src /postgres/src
COPY --from=postgres eiwa.yaml /postgres/eiwa.yaml
COPY --from=browser src /browser/src
WORKDIR /src
COPY eiwa.yaml eiwa.yaml
COPY src src
COPY tests tests
# Live proof: the suite runs inside the image build; a broken service
# fails the image here. PG-backed tests skip without a database (their
# skip is the honest signal); live store proof runs against compose
# postgres (see PLAN Phase 1).
RUN eiwa test --no-cache --module-path /postgres/src --module-path /browser/src
# NOTE: `eiwa build -o` rejects absolute paths (mkdir -p with empty
# operand), so build relative then move.
RUN eiwa build --module-path /postgres/src --module-path /browser/src -o scraper && mkdir -p /out && mv scraper /out/scraper

FROM debian:trixie-slim
# Native binary links Boehm GC + libpq + libcurl at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgc1 \
        libpq5 \
        libcurl4 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /out/scraper /usr/local/bin/scraper
# No ENV defaults baked in: missing config must fail fast at boot.
# Defaults for local dev live in compose.yaml.
VOLUME /var/lib/scraper/artifacts
ENTRYPOINT ["/usr/local/bin/scraper"]
