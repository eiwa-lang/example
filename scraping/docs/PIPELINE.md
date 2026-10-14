# Pipeline YAML — Plan (agnostic quotes)

> **Goal: agnostic code — only the pipeline knows product/page/rules.**
> No selector, URL, domain model, or extraction rule lives in `.ei`.
> The service interprets generic `steps`; all target knowledge lives in
> versioned `pipelines/*.yaml`. Violations (e.g. a new `targets/*.ei`,
> `if pipeline == "x"` in code) fail review.
> This doc supersedes `PLAN.md §§3,6` on connector/pipeline.

End goal: extract `quotes.toscrape.com` with zero per-target code.
Agnostic service: all extraction behavior lives in versioned pipelines,
interpreted at runtime by generic handles.

Hard rules (non-negotiable in this plan):

- **Never String JSON.** All JSON enters via `fromJson<T>()` and leaves via
  `toJson()` on `Serializable + Json` types. No `indexOf`, `substring`,
  concatenation, or templating to build/read JSON. Violations fail review.
- **Browser-goto only.** No `httpGet`/`http-first`. Every fetch is
  `page.goto(url)` + `locator`/`within`/`text`/`attribute`. HTTP may return
  as an opt-in `via` in a later phase, never by default.
- **Pipeline enters via the request.** `POST /jobs` takes only the pipeline
  name. URL, selectors, pagination, and validation come from the YAML,
  never from the caller.
- **No `targets/*.ei`.** `QuotesConnector` was deleted in Phase 3. `Scraper`
  never does `if connector == "quotes"`.
- **Language gaps are never worked around.** On hitting a compiler/std
  bug or limit: (1) isolate the minimal repro, (2) write the RED in
  `eiwa-lang/samples/tests/` (numbered L+n), (3) report and stop the phase
  until fixed upstream. No workaround here, no manual parsing, no schema
  changes to dodge the bug. History: L1–L7.

## 1. New contract

### 1.1 POST /jobs — before / after

Before (`src/scraper/scraper.ei`, old shape):

```eiwa
type JobRequest(val connector: String, val url: String, ...)
```

After:

```eiwa
type JobRequest(val pipeline: String, val maxAttempts: Int = 3, val idempotencyKey: String = "") : Serializable + Json
```

- `pipeline`: name of the file in `pipelines/<name>.yaml` (e.g. `"quotes"`).
- No `url`, no `kind`, no `connector`. Empty `idempotencyKey` derives from
  `pipeline + goto.url` on the server.
- Existing typed errors kept: `InvalidJob` (400, `unknown pipeline`,
  `bad maxAttempts`), `DuplicateJob` (409). `createJob` validates without
  sockets.

Example:

```
POST {{baseUrl}}/jobs
{"pipeline": "quotes"}
→ 201 {"id": "quotes-https://quotes.toscrape.com/", "status": "queued"}
```

### 1.2 Job carries a pipeline snapshot

`Job` gains `pipeline: String` + `pipelineJson: String`. `Store.enqueue`
persists the pipeline snapshot in use (reproducibility):

- Migration v2: `jobs.pipeline TEXT NOT NULL DEFAULT ''` +
  `jobs.pipeline_json JSONB NOT NULL DEFAULT '{}'`.
- At creation: server runs `PipelineStore.load(pipeline)` →
  `pipeline.toJson()` → `pipeline_json` column.
- `claim()` returns the `Job` with its snapshot (`pipelineJson`); the
  runner executes that copy — the job runs what was valid at creation
  even if the YAML changes later.
- `deleteJob`/`fail`/`complete` unchanged.

### 1.3 Pipeline YAML (schema v3 union, quotes)

File `pipelines/quotes.yaml`. `steps` is `List<Step>` where `Step` is a
closed union — one verb per item, each with only its own fields:

```yaml
name: quotes
steps:
  - goto:
      url: https://quotes.toscrape.com/
  - collect:
      selector: div.quote
      fields:
        - name: text
          selector: span.text
        - name: author
          selector: small.author
        - name: tags
          selector: a.tag
          many: true
  - paginate:
      selector: li.next a
      maxPages: 100
required:
  - text
  - author
```

Single-record case (product): same `collect` verb, `selector` omitted:

```yaml
name: product
steps:
  - goto:
      url: https://example.com/p/42
  - collect:
      fields:
        - name: pname
          selector: .name
required:
  - pname
```

`collect` semantics:

- `selector` present → iterates `locator(selector).nth(k)` (stops at the
  first empty, like the old `readQuotes`), 1 record per match, fields
  relative to the item (implicit `within`, no flag).
