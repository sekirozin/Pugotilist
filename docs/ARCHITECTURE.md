# Arquitetura técnica

## Visão arquitetural

```text
┌──────────────────────────────┐
│ Browser: index/app/styles     │
│ DOM + state + fetch           │
└──────────────┬───────────────┘
               │ HTTP/JSON
┌──────────────▼───────────────┐
│ Express em src/server.ts     │
│ static + requireUser + rotas │
└───────┬──────────┬───────────┘
        │          │
┌───────▼──────┐ ┌─▼────────────────────┐
│ SQLite       │ │ Adaptadores externos │
│ better-sqlite│ │ PugotiLab/TMDB/IGDB │
│              │ │ Steam/Jellyfin/Tasks │
└──────────────┘ └──────────────────────┘
```

## Módulos e dependências

- Configuração/armazenamento: topo de `src/server.ts`, abertura SQLite, pragmas e schema.
- Identidade: `requireUser`; todos os handlers protegidos dependem dele.
- PugotiTasks: `tasksApi`, `createTasksLink`, `syncTasksCompletion`.
- Catálogos: `getIgdbToken`, `searchIgdb`, `detailsIgdb`, `recommendIgdb`; equivalentes TMDB e tradução.
- Jellyfin/PugotiCine: `getJellyfinDb`, `cineMatch` e funções de títulos comparáveis.
- Biblioteca/listas: handlers `/api/library` e `/api/lists/*` com SQL direto.
- Steam: tabelas de conexão/estado e handlers de OpenID, conquistas e guias.
- Frontend: funções de `public/app.js`; não há módulos de componentes separados.

Dependência principal: renderização chama `bind()` e `enhanceRenderedDom()` explicitamente. O backend centraliza regras, persistência e integrações; não há service layer independente. O `MutationObserver` global foi removido por custo de CPU/DOM no Firefox.

## Fluxos importantes

### Autenticação/bootstrap

1. Browser chama `/api/bootstrap`.
2. `requireUser` encaminha cookie a `PUGOTILAB_PROFILE_URL`.
3. O perfil define `req.userId`.
4. Bootstrap retorna dados filtrados por usuário sem aguardar sincronizações externas pesadas.
5. Frontend aplica `Object.assign(state, data)`, renderiza e aprimora o DOM explicitamente.
6. `refreshUserData()` atualiza Tasks, criadores/Steam IDs e progresso Steam em segundo plano.

### Pesquisa e detalhes

`/api/search` valida tamanho mínimo, escolhe IGDB ou TMDB e devolve objetos de catálogo. `/api/details` carrega detalhes, traduz overview, atualiza metadados da biblioteca quando já existe o item e pode consultar PugotiCine. O frontend abre detalhes por `data-details-*` e renderiza a mesma página dentro do shell.

### Biblioteca

`POST /api/library` faz upsert lógico pela chave única usuário/provedor/tipo/id, grava categoria e metadados; `PATCH` valida status, rating, favorito, notas e plataforma; `DELETE` remove item e tarefas órfãs. Nota ou review pode promover status a `completed`, salvo quando um status explícito é enviado.

### Listas e tarefas

Adicionar item valida dono e categoria, calcula posição, reutiliza/cria uma task na pasta `Assistir mais tarde` e grava `task_id`. Reordenação atualiza posições e tenta reordenar tarefas. Completar lista atualiza biblioteca e tasks vinculadas. Falhas externas de exclusão/reordenação são geralmente absorvidas; criação de task falha a operação.

### Steam

O início guarda estado OpenID; callback valida com Steam, extrai SteamID64 e salva vínculo por usuário. Conquistas requerem chave, Steam App ID e opcionalmente conexão do jogador; chamadas oficiais têm timeout de 10s. Guias consultam `IPublishedFileService` e usam cache em memória de 30 minutos.

## Pontos de entrada

- Processo: `src/server.ts` → `app.listen`.
- Build: `tsconfig.json` → `dist/server.js`.
- Browser: `public/index.html` → `public/app.js`.
- Container: `Dockerfile` (`npm run build`, `npm start`).
- Proxy: `portal-default.conf`/`portal-live.conf`.

## Onde modificar cada coisa

| Necessidade | Local primário |
|---|---|
| Layout, cores, responsividade | `public/styles.css` |
| Tela, card, detalhe, evento ou estado visual | `public/app.js` |
| Contrato de API/rota | `src/server.ts` handler correspondente |
| Regra de biblioteca/lista/status | handlers `/api/library` e `/api/lists` em `src/server.ts` |
| Entidade/campo SQLite | schema inicial e bloco de `PRAGMA table_info` em `src/server.ts` |
| Catálogo TMDB/IGDB | funções de integração no bloco de catálogo |
| Login/isolamento de usuário | `requireUser` e consultas com `user_id` |
| Steam | tabelas e rotas de integração Steam |
| Container/variáveis/volumes | `Dockerfile`, `docker-compose.yml` |
| Proxy/rotas de domínio | `portal-*.conf` |

## Dependências sensíveis

- `requireUser` é pré-condição de quase toda a API; remover ou alterar filtragem por `user_id` causa risco de exposição entre usuários.
- O schema é aplicado no boot e usa SQLite WAL/foreign keys; alterações precisam ser compatíveis com bancos existentes.
- `better-sqlite3` é nativo e o Docker instala compiladores para o build.
- `render()` substitui o DOM inteiro; listeners precisam ser reanexados por `bind()` e os aprimoramentos pós-render devem passar por `enhanceRenderedDom()` sem observer global.
- Bootstrap executa sincronizações externas; aumentar chamadas ou retirar timeouts pode deixar a UI bloqueada.
