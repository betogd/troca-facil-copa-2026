# web/

Frontend estático (sem build). Servir por HTTP — ES modules e auth não rodam via `file://`.

- `index.html` — telas de setup / login / álbum. Carrega `config.js` (clássico) e `app.js` (módulo).
- `app.js` — client Supabase, auth (magic link), perfis e coleção no banco.
- `catalog.js` — catálogo canônico das 980 figurinhas (`SPECIALS`, `TEAMS`, `ORDER` + mapas derivados). `ORDER` é a fonte da ordem usada pelo código C26.
- `config.example.js` → copie para `config.js` (fora do git) e preencha `window.SUPABASE_URL` / `window.SUPABASE_ANON_KEY`.
- `legacy-local.html` — versão offline anterior (localStorage). Referência de UI; não é carregada pelo app.

Setup e deploy completos no [README da raiz](../README.md).