- `selector` absent → `page.locator(field.selector)` directly (`text()` or
  `attribute(attr)`), 1 record. `many` stays orthogonal (collects N texts
  in both modes).
- `trim` is a runner default (every `text()` arrives trimmed); no
  `transform` block in v1. `parse_money` is out — returns with a real case
  + `Money` type.
- Top-level `required` filters items (drops, never coerces).
- `challenge` is never auto-solved: per `PLAN.md`, on detection the runner
  aborts with `browser-challenge` (log + metric, dead-letter, no silent
  retry). The `captcha` step is the only exception: it solves via a
  third-party provider, fills `responseSelector`, optionally clicks
  `submitSelector`, and runs only when the operator allowlists its provider
  in `CAPTCHA_PROVIDERS` — YAML alone never enables it. Denied/unwired/
  failed attempts dead-letter (`captcha-denied`/`captcha-no-solver`/
  `captcha-failed`, never retried) and every attempt is audited via
  `scrape_captcha_total{provider,outcome}`. Provider names are
  `[a-z0-9-]` (fail-fast, no metric injection).
- The CSS converter uses exact class match (`div.quote` does not match
  `class="a quote"`); for multi-class use XPath `contains()` directly
  (e.g. `//button[contains(@class, 'example-tab')]` — see `eiwa-mcp.yaml`).

Eiwa types (union members `Serializable + Json`; the union closes the set).
Optionals with meaningful absence are `String? = null` (omitted in YAML);
other defaults (`waitUntil`, `timeoutMs`, `many`, `index`) always hold a
value:

```eiwa
type FieldDef(val name: String, val selector: String, val many: Bool = false, val attr: String? = null) : Serializable + Json
type Goto(val url: String, val waitUntil: String = "load", val timeoutMs: Int = 15000) : Serializable + Json
type Collect(val fields: List<FieldDef>, val selector: String? = null) : Serializable + Json
type Paginate(val selector: String, val maxPages: Int) : Serializable + Json
type Click(val selector: String, val index: Int = 1) : Serializable + Json
type Wait(val selector: String, val text: String? = null, val timeoutMs: Int = 5000) : Serializable + Json
type Captcha(val provider: String, val responseSelector: String, val sitekey: String? = null, val submitSelector: String? = null) : Serializable + Json

union Step {
    @Alias("goto") Goto,
    @Alias("click") Click,
    @Alias("wait") Wait,
    @Alias("collect") Collect,
    @Alias("paginate") Paginate,
    @Alias("captcha") Captcha
}
type Pipeline(val name: String, val steps: List<Step>, val required: List<String>) : Serializable + Json
```

Unknown tag, empty object, or double key → `throw` at decode with detail
(mapped to `InvalidPipeline` in `parsePipeline`/`parsePipelineYaml`).
Pure `Pipeline.validate()` checks the rest: non-empty `steps`, first step
a `goto`, non-empty `collect.fields` without dupes, `required ⊆ fields`,
`paginate` with `selector` and `maxPages > 0`. New interaction verbs enter
as new union members — no reform, no strings.

## 2. New / dead handles

| Handle | File | Role |
|---|---|---|
| `Pipeline` | `src/scraper/pipeline/pipeline.ei` | typed value + pure `validate()` |
| `PipelineStore` | `src/scraper/pipeline/store.ei` | reads `pipelines/*.yaml` from disk, `fromYaml<Pipeline>`, read-through (no cache — see T5.2) |
| `PipelineRunner` | `src/scraper/pipeline/runner.ei` | `run(job, pipeline): RunResult` — runs `steps` in order via `Browser`/`Page`/`Locator` |
| `Scraper` | `src/scraper/scraper.ei` | `runOnce`: claim → runner → `insertRecord(rec.toJson())` → complete/fail. No dispatch by name |
| ❌ `QuotesConnector` | `src/scraper/targets/quotes.ei` | **deleted** in Phase 3 |

`FetchResult(kind, body: String, note)` is dead. It became
`RunResult(val records: List<PipelineRecord>, val note: String)` —
`PipelineRecord` with typed `fields: List<RecordValue>`, no raw `body`.
`normalize` is gone: validation is `required` in the runner.

## 3. Phases (TDD, RED first, `eiwa test` green each) — all done

Executable tasks in `docs/TASKS.md` (sequencing source of truth).

- [x] **Phase 1 — types + store (no browser).** `Pipeline` +
  `PipelineStore.load("quotes")` via serde decode. `pipeline_test.ei`:
  load ok, missing file → `PipelineNotFound`, unknown verb / `required`
  outside `fields` / fieldless `collect` → `InvalidPipeline`, `toJson→fromJson`
  round-trip preserves. Proof: `pipeline_test` green, zero `indexOf` in JSON.
