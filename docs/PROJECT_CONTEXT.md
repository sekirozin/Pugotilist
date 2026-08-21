# PugotiList — contexto do projeto

## O que é

Aplicação web de biblioteca pessoal ligada à identidade PugotiLab. Permite pesquisar catálogos, adicionar obras, avaliar de 0 a 5 estrelas em meios pontos, favoritar, escrever reviews, separar jogos/filmes/séries/animes, acompanhar status, criar listas ordenadas e sincronizar tarefas de “Assistir mais tarde” com PugotiTasks. Também exibe detalhes, situação de séries/animes, recomendações e, para jogos associados à Steam, conquistas e guias da comunidade.

O catálogo de jogos vem do IGDB; filmes/séries vêm do TMDB. O armazenamento da biblioteca é por usuário e não contém dados reais no código.

## Stack e infraestrutura

- TypeScript compilado por `tsc`, Node.js >=20 e Express 4.
- Frontend vanilla: `public/index.html`, `public/app.js` e `public/styles.css`; não há React/Vue/Angular.
- SQLite via `better-sqlite3`, arquivo definido por `DB_FILE`.
- Produção em imagem Docker Node 20 Alpine; container expõe 3020 internamente e o compose publica 3021.
- Reverse proxy de referência em `portal-default.conf`/`portal-live.conf`; `list.pugotilab.com` encaminha para `pugotilist:3020`.
- Volumes de produção confirmados no compose: `/DATA/AppData/pugotilist/data` para banco e volume somente leitura do banco Jellyfin.

## Fluxo principal

```text
Usuário → public/app.js → /api/* → requireUser
       → perfil PugotiLab por cookie → regras em server.ts
       → SQLite / APIs TMDB, IGDB, Steam, Jellyfin, PugotiTasks
       → JSON → renderização DOM
```

`GET /api/bootstrap` carrega perfil, biblioteca, listas, estado Steam e disponibilidade de provedores e responde antes das sincronizações externas pesadas. `refreshUserData()` atualiza Tasks, criadores, IDs Steam e progresso de conquistas em segundo plano. O frontend renderiza o shell, registra listeners diretamente no DOM e chama `enhanceRenderedDom()` após cada renderização.

## Funcionalidades atuais

- Pesquisa de jogos (`game`) no IGDB e filmes/séries (`movie`/`tv`) no TMDB; `anime` usa TMDB com filtragem de categoria.
- Biblioteca por usuário com status `planned`, `in_progress`, `completed` e `abandoned`.
- Notas inteiras de 0–10, apresentadas como 0–5 estrelas com meio ponto; favorito e review em texto.
- Detalhes traduzidos quando possível, posters/backdrops, criador, plataformas, gêneros, situação da obra e correspondência com PugotiCine/Jellyfin.
- Navegação de Jogos, Filmes, Séries, Animes, Favoritos, Concluídos, Quero conhecer, Jogando agora e Acompanhando.
- Listas customizadas com categoria, ícone, cor, ordenação drag-and-drop e integração opcional PugotiTasks.
- Recomendações separadas por categoria usando obras avaliadas como sementes; limite apresentado no frontend é 18 por grupo.
- Steam: OpenID para vincular conta, Steam Web API para conquistas e consulta de guias da Comunidade Steam.
- Xbox: conexão Microsoft OAuth/Xbox Live implementada, com identificação de XUID/gamertag, refresh token cifrado por usuário e aba de conquistas Xbox nos detalhes dos jogos; depende das credenciais do aplicativo no ambiente.
- Plataforma jogada armazenada como `steam`, `playstation`, `xbox`, `nintendo` ou vazio. Isso é metadado manual; não implica sincronização de console.

## Frontend

`public/app.js` mantém um objeto `state` global e funções de composição/renderização. `render()` substitui o conteúdo de `#app`; `bind()` instala os listeners. A API usa `fetch` relativo, com prefixo `/list` quando a aplicação está sob esse caminho. O seletor de pesquisa e atalhos `/j`, `/f`, `/s`, `/a` alteram `state.type`.

Cards, detalhes, reviews, estrelas, favoritos, menus e listas são HTML string + listeners. `public/styles.css` concentra tokens, layout responsivo, cards, detalhes, modais, listas e estados. O HTML referencia `ambient-effects.js`, mas esse arquivo não existe no repositório analisado: origem/deploy atual é **NÃO CONFIRMADO**.

