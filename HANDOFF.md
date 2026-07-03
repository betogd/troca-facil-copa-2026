# HANDOFF — Copa 26 · Trocas de Figurinhas

> **Para o agente (Claude no desktop / Claude Code):** você está assumindo um projeto
> já começado. **Leia este arquivo inteiro antes de tocar em qualquer coisa.** O backend
> (Supabase) já existe e está correto — **não recrie SQL**. Seu trabalho é organizar o repo,
> construir o frontend em `web/` e ligar tudo. Trabalhe em pequenos passos, rode o smoke
> test ao fim de cada tarefa, e deixe `TODO(roberto):` onde faltar um dado que só ele tem.

---

## 0. Missão

App de coleção e **troca** de figurinhas do álbum FIFA Copa do Mundo 2026 (Panini, 980 figurinhas).
O colecionador marca o que tem/o que está repetido; o app encontra pessoas **na mesma cidade**
com quem vale a troca e permite **mandar uma solicitação já preenchida** com o que cada lado dá e recebe.

---

## 1. Bloqueadores (dependem do Roberto — deixe `TODO` e siga o que der)

Nada disto impede começar o `web/`; use placeholders.

- `SUPABASE_URL` e `SUPABASE_ANON_KEY` (Settings → API). A anon key é **publicável**. **Nunca** usar `service_role` no cliente.
- **Coleção do Roberto:** o **código C26** gerado pelo app atual (aba Trocar) — para semear o perfil dele (ver §7).
- URL do repositório GitHub (para o `git remote`).

Coloque as duas chaves em `web/config.js` (a partir de `.env.example`). Esse arquivo é **git-ignored**.

---

## 2. O que JÁ existe (não recriar — referencie)

| Arquivo | Papel |
|---|---|
| `supabase/migrations/0001_schema.sql` | Tabelas + índices: `stickers`, `profiles`, `collection_items`, `trade_requests` |
| `supabase/migrations/0002_rls.sql` | Row Level Security (coleção alheia é privada; match sai só via RPC) |
| `supabase/migrations/0003_functions.sql` | RPCs `find_trade_matches`, `trade_preview`, helper `assert_owns`, Realtime, grants |
| `supabase/seed/0001_stickers_seed.sql` | As **980** figurinhas (idempotente) |
| `web/legacy-local.html` | **UI de referência** (versão offline atual). Reaproveite o visual, o grid de slots e a lógica de código C26. Contém a array canônica `const ORDER=[...]` (980 ids) usada pelo código C26 — **é a fonte da ordem**, não redefina. |
| `README.md` | Setup + arquitetura resumida |
| `.env.example` | Modelo do `web/config.js` |

---

## 3. Stack e princípios (invioláveis)

- **Frontend estático**, sem build: `index.html` + módulos JS + `@supabase/supabase-js` via ESM CDN (`https://esm.sh/@supabase/supabase-js@2`). Hospedável em GitHub Pages / Cloudflare Pages.
- **Supabase é a fonte da verdade** da coleção. `localStorage` só como cache opcional/otimista — nunca como armazenamento principal.
- **RLS não se afrouxa.** Coleção de terceiros só é lida por RPC `security definer`. O cliente nunca faz `select` na `collection_items` de outro perfil.
- **`service_role` jamais** vai ao cliente.
- Preservar o **look & feel** e a acessibilidade do `legacy-local.html` (mobile-first, foco visível, `prefers-reduced-motion`).
- Português (pt-BR) em toda a UI.

---

## 4. Decisões congeladas (padrão recomendado — troque no cabeçalho de `web/app.js` se quiser)

