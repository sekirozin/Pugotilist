# PugotiList — Contexto Técnico Completo

> Documento canônico baseado no código e nos arquivos de configuração presentes neste repositório. Quando uma afirmação não pôde ser confirmada localmente, ela está marcada como **NÃO CONFIRMADO**.

## 1. Resumo do sistema

O PugotiList é uma aplicação web de biblioteca pessoal integrada à identidade central PugotiLab. Usuários pesquisam jogos, filmes, séries e animes, adicionam obras, dão notas de 0 a 5 estrelas em meios pontos, escrevem reviews, favoritam, acompanham status, criam listas ordenadas e recebem recomendações. Jogos podem ter plataforma jogada registrada; conquistas e guias automáticos estão implementados somente para Steam.

No ecossistema Pugotilab, o PugotiList é o catálogo/diário de consumo. Ele conversa com PugotiLab para identidade, PugotiTasks para tarefas de listas, Jellyfin/PugotiCine para disponibilidade de filmes e provedores externos para catálogo e dados de jogos.

## 2. Estado atual

- Linguagem: TypeScript no backend; JavaScript vanilla no frontend.
- Runtime: Node.js `>=20`.
- Frameworks/bibliotecas: Express 4, `better-sqlite3`, TypeScript/tsx.
- Banco: SQLite local, acessado diretamente por `better-sqlite3`.
- Arquitetura: monólito Express que serve a API REST e os arquivos estáticos do frontend.
- Renderização: `public/app.js` monta HTML por template strings e substitui `#app`; não existe React/Vue/Angular.
- Persistência: SQL direto no `src/server.ts`; schema e alterações incrementais são executados no startup.
- Deploy: imagem Docker Node 20 Alpine construída pelo Dockerfile; Compose define o serviço `pugotilist`.
- Externos: PugotiLab, TMDB, IGDB/Twitch, Steam, Jellyfin e PugotiTasks.

É importante separar os níveis:

```text
Código-fonte: src/, public/, package.json, Dockerfile, compose e configs
      ↓ npm run build / Docker build
Build: dist/server.js dentro da imagem
      ↓ Docker Compose
Aplicação em execução: container pugotilist, porta interna 3020
      ↓ volume
Dados persistentes: SQLite em /DATA/AppData/pugotilist/data (conforme compose)
```

`dist/` e `data/` são ignorados pelo `.gitignore` e não aparecem na árvore deste checkout. O estado real do container/imagem no ZimaOS não é inferido somente pelo código.

## 3. Arquitetura geral

```text
┌──────────────────────┐
│ Navegador             │
│ index.html/app.js/CSS│
└──────────┬───────────┘
           │ HTTP/JSON + cookie
┌──────────▼─────────────────────────┐
│ Express: src/server.ts              │
│ static · requireUser · handlers SQL │
└──────┬─────────┬─────────┬─────────┘
       │         │         │
┌──────▼─────┐ ┌─▼───────┐ ┌─▼─────────────────────┐
│ SQLite     │ │ Pugoti  │ │ Provedores externos   │
│ biblioteca │ │Lab/Tasks│ │ TMDB IGDB Steam       │
│ e listas   │ │Jellyfin │ │ Jellyfin/Anilist     │
└────────────┘ └─────────┘ └───────────────────────┘
```

Não há controllers, services, repositories ou módulos de domínio separados: funções de integração, regras e handlers ficam no único `src/server.ts`.

## 4. Estrutura do projeto

```text
Pugotilist-server/
├── public/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── src/
│   └── server.ts
├── docs/
│   ├── PUGOTILIST_CONTEXT.md (este arquivo)
│   ├── PROJECT_CONTEXT.md
│   ├── ARCHITECTURE.md
│   └── DECISIONS.md
├── package.json / package-lock.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── portal-default.conf
├── portal-live.conf
├── README.md
├── .gitignore / .dockerignore
└── dist/, data/ (gerados/montados; não presentes no checkout atual)
```

`public/index.html` fornece o shell, fontes Material Symbols, stylesheet e módulos JS. `public/app.js` contém estado, renderização, busca, cards, detalhes, listas e listeners. `public/styles.css` concentra tokens, layout, responsividade e estados visuais. `src/server.ts` inicializa o banco, autenticação, integrações, rotas e servidor. Os arquivos `portal-*.conf` são configurações Nginx de referência; o mecanismo que as instala no host é **NÃO CONFIRMADO**.

