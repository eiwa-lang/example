# Scraper — serviço de extração agnóstico

Serviço headless que executa **pipelines declarativos em YAML** e persiste
registros tipados no PostgreSQL. O código não conhece nenhum alvo: URLs,
seletores e regras vivem em `pipelines/*.yaml`. Novo site = novo YAML,
zero código.

## Como funciona

```
POST /jobs {"pipeline": "quotes"}
  → Scraper.claim → PipelineRunner → Browser (worker) → Store (Postgres)
```

1. `POST /jobs` recebe **só o nome** do pipeline. O servidor carrega
   `pipelines/<nome>.yaml`, valida e guarda um snapshot junto do job
   (reprodutibilidade: o job executa o JSON da criação, mesmo se o YAML mudar).
2. O `PipelineRunner` executa os `steps` em ordem via o pool `Browser`
   (goto → click → wait → collect → paginate), sempre com `browser.goto`
   como navegação — sem `httpGet`.
3. Cada item coletado vira 1 `record` (`payload` JSONB). Falhas viram
   `retry` (com backoff) ou `dead-letter`, nunca loop silencioso.

## Uso do eiwa browser (o que o serviço usa do pacote)

- `Browser(workers, pool)` — pool compartilhado de workers via WebSocket.
- `page.goto(url, waitUntil, timeoutMs)` — única navegação.
- `page.locator(sel)` + `.nth(k)` + `.within(sel)` — leitura; `.text()`
  para texto, `.attribute(name)` para atributos (`href` da paginação).
- `locator.click()` / `locator.waitFor(ms)` — interação e sincronia.
- Erros tipados (`Timeout`, `ChallengeDetected`, ...) viram outcome de job;
  `CHALLENGE` nunca é contornado: aborta, registra e dead-letter.

## Quickstart

```bash
# infra (worker + postgres)
docker compose up -d browser-worker postgres

# serviço local (precisa do toolchain eiwa + libpq)
set -a; source .env; set +a
eiwa run
```

```bash
# enfileirar extrações (só o nome do pipeline)
curl -X POST http://127.0.0.1:9090/jobs -d '{"pipeline": "quotes"}'
curl -X POST http://127.0.0.1:9090/jobs -d '{"pipeline": "eiwa-mcp"}'

# observar
curl http://127.0.0.1:9090/health     # {"status": "ok", "pending": N}
curl http://127.0.0.1:9090/metrics    # scrape_jobs_total{pipeline,outcome}
```

Variáveis (`config.ei` falha alto se faltar alguma): `BROWSER_WORKERS`,
`DATABASE_URL`, `CONCURRENCY`, `POLL_INTERVAL_MS`, `ARTIFACT_DIR`,
`PIPELINES_DIR`.

## Pipeline YAML — referência

```yaml
name: eiwa-mcp
steps:
  - goto:                                    # sempre o primeiro step
      url: https://eiwa.dev/
      waitUntil: load
      timeoutMs: 30000
  - wait:                                    # sincroniza conteúdo assíncrono
      selector: "#example-view h3"           # aspas: # comenta em YAML!
      timeoutMs: 6000
      text: HTTP                             # opcional: espera o texto aparecer
  - click:
      selector: "//button[contains(@class, 'example-tab')]"
      index: 6                               # 1-based; CSS do conversor só
                                             # casa classe exata — multi-classe
                                             # exige XPath contains()
  - collect:                                 # com selector = N records;
      selector: ""                           # sem selector = 1 record
      fields:
        - name: title
          selector: "#example-view h3"
          many: false                        # many: true coleta N textos
          attr: ""                           # attr != "" lê atributo em vez de texto
  - paginate:                                # opcional; sem ele, 1 página
      selector: li.next a
      maxPages: 100
required: [title]                            # descarta item sem esses campos
```

Regras duras:

- **Todas as chaves, sempre.** Chave aninhada ausente é erro de decode
  (`InvalidPipeline`), nunca default silencioso. `toJson` do próprio
  pipeline gera exatamente o que `fromJson` aceita.
- **`required ⊆ fields`**, `fields` sem nomes duplicados, `collect` sem
  `fields` vazio, `paginate` com `maxPages > 0` — tudo validado no load,
  fail-fast (`PipelineStore.load` → `InvalidPipeline` / `PipelineNotFound`).
- **Nomes de pipeline são `[a-z0-9_-]** (sem `/`, `.` ou `|`): `../` dá
  `InvalidPipeline`, nunca path traversal.
- `trim` é default do runner; sem bloco `transform` no v1.
- `challenge` nunca é verbo: ao detectar, aborta com `browser-challenge`.

Para adicionar um alvo: copie um YAML, ajuste seletores, valide com
`PipelineStore("pipelines").load("<nome>")` (ou `POST /jobs` — nome
desconhecido retorna 400, nunca dead-letter).

## API

| Método | Resposta |
|---|---|
| `POST /jobs {"pipeline": "<nome>"}` (+ `maxAttempts?`, `idempotencyKey?`) | `201 {"id","status":"queued"}` · `400` pipeline inválido · `409` duplicado |
| `GET /health` | `{"status": "ok"\|"degraded", "pending": N}` |
| `GET /metrics` | Prometheus (`scrape_jobs_total{pipeline,outcome}`, `scrape_fetch_errors_total{reason}`) |

`id` do job = `pipeline-(idempotencyKey || goto.url)`.

## Testes

```bash
eiwa test                                    # unit + fakes (sem rede)
SCRAPER_TEST_DATABASE_URL=... eiwa test      # + Postgres real
SCRAPER_TEST_WORKER_URL=ws://... eiwa test   # + worker/Chromium real
```

Detalhes de arquitetura e fases em `docs/PLAN.md`, `docs/PIPELINE.md` e
`docs/TASKS.md`.
