# Eiwa Scraping Service — Plan

Consumer-owned scraping layer on top of `eiwa/browser` (§§39–41).
The browser repo stays a generic client: no domain models, no
normalization, no storage, no connector fallback logic live here.
Judicial-domain logic lives in this repo, never in browser.

Status conventions: `[ ]` todo, `[x]` done with proof (tests green +
Docker where noted). Verification is by execution, same bar as
browser: `eiwa test` green, Docker runs, TDD with RED tests.

## 0. Ground rules (inherited, non-negotiable)

- **No workarounds, ever.** Language bugs get fixed in eiwa-lang
  (RED test first); product gaps get fixed here.
- **No free-flying functions**: behavior lives on handles
  (`Scraper`, `Connector`, `Job`, `Store`, ...), never bare imports.
- **Public Eiwa API in camelCase**; named args use `=`; Prometheus
  metrics keep snake_case.
- **Core never bypasses CAPTCHA/anti-bot.** On `CHALLENGE`, stop,
  record, and surface — human-gated providers are post-MVP and live
  behind explicit permission, never silent evasion.
- **Rule A for bytes**: artifact bytes travel through the protocol
  (base64url); the app saves to disk. This service owns saved
  artifacts (PDFs, zips, CSVs).
- **Commits/pushes/tags only with explicit approval.** No release tag
  without an explicit release decision.
- Browser dependency pins to a **released** toolchain image
  (`eiwac/eiwa:vX.Y.Z`) and a released browser-worker image — never
  `:latest`, never dev tags, in any committed compose file.

## 1. Objective

A headless scraping service that, given a target descriptor, returns
normalized records:

1. **HTTP-first**: plain `httpGet` for API-friendly targets.
2. **Browser fallback**: pooled `Browser` handles for rendered pages,
   with network observation (`NetworkLogger`), downloads, and scoped
   timeouts.
3. **Normalize in-app**: raw text/HTML/bytes in, typed records out.
4. **Persist**: records + artifacts into PostgreSQL; runs observable
   via logs + Prometheus metrics.

MVP scope: one service binary + one worker compose (browser-worker +
scraper + Postgres). Connectors are per-target classes, not a plugin
marketplace. Scheduling is a simple queue (DB-backed); distributed
crawling is post-MVP.

## 2. Non-goals (post-MVP or never)

- `route` interception / request fulfillment (waits on browser).
- CAPTCHA solving, proxy rotation, fingerprint evasion — **never
  silent**; human-gated providers stay behind explicit permission.
- Distributed crawl frontier, politeness scheduler across tenants.
- Screenshots/tracing as evidence (waits on browser §§17, 36–37).
- Generic connector marketplace; each connector is hand-built.

## 3. Architecture

```
                ┌─────────────┐
                │   Scraper   │  binary (this repo, src/main.ei)
                │  (service)  │
                └──────┬──────┘
         ┌─────────────┼──────────────┐
         ▼             ▼              ▼
   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │ Connector│  │  Browser │  │  Store   │  handles, Closeable
   │ per-target│  │  pool    │  │ (Postgres)│
   └──────────┘  └────┬─────┘  └──────────┘
                      ▼ (WebSocket JSON-RPC)
               ┌──────────────┐
               │browser-worker│  eiwac/browser-worker image
               │  + Chromium  │
               └──────────────┘
```

MVP target: `quotes.toscrape.com` (`QuotesConnector`: quotes,
tags, pagination; login out of scope). Phase 4 download proof is
deterministic via a local fake file server (browser's
`download_live` pattern), not an external file host.

- **Scraper**: owns config, the job queue loop, connector dispatch,
  metrics endpoint. One process, N worker tasks.
- **Connector**: per-target handle (`QuotesConnector` for the MVP
  target `quotes.toscrape.com`, `JudicialConnector` in Phase 5, ...).
  Each implements:
  `fetch(job): FetchResult` (HTTP-first, browser fallback),
  `normalize(raw): Record`. Connectors never touch sockets directly
  except through `Browser` handles and `httpGet`.
- **Job**: value type (`url`, `kind`, `connector`, `attempt`,
  `timeoutMs`, `idempotencyKey`). DB-backed queue table; claim via
  `SELECT ... FOR UPDATE SKIP LOCKED`.
- **Store**: Postgres handle (connect, migrate, insert records,
  save artifact bytes, claim/complete jobs). Uses the `postgres`
  package (already in local repository).
- **Browser pool**: `Browser([workers], poolSize)` shared across
  tasks; provisioning failures (`NoWorkerAvailable`,
  `UnknownContext`) are retried or requeued, never swallowed.
- **Fallback chain** per fetch (explicit, logged at each step):
  1. `httpGet` → 200 + usable body → normalize.
  2. Browser `page.goto` + `text`/`content` → normalize.
  3. Browser + wait (`waitFor`/`waitForUrl`) → normalize.
  4. Download (`onDownload` + `bytes()`) for file targets.
  5. On `CHALLENGE`/typed error → record outcome, no retry loop
     without backoff; `Timeout`/`ResourceExhausted` may retry with
     budget (max attempts per job).