O HTML referencia `/ambient-effects.js`, mas esse arquivo não existe na árvore analisada. Origem, volume ou injeção dele no deploy: **NÃO CONFIRMADO**.

## 5. Frontend

### Entrada e estado

`public/index.html` inicia `#app` com loader e carrega `public/app.js` como módulo. O objeto `state` em `app.js` mantém perfil, itens, listas, provedores, Steam, view, resultados, busca, tipo, detalhes, recomendações e flags de carregamento. `appBase` usa `/list` quando o pathname começa com `/list`.

`boot()` chama `/api/bootstrap`, injeta o estado, renderiza, hidrata situações de séries/animes e busca `/api/recommendations`. `api()` usa `fetch`, JSON, `AbortController` de 15 segundos e traduz respostas não-2xx em erros.

### Renderização e navegação

`render()` substitui o conteúdo de `#app` por shell, sidebar, topbar, hero, conteúdo e footer; `bind()` reinstala listeners após cada render. Ao final, `enhanceRenderedDom()` executa explicitamente os aprimoramentos pós-render (navegação dividida, menus de listas, status, layout de ações, Steam e listas customizadas). O `MutationObserver` global foi removido para evitar trabalho recursivo sobre toda a árvore DOM.

As views são strings como `home`, `games`, `movies`, `series`, `anime`, `favorites`, `completed`, `planned`, `in_progress`, `following` e `list:<id>`. A navegação visual também inclui “Jogando agora” e “Acompanhando”. O botão “Filmes e séries” inicial é dividido em Filmes, Séries e Animes por `splitWatchNavigation()`.

### Busca

O formulário possui input e select `game`, `movie`, `tv`, `anime`. Atalhos sem foco em campo são `/j`, `/f`, `/s`, `/a`; o input também reconhece esses prefixos. Submit chama `GET /api/search`, grava `state.results` e renderiza cards de catálogo. A seleção de sidebar sincroniza o tipo para Jogos, Filmes, Séries e Animes.

### Cards e detalhes

`card()` gera poster, badge de tipo/ano, criador ou situação, plataforma, nota, menu de três pontos e favorito. Cards de busca têm botão Adicionar; cards de biblioteca têm estrelas, lista, remoção e favorito. `detailsModal()` gera a página interna com hero/backdrop, poster, sinopse, fatos, nota, review, PugotiCine e abas Steam. Botões usam `data-*` para ligar comportamento em `bind()`.

### Biblioteca, listas e interações

Estrelas calculam nota 1–10 usando a metade esquerda/direita do botão; o texto exibe 0–5. Favorito alterna `favorite` e classe/ícone. Menus de card adicionam a listas, removem item ou alternam “Jogando agora”. `customListContent()` exibe fila; `bindCustomListPage()` implementa remoção, conclusão e drag-and-drop com reorder na API. Modais de lista são criados por `showListEditor()` e `addItemToList()`.

### Responsividade e estilos

`public/styles.css` é um stylesheet único com variáveis de cor, cards, grids, sidebar, detalhe, modais, ratings e media query principal em `max-width:800px`. Não há pré-processador ou pipeline de CSS confirmado.

## 6. Backend

### Entrada e middleware

`src/server.ts` cria diretórios, abre SQLite, ativa WAL/foreign keys, inicializa schema, cria `express()`, desativa `x-powered-by`, usa `express.json({limit:"32kb"})`, registra `/health`, rotas protegidas, static e fallback SPA, e escuta `PORT` (padrão 3020).

`requireUser` é o middleware de identidade. Ele encaminha o cookie recebido para o endpoint PugotiLab, valida perfil e define `req.profile`/`req.userId`. Não há middleware de sessão local, JWT local, roles ou autorização administrativa implementados.

### Rotas por domínio

**Saúde e bootstrap**

- `GET /health` — `{ok:true}`, sem autenticação.
- `GET /api/bootstrap` — protegido; retorna rapidamente perfil, itens, listas, Steam e providers. `refreshUserData()` atualiza Tasks, metadados, IDs Steam e conquistas em segundo plano.
- `POST /api/sync/tasks` — protegido; sincroniza conclusão de tarefas.

**Catálogo**

- `GET /api/search?q=&type=` — IGDB para `game`, TMDB para `movie`/`tv`; `anime` consulta TMDB e filtra a categoria.
- `GET /api/details?provider=&type=&id=` — detalhes, tradução, metadados, situação e eventual match Jellyfin.
- `GET /api/recommendations` — recomendações independentes por categoria.

