# PugotiList — manual operacional

## Visão geral

PugotiList é um catálogo pessoal autenticado pelo PugotiLab para pesquisar, organizar, avaliar e acompanhar jogos, filmes, séries e animes. É uma aplicação web monolítica: frontend DOM/HTML/CSS servido pelo mesmo processo Node/Express e API REST com SQLite.

Stack confirmada: TypeScript, Node.js 20+, Express 4, better-sqlite3, SQLite, TMDB, IGDB/Twitch e Steam Web API.

## Estrutura essencial

```text
src/server.ts       API, autenticação, regras, integrações e acesso SQLite
public/index.html   shell HTML e entradas de assets
public/app.js       frontend em JavaScript sem framework
public/styles.css   design system e layout
package.json        scripts e dependências
Dockerfile          build de produção
docker-compose.yml  container, volumes, rede e variáveis
portal-*.conf       proxy/reverse proxy de referência
```

## Comandos reais

```bash
npm install
npm run dev       # tsx watch
npm run build     # tsc para dist/
npm run check     # tsc --noEmit
npm start         # node dist/server.js
```

Não há script de lint, testes automatizados ou migrations dedicadas confirmados no repositório.

## Regras para agentes

- Preserve a arquitetura e os padrões já usados; procure implementações equivalentes antes de criar novas.
- Evite duplicação, novas dependências e substituição de bibliotecas sem justificativa.
- Não altere autenticação sem analisar `requireUser`, o cookie encaminhado e o fluxo PugotiLab completo.
- Não altere schema/migrações ou infraestrutura sem necessidade explícita; o schema é evoluído no startup.
- Não remova funcionalidades como efeito colateral e não exponha credenciais, tokens ou dados reais.
- Execute `npm run check` e `npm run build` quando a alteração permitir; revise `git diff`/status ao final.
- Não faça `git commit` nem `git push`.
- Não modifique `.env`, segredos, Docker/deploy ou servidor sem solicitação explícita.

Antes de mudanças significativas, leia `docs/PROJECT_CONTEXT.md` e `docs/ARCHITECTURE.md`. Para decisões existentes, consulte também `docs/DECISIONS.md`.
