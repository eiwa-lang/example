# Compile stage
FROM eiwac/eiwa:v0.0.93 AS compile
ARG EIWA_CACHE_BUST=4
WORKDIR /app

COPY ./ ./
RUN eiwa build --release
# Vendor the toolchain's std sources so the MCP get_std_source/search_std
# tools keep working in the slim runtime (which ships no compiler).
# Pinned toolchain version and std snapshot: see mcp changelog topic.
# Note: --print-std-dir prints to stderr, hence 2>&1 inside $().
RUN cp -r "$(eiwac --print-std-dir 2>&1)" ./std-src

# Runtime stage
FROM debian:stable-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    libcurl4 \
    zlib1g \
    libssl3 \
    libpcre2-8-0 \
    libgc1 \
    libevent-2.1-7 \
    libgmp10 \
    ca-certificates \
    openssl
RUN rm -rf /var/lib/apt/lists/*

ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

COPY --from=compile /app/app /app/server
COPY --from=compile /app/static /app/static
COPY --from=compile /app/std-src /app/std
WORKDIR /app

CMD ["./server"]