**Biblioteca**

- `POST /api/library` — inclui/upsert de item e metadados.
- `PATCH /api/library/:id` — status, rating, favorito, notes e plataforma jogada.
- `DELETE /api/library/:id` — remove item e tarefas órfãs.

**Listas**

- `POST/GET/PATCH/DELETE /api/lists` e `/api/lists/:id` — CRUD de listas.
- `POST/DELETE /api/lists/:id/items/:itemId` — inclusão/remoção e sincronização de task.
- `POST /api/lists/:id/reorder` — posições e ordem das tasks.
- `PATCH /api/lists/:id/items/:itemId/complete` — status da obra e tasks vinculadas.

**Steam**

- `GET /api/integrations/steam/connect`, `/callback`, `DELETE /api/integrations/steam`.
- `GET /api/games/:id/achievements` e `/guides`.

### Regras e erros

Handlers retornam JSON de erro, normalmente 400 para entrada inválida, 401 para identidade ausente, 404 para recurso/associação ausente, 502 para provedor externo e 503 quando configuração necessária (por exemplo Steam key) está ausente. Algumas sincronizações externas em bootstrap e exclusão/reorder absorvem falhas para manter a operação principal.

## 7. Banco de dados

### Tecnologia e localização

SQLite via `better-sqlite3`; caminho lógico em `DB_FILE`. O processo cria o diretório pai. No Compose, o default é `/app/data/pugotilist.db`, mapeado para `/DATA/AppData/pugotilist/data` no host.

### Entidades

| Tabela | Conteúdo e relações |
|---|---|
| `library_items` | Obra por usuário/provedor/tipo/id; rating, status, review, favorito, poster, plataforma, criador, categoria, Steam e situação. Chave única por usuário + provider + media_type + external_id. |
| `custom_lists` | Lista do usuário, nome, descrição, ícone, cor e categoria. Nome único por usuário. |
| `custom_list_items` | Relação lista–obra com posição, data e `task_id`; foreign keys com cascade. |
| `overview_translations` | Cache de tradução por provider/id/idioma. |
| `user_steam_connections` | Relação usuário–SteamID64, timestamps de conexão/sync. |
| `steam_openid_states` | Estado temporário de OpenID, usuário, expiração e return base. |

Índices confirmados: `idx_library_user_status` e `idx_library_user_favorite`. O schema base é criado por `db.exec`; depois `PRAGMA table_info` detecta e adiciona `play_platform`, `creator_name`, `content_category`, `steam_app_id`, `achievement_total`, `achievement_unlocked`, `achievements_synced_at`, `work_situation`, `return_base`, `icon`, `color`, `category` e `task_id`. Não existe diretório de migrations nem ORM.

Consultas e mutações são SQL direto em `server.ts`, sempre com `user_id` nas operações de usuário. Alterações de schema acontecem no startup e são potencialmente irreversíveis sem backup; não executar contra produção casualmente.

## 8. Autenticação e usuários

O PugotiList depende da sessão/cookie emitido pelo PugotiLab. `requireUser` faz `fetch(PUGOTILAB_PROFILE_URL)` com o header `cookie` da requisição e `accept: application/json`. O retorno pode ser um perfil direto ou `{profile}`; exige `username` e usa `id`, `userId` ou username como identificador. O identificador é convertido para string e usado em todas as consultas.

Falha de perfil não-2xx retorna 401 com `loginUrl`; exceção de rede retorna 503. O frontend apresenta login para 401 e texto de erro para outras falhas. `PUGOTILAB_LOGIN_URL` é usado no link de entrada. Não há credenciais, senha, cookie ou token local no projeto.

Área sensível: `requireUser`, todas as cláusulas `WHERE user_id=?`, rotas de lista/biblioteca e o fluxo Steam OpenID. Alterar qualquer uma sem testar isolamento entre usuários pode causar exposição de dados.

## 9. Biblioteca

`library_items` suporta `game`, `movie` e `tv`; anime é uma categoria de conteúdo dentro de `tv` (`content_category='anime'`). Cada registro guarda `provider` (`igdb`/`tmdb`) e `external_id`. `POST /api/library` recebe metadados de catálogo, faz insert com conflito por chave única e atualiza categoria/criador; para TV consulta detalhes e persiste situação.

