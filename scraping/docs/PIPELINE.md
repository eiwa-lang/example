# Pipeline JSON — Plan (quotes agnóstico)

> **Objetivo: código agnóstico — só o pipeline conhece produto/página/regras.**
> Nenhum seletor, URL, modelo de domínio ou regra de extração vive em `.ei`.
> O serviço interpreta `steps` genéricos; todo conhecimento do alvo vive em
> `pipelines/*.json` versionado. Violação (ex. novo `targets/*.ei`,
> `if pipeline == "x"` no código) falha em review.
> Este doc supersede `PLAN.md §§3,6` no tema connector/pipeline.

Objetivo final: extrair `quotes.toscrape.com` sem nenhum código por alvo.
Serviço agnóstico: todo comportamento de extração vive em JSON versionado,
interpretado em runtime por handles genéricos.

Regras duras (não-negociáveis neste plano):

- **JSON nunca em String.** Todo JSON entra via `fromJson<T>()` e sai via
  `toJson()` em tipos `Serializable + Json`. Proibido `indexOf`, `substring`,
  concatenação ou template para construir/ler JSON. Violação falha em review.
- **Browser-goto only (fase 1).** Nada de `httpGet`/`http-first`. Todo fetch é
  `page.goto(url)` + `locator`/`within`/`text`/`attribute`. HTTP pode voltar
  como `via` opcional em fase posterior, nunca por padrão.
- **Pipeline entra pelo request.** `POST /jobs` recebe só o nome do pipeline.
  URL, seletores, paginação e validação vêm do JSON, nunca do caller.
- **Sem `targets/*.ei`.** `QuotesConnector` é deletado ao fim. `Scraper` nunca
  faz `if connector == "quotes"`.
- **Gap de linguagem nunca se contorna.** Ao bater num bug/limite do
  compilador ou da std: (1) isolar o repro mínimo, (2) escrever o RED em
  `eiwa-lang/samples/tests/` (numerado L+n), (3) avisar e parar a fase até
  ser resolvido upstream. Sem workaround aqui, sem parse manual, sem mudar o
  schema para desviar do bug. Histórico: L1–L5.

## 1. Contrato novo

### 1.1 POST /jobs — antes / depois

Antes (`src/scraper/scraper.ei:27-33`):

```eiwa
type JobRequest(val connector: String, val url: String, ...)
```

Depois:

```eiwa
type JobRequest(val pipeline: String, val maxAttempts: Int = 3, val idempotencyKey: String = "") : Serializable + Json
```

- `pipeline`: nome do arquivo em `pipelines/<name>.json` (ex. `"quotes"`).
- Sem `url`, sem `kind`, sem `connector`. `idempotencyKey` vazio →
  derivado de `pipeline + goto.url` no servidor.
- Erros tipados existentes mantidos: `InvalidJob` (400, `unknown pipeline`,
  `bad maxAttempts`), `DuplicateJob` (409). `createJob` valida sem socket.

Exemplo:

```
POST {{baseUrl}}/jobs
{"pipeline": "quotes"}
→ 201 {"id": "quotes-<sha>", "status": "queued"}
```

### 1.2 Job carrega snapshot do pipeline

`Job` ganha `pipeline: String`. `Store.enqueue` persiste além do Job o
snapshot do pipeline usado (para reprodutibilidade):

- Migração v2: `jobs.pipeline TEXT NOT NULL DEFAULT ''` +
  `jobs.pipeline_json JSONB NOT NULL DEFAULT '{}'`.
- Na criação: servidor faz `PipelineStore.load(pipeline)` →
  `pipeline.toJson()` → coluna `pipeline_json`.
- `claim()` retorna `Job + Pipeline` (dois `fromJson`, nunca parse manual).
- `deleteJob`/`fail`/`complete` inalterados.

### 1.3 Pipeline JSON (schema v2 union, quotes)

Arquivo `pipelines/quotes.json`. `steps` é `List<Step>` onde `Step` é union
fechada — um verbo por item, cada um só com seus campos:

