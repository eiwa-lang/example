# Compile stage
FROM leodouglas/eiwa AS compile
WORKDIR /app

COPY ./ ./
RUN eiwa build --release

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
WORKDIR /app

CMD ["./server"]