Status permitidos: `planned`, `in_progress`, `completed`, `abandoned`. Rating é inteiro 0–10; frontend o representa como estrelas de 0–5 com meio ponto. `favorite` é 0/1; `notes` é review textual. O PATCH promove implicitamente para `completed` quando rating ou notes estão presentes, exceto quando `status` explícito é enviado. Bootstrap também promove itens avaliados e sincroniza tarefas.

`work_situation` é separado do status pessoal e deriva de TMDB/Anilist para séries/animes: andamento, hiato, encerrada, cancelada, planejada ou produção. `play_platform` aceita vazio, Steam, PlayStation, Xbox e Nintendo, mas é apenas seleção manual. `steam_app_id` é preenchido por correspondência IGDB–Steam quando disponível.

Fluxo: busca → card de catálogo → POST biblioteca → persistência por usuário → bootstrap/render → detalhes/PATCH para nota, favorito, review, plataforma ou status.

## 10. Sistema de listas

Listas possuem nome, descrição, categoria (`mixed`, `game`, `movie`, `tv`, `anime`), ícone e cor. O frontend cria/edita via modal; backend valida nome, conjuntos de ícone/cor/categoria e aplica unicidade por usuário. A inclusão valida dono e compatibilidade da categoria, calcula próxima posição e cria ou reutiliza uma task em `Assistir mais tarde`.

Itens têm posição e `task_id`. A fila usa drag-and-drop no browser; reorder salva posições e envia os IDs das tasks ao PugotiTasks. Remoção apaga vínculo e, se a task não estiver compartilhada com outra lista, tenta apagá-la. Completar uma obra atualiza o status e tasks vinculadas. O conteúdo da biblioteca não é removido ao remover da lista.

## 11. Recomendações

`GET /api/recommendations` seleciona itens com `rating>0`, ordena por nota/atualização e usa até seis sementes por categoria: jogo, filme, série e anime. Jogos usam `similar_games` no IGDB; filmes/séries usam endpoints `/recommendations` do TMDB; anime filtra gênero 16 e país JP. Itens já possuídos e sem poster são removidos, com até 18 resultados no frontend.

Se não houver avaliações, retorna grupos vazios. Se provedores não estiverem configurados ou falharem, a rota retorna grupos vazios/base vazia. A intenção de recomendação por nota e separação de categorias está no código; detalhes de ranking além de score/provedor e o comportamento exato de alguns casos de empate são **NÃO CONFIRMADO**.

## 12. Integração TMDB

`TMDB_READ_TOKEN` autentica chamadas à API v3. `searchTmdb()` consulta `/search/movie` ou `/search/tv`, envia `language=pt-BR`, `include_adult=false`, limita 18 e mapeia poster/backdrop, título, ano, overview, score e categoria anime. `detailsTmdb()` consulta `/{type}/{id}` com `append_to_response=credits,videos`, calcula diretores/criadores, elenco, gêneros, status, temporadas/episódios e situação.

Overviews são traduzidos por MyMemory quando necessário e cacheados em `overview_translations` como `pt-BR`; em erro, o original é devolvido. O token, limites e política de uso não são documentados no repositório.

## 13. Integração IGDB / Twitch

`IGDB_CLIENT_ID` e `IGDB_CLIENT_SECRET` são usados em OAuth client credentials contra `https://id.twitch.tv/oauth2/token`. O token fica em memória com expiração baseada em `expires_in`, renovando cerca de um minuto antes do vencimento. `searchIgdb()` faz POST `/v4/games` com `Client-ID`, Bearer e querytext, campos de capa, arte, ano, gênero e plataformas; filtra `version_parent=null`, exige imagem e limita 18.

`detailsIgdb()` obtém resumo/storyline, capa, artwork, plataformas, modos, empresas, avaliação e `external_games`; o Steam App ID é extraído quando a fonte externa é Steam. Recomendações usam `similar_games`. Não há credenciais no documento.

## 14. Integração Xbox

A integração Xbox está implementada no backend e na interface, mas fica desativada sem `XBOX_CLIENT_ID`, `XBOX_CLIENT_SECRET` e `XBOX_TOKEN_ENCRYPTION_KEY`. O fluxo usa Microsoft OAuth para consumidores, troca o access token por Xbox User Token e XSTS, consulta o perfil para obter XUID/gamertag e armazena o refresh token cifrado por usuário. Rotas: `/api/integrations/xbox/connect`, `/callback`, `/profile`, `DELETE /api/integrations/xbox` e `/api/games/:id/xbox-achievements`. A aba “Conquistas Xbox” aparece nos detalhes de jogos e consulta conquistas quando o jogo possui `xbox_title_id`; esse ID é preenchido por correspondência IGDB quando a fonte Xbox é encontrada. As APIs oficiais exigem autorização Xbox/XSTS.