```json
{
  "name": "quotes",
  "steps": [
    {"goto": {"url": "https://quotes.toscrape.com/", "waitUntil": "load", "timeoutMs": 15000}},
    {"collect": {"selector": "div.quote", "fields": [
      {"name": "text", "selector": "span.text", "many": false, "attr": ""},
      {"name": "author", "selector": "small.author", "many": false, "attr": ""},
      {"name": "tags", "selector": "a.tag", "many": true, "attr": ""}
    ]}},
    {"paginate": {"selector": "li.next a", "maxPages": 100}}
  ],
  "required": ["text", "author"]
}
```

Caso 1-por-página (produto): mesmo verbo `collect`, sem `selector`:

```json
{
  "name": "product",
  "steps": [
    {"goto": {"url": "https://example.com/p/42", "waitUntil": "load", "timeoutMs": 15000}},
    {"collect": {"selector": "", "fields": [
      {"name": "pname", "selector": ".name", "many": false, "attr": ""}
    ]}}
  ],
  "required": ["pname"]
}
```

Semântica do `collect`:

- `selector` presente → itera `locator(selector).nth(k)` (para no primeiro
  vazio, como `readQuotes` em `targets/quotes.ei:110-125`), 1 record por match,
  campo relativo ao item (`within` implícito, sem flag).
- `selector` ausente/vazio → `page.locator(field.selector)` direto
  (`text()` ou `attribute(attr)`), 1 record. `many` continua ortogonal.
- `trim` é default do runner (todo `text()` já vem trimado); sem bloco
  `transform` no v1. `parse_money` fora — volta com caso real + tipo `Money`.
- `required` (topo) filtra o item (descarta, não coage).
- `challenge` nunca é verbo: por regra do `PLAN.md`, ao detectar o runner
  aborta com `browser-challenge` (log + métrica, dead-letter, sem retry).

Tipos Eiwa (membros `Serializable + Json`, union fecha o conjunto):

```eiwa
type FieldDef(val name: String, val selector: String, val many: Bool, val attr: String) : Serializable + Json
type Goto(val url: String, val waitUntil: String, val timeoutMs: Int) : Serializable + Json
type Collect(val selector: String, val fields: List<FieldDef>) : Serializable + Json
type Paginate(val selector: String, val maxPages: Int) : Serializable + Json

union Step {
    @Alias("goto") Goto,
    @Alias("collect") Collect,
    @Alias("paginate") Paginate
}
type Pipeline(val name: String, val steps: List<Step>, val required: List<String>) : Serializable + Json
```

Tag desconhecida, objeto vazio ou duas chaves → `throw` no decode com detalhe
(mapeado para `InvalidPipeline` em `parsePipeline`). `Pipeline.validate()`
puro checa o resto: `steps` não vazio, primeiro é `goto`, `collect.fields`
não vazio sem dupes, `required ⊆ fields`, `paginate` com `selector` e
`maxPages > 0`. Interações (`click`/`fill`/`wait`) entram como novos membros
da union quando o primeiro caso real chegar — sem reforma, sem string.

## 2. Handles novos / mortos

| Handle | Arquivo | Papel |
|---|---|---|
| `Pipeline` | `src/scraper/pipeline/pipeline.ei` | valor tipado + `validate()` puro |
| `PipelineStore` | `src/scraper/pipeline/store.ei` | lê `pipelines/*.json` do disco, `fromJson<Pipeline>`, cache, `reload()` |
| `PipelineRunner` | `src/scraper/pipeline/runner.ei` | `run(job, pipeline): RunResult` — executa `steps` em ordem via `Browser`/`Page`/`Locator` |
| `Scraper` | `src/scraper/scraper.ei` | `runOnce`: claim → runner → `insertRecord(rec.toJson())` → complete/fail. Sem dispatch por nome |
| ❌ `QuotesConnector` | `src/scraper/targets/quotes.ei` | **deletar** ao fim da fase 3 (mantido verde até lá) |

`FetchResult(kind, body: String, note)` morre. Vira
`RunResult(val records: List<PipelineRecord>, val note: String)` —
`PipelineRecord` com `fields: List<RecordValue>` tipado, sem `body` cru.
`normalize` some: validação é `required` no runner.

## 3. Fases (TDD, RED primeiro, `eiwa test` verde em cada)

Ver tasks executáveis em `docs/TASKS.md` (fonte de verdade do sequenciamento).