## 4. Repository layout (target)

```
scraping/
  PLAN.md                ← this file
  eiwa.yaml              (name: scraping; deps: crypto, postgres;
                          browser via path or package?)
  Dockerfile             (service image; see §8)
  compose.yaml           (browser-worker + scraper + postgres)
  src/
    main.ei              (service entry: config → Scraper.run())
    scraper/
      scraper.ei         (Scraper handle: queue loop, dispatch)
      job.ei             (Job value type + queue SQL)
      connector.ei       (Connector interface/base + registry)
      targets/
        shop.ei          (example generic connector, from demo)
        judicial.ei      (judicial-domain connector lives HERE)
      normalize.ei       (shared normalization helpers)
      store.ei           (Store handle: Postgres + artifacts)
      metrics.ei         (Prometheus counters/histograms, snake_case)
      config.ei          (env-driven config with validation)
  tests/
    job_queue_test.ei    (claim/complete semantics vs fake store)
    connector_test.ei    (HTTP-first, fallback order vs fakes)
    normalize_test.ei    (raw → record fixtures)
    store_test.ei        (SQL round-trip; testcontainers-style:
                          real Postgres in Docker, skip without it)
    service_test.ei      (end-to-end vs browser fakes)
  examples/
    scraping.ei          (minimal single-target run)
```

Open decision: browser dependency as path (`../../browser`) for local
dev vs published package. Recommendation: path override locally,
published browser package in committed manifests (mirrors how the
browser consumes `crypto`). Same for `../../postgres` (exists locally:
`connect`/`pool`, `execute`/`query` with string params,
`prepare`; JSONB via `$1::jsonb` cast, artifacts on filesystem —
bytea unnecessary).

## 5. Data model (PostgreSQL, initial)

- `jobs(id UUID PK, connector TEXT, url TEXT, kind TEXT,
  status TEXT, attempt INT, max_attempts INT, idempotency_key TEXT
  UNIQUE, not_before TIMESTAMPTZ, created_at, updated_at)`.
- `records(id UUID PK, job_id FK, connector TEXT, payload JSONB,
  fetched_at, source_url TEXT)`.
- `artifacts(id UUID PK, job_id FK, file_name TEXT, mime TEXT,
  size BIGINT, storage_path TEXT, sha256 TEXT, fetched_at)`.
- Migrations: numbered SQL files applied by `Store.migrate()` at
  boot; migration count asserted in `store_test`.

Conventions: `snake_case` columns (Postgres idiom); JSONB payload
validated against per-connector schema before insert (reject, don't
coerce); artifacts hashed (sha256) and deduplicated by
`(sha256, connector)`.

## 6. Connector contract (draft API)

```eiwa
type FetchResult(val kind: String, val body: String)
// kind: "html" | "text" | "json" | "bytes:<downloadId>" | "failed"

type QuotesConnector(val browser: Browser, val store: Store) {
    fun fetch(job: Job): FetchResult { ... }   // HTTP-first, browser fallback
    fun normalize(raw: String): QuoteRecord { ... }  // quotes, tags, pagination
}
```

- `fetch` never throws domain errors for expected failures;
  transport/domain failures surface as typed browser errors or
  `FetchFailed(reason)` and the scraper maps them to job outcomes
  (retry with backoff vs dead-letter).
- `normalize` is pure and fully unit-tested with fixtures
  (no network in normalize tests, ever).
- Judicial connector: same shape, domain vocabulary isolated in
  `targets/judicial.ei`; no judicial imports anywhere else.

## 7. Observability

- Structured logs (`std.log`): job claimed/completed/failed with
  `job_id`, `connector`, `attempt`, `outcome`, latency.
- Prometheus (snake_case): `scrape_jobs_total{connector,outcome}`,
  `scrape_fetch_duration_ms{connector,path}` (path = http/browser),
  `scrape_artifacts_bytes_total`, `browser_workers_up`.
- Health endpoint: `/health` (queue depth, DB reachable, worker
  `isConnected()`).
- Every failure carries job context; `CHALLENGE` outcomes page
  loudly (log + metric), never retried silently.

## 8. Docker & environments

- `Dockerfile`: multi-stage (toolchain image → `eiwa build` →
  slim runtime + CA certs; Postgres client not needed — wire
  protocol via the `postgres` package).
- `compose.yaml`: `browser-worker` (released image),
  `scraper` (this Dockerfile), `postgres:16` (volume for data).
  No `:latest`/dev tags; versions pinned and bumped by explicit
  decision.
- Config via env: `BROWSER_WORKERS` (csv of ws URLs),
  `DATABASE_URL`, `CONCURRENCY`, `POLL_INTERVAL_MS`,
  `ARTIFACT_DIR`. `config.ei` validates at boot and fails fast
  with a usage error (never half-boot).

## 9. Testing strategy

- TDD: RED test first for every behavior; fakes over mocks
  (scripted TCP/CDP fakes like browser's; fake Postgres only for
  queue-logic unit tests — `store_test` uses a REAL Postgres,
  skips cleanly without one, same pattern as `cdp_live`).
