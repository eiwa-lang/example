# Scraper — agnostic extraction service

Headless service that runs **declarative YAML pipelines** and persists
typed records into PostgreSQL. The code knows no target: URLs, selectors
and rules live in `pipelines/*.yaml`. A new site means a new YAML file,
zero code.

## How it works

```
POST /jobs {"pipeline": "quotes"}
  → Scraper.claim → PipelineRunner → Browser (worker) → Store (Postgres)
```

1. `POST /jobs` takes **only the pipeline name**. The server loads
   `pipelines/<name>.yaml`, validates it, and stores a snapshot with the
   job (reproducibility: the job runs the creation-time JSON even if the
   YAML changes later).
2. `PipelineRunner` executes `steps` in order through the pooled `Browser`
   (goto → click → wait → collect → paginate), always via `browser.goto`
   for navigation — no `httpGet`.
3. Each collected item becomes one `record` (JSONB `payload`). Failures
   become `retry` (with backoff) or `dead-letter`, never a silent loop.

## eiwa browser usage (what the service uses from the package)

- `Browser(workers, pool)` — shared worker pool over WebSocket.
- `page.goto(url, waitUntil, timeoutMs)` — the only navigation.
- `page.locator(sel)` + `.nth(k)` + `.within(sel)` for reads; `.text()`
  for text, `.attribute(name)` for attributes (pagination `href`).
- `locator.click()` / `locator.waitFor(ms)` — interaction and sync.
- Typed errors (`Timeout`, `ChallengeDetected`, ...) become job outcomes;
  `CHALLENGE` is never bypassed: abort, record, dead-letter.

## Quickstart

```bash
# infra (worker + postgres)
docker compose up -d browser-worker postgres

# local service (needs the eiwa toolchain + libpq)
set -a; source .env; set +a
eiwa run
```

```bash
# enqueue extractions (pipeline name only)
curl -X POST http://127.0.0.1:9090/jobs -d '{"pipeline": "quotes"}'
curl -X POST http://127.0.0.1:9090/jobs -d '{"pipeline": "eiwa-mcp"}'

# observe
curl http://127.0.0.1:9090/health     # {"status": "ok", "pending": N}
curl http://127.0.0.1:9090/metrics    # scrape_jobs_total{pipeline,outcome}
```

Env vars (`config.ei` fails fast when any is missing): `BROWSER_WORKERS`,
`DATABASE_URL`, `CONCURRENCY`, `POLL_INTERVAL_MS`, `ARTIFACT_DIR`,
`PIPELINES_DIR`.

## Pipeline YAML — reference

```yaml
name: eiwa-mcp
steps:
  - goto:                                    # always the first step
      url: https://eiwa.dev/
  - wait:                                    # syncs async content
      selector: "#example-view h3"           # quote it: # starts a YAML comment!
      text: HTTP                             # optional: wait until text appears
  - click:
      selector: "//button[contains(@class, 'example-tab')]"
      index: 6                               # 1-based; the CSS converter only
                                             # matches exact classes — use
                                             # XPath contains() for multi-class
  - collect:                                 # with selector = N records;
      selector: div.quote                    # without = 1 record (omit it)
      fields:
        - name: title
          selector: "#example-view h3"
        - name: tags
          selector: a.tag
          many: true                         # many: true collects N texts
                                             # attr: "href" reads an attribute
  - paginate:                                # optional; without it, 1 page
      selector: li.next a
      maxPages: 100
required: [title]                            # drops items missing these fields
```

Hard rules:

- **Omit optional keys — don't leave `""`.** Absence decodes as `null`
  (`Collect.selector`, `FieldDef.attr`, `Wait.text` are `String?`); other
  defaults apply on decode:
  `waitUntil: load`, `timeoutMs: 15000` (goto) / `5000` (wait), `many: false`,
  `index: 1`. Truly required keys (`url`, `fields`, names,
  `maxPages`, ...) still throw `InvalidPipeline` when missing.
- **`required ⊆ fields`**, no duplicate field names, non-empty `fields`,
  `paginate` with `maxPages > 0`, first step a `goto` — all validated on
  load, fail-fast (`PipelineStore.load` → `InvalidPipeline` /
  `PipelineNotFound`).
- **Pipeline names are `[a-z0-9_-]`** (no `/`, `.`, `|`): `../` yields
  `InvalidPipeline`, never path traversal.
- `trim` is a runner default (every `text()` comes trimmed); no `transform`
  block in v1. `parse_money` is out — returns with a real case + `Money` type.
- `challenge` is never a verb: on detection the runner aborts with
  `browser-challenge` (log + metric, dead-letter, no silent retry).

To add a target: copy a YAML, adjust selectors, verify with
`PipelineStore("pipelines").load("<name>")` (or `POST /jobs` — unknown
names return 400, never dead-letter).

## API

| Method | Response |
|---|---|
| `POST /jobs {"pipeline": "<name>"}` (+ `maxAttempts?`, `idempotencyKey?`) | `201 {"id","status":"queued"}` · `400` bad pipeline · `409` duplicate |
| `GET /health` | `{"status": "ok"\|"degraded", "pending": N}` |
| `GET /metrics` | Prometheus (`scrape_jobs_total{pipeline,outcome}`, `scrape_fetch_errors_total{reason}`) |

Job `id` = `pipeline-(idempotencyKey || goto.url)`.

## Tests

```bash
eiwa test                                    # unit + fakes (no network)
SCRAPER_TEST_DATABASE_URL=... eiwa test      # + real Postgres
SCRAPER_TEST_WORKER_URL=ws://... eiwa test   # + real worker/Chromium
```

Architecture and phases: `docs/PLAN.md`, `docs/PIPELINE.md`, `docs/TASKS.md`.
