# Tasks — Pipeline JSON (fonte de verdade do sequenciamento)

Convenção: TDD RED primeiro, `eiwa test` verde por task, sem `indexOf`/concat
em JSON. Marcar `[x]` só com prova (comando + saída).

## Fase 1 — tipos + store (sem browser) — [x] done (10/10 `pipeline_test` verde, sem `indexOf` em JSON)

- [x] **T1.1** Tipos `GotoStep/CollectStep/...` → forma final provada por spike:
  `Step` flat + `kind` (`goto|collect|paginate|click|fill|wait`), `fields: List<FieldDef>`
  (sem `Map`, sem defaults) em `src/scraper/pipeline/pipeline.ei`.
- [x] **T1.2** `Pipeline.validate()` puro em `pipeline.ei` + 8 tests (verbo
  desconhecido, 1º não-goto, collect sem fields, required órfão, dupe).
- [x] **T1.3** `PipelineStore.load(name)` read-through (`PIPELINES_DIR` futuro;
  sem cache no v1 — cache chega com o endpoint de reload em T5.2).
  `pipelines/quotes.json` comitado. Ausente → `PipelineNotFound`.
- [x] **T1.4** Prova acima. Achados de linguagem (spike, evidência em `eiwa test`):
  `Map<String,CustomType>` deserializa null (descartado); chave nested ausente
  NPE o deserializador (bug upstream a reportar — schema exige todas as chaves
  presentes, `validate()` cobre o resto).

## Fase 2 — runner (browser-goto only, fake CDP) — [x] done (7/7 `runner_test` verde)

- [x] **T2.1** `PipelineRunner.run` em `src/scraper/pipeline/runner.ei` (fake CDP próprio, portas 28921+, `hrefBudget`; achado de wire: xpath sem escape, css com `\"` escapado). `PipelineRunner.run` goto→collect(N, `nth(k)` + `within` implícito, `many`) → `required` filtra. RED `runner_test.ei` vs fake `service_test.ei:29-98`: 2 records tipados.
- [x] **T2.2** Modo 1-record (`collect` sem `selector`). Modo 1-record: `collect` sem `selector` → `page.locator` direto. RED: fixture produto → 1 record.
- [x] **T2.3** Paginate (`pages-N`, `truncated-N`), erros mapeados, verbo reservado → `unsupported-step`. Zero `Client().get`. Paginate: segue `li.next a` até `maxPages`/fim; note `truncated-N`. Erros: `goto-false` → `browser-goto-failed`, `CHALLENGE/Timeout` como `quotes.ei:38-56`. Prova: `eiwa test runner_test` verde, zero `Client().get` no caminho.

## Fase 3 — service loop + API por nome

- [ ] **T3.1** Migração v2 (`pipeline`, `pipeline_json` com defaults). `enqueue/claim` com snapshot (`toJson` no create, `fromJson` no claim).
- [ ] **T3.2** `JobRequest{pipeline, maxAttempts, idempotencyKey}` + `createJob` (id = `pipeline-(key||goto.url)`, `unknown pipeline` → `InvalidJob`). RED sem socket.
- [ ] **T3.3** `runOnce` via runner → `done-2` no fake; `service_test` com POST só-`pipeline`, asserts `fromJson`. Deletar `targets/quotes.ei` + `connector_test.ei`. Prova: `service_test` verde local + Docker vs PG16; corpo antigo → 400.

## Fase 4 — live (prova externa)

- [ ] **T4.1** `quotes_live_test.ei`: load `quotes.json` → worker real (`SCRAPER_TEST_WORKER_URL`, skip sem env) → `>=50` records, `author != ""`.

## Fase 5 — hardening

- [ ] **T5.1** `PIPELINES_DIR` em `config.ei` (fail-fast) + `compose.yaml`; métricas `scrape_jobs_total{pipeline,outcome}`.
- [ ] **T5.2** (opcional) `POST /pipelines/reload` → `PipelineStore.reload()`.
