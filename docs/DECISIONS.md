# Decisões técnicas preservadas

## Aplicação monolítica Express + frontend vanilla

### Estado atual

API, regras, integrações e servidor de arquivos estão em `src/server.ts`; o frontend é HTML/CSS/JavaScript sem framework.

### Evidências no projeto

`package.json` contém apenas Express/better-sqlite3 como dependências de runtime; `public/app.js` mantém `state`, `render()` e `bind()`.

### Impacto

Alterações de tela normalmente não exigem novo sistema de componentes ou bundler.

### Cuidados

Motivação original: **NÃO CONFIRMADA**. Não introduzir framework ou separar serviços sem decisão explícita.

## SQLite local por usuário

### Estado atual

`better-sqlite3` abre `DB_FILE`; entidades e evoluções incrementais são declaradas no startup. Todas as consultas de dados do usuário filtram `user_id`.

### Evidências no projeto

`src/server.ts`, `library_items`, `custom_lists`, `custom_list_items` e índices `idx_library_user_*`.

### Impacto

Não existe ORM, camada de migrations ou banco remoto no código.

### Cuidados

Preservar constraints, foreign keys e compatibilidade de colunas antigas. Motivação original: **NÃO CONFIRMADA**.

## Identidade central PugotiLab por cookie

### Estado atual

O serviço não implementa senha própria. `requireUser` encaminha o cookie para `PUGOTILAB_PROFILE_URL`; login usa `PUGOTILAB_LOGIN_URL`.

### Evidências no projeto

Função `requireUser`, variáveis do compose e respostas 401/503.

### Impacto

Toda rota protegida depende da disponibilidade e do formato do perfil central.

### Cuidados

Não armazenar credenciais locais nem substituir o mecanismo sem revisar todas as rotas. Motivação original: **NÃO CONFIRMADA**.

## Integrações por adaptadores no mesmo módulo

### Estado atual

TMDB, IGDB, Steam, Jellyfin, PugotiTasks e PugotiCine são acessados por funções próximas aos handlers, usando `fetch`, cache pontual e SQLite.

### Evidências no projeto

Funções `search*`, `details*`, `recommend*`, `tasksApi`, `getJellyfinDb`, `cineMatch` e rotas Steam.

### Impacto

Mudanças em uma integração podem afetar bootstrap, detalhes, recomendações ou listas.

### Cuidados

Manter tratamento de falhas e timeouts; não assumir que um provedor externo está disponível. Motivações originais: **NÃO CONFIRMADAS**.

## Status e avaliação representam fases diferentes

### Estado atual

`status` usa `planned`, `in_progress`, `completed`, `abandoned`; `rating`/`notes` indicam consumo e podem promover a obra a concluída. Situação editorial de séries/animes fica em `work_situation`.

### Evidências no projeto

Constraints de `library_items`, `PATCH /api/library/:id`, `workSituation` e sincronização PugotiTasks.

### Impacto

Filtros do frontend e recomendações dependem dessas distinções.

### Cuidados

Não tratar “Em hiato” ou “Em andamento” como automaticamente não avaliado; não apagar a regra de promoção por review sem revisar listas/tasks. Motivação original: **NÃO CONFIRMADA**.

## Steam é a única sincronização automática de conquistas

### Estado atual

Steam OpenID/Web API fornece vínculo, progresso, conquistas e guias. `play_platform` aceita outras plataformas, mas não há adaptadores equivalentes implementados.

### Evidências no projeto

`user_steam_connections`, `steam_openid_states`, `steam_app_id`, rotas `/api/games/:id/achievements` e `/guides`.

### Impacto

Uma plataforma selecionada no card não implica autenticação ou progresso sincronizado.

### Cuidados

Não prometer suporte a troféus/conquistas PlayStation, Xbox ou Nintendo sem integração específica e análise de segurança. Motivação original: **NÃO CONFIRMADA**.

## Bootstrap não bloqueia a interface com sincronizações externas

### Estado atual

`GET /api/bootstrap` retorna os dados básicos imediatamente. A função `refreshUserData()` executa sincronização PugotiTasks, preenchimento de metadados e progresso Steam em segundo plano.

### Evidências no projeto

`src/server.ts`, função `refreshUserData()` e handler `/api/bootstrap`.

### Impacto

Falhas ou lentidão de TMDB, IGDB, AniList, Steam ou PugotiTasks não devem impedir a primeira renderização da biblioteca.

### Cuidados

Não mover chamadas externas pesadas de volta para o caminho síncrono do bootstrap sem medir o tempo de entrada e os timeouts.

## Aprimoramentos do DOM explícitos, sem MutationObserver global

### Estado atual

`public/app.js` chama `enhanceRenderedDom()` uma vez após `render()`. O observador que acompanhava toda a subárvore de `#app` foi removido.

### Evidências no projeto

`public/app.js`, função `enhanceRenderedDom()` e final de `render()`.

### Impacto

Reduz trabalho repetido no thread principal e evita que mutações de cards/menus provoquem ciclos de observação no Firefox.

### Cuidados

Novos elementos criados por uma mudança devem ser aprimorados explicitamente ou durante o render; não adicionar um observer global sem demonstrar necessidade e medir impacto.