## Backend e rotas

Todas as rotas de dados usam `requireUser`, exceto `/health` e arquivos estáticos. Principais endpoints em `src/server.ts`:

- `GET /api/bootstrap`, `POST /api/sync/tasks`;
- `GET /api/search`, `GET /api/recommendations`, `GET /api/details`;
- `POST/PATCH/DELETE /api/library`;
- `POST/GET/PATCH/DELETE /api/lists`, itens, reorder e complete;
- `GET /api/integrations/steam/connect`, callback e delete;
- `GET /api/games/:id/achievements` e `/guides`.

Não há camadas separadas de controllers/services: handlers e funções de domínio vivem no `server.ts`.

## Banco de dados

SQLite é inicializado no startup com `CREATE TABLE IF NOT EXISTS` e alterações incrementais via `PRAGMA table_info` + `ALTER TABLE`. Entidades principais: `library_items`, `custom_lists`, `custom_list_items`, `overview_translations`, `user_steam_connections`, `steam_openid_states`. Há índices por usuário/status e favorito, chaves únicas por usuário/provedor/tipo/id e foreign keys nas listas.

Campos adicionais da biblioteca incluem plataforma jogada, criador, categoria, Steam App ID, progresso de conquistas e situação da obra. Não há diretório de migrations formal.

## Autenticação e autorização

`requireUser` chama `PUGOTILAB_PROFILE_URL`, encaminhando o header `cookie` recebido. O endpoint deve devolver um perfil com `username` e `id`, `userId` ou username utilizável como identificador. O `userId` é colocado na requisição e toda consulta/mutação de biblioteca/listas filtra por ele. Falha de perfil retorna 401; falha de comunicação retorna 503. Login é delegado a `PUGOTILAB_LOGIN_URL`. Fluxos OpenID Steam usam estado aleatório persistido e expiração de 10 minutos.

Permissões administrativas não aparecem implementadas no PugotiList; autorização confirmada é isolamento por `user_id`.

## Integrações e configuração

Variáveis (somente nomes): `PORT`, `DB_FILE`, `PUBLIC_DIR`, `NODE_ENV`, `PUBLIC_ORIGIN`, `PUGOTILAB_PROFILE_URL`, `PUGOTILAB_LOGIN_URL`, `TMDB_READ_TOKEN`, `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, `STEAM_WEB_API_KEY`, `PUGOTITASKS_API_URL`, `PUGOTITASKS_API_TOKEN`, `JELLYFIN_DB_FILE`, `JELLYFIN_SERVER_ID`, `TZ`.

TMDB usa `language=pt-BR`; IGDB usa OAuth Twitch; Steam usa OpenID/Web API; Jellyfin é lido de cópia/cache SQLite somente leitura; PugotiTasks usa Bearer token e endpoints de tarefas. Escopos, limites de uso e credenciais reais são **NÃO CONFIRMADO** pelo repositório.

## Desenvolvimento, build e deploy

Local: `npm install`, `npm run dev`; produção: `npm run build` e `npm start`. Docker executa build TypeScript dentro da imagem e remove devDependencies. Compose injeta configuração, monta dados e reinicia o container. Procedimentos operacionais de CI/CD, migrations externas, backups e healthchecks do proxy são **NÃO CONFIRMADO** além do que aparece nos arquivos Docker/compose.

## Limitações e cuidados

- `server.ts` é um módulo grande e centralizado; alterações têm impacto amplo.
- O status pode ser promovido para concluído quando há nota/review e também é sincronizado com PugotiTasks.
- Conquistas automáticas estão disponíveis para Steam e, com a configuração Xbox ativa, para jogos associados a um Xbox title ID; PlayStation/Nintendo permanecem apenas como metadados.
- A integração Xbox permanece desativada até configurar `XBOX_CLIENT_ID`, `XBOX_CLIENT_SECRET` e `XBOX_TOKEN_ENCRYPTION_KEY` no ambiente de produção.
- Chamadas externas de atualização ocorrem em segundo plano após bootstrap; preserve timeouts e tratamento de falhas para não bloquear a entrada.
- O `MutationObserver` global foi removido em 16/08/2026 por causar trabalho excessivo no Firefox; não reintroduzi-lo sem medição.
- Não confundir o banco principal com o cache Jellyfin.