- [x] **Phase 2 — runner vs fake CDP (browser-goto only).**
  `PipelineRunner.run` runs `goto → collect → paginate → required`.
  `runner_test.ei`: typed records, `tags.many` collects N, selector-less
  mode → 1 record, `goto-false` → `failed(browser-goto-failed)`,
  `CHALLENGE/Timeout` mapped, no silent retry. No `Client().get` in the path.
- [x] **Phase 3 — service loop + named API.** `createJob({"pipeline":"quotes"})`
  → enqueue with snapshot; `runOnce` → `done-N`; bad snapshot →
  `dead-bad-pipeline` with detail; `service_test` posts pipeline-only bodies
  with typed asserts (`PipelineRecord`). `targets/quotes.ei` +
  `connector_test.ei` deleted here. Proof: green locally + vs PG16 + Docker;
  legacy bodies → 400.
- [x] **Phase 4 — live quotes (proof).** `quotes_live_test.ei`: load
  `quotes.yaml` → runner vs real worker → `>=50` records. Only phase with
  external network.
- [x] **Phase 5 — hardening.** `maxPages` bound + `truncated-N` note,
  `scrape_jobs_total{pipeline,outcome}` metrics, `PIPELINES_DIR` in
  `config.ei` (fail-fast), traversal-safe pipeline names, `wait-timeout`
  retryable with budget. Reload endpoint dropped with rationale (T5.2:
  read-through store has no cache to invalidate).
- [x] **Second pipeline (eiwa-mcp).** `Click` + `Wait` union members;
  `pipelines/eiwa-mcp.yaml` (goto → wait → click → wait → collect);
  measured minimal timeouts; live proof vs real worker.
- [x] **YAML migration.** `pipelines/*.json` → `*.yaml`; snapshots in the
  DB stay JSON (internal detail); old `""`-style snapshots still parse.

## 4. Locked decisions

1. `steps: List<Step>` with `Step` a closed union (`Goto|Collect|Paginate` +
   `Click|Wait|Captcha`, wire keys via `@Alias`). `each/do`, `extract`, and
   `kind: String` retired.
2. Single `collect`: with `selector` = N records, without = 1 record
   (`String? = null`). No `within` flag.
3. Absent-is-null for `Collect.selector`, `FieldDef.attr`, `Wait.text`
   (runner normalizes with `?: ""`; legacy `""` snapshots tolerated).
4. No `transform` in v1 (`trim` default; `parse_money` with a real case + `Money`).
5. No `output.sink` in v1 (fixed `records`; artifacts in `PLAN.md` Phase 4).
6. Job `id` = `pipeline + "-" + (idempotencyKey || goto.url)`.
7. Additive v2 migration (`pipeline`, `pipeline_json` with defaults).
8. Measured minimal timeouts (pre-wait anti-congestion; `wait-timeout`
   retryable, not directly dead).
9. Traversal-safe pipeline names; `dead-bad-pipeline` logs the detail.
10. Captcha plugin (third-party auto-solve): union member + operator
    allowlist (`CAPTCHA_PROVIDERS`, empty = disabled) + per-attempt audit;
    denied/unwired/failed dead-letter, never retried. Real provider wiring
    is future work (prototype proves the mechanism with a fake).

## 5. Risks

- **Resolved upstream (L1–L4 green):** `Map<String,Custom>` populates
  (schema kept `List<FieldDef>` anyway — better errors);
  missing key without default **throws** (with default, applies it);
  absent nullable decodes as `null`. Consequence: YAML omits optionals;
  old `""` snapshots stay valid (tolerated as absent). `validate()` +
  `InvalidPipeline` cover the rest.
- **Resolved upstream (L5 green):** `e.message()` in `+`/annotation inside
  an imported module lost its type (`Void`). Template workaround reverted —
  `pipeline.ei:parsePipeline` uses `+` again, proven in project mode.
- **Resolved upstream (L6/L7 green):** native try/catch (`optnone`) and
  per-task handler state; proven by service burn-in.
- Fake CDP in `service_test` uses locator-generated XPath (`span[@class]`);
  new selectors in YAML need equivalent fake entries — cost per field,
  not per target.
- `pipelines/*.yaml` read from disk requires `PIPELINES_DIR` in Docker
  (volume or baked in); `compose.yaml` needs the var — missing it = loud
  boot failure by design (`config.ei` fail-fast).
- Isolated live flake: htmx fetch stalls (rerun green; container network
  degraded). Timeouts stay tight on purpose — stretching them masks,
  never fixes.