1. **Auth:** e-mail **magic link** (sem senha). O responsável cria a conta e cadastra os filhos como **perfis**.
2. **Perfis:** uma conta (`auth.users`) → **vários** perfis de colecionador. Descoberta e mensagem no nível do perfil; contato real mediado pela conta do responsável.
3. **Cidade:** texto `city` + `uf`, com `city_norm` (minúsculo, sem acento) calculado na escrita. Filtro padrão = **cidade exata**, com botão **"abrir para o estado (UF)"**.
4. **Match:** só trocas **mútuas** (dá **e** recebe) por padrão; toggle para incluir unidirecionais.
5. **Alcance:** MVP **aberto por cidade**. Segurança vem do desenho: perfis expõem só `display_name` + `city/uf` (sem contato pessoal, sem localização precisa); toda mensagem fica in-app e ancorada na conta adulta. *(Evolução opcional em §9: grupos por convite.)*

---

## 5. Contrato de dados (confira contra os arquivos, não invente)

**Tabelas** (ver `0001_schema.sql`): 
- `profiles(id, owner_id, display_name, city, city_norm, uf, created_at)` 
- `collection_items(profile_id, sticker_id, count>=1, updated_at)` — falta = ausência de linha; repetida = `count>=2`. 
- `trade_requests(id, from_profile, to_profile, message, offered text[], requested text[], status, ...)` — `offered/requested` são snapshot no envio.

**RPCs** (ver `0003_functions.sql`):
```
find_trade_matches(p_profile uuid, p_city_norm text, p_uf text, p_only_mutual boolean, p_limit int)
  -> (profile_id, display_name, city, uf, give_count, get_count, sample_give text[], sample_get text[])

trade_preview(p_from uuid, p_to uuid) -> (offered text[], requested text[])
```
O cliente deve **normalizar** o texto da cidade do mesmo jeito que `city_norm` antes de passar em `p_city_norm`.

---

## 6. Tarefas (em ordem; rode o smoke test §10 ao fim de cada uma)

**T1 · Provisionar Supabase.** Rodar no SQL Editor, nesta ordem: `0001` → `0002` → `0003` → `seed/0001`. Confirmar `select count(*) from stickers` = **980**. (`alter publication ... add table` não é idempotente; se reexecutar, ignore o erro "already member".)

**T2 · Esqueleto `web/`.** Criar `web/index.html`, `web/config.js` (a partir de `.env.example`, com `TODO`), `web/app.js` (ES modules). Instanciar o client: `createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)`. Portar tokens de CSS/estrutura do `legacy-local.html`.

**T3 · Auth (magic link).** Tela de entrada com e-mail → `signInWithOtp`. Guardar sessão; `onAuthStateChange` controla telas logado/deslogado. Sem sessão, só a tela de login.

**T4 · Perfis.** Ao logar, `select` dos `profiles` do `owner_id`. Permitir criar/renomear/selecionar (substitui o seletor de "Álbum de" do legacy). Ao criar/editar, gravar `city`, `uf` e `city_norm` (normalizado no cliente).

**T5 · Coleção do banco.** Carregar `collection_items` do perfil ativo e renderizar o grid (reaproveitar `legacy-local.html`). Marcar figurinha = **upsert** `collection_items` com `count` (debounce ~400ms; update otimista na UI). `count` cair a 0 = **delete** da linha. Recalcular KPIs (coladas/faltam/repetidas) a partir do banco.

**T6 · Aba "Procurar trocas".** Filtro de cidade (default = cidade do perfil) + toggle "estado inteiro" + toggle "só mútuas". Chamar `rpc('find_trade_matches', {...})`. Listar pessoas com `give_count`/`get_count` e os chips de `sample_give`/`sample_get`. Ordenação já vem da RPC.

**T7 · Solicitar troca.** No card de uma pessoa, botão "Solicitar troca" → `rpc('trade_preview', { p_from: meuPerfil, p_to: outro })` → abrir compositor com a mensagem **pré-preenchida**: "Tenho pra você: {offered}. Queria de você: {requested}." + campo editável → `insert` em `trade_requests` (com `offered`/`requested` do preview). Também oferecer "enviar no WhatsApp" (reaproveitar do legacy) como canal alternativo.