- No network in unit tests: connector fallback order proven with
  scripted browser fakes; normalize proven with fixtures.
- Ports unique across ALL test files (same discipline as browser).
- `eiwa test` green locally AND in Docker (`--no-cache`; the
  incremental-cache poisoning issue is documented browser-side).

## 10. Phased delivery

- [x] **Phase 0 — skeleton**: `eiwa.yaml`, `main.ei`, `config.ei`
      (env validation), `Dockerfile` + `compose.yaml` (pinned
      versions), one `noop` connector; `eiwa build` + `eiwa test`
      green (1 smoke test). Proven: image boots 0 with config,
      exits 1 loud without; no ENV defaults baked into the image.
- [x] **Phase 1 — queue + store**: `Job` type + queue SQL
      (claim/complete/dead-letter), `Store` (connect/migrate/insert),
      `store_test` vs real Postgres, `job_queue_test` vs fake.
      Proven: 9/9 local vs PG + 9/9 in Docker vs PG 16 (no skips);
      image builds green (PG tests skip gracefully without DB).
      Requires the `../../postgres` wrapper fix below.
- [ ] **Phase 2 — first connector**: `QuotesConnector` against
      `quotes.toscrape.com` (quotes + tags + pagination; login
      explicitly out of MVP), HTTP-first + browser fallback with
      logged steps; `connector_test` vs scripted fakes proving the
      order; `normalize_test` fixtures.
- [x] **Phase 3 — service loop**: `Scraper.run()` (claim → dispatch
      → outcome), retries with backoff + budgets, metrics endpoint,
      `/health`; `service_test` end-to-end (fake browser + real or
      fake store). Proven: 21/21 local vs PG + 21/21 in Docker vs
      PG 16 (fake CDP serves 2 quotes; unknown connector
      dead-letters; /metrics + /health + 404 live); image boots 0
      with config, 1 loud without. Follow-up: live test on hostname
      worker URL once the v0.0.77 toolchain image lands (DNS fix).
- [ ] **Phase 4 — artifacts**: download path (`onDownload` +
      `bytes()`), sha256 dedup, `artifacts` table; live proof vs
      real Chromium in Docker (mirrors browser's `download_live`).
- [ ] **Phase 5 — judicial connector**: `targets/judicial.ei`
      (domain logic isolated); fixtures only, no live judicial
      endpoints in tests.
- [ ] **Phase 6 — hardening**: backoff/jitter tuning, poison-pill
      jobs (max attempts → dead-letter + alert), graceful shutdown
      (drain in-flight on SIGTERM), compose burn-in run.

## 11. Open questions (decide before Phase 1)

1. Browser dependency: published package vs path override? 
2. Postgres driver: `postgres` package API surface — verify
   `SELECT ... FOR UPDATE SKIP LOCKED` + JSONB + bytea support
   before Phase 1 (spike, 1 day max). UPDATE: driver exists at
   `../../postgres` (`connect`/`pool`, string params, `prepare`);
   SKIP LOCKED is plain SQL text, JSONB via cast — spike reduced
   to a half-day connection + round-trip check.
3. Job idempotency: `idempotency_key` = normalized URL, or
   caller-supplied? 
4. Artifact storage: Postgres bytea vs filesystem volume
   (`ARTIFACT_DIR` + `storage_path`)? Recommendation: filesystem +
   path in DB (keeps DB lean; bytea only for small payloads).
5. Scheduling: pure queue vs cron-ish periodic targets? MVP =
   queue + external enqueuer (manual/`examples` CLI).

## 12. Risks

- **Known upstream issue (filed, not worked around here):**
  `fun main(): Int` breaks NATIVE builds (entry shim declares an
  i32 return while Eiwa `Int` is i64 → LLVM verification ICE;
  JIT handles both). Services therefore use `fun main()` + loud
  `assert` fail-fast until the language accepts `Int` mains or
  ships a `process.exit`. Revisit when fixed upstream.
- **Eiwa `Int?` never narrows** (only reference types do —
  `if (x == null) return` on an `Int?` still refuses `x + 1`).
  Counters and numeric optionals use Elvis (`map.get(k) ?: 0`).
- **Test `serve` loops with `maxConn` ≥ request count.**
  A client connecting after the server closed segfaults (null
  socket deref in std `Client`/curl path) instead of failing
  cleanly. Always size `maxConn` for every request the test makes.
- **Flaky timing in Docker** (proven browser-side: delayed-ACK
  stalls): same patience patterns (`drainWant`/`collectWant`
  equivalents) apply to any timing-sensitive service test.
- **Chromium download semantics** (proven: context-scoped
  behavior, `filePath` authoritative): service relies on both;
  pin minimum browser-worker version containing them.
- **Postgres package gaps**: spike early (Q2); fallback is a
  minimal SQL-over-TCP client owned here (costly — avoid).
- **Target drift** (sites change shape): normalize tests pin
  fixtures; add per-connector fixture refresh procedure (manual,
  documented) — never auto-update fixtures from live fetches.