## 15. Integração Steam

A conexão usa Steam OpenID: `connect` cria estado aleatório persistido com expiração de 10 minutos; callback valida `openid` contra Steam, extrai um SteamID64 e faz upsert em `user_steam_connections`. A conexão é por usuário PugotiLab. Sem vínculo, o endpoint de conquistas ainda pode devolver metadados globais, mas não progresso pessoal.

Conquistas exigem `STEAM_WEB_API_KEY`, item da biblioteca do tipo game e `steam_app_id`. O handler consulta:

- `ISteamUserStats/GetSchemaForGame/v2/` (schema e nomes);
- `ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/` (raridade);
- `ISteamUserStats/GetPlayerAchievements/v1/` (progresso do usuário, quando conectado).

Cada chamada tem timeout de 10s. Bootstrap sincroniza progresso no máximo a cada 15 minutos por item. Guias usam `IPublishedFileService/QueryFiles/v1/` para termos de conquistas/100%/walkthrough/platinum, busca nomes via `ISteamUser/GetPlayerSummaries/v2/`, ranqueia PT-BR/conquistas/votos/visualizações, limita 24 e mantém cache em memória de 30 minutos. Sem key retorna 503; sem associação Steam retorna 404.

## 15. Jellyfin / PugotiCine

`JELLYFIN_DB_FILE` aponta para o banco Jellyfin. `getJellyfinDb()` verifica mtime, copia o arquivo para `jellyfin-cache.db` no diretório do banco principal e abre a cópia em modo `readonly`. O caminho Jellyfin do Compose é montado `:ro`; portanto a intenção de leitura somente é confirmada pelo código/compose.

`cineMatch()` primeiro procura `ProviderId='Tmdb'` pelo TMDB ID; se não encontrar, compara título original/traduzido e ano com normalização e similaridade >=0.8. Quando encontra, retorna URL `https://cine.pugotilab.com/web/#/details?...` usando o ID Jellyfin sem hífens e `JELLYFIN_SERVER_ID`. A disponibilidade, atualização e saúde do PugotiCine fora do banco montado são **NÃO CONFIRMADO**.

## 16. Integração PugotiTasks

`PUGOTITASKS_API_URL` tem default interno `/api/integrations/v1`; token vem de `PUGOTITASKS_API_TOKEN` ou de um arquivo `pugotitasks-token` ao lado do banco. `tasksApi()` usa Bearer, JSON e timeout de 10s.

Ao adicionar item a uma lista, `createTasksLink()` cria task em `folderName: "Assistir mais tarde"`, com título `Jogar -`, `Assistir -`, `Assistir série -` ou `Assistir anime -`. `syncTasksCompletion()` consulta `/tasks?filter=all&limit=200`, mapeia tasks por `task_id` e também tenta compatibilidade legada por título, atualizando status. Reorder usa `/tasks/reorder`; alteração de status usa `PATCH /tasks/:id`; remoção usa `DELETE /tasks/:id`.

Falha ao criar task impede inclusão na lista; falhas de remoção/reordenação/status são em geral absorvidas. Essa integração deve ser tratada como sensível porque pode alterar tarefas em outro serviço.

## 17. Variáveis de ambiente