**T8 · Caixa de entrada + Realtime.** Aba "Mensagens": recebidas (`to_profile in meus perfis`) e enviadas. `subscribe` no canal Realtime de `trade_requests` filtrando pelos meus perfis → badge/toast ao chegar nova. Ações: **aceitar/recusar** = `update status`. Mostrar `offered`/`requested` com nome da figurinha (join local com o catálogo `stickers`, que pode ser carregado uma vez).

**T9 · Importar a coleção do Roberto.** Escrever um util que decodifica o **código C26** (§7) e faz upsert em `collection_items` do perfil dele. Se o código ainda não veio, deixar `TODO(roberto)` e um botão "Importar código C26" na UI que faz o mesmo em runtime.

**T10 · Deploy.** Publicar `web/` no GitHub Pages ou Cloudflare Pages. Documentar a URL no `README.md`. Conferir que `config.js` **não** foi versionado.

---

## 7. Formato do código C26 (para o importador da T9)

- String: `C26.` + **base64url** (`-`/`_`, sem `=`).
- Decodifica para bytes; **2 bits por figurinha**, na ordem de `ORDER` (extraia `const ORDER=[...]` de `web/legacy-local.html`).
- Para o índice `i` (0..979): `v = (bytes[i>>2] >> ((i&3)*2)) & 3`.
  - `v==0` → falta (não inserir linha).
  - `v==1` → tem 1 → `count=1`.
  - `v==2` → repetida → `count=2`.
- **Limitação conhecida:** o código só distingue "repetida" (≥2), não a quantidade exata. Se o Roberto quiser contagem exata de repetidas, peça um CSV `sticker_id,count` no lugar. Registre isso ao importar.

Pseudo:
```js
function decodeC26(code, ORDER){
  const b64 = code.replace(/^C26\./,'').replace(/-/g,'+').replace(/_/g,'/');
  const bin = atob(b64.padEnd(Math.ceil(b64.length/4)*4,'='));
  const rows = [];
  for (let i=0;i<ORDER.length;i++){
    const v = (bin.charCodeAt(i>>2) >> ((i&3)*2)) & 3;
    if (v>=1) rows.push({ sticker_id: ORDER[i], count: v>=2 ? 2 : 1 });
  }
  return rows; // upsert em collection_items
}
```

---

## 8. Correção de segurança obrigatória (fazer junto do frontend)

As RPCs são `security definer` e hoje **não** validam quem chama. Antes de expor a busca/mensagem, endureça:

- Em `find_trade_matches` e `trade_preview`, exigir que `auth.uid()` seja dono de `p_profile`/`p_from`. Converter para `plpgsql` e, no topo, `perform public.assert_owns(p_profile);` (o helper já existe em `0003`). Criar migration nova `0004_harden_rpc.sql` (não editar as anteriores). Sem isso, um usuário conseguiria sondar a coleção de terceiros passando outro `p_from`.

---

## 9. Evolução (fora do MVP — só documentar como próximos passos)

Grupos por convite (turma/escola) para busca fechada · wishlist explícita com prioridade · municípios IBGE + raio de distância · histórico/threads de conversa por troca · notificações push.

---

## 10. Critérios de aceite / smoke test

1. `stickers` = 980; login por magic link funciona; criar 2 perfis em contas diferentes.
2. Marcar figurinhas em cada perfil persiste no banco (recarregar mantém o estado).
3. Com repetidas/faltas complementares e **mesma cidade**, `find_trade_matches` retorna o par com `give_count` e `get_count` > 0.
4. "Solicitar troca" cria `trade_requests` com `offered`/`requested` corretos; a outra conta recebe em **realtime**; aceitar/recusar muda o `status`.
5. Importar o código C26 do Roberto reproduz a coleção dele (repetidas viram `count=2`).
6. `config.js` fora do git; nenhuma chave `service_role` no cliente; nenhum `select` direto em coleção alheia.

---

## 11. Como versionar

Este diretório já é um repo com commit inicial. Ao concluir tarefas, commits pequenos e descritivos. Para publicar:
```bash
git remote add origin git@github.com:SEU_USUARIO/copa26-trocas.git
git branch -M main
git push -u origin main
```
