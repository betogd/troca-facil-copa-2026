# Troca Fácil · Copa 2026

App de coleção e **troca** de figurinhas do álbum FIFA Copa do Mundo 2026 (Panini, 980 figurinhas).
Cada colecionador marca o que tem / o que está repetido, e o app encontra outras pessoas
**na mesma cidade** com quem vale a troca — mostrando exatamente o que cada lado dá e recebe.

> Roteiro completo do projeto (tarefas T1–T10, decisões, contrato de dados) em [`HANDOFF.md`](HANDOFF.md).

## Stack

- **Backend:** Supabase (Postgres + Auth + Realtime + RLS). A lógica de match roda no banco.
- **Frontend:** site estático em `web/` (HTML + `supabase-js` via ESM CDN, **sem build**). Hospedável em GitHub Pages / Cloudflare Pages.
- **Dados:** catálogo das 980 figurinhas versionado no seed **e** em `web/catalog.js` (mesma ordem canônica).

## Estrutura

```
TrocaFacil/
├─ supabase/
│  ├─ migrations/
│  │  ├─ 0001_schema.sql        # tabelas + índices
│  │  ├─ 0002_rls.sql           # Row Level Security
│  │  ├─ 0003_functions.sql     # match, preview, realtime, grants
│  │  └─ 0004_harden_rpc.sql    # endurece as RPCs (§8/T8): assert_owns + revoke
│  └─ seed/
│     └─ 0001_stickers_seed.sql # as 980 figurinhas
├─ web/
│  ├─ index.html                # telas: setup · login · álbum
│  ├─ app.js                    # client Supabase, auth, perfis, coleção (ES module)
│  ├─ catalog.js                # catálogo canônico (SPECIALS, TEAMS, ORDER + mapas)
│  ├─ config.example.js         # modelo → copie para config.js (fora do git)
│  └─ legacy-local.html         # versão offline anterior (referência de UI)
├─ HANDOFF.md
└─ README.md
```

## Modelo de dados (resumo)

- `stickers` — catálogo (id ex.: `BRA17`, `FWC1`, `00`).
- `profiles` — colecionadores. Um `owner_id` (auth.users) pode ter **vários** perfis (um por filho).
- `collection_items` — só o que a pessoa **tem** (`count >= 1`). Falta = ausência de linha. Repetida = `count >= 2`.
- `trade_requests` — solicitações, com `offered`/`requested` congelados no envio.

## Setup

1. **Banco.** Crie um projeto no [Supabase](https://supabase.com). No **SQL Editor**, rode em ordem:
   `0001_schema.sql` → `0002_rls.sql` → `0003_functions.sql` → `0004_harden_rpc.sql` → `seed/0001_stickers_seed.sql`.
   Confirme: `select count(*) from stickers` = **980**.
   *(`alter publication … add table` em 0003 não é idempotente; ao reexecutar, ignore o erro "already member".)*
2. **Auth.** Em **Authentication → Providers**, habilite **Email** (magic link).
3. **Config do cliente.** Copie o modelo e preencha suas chaves (Supabase → Settings → API):
   ```bash
   cp web/config.example.js web/config.js
   # edite web/config.js: window.SUPABASE_URL e window.SUPABASE_ANON_KEY
   ```
   A **anon key** é publicável (fica no cliente). A **service_role** nunca vai ao frontend. `web/config.js` está no `.gitignore`.
4. **Rodar local.** Sirva `web/` por HTTP (ES modules e auth **não** funcionam via `file://`):
   ```bash
   npx serve web        # ou: python -m http.server 5500 --directory web
   ```
   Abra o endereço mostrado. Sem `config.js` válido, a tela de **setup** explica o que falta.
5. **Deploy.** Publique a pasta `web/` no GitHub Pages / Cloudflare Pages.

## Estado atual

Implementado no frontend (`web/`):

- [x] **T2** Esqueleto estático + client Supabase, visual portado do legacy.
- [x] **T3** Login por **magic link** (`signInWithOtp`, sessão via `onAuthStateChange`).
- [x] **T4** **Perfis** por conta: criar / renomear / selecionar, com `city`/`uf`/`city_norm`.
- [x] **T5** **Coleção no banco**: carrega `collection_items`, marca com upsert (debounce ~400ms, update otimista), zera com delete. KPIs a partir do banco.
- [x] **§8 (segurança)** RPCs endurecidas — migration `0004_harden_rpc.sql` (`assert_owns` + revoke de `public`/`anon`). *Aplicar no banco na ordem dos migrations.*

Próximos passos (ver `HANDOFF.md`):

- [ ] **T6** Aba **Procurar trocas** (filtro por cidade + `find_trade_matches`).
- [ ] **T7** **Solicitar troca** com mensagem pré-preenchida (`trade_preview` → `trade_requests`).
- [ ] **T8** Caixa de entrada em **realtime** (badge/toast em `trade_requests`).
- [ ] **T9** Importar a coleção do Roberto pelo **código C26** (decoder em `HANDOFF.md` §7; `ORDER` está em `web/catalog.js`).
- [ ] **T10** Deploy e documentar a URL.

## Segurança

RLS não é afrouxado: coleção de terceiros só sai agregada pelas RPCs `security definer`. O cliente nunca faz `select` direto em coleção alheia, e a `service_role` jamais vai ao frontend. As RPCs exigem que o chamador seja **dono** do perfil consultado (`assert_owns`, migration `0004`) e só rodam para usuários **autenticados** — um anônimo não consegue sondar coleções.
