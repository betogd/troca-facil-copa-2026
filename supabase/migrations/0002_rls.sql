-- 0002_rls.sql
-- Row Level Security. Regra de ouro:
--  * cada um só mexe no que é seu;
--  * a coleção dos outros NÃO é lida direto -> só via funções (0003) para
--    o match, o que evita baixar a base inteira no cliente e dá controle fino.

alter table public.stickers          enable row level security;
alter table public.profiles          enable row level security;
alter table public.collection_items  enable row level security;
alter table public.trade_requests    enable row level security;

-- ---- stickers: catálogo público (qualquer autenticado lê) ----
drop policy if exists stickers_read on public.stickers;
create policy stickers_read on public.stickers
  for select using (true);

-- ---- profiles: dono gerencia os seus; diretório visível a autenticados ----
drop policy if exists profiles_owner_all on public.profiles;
create policy profiles_owner_all on public.profiles
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select using (auth.role() = 'authenticated');

-- ---- collection_items: SÓ o dono lê/escreve. Match vem por RPC (0003). ----
drop policy if exists ci_owner_all on public.collection_items;
create policy ci_owner_all on public.collection_items
  for all
  using (exists (select 1 from public.profiles p
                 where p.id = profile_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.profiles p
                      where p.id = profile_id and p.owner_id = auth.uid()));

-- ---- trade_requests: remetente e destinatário enxergam a conversa ----
drop policy if exists tr_read on public.trade_requests;
create policy tr_read on public.trade_requests
  for select using (
    exists (select 1 from public.profiles p
            where p.id in (from_profile, to_profile) and p.owner_id = auth.uid())
  );

drop policy if exists tr_insert on public.trade_requests;
create policy tr_insert on public.trade_requests
  for insert with check (
    exists (select 1 from public.profiles p
            where p.id = from_profile and p.owner_id = auth.uid())
  );

drop policy if exists tr_update on public.trade_requests;
create policy tr_update on public.trade_requests
  for update using (
    exists (select 1 from public.profiles p
            where p.id in (from_profile, to_profile) and p.owner_id = auth.uid())
  );