| Variável | Finalidade | Obrigatória | Área |
|---|---|---|---|
| `PORT` | Porta HTTP; default 3020 | Não | servidor |
| `DB_FILE` | Caminho do SQLite | Não (default em `data/`) | banco |
| `PUBLIC_DIR` | Diretório de assets | Não (default `public`) | servidor |
| `NODE_ENV` | Modo de execução/cache static | Não | runtime |
| `PUBLIC_ORIGIN` | Origem para redirects Steam | Não | Steam |
| `PUGOTILAB_PROFILE_URL` | Endpoint interno do perfil | Não (há default) | autenticação |
| `PUGOTILAB_LOGIN_URL` | URL de login | Não (há default) | autenticação |
| `TMDB_READ_TOKEN` | Autenticação TMDB | Sim para catálogo TMDB | catálogo |
| `IGDB_CLIENT_ID` | Client ID Twitch/IGDB | Sim para IGDB | catálogo |
| `IGDB_CLIENT_SECRET` | Secret Twitch/IGDB | Sim para IGDB | catálogo |
| `STEAM_WEB_API_KEY` | Chave Steam Web API | Sim para conquistas/guias | Steam |
| `XBOX_CLIENT_ID` | Client ID do aplicativo Microsoft/Xbox | Sim para conexão Xbox | Xbox |
| `XBOX_CLIENT_SECRET` | Secret do aplicativo Microsoft/Xbox | Sim para conexão Xbox | Xbox |
| `XBOX_REDIRECT_URI` | Callback OAuth Xbox | Não (há default) | Xbox |
| `XBOX_TOKEN_ENCRYPTION_KEY` | Chave local para cifrar refresh tokens Xbox | Sim para conexão Xbox | Xbox |
| `PUGOTITASKS_API_URL` | Base da API Tasks | Não (há default) | Tasks |
| `PUGOTITASKS_API_TOKEN` | Bearer da API Tasks | Sim para sync Tasks | Tasks |
| `JELLYFIN_DB_FILE` | Banco Jellyfin montado | Não | PugotiCine |
| `JELLYFIN_SERVER_ID` | ID de servidor usado na URL | Não (há default) | PugotiCine |
| `TZ` | Fuso do container | Não | runtime |

Os valores não são reproduzidos. A obrigatoriedade “Sim” significa necessária para aquela integração, não necessariamente para iniciar o processo.

## 18. Docker e execução

`Dockerfile` usa `node:20-alpine`, instala `python3 make g++` para dependência nativa, copia package files, executa `npm ci`, copia TypeScript/config/public, roda `npm run build`, remove devDependencies, expõe 3020 e inicia `node dist/server.js`. Healthcheck chama `/health` internamente.

`docker-compose.yml` define container `pugotilist`, publica `3021:3020`, injeta variáveis, monta o banco em `/app/data` e Jellyfin em `/jellyfin:ro`, e conecta as redes default e externa `pugotilab`. O código fonte não é volume do serviço: alterar arquivos não altera automaticamente o container; exige nova imagem/rebuild/redeploy para entrar em execução.

## 19. Ambiente atual no ZimaOS

Confirmado pelo Compose:

```text
/DATA/AppData/pugotilist/data/           → /app/data
/DATA/AppData/jellyfin/config/data/data/ → /jellyfin (somente leitura)
```

O Compose usa um diretório de trabalho no host, mas o caminho exato do projeto Compose, tag efetiva da imagem, container atualmente executando, conteúdo de `.env`, backups e rotina de deploy são **NÃO CONFIRMADO** pelo repositório. Em contexto operacional anterior foi usado um caminho semelhante a `/DATA/AppData/pugotilist/stacks/app`, mas isso deve ser verificado diretamente antes de qualquer alteração.

Não assumir que `/var/home/sekiro/Nextcloud/Pugotilab/pugotilist-server` é a cópia usada pelo ZimaOS. Antes de editar, execute `pwd`, confirme o checkout e compare com o diretório usado pelo Compose. Código local, cópia Nextcloud, fonte no host, imagem e container são camadas distintas.

## 20. Desenvolvimento local vs produção

Local confirmado pelo README/package: `npm install`, `npm run dev`; o dev usa `tsx watch src/server.ts` e dados/configuração vindos do ambiente local. Produção usa build Docker, `dist/server.js`, volumes e variáveis do Compose. O uso de SSHFS, sincronização bidirecional Nextcloud, links simbólicos, checkout Git no ZimaOS e pipeline automático é **NÃO CONFIRMADO**.

> **Antes de modificar qualquer arquivo, confirme com `pwd` qual instância do PugotiList está sendo utilizada.**

Uma alteração local não significa alteração no container. Da mesma forma, copiar arquivo para um container não documenta um deploy persistente se a imagem/stack não for reconstruída conforme o processo real.

## 21. Build, validação e testes

Comandos realmente declarados em `package.json`:

```bash
npm install
npm run dev       # tsx watch src/server.ts
npm run build     # tsc, produz dist/
npm run check     # tsc --noEmit
npm start         # node dist/server.js
```

Não há scripts de lint, unit tests, integração, e2e ou migrations. `npm run check`/`build` são a validação estática disponível. Testes manuais importantes: `/health`, login/bootstrap, pesquisa, inclusão/PATCH/remoção, listas, sincronização Tasks, detalhes, Steam e fallback sem provedores. O ambiente local analisado não possuía `npm`, então a execução local desses comandos não foi confirmada nesta análise.

