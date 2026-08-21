# Contexto do Chat - PugotiList

## Histórico da Sessão

- **Data:** 15 de agosto de 2026
- **Resumo:** O usuário está usando o OpenCode para gerenciar o projeto PugotiList, que é uma aplicação web de catálogo pessoal para jogos, filmes, séries e animes. O usuário percebeu que o PugotiList parecia estar "quebrado" após alguma alteração não identifcada.

## Status Atual

- **Branch:** `glm-pugotilist`
- **Último commit:** "Estado atual antes do uso do OpenCode + GLM" (commit 8934980)
- **Estado do repositório:** Limpo (working tree clean), nada para commit
- **Problema identificado:** Diretório `dist/` não existe após tentativa de build do TypeScript
- **Ambiente:** Node.js NÃO disponível no ambiente atual, impedindo a execução de `npm run build` ou `npm start`

## Problema Atual

O usuário percebeu que parece que o PugotiList está "quebrado". Investigação inicial revelou que o diretório `dist/` (o build do TypeScript) não existe, o que indica que o servidor não pode ser iniciado.

Como o ambiente atual não tem Node.js instalado, é necessário rodar os comandos de build e start manualmente pelo usuário no seu terminal.

## Stack do Projeto

- **TypeScript** (versão 5.8.3)
- **Node.js** (versão >= 20)
- **Express** (versão 4.21.2)
- **better-sqlite3** (versão 12.2.0)
- **SQLite**
- **tsx** (versão 4.20.3)

## Estrutura do Projeto

```
/var/home/sekiro/Nextcloud/Pugotilab/pugotilist-server/
├── src/server.ts           # API, autenticação, regras, integrações e acesso SQLite
├── public/
│   ├── index.html          # shell HTML e entradas de assets
│   ├── app.js              # frontend em JavaScript sem framework
│   └── styles.css          # design system e layout
├── data/
│   └── pugotilist.db       # SQLite database (criado dinamicamente)
├── package.json            # scripts e dependências
├── Dockerfile              # build de produção
├── docker-compose.yml      # container, volumes, rede e variáveis
└── package-lock.json
```

## Scripts Disponíveis

```bash
npm install          # Instala as dependências
npm run dev          # Executa com tsx watch
npm run build        # Compila TypeScript para dist/
npm run check        # Verifica tipo TypeScript sem compilar
npm start            # Inicia o servidor (node dist/server.js)
```

## Funcionalidades Principais

1. **Library Management:** Rastreia itens com status (Planned, In Progress, Completed) e work situations (Ongoing, Hiatus, Canceled)
2. **Discovery & Search:** Browse catalog, search por título e tipo, recomendações personalizadas
3. **Recommendation System:** Sugestões baseadas em ratings
4. **Task Integration:** Sync com PugotiTasks
5. **Steam Integration:** Achievements e Guides

## Regras Importantes

- **Não alterar autenticação** sem analisar `requireUser`, cookie encaminhado e fluxo PugotiLab completo
- **Não alterar schema/migrações** sem necessidade explícita
- **Não remover funcionalidades** existentes
- **Não expor credenciais/tokens**
- **Executar `npm run check` e `npm run build`** quando possível
- **Não fazer git commit nem push**
- **Não modificar `.env`, segredos, Docker/deploy** sem solicitação explícita

## Atualização de desempenho — 16/08/2026

- A lentidão para entrar e o travamento completo no Firefox foram investigados no ambiente do ZimaOS.
- O container não estava saturado; o atraso principal vinha de `/api/bootstrap` aguardando sincronizações externas antes de responder.
- O backend agora responde primeiro com o estado básico e executa `refreshUserData()` em segundo plano.
- O `MutationObserver` global do frontend foi removido; `enhanceRenderedDom()` é chamado explicitamente ao fim de cada `render()`.
- O efeito de partículas/cometas permaneceu intacto, pois não era a causa principal.
- O build Docker, a recriação do serviço `pugotilist` e `/health` foram validados após a correção.

## Próximos Passos

1. Preservar o bootstrap assíncrono e o pós-render explícito.
2. Revalidar `/health`, login/bootstrap e pesquisa após mudanças.
3. Executar `npm run check`/`npm run build` quando o ambiente Node estiver disponível.

## Documentação de Referência

O projeto possui documentações adicionais:
- `docs/PROJECT_CONTEXT.md` - Contexto do projeto
- `docs/ARCHITECTURE.md` - Arquitetura da aplicação
- `docs/DECISIONS.md` - Decisões técnicas

## Notas

Este arquivo foi gerado automaticamente durante a sessão de chat atual para manter um registro do contexto do projeto e do estado da sessão.
