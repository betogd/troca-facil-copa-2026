-- 0001_schema.sql
-- Estrutura base do app de troca de figurinhas (Copa 2026).
-- Postgres / Supabase.

create extension if not exists pgcrypto;

-- =========================================================
-- Referência: as 980 figurinhas do álbum (seed em supabase/seed).
-- =========================================================
create table if not exists public.stickers (
  id         text primary key,          -- 'BRA17', 'FWC1', '00'
  team_code  text not null,             -- 'BRA', 'FWC'
  team_name  text not null,             -- 'Brasil', 'Especiais'
  number     int  not null,             -- 0..20
  name       text not null,             -- nome do jogador / descrição
  kind       text not null              -- logo | photo | player | special
);

-- =========================================================
-- Perfis de colecionador.
-- Um "responsável" (auth.users) pode ter VÁRIOS perfis (ex.: cada filho).
-- Descoberta e mensagens acontecem no nível do perfil, mas sempre
-- ancoradas em owner_id -> mais seguro para crianças (adulto media contato).
-- =========================================================
create table if not exists public.profiles (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  city         text,                    -- exibição, ex.: 'Pato Branco'
  city_norm    text,                    -- normalizado (lower, sem acento) para filtro estável
  uf           text,                    -- 'PR'
  created_at   timestamptz not null default now()
);
create index if not exists idx_profiles_owner on public.profiles (owner_id);
create index if not exists idx_profiles_geo   on public.profiles (uf, city_norm);

-- =========================================================
-- Coleção: guardamos SÓ o que a pessoa tem (count >= 1).
-- "Falta" = ausência de linha para aquela figurinha.
-- "Repetida / disponível pra troca" = count >= 2.
-- =========================================================
create table if not exists public.collection_items (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  sticker_id  text not null references public.stickers(id),
  count       int  not null default 1 check (count >= 1),
  updated_at  timestamptz not null default now(),
  primary key (profile_id, sticker_id)
);
create index if not exists idx_ci_sticker on public.collection_items (sticker_id);
create index if not exists idx_ci_dupes   on public.collection_items (profile_id) where count >= 2;

-- =========================================================
-- Solicitações de troca (mensagens).
-- Auto-contidas: 'offered'/'requested' são um SNAPSHOT no momento do envio,
-- para a mensagem continuar fazendo sentido mesmo se as coleções mudarem.
-- =========================================================
create table if not exists public.trade_requests (
  id           uuid primary key default gen_random_uuid(),
  from_profile uuid not null references public.profiles(id) on delete cascade,
  to_profile   uuid not null references public.profiles(id) on delete cascade,
  message      text,
  offered      text[] not null default '{}',   -- figurinhas que o remetente oferece
  requested    text[] not null default '{}',   -- figurinhas que o remetente quer
  status       text not null default 'pending'
               check (status in ('pending','accepted','declined','cancelled')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_tr_inbox on public.trade_requests (to_profile, status);
create index if not exists idx_tr_sent  on public.trade_requests (from_profile, status);