## 22. Como fazer alterações com segurança

1. Execute `pwd` e confirme a instância correta.
2. Leia este documento e, quando necessário, `AGENTS.md`, `ARCHITECTURE.md` e `DECISIONS.md`.
3. Localize a implementação existente antes de criar outra.
4. Não leia, copie ou altere `.env`/segredos.
5. Faça a menor mudança possível, preservando contratos JSON e isolamento `user_id`.
6. Não toque em banco de produção, Docker ou integrações sem escopo explícito.
7. Rode `npm run check` e `npm run build` quando disponíveis.
8. Teste o fluxo afetado e revise o diff/status.
9. Informe claramente arquivos alterados, validações e limitações.
10. Não faça commit, push, deploy, restart ou migration destrutiva sem autorização.

## 23. Mapa de alterações

```text
Layout, tokens, responsividade, estados visuais → public/styles.css
Tela, cards, navegação, eventos, modais, estado → public/app.js
Shell, scripts/stylesheet/cache-busting          → public/index.html
API, regras, autenticação, integrações, SQL      → src/server.ts
Schema/colunas/índices                           → src/server.ts (startup DB)
Catálogo TMDB                                    → searchTmdb/detailsTmdb/recommendTmdb
Catálogo IGDB                                    → getIgdbToken/searchIgdb/detailsIgdb/recommendIgdb
Status de séries/animes                          → detailsTmdb/workSituation/hydrate frontend
Biblioteca                                      → /api/library e card/details em app.js
Listas/tasks                                    → /api/lists*, tasksApi e funções de lista
Steam                                           → tabelas/rotas Steam em server.ts + abas app.js
PugotiCine/Jellyfin                             → getJellyfinDb/cineMatch e details
Imagem/runtime                                  → Dockerfile
Volumes/portas/variáveis                        → docker-compose.yml
Reverse proxy                                   → portal-default.conf / portal-live.conf
```

## 24. Áreas sensíveis

### Baixo risco

Textos localizados, estilos isolados e pequenos ajustes visuais em `public/styles.css`/HTML, desde que não removam seletores usados por `app.js`.

### Médio risco

Cards, render/bind, busca, recomendações, biblioteca e listas. `render()` substitui o DOM inteiro; listeners e `enhanceRenderedDom()` podem quebrar fluxos se alterados parcialmente.

### Alto risco

`requireUser` e filtros `user_id`; schema SQLite e alterações no startup; PugotiTasks; Steam/OpenID; Jellyfin/PugotiCine; variáveis Docker, volumes, proxy e deploy. Essas áreas podem expor dados, alterar tarefas ou tornar dados incompatíveis.

## 25. Regras para agentes de IA

- Preservar a arquitetura monolítica e contratos existentes.
- Fazer mudanças mínimas; não reescrever `server.ts`/`app.js` sem necessidade.
- Procurar implementação existente e evitar duplicação.
- Não trocar bibliotecas ou adicionar dependências sem justificativa.
- Nunca ler, reproduzir ou modificar `.env`, tokens, cookies ou secrets.
- Não modificar banco de produção diretamente nem fazer migration destrutiva sem aprovação.
- Não alterar autenticação sem revisar o fluxo completo e isolamento por usuário.
- Não alterar comunicação PugotiTasks, Steam, Jellyfin ou PugotiLab casualmente.
- Não fazer commit, push, deploy, restart de container ou alteração de infraestrutura automaticamente.
- Validar mudanças, revisar diff e marcar lacunas como `NÃO CONFIRMADO`.

## 26. Estratégia de modelos

- **GLM-4.7-Flash:** tarefas localizadas, CSS, textos, frontend simples e documentação.
- **GLM-5.1:** investigação multi-arquivo, bugs e refatorações médias.
- **Codex:** arquitetura, autenticação, segurança, banco, infraestrutura e integrações críticas/multi-serviço.

Essa é uma regra operacional do projeto, não uma afirmação de benchmark.

## 27. Problemas e inconsistências conhecidas

