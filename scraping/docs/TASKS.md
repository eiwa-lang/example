# Tasks — Pipeline YAML (sequencing source of truth)

Convention: TDD RED first, `eiwa test` green per task, no `indexOf`/concat
on JSON. Mark `[x]` only with proof (command + output).

## Phase 1 — types + store (no browser) — [x] done (10/10 `pipeline_test` green, no `indexOf` on JSON)

- [x] **T1.1** Final shape proven by spike: flat `Step` + `kind`
  (`goto|collect|paginate|click|fill|wait`), `fields: List<FieldDef>`
  (no `Map`, no defaults) in `src/scraper/pipeline/pipeline.ei`.
  (Later superseded by the closed `union Step` once the language grew it.)
- [x] **T1.2** Pure `Pipeline.validate()` in `pipeline.ei` + 8 tests
  (unknown verb, non-goto first, fieldless collect, orphan required, dupe).
- [x] **T1.3** Read-through `PipelineStore.load(name)` (`PIPELINES_DIR` lands
  in Phase 3; no cache in v1 — cache would arrive with the reload endpoint
  in T5.2). `pipelines/quotes.yaml` committed. Missing → `PipelineNotFound`.
- [x] **T1.4** Proof above. Language findings (spike, `eiwa test` evidence,
  resolved upstream as L1–L5): `Map<String,CustomType>`, absent nested keys,
  `[]` without inference, `e.message()` in modules. Final schema in
  PIPELINE.md §1.3.
- [x] **T1.5** `Step` += `waitUntil/timeoutMs/value` (navigation belongs to
  the pipeline, not the runner). `quotes.yaml` + fixtures updated (strict
  decode proves completeness).

## Phase 2 — runner (browser-goto only, fake CDP) — [x] done (7/7 `runner_test` green)

- [x] **T2.1** `PipelineRunner.run` in `src/scraper/pipeline/runner.ei`
  (own fake CDP, ports 28921+, `hrefBudget`; wire finding: xpath arrives
  unescaped, css arrives `\"`-escaped — fake matchers respect that).
- [x] **T2.2** Single-record mode (`collect` without `selector`).
- [x] **T2.3** Paginate (`pages-N`, `truncated-N`), mapped errors, reserved
  verb → `unsupported-step`. Zero `Client().get`.

## Phase 3 — service loop + named API — [x] done (real-PG proof below)

- [x] **T3.1** v2 (`pipeline`, `pipeline_json`) + extended `Job` +
  `enqueue/claim` with snapshot. Real-PG proof.
- [x] **T3.2** `JobRequest{pipeline}` + `createJob` (snapshot at enqueue,
  id `pipeline-(key||goto.url)`, `Pipeline.gotoUrl()`).
  Fail-fast `Config.PIPELINES_DIR`; `Scraper` gains `PipelineStore`.
- [x] **T3.3** `runOnce` via runner + pipeline-only `service_test` POSTs
  with typed asserts. Legacy deleted (`targets/`, `connector_test`;
  `quotes_live` recreated runner-based in Phase 4). Proof: 36/36 vs PG16
  from a clean DB (TRUNCATE; the suite shares one DB). Docker: UNBLOCKED —
  builder v0.0.79 lacked `union` (feature without release; pin rule forbids
  dev tags — bump when a release with union ships). Later bumped to v0.0.83,
  then v0.0.85 (union+L6+L7), Docker proof green.

## Phase 4 — live (external proof) — [x] done

- [x] **T4.1** Runner-based `quotes_live_test.ei`: load `quotes.yaml` →
  real worker (`SCRAPER_TEST_WORKER_URL`, skip without env) → `>=50`
  records. PROVEN: PASS vs `ws://127.0.0.1:18080` (compose browser-worker)
  + live quotes.toscrape.com — 100% JSON-driven extraction, zero per-target
  code.

## Phase 5 — hardening — [x] done

