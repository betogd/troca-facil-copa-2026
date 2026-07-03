-- 0005_trade_messages.sql
-- Chat por troca: depois que uma solicitação é ACEITA, os dois lados trocam
-- mensagens para combinar o encontro. (Evolução §9 do HANDOFF: threads por troca.)

create table if not exists public.trade_messages (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references public.trade_requests(id) on delete cascade,
  sender_profile uuid not null references public.profiles(id)        on delete cascade,
  body           text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at     timestamptz not null default now()
);
create index if not exists idx_tm_thread on public.trade_messages (request_id, created_at);

alter table public.trade_messages enable row level security;

-- Ler: qualquer um dos dois lados da troca (pelo dono do perfil).
drop policy if exists tm_read on public.trade_messages;
create policy tm_read on public.trade_messages
  for select using (
    exists (
      select 1
      from public.trade_requests r
      join public.profiles p on p.id in (r.from_profile, r.to_profile)
      where r.id = request_id and p.owner_id = auth.uid()
    )
  );

-- Escrever: só como um perfil MEU, que é parte da troca, e só se a troca foi ACEITA.
drop policy if exists tm_insert on public.trade_messages;
create policy tm_insert on public.trade_messages
  for insert with check (
    exists (select 1 from public.profiles p
            where p.id = sender_profile and p.owner_id = auth.uid())
    and exists (
      select 1 from public.trade_requests r
      where r.id = request_id
        and r.status = 'accepted'
        and sender_profile in (r.from_profile, r.to_profile)
    )
  );

grant select, insert on public.trade_messages to authenticated;

-- Realtime da conversa (nova mensagem aparece na hora).
-- (Não é idempotente; ao reexecutar, ignore o erro "already member".)
alter publication supabase_realtime add table public.trade_messages;
