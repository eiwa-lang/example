# Arest Tour — um framework HTTP + MCP em Eiwa

Um guia passo a passo para entender o Arest, usando a rota `get("/")` como fio condutor. Termina ensinando a mover handlers para arquivos separados (`learn.ei`).

---

## O que é o Arest

Arest é um framework web escrito em Eiwa que roda **HTTP REST e MCP (Model Context Protocol) no mesmo servidor**. Cada conexão é tratada em uma fibra cooperativa (`task {}`).

A forma de usar é declarativa, com builders:

```eiwa
arest(8080) {
    routing {
        get("/") { ... }        // HTTP
        post("/users") { ... }
    }

    mcp {
        tool("sum") { ... }     // MCP
        resource("config://x") { ... }
        prompt("review") { ... }
    }
}
```

Não há herança nem interfaces implícitas: tudo é `type`/`contract`/`skill` com sintaxe de receptores estilo Kotlin (`ApplicationCall.() -> Void`) — mas compilado direto para C nativo.

---

## Anatomia do projeto

```
src/
    main.ei             # ponto de entrada (raiz do projeto)
    arest.ei            # função arest(port) { } — loop do servidor
    arest_builder.ei    # acumula routing + mcp
    application_call.ei # ApplicationCall: respond()/respondText()/respondJson()
    routing.ei          # RoutingBuilder: get/post/put/patch/delete
    learn.ei            # <-- handlers que você escreve (este tutorial)
    json.ei             # parser JSON (JSON-RPC)
    dispatcher/         # decide HTTP vs MCP por path
    mcp/                # mcp_builder, mcp_call, protocolos JSON-RPC
```

Toda a inteligência já está pronta: `main.ei` só **declara o que o servidor deve fazer**.

---

## Tutorial: a rota `get("/")`

Abra `src/main.ei` (originalmente): a primeira rota registrada é a página inicial.

```eiwa
arest(8082) {
    routing {
        get("/") {
            respond(200, "text/html", html {
                // HTML declarativo via DSL
            })
        }
    }
}
```

### Passo 1 — Registro da rota

`routing { }` chama `RoutingBuilder` (`routing.ei`). Cada `get("/")` cria uma `Route`:

```eiwa
fun get(path: String, handler: ApplicationCall.() -> Void) {
    routes.add(Route("GET", path, handler))
}
```

Repare: o handler é um **receiver lambda** `ApplicationCall.() -> Void`. Dentro dele você tem acesso a `this` = `ApplicationCall`, o que permite chamar `respond(...)` **sem prefixo**.

### Passo 2 — O contexto (ApplicationCall)

`application_call.ei` define o que você pode fazer no handler:

```eiwa
type ApplicationCall(val conn, val request, val server) {
    fun respond(status, contentType, body)     // resposta completa
    fun respondText(body, status = 200)        // text/plain
    fun respondHtml(body, status = 200)        // text/html
    fun respondJson(body, status = 200)        // application/json
}
```

`request` dá acesso a `method`, `path`, `body`, `headers` e `queries`. Ex.: `request.queries["name"]`.

### Passo 3 — Runtime

`arest.ei` faz o loop: `server.bind(port)`, aceita conexões e despacha:

```eiwa
val conn = server.accept()
task {
    dispatcher.dispatch(conn)   // HTTP ou MCP, decidido pelo path
}
```

O despachante (`dispatcher/dispatcher.ei`) compara o path com `builder.mcpBuilder.path` (default `/mcp`): se for MCP chama `McpDispatcher`, senão `HttpDispatcher`.

---

## Mover o handler para outro arquivo (`learn.ei`)

Você **não precisa** colocar todo handler dentro do bloco `arest(8082)`. Crie `src/learn.ei` com funções que recebem `ApplicationCall`:

```eiwa
// src/learn.ei
import { ApplicationCall } from ".application_call"
import { html } from "html"

fun homePage(call: ApplicationCall) {
    call.respond(200, "text/html", html {
        head { title("Arest — Eiwa Web Framework") }
        body(class = "bg-blue-950") {
            h1("Eiwa Programming Language")
        }
    })
}

fun greetPage(call: ApplicationCall) {
    val name = call.request.queries["name"] ?: "Mundo"
    call.respondText("Olá, " + name + "!")
}
```

Depois importe e registre em `main.ei`:

```eiwa
import { homePage, greetPage } from ".learn"

arest(8082) {
    routing {
        get("/")       { homePage(this) }
        get("/learn")  { greetPage(this) }
    }
}
```

Dentro do receiver lambda, `this` é o `ApplicationCall`, então basta passar `this` para a função. Isso mantém `main.ei` enxuto e cada página em seu próprio arquivo.

> **Alternativa idiomática** (quando o projeto crescer): agrupar handlers por responsabilidade em um `type Page { fun index(call) ... }` ou usar um `object` como namespace, e registrar `get("/") { Pages.index(this) }`.

---

## State e dados

Handlers podem acessar o `server` (`ApplicationCall.server`, que é um `ArestBuilder`) para estado compartilhado:

```eiwa
fun shutdownPage(call: ApplicationCall) {
    call.server.shutdown()
    call.respondText("Servidor encerrando...")
}
```

Conexões com banco (`Postgres.pool`), logging (`Log.info {}`) e serialização (`toJson()`) funcionam normalmente dentro dos handlers:

```eiwa
get("/json") {
    val person = Person("Ana", 30, addr, date(1987, 10, 10), ["friend", "coder"])
    respond(200, "application/json", person.toJson())
}
```

---

## Adicionando MCP

No mesmo `arest {}`:

```eiwa
mcp {
    name("Calculator")
    version("1.0.0")
    http("/mcp")

    tool("sum") {
        val a = argumentInt("a")
        val b = argumentInt("b")
        respond((a + b).toString())
    }
}
```

`mcp_builder` registra `tool/resource/prompt`; o `McpDispatcher` cuida de `initialize`, `tools/list`, `tools/call`, etc. automaticamente. Você só escreve a lógica de negócio.

---

## Rodando

```bash
eiwa build          # ou: eiwac build --backend=c src/main.ei
./bin/arest-sample
```

**Testando com curl:**
```bash
curl http://localhost:8082/
curl "http://localhost:8082/learn?name=Ana"
curl -X POST http://localhost:8082/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
```

---

## Resumo mental

| Conceito | Arquivo | Papel |
|---|---|---|
| `arest(port) {}` | `arest.ei` | Sobe o servidor e despacha |
| `routing { }` | `routing.ei` | Registra rotas HTTP |
| `get("/") { }` | lambda receiver | Handler HTTP (contexto `ApplicationCall`) |
| `ApplicationCall` | `application_call.ei` | respond/request/server |
| `mcp { }` | `mcp_builder.ei` | Registra tools/resources/prompts |
| `McpDispatcher` | `mcp/mcp_dispatcher.ei` | Protocolo JSON-RPC |

O Arest separa **transporte** (HTTP/MCP) de **lógica** (seus handlers): você só escreve o que cada rota/tool faz — o framework cuida do resto.