- [x] **T5.1** `scrape_jobs_total{pipeline,outcome}` metrics (single map,
  `""` = infra); `PipelineStore` rejects unsafe names (`/`, `.`, `|`,
  empty). `PIPELINES_DIR`/compose done in Phase 3. Proof: 38/38 vs PG16.
- [x] **T5.2** DROPPED with rationale: read-through store (reads disk on
  every `load`), nothing to invalidate; a reload endpoint would be a
  dishonest no-op.

## Second pipeline (eiwa-mcp) — [x] done

- [x] Union += `Click(selector, index)` + `Wait(selector, text?, timeoutMs)`;
  runner executes steps in order (goto/click/wait/collect, paginate last).
  Absent `Wait.text` = presence wait; present = `text()` polling with
  `sleepMs` (no browser changes).
- [x] `pipelines/eiwa-mcp.yaml`: goto eiwa.dev → click MCP tab
  (`//button[contains(@class,…)]`, exact CSS does not match multi-class) →
  wait "MCP" text → collect title/lede/snippets. Finding: exact-match click
  fails (`ENGINE: click failed`) — documented in PIPELINE §1.3.
- [x] Proof: `runner_test` 9/9 (fake with click/wait branches; script-kind
  before selector), live `eiwa-mcp` PASS (title + 3 snippets), suite 43/43
  vs PG16 + real worker.
- Measured minimal timeouts (10 samples, 100ms poll): initial ready max
  1826ms / swap max 313ms; without pre-wait the swap varied 263–1507ms +
  stalls (>10s) from the initial fragment-burst congestion. Initial wait
  6000ms, swap 1000ms (~3x measured max). `wait-timeout` joined
  `retryableNote` (transient with budget, not straight to dead).
- Isolated flake: 1 live run gave `wait-timeout` (htmx fetch stalled; rerun
  green; healthy swap ~1s on measured timeline). Timeout deliberately kept
  at 15s — 30s would mask, not fix. Degraded container network (Chromium
  logs with net errors).

## Compose-level burn-in (native binary) — [x] done

- [x] Native service drained the queue with interleaved POSTs, no crash, no
  spurious retry: 5x quotes `done` (100 records each) + 3x eiwa-mcp `done`
  (persisted title/lede/snippets). Per-pipeline `/metrics` labels,
  `/health` pending 0. Prerequisites of this proof: L6+L7 toolchain fix,
  512B fix in the postgres driver (local path override; manifest stays on
  `github:main`), clean DB via TRUNCATE.
- [x] Observability: `dead-bad-pipeline` now logs the `InvalidPipeline`
  detail (how the 512B ceiling was diagnosed).

## Final burn-in (native + fixes) — [x] done 2026-10-13

- Native binary (L6+L7 toolchain, postgres driver local path-override):
  interleaved quotes + eiwa-mcp POSTs → `done` 100 + 1 records, pending 0,
  per-pipeline metrics, alive the whole window. Restart: health ok,
  re-POSTs → `duplicate job` (101 records intact, no re-crawl).
- eiwa.yaml stays pinned to `github:main` (override was local only,
  reverted).
- Remaining blocker: Docker image with fixes requires a toolchain release
  (pin rule) plus the postgres fix merged upstream. (Later unblocked:
  v0.0.85 + Docker proof green.)

## YAML migration — [x] done

- [x] `pipelines/*.json` -> `*.yaml` (union + aliases + lists via
  `fromYaml`; `#` specials, XPath with quotes). `PipelineStore` reads YAML
  (`parsePipelineYaml`, malformed -> `InvalidPipeline`); DB snapshots stay
  JSON (internal detail). `.json` deleted. Proof: 44/44 vs PG16.

## Absent-is-null (String?) — [x] done

- [x] `Collect.selector`, `FieldDef.attr`, `Wait.text` are `String? = null`
  (runner normalizes with `?: ""`); legacy `""` snapshots still parse.
  eiwa-mcp goto keeps tuned `timeoutMs: 30000`. Proof: suite green vs PG16.