- `public/index.html` referencia `ambient-effects.js`, ausente no checkout: origem/deploy **NÃO CONFIRMADO**.
- Não há testes, lint ou migrations formais.
- `src/server.ts` é um módulo muito grande; documentação existente descreve a mesma arquitetura, mas não substitui a leitura do código.
- `portal-default.conf` e `portal-live.conf` contêm blocos muito semelhantes; qual deles está ativo é **NÃO CONFIRMADO**.
- O catálogo de jogos usa `where version_parent = null` e busca textual do IGDB; cobertura de títulos/versões retro e localização de nomes não é garantida.
- A aplicação aceita plataformas PlayStation/Xbox/Nintendo como metadado, mas apenas Steam possui sincronização automática de conquistas.
- O backend cria cache Jellyfin copiando o banco, mas política de limpeza/backup desse cache é **NÃO CONFIRMADO**.
- Não há repositório Git detectável no diretório analisado; `git diff` e histórico não podem ser usados como fonte local.
- Não foi possível confirmar localmente a versão do Node/npm nem executar scripts nesta máquina.

## 28. Pendências de documentação

Devem ser verificadas diretamente no ZimaOS/stack antes de operações de produção:

- diretório exato do Compose e checkout fonte efetivamente usado;
- conteúdo estrutural de `.env` (sem expor valores), tags/digest da imagem e rotina de rebuild;
- container/imagem atualmente ativos e se há alterações manuais dentro do container;
- processo de Cloudflare/Nginx/Tunnel e qual `portal-*.conf` está ativo;
- backups, retenção do SQLite, monitoramento e logs;
- origem real de `ambient-effects.js`;
- URL/contrato efetivo do PugotiTasks e disponibilidade do serviço;
- permissões, escopos e limites das contas TMDB/IGDB/Steam;
- compatibilidade e política de uso das APIs externas.

## 29. Resumo rápido para novos agentes

1. PugotiList é um monólito Express + frontend vanilla para biblioteca de jogos e obras audiovisuais.
2. Frontend: `public/index.html`, `public/app.js`, `public/styles.css`.
3. Backend, rotas, regras, integrações e SQL: `src/server.ts`.
4. Banco: SQLite `DB_FILE`; Compose mapeia `/DATA/AppData/pugotilist/data`.
5. Imagem: Dockerfile Node 20 Alpine, build `tsc`, execução `dist/server.js`.
6. Identidade vem de PugotiLab por cookie via `requireUser`.
7. Todas as consultas de usuário devem preservar `user_id`.
8. Catálogo: TMDB para filmes/TV/anime e IGDB/Twitch para jogos.
9. Steam é a única integração automática de conquistas/guias.
10. PugotiTasks cria e sincroniza tasks de listas; Jellyfin/PugotiCine resolve disponibilidade de filmes.
11. `render()` reconstrói o DOM; `bind()` e `enhanceRenderedDom()` são executados explicitamente após a renderização. Não há mais `MutationObserver` global.
12. Antes de editar, execute `pwd`; não presuma que a cópia Nextcloud é produção.
13. Consulte `AGENTS.md`, `docs/ARCHITECTURE.md` e `docs/DECISIONS.md`.
14. Valide com `npm run check` e `npm run build` quando Node/npm estiverem disponíveis.
15. Não altere `.env`, banco de produção, autenticação, Docker ou integrações sem escopo.
16. Não faça commit, push, deploy ou restart automaticamente.
17. Marque qualquer lacuna como `NÃO CONFIRMADO`.

## Atualização de desempenho — 16/08/2026

- Diagnóstico: o ZimaOS não estava saturado; a lentidão vinha do bootstrap aguardando sincronizações externas e do frontend observando/mutando toda a árvore DOM.
- Backend: `/api/bootstrap` agora responde com perfil, biblioteca, listas, Steam e provedores sem esperar tarefas, TMDB/Anilist, IGDB ou progresso Steam. `refreshUserData()` executa essas atualizações em segundo plano.
- Frontend: o `MutationObserver` global foi removido. `enhanceRenderedDom()` é chamado uma vez ao fim de `render()` para aplicar menus, cards, navegação, status e listas.
- O canvas de partículas e cometas não foi alterado; ele funcionava nos demais serviços e não foi considerado a causa principal.
- Build Docker, container e `/health` foram validados após a correção. O navegador deve ser atualizado com `Ctrl+F5` para descartar o JavaScript antigo em cache.

## Atualização de navegação — Quero conhecer

- A view `Quero conhecer` não exibe jogos; eles continuam preservados na biblioteca e no banco.
- Foi adicionado um filtro visual por `Todos`, `Filmes`, `Séries` e `Animes`.
- No filtro `Todos`, grupos sem obras são omitidos para que a primeira categoria com conteúdo apareça no topo.
- A mudança está restrita a `public/app.js` e `public/styles.css`; não altera API, schema, autenticação ou integrações.