- [ ] **Fase 1 — tipos + store (sem browser).**
      `Pipeline` + `PipelineStore.load("quotes")` via `fromJson`.
      `pipeline_test.ei`: load ok, arquivo ausente → `PipelineNotFound`,
      verbo desconhecido / `required` fora de `fields` / `collect` sem fields
      → `InvalidPipeline`, round-trip `toJson→fromJson` preserva.
      `pipelines/quotes.json` comitado.
      Critério: `eiwa test pipeline_test` verde, zero `indexOf` em JSON
      (`grep -rn 'indexOf.*payload\|+ "{' src/` vazio).
- [ ] **Fase 2 — runner contra fake CDP (browser-goto only).**
      `PipelineRunner.run` executa `goto → collect → paginate → required`.
      Reusa o fake de `tests/service_test.ei:29-98` (2 quotes, sem next).
      `runner_test.ei`: 2 records tipados, `tags.many` coleta N,
      modo sem `selector` → 1 record, `goto-false` → `failed(browser-goto-failed)`,
      `CHALLENGE/Timeout` mapeados como hoje (`quotes.ei:38-56`), sem retry
      silencioso. Nenhum `Client().get` no caminho.
- [ ] **Fase 3 — service loop + API por nome.**
      `Scraper.createJob({"pipeline":"quotes"})` → enqueue com snapshot;
      `runOnce` → `done-2` no fake; `unknown pipeline` → `InvalidJob`/dead-letter;
      `service_test` atualizado: POST só com `pipeline`, asserts via
      `fromJson<CreatedJob>`/`fromJson<HealthBody>`, nunca `indexOf` no body.
      Deletar `targets/quotes.ei` + `connector_test.ei` legado nesta fase.
      Critério: `service_test` verde local + Docker vs PG16, `POST /jobs`
      com corpo antigo (`connector/url`) → 400.
- [ ] **Fase 4 — live quotes (prova).**
      `quotes_live_test.ei` reescrito: load `quotes.json` → runner contra
      worker real → `>=50` records, `author != ""`. `SCRAPER_TEST_WORKER_URL`
      como hoje, skip sem env. É a única fase com rede externa.
- [ ] **Fase 5 — hardening.**
      `maxPages` bound + `truncated-N` note, métricas
      `scrape_jobs_total{pipeline,outcome}`, `PIPELINES_DIR` no `config.ei`
      (fail-fast se ausente), hot-reload opcional via endpoint
      `POST /pipelines/reload`.

## 4. Decisões travadas

1. `steps: List<Step>` com `Step` = union fechada (`Goto|Collect|Paginate`,
   wire `goto|collect|paginate` via `@Alias`). `each/do`, `extract` e o
   `kind: String` aposentados. Interações entram como membros novos.
2. `collect` único: com `selector` = N records, sem = 1 record. Sem `within`.
3. Sem `transform` no v1 (`trim` default; `parse_money` com caso real + `Money`).
4. Sem `output.sink` no v1 (fixo `records`; artifacts na Phase 4 do `PLAN.md`).
5. `id` do job = `pipeline + "-" + (idempotencyKey || goto.url)`.
6. Migração v2 aditiva (`pipeline`, `pipeline_json` com defaults).

## 5. Riscos

- **Resolvido upstream (L1–L4 verdes):** `Map<String,Custom>` popula
  (schema manteve `List<FieldDef>` mesmo assim — erro melhor);
  chave ausente sem default **lança** (com default, aplica o default);
  nested nullable ausente decodifica `null`. Consequência mantida: pipeline
  JSON emite todas as chaves; `validate()` + `InvalidPipeline` cobrem o resto.
- **Resolvido upstream (L5 verde):** `e.message()` em `+`/anotação dentro de
  módulo importado perdia o tipo (`Void`). Workaround template revertido —
  `pipeline.ei:parsePipeline` usa `+` de novo, provado em project mode.
- Fake CDP da `service_test` usa XPath gerado pelo locator (`span[@class]`);
  seletores novos no JSON precisam de entrada equivalente no fake — custo por
  campo, não por alvo.
- `pipelines/*.json` lido do disco exige `PIPELINES_DIR` no Docker
  (volume ou baked-in); `compose.yaml` precisa da var — esquecer = boot 1
  alto, por desenho (`config.ei` fail-fast).
