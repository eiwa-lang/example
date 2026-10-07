# Tasks — Pipeline JSON (fonte de verdade do sequenciamento)

Convenção: TDD RED primeiro, `eiwa test` verde por task, sem `indexOf`/concat
em JSON. Marcar `[x]` só com prova (comando + saída).

## Fase 1 — tipos + store (sem browser)

- [ ] **T1.1** Tipos `GotoStep/CollectStep/PaginateStep/ClickStep/FillStep/WaitStep/Pipeline` em `src/scraper/pipeline/pipeline.ei` (`Serializable + Json`, `collect.selector` default `""`).
- [ ] **T1.2** `Pipeline.validate()` puro: steps não vazio, 1º é `goto`, `collect.fields` não vazio, `required ⊆ fields`. RED: `pipeline_test.ei` (verbo desconhecido, required órfão, collect sem fields → `InvalidPipeline`).
- [ ] **T1.3** `PipelineStore.load(name)` em `src/scraper/pipeline/store.ei` (`PIPELINES_DIR`, `fromJson<Pipeline>`, `PipelineNotFound`). Comitar `pipelines/quotes.json` (goto→collect→paginate, §1.3 do PIPELINE.md).
- [ ] **T1.4** Round-trip `toJson→fromJson` preserva quotes.json. Prova: `eiwa test pipeline_test` verde + `grep -rn 'indexOf.*payload\|+ "{' src/` vazio.

## Fase 2 — runner (browser-goto only, fake CDP)

- [ ] **T2.1** `PipelineRunner.run` goto→collect(N, `nth(k)` + `within` implícito, `many`) → `required` filtra. RED `runner_test.ei` vs fake `service_test.ei:29-98`: 2 records tipados.
- [ ] **T2.2** Modo 1-record: `collect` sem `selector` → `page.locator` direto. RED: fixture produto → 1 record.
- [ ] **T2.3** Paginate: segue `li.next a` até `maxPages`/fim; note `truncated-N`. Erros: `goto-false` → `browser-goto-failed`, `CHALLENGE/Timeout` como `quotes.ei:38-56`. Prova: `eiwa test runner_test` verde, zero `Client().get` no caminho.

## Fase 3 — service loop + API por nome

- [ ] **T3.1** Migração v2 (`pipeline`, `pipeline_json` com defaults). `enqueue/claim` com snapshot (`toJson` no create, `fromJson` no claim).
- [ ] **T3.2** `JobRequest{pipeline, maxAttempts, idempotencyKey}` + `createJob` (id = `pipeline-(key||goto.url)`, `unknown pipeline` → `InvalidJob`). RED sem socket.
- [ ] **T3.3** `runOnce` via runner → `done-2` no fake; `service_test` com POST só-`pipeline`, asserts `fromJson`. Deletar `targets/quotes.ei` + `connector_test.ei`. Prova: `service_test` verde local + Docker vs PG16; corpo antigo → 400.

## Fase 4 — live (prova externa)

- [ ] **T4.1** `quotes_live_test.ei`: load `quotes.json` → worker real (`SCRAPER_TEST_WORKER_URL`, skip sem env) → `>=50` records, `author != ""`.

## Fase 5 — hardening

- [ ] **T5.1** `PIPELINES_DIR` em `config.ei` (fail-fast) + `compose.yaml`; métricas `scrape_jobs_total{pipeline,outcome}`.
- [ ] **T5.2** (opcional) `POST /pipelines/reload` → `PipelineStore.reload()`.
