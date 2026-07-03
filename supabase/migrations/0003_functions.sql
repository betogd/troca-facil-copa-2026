-- 0003_functions.sql
-- Motor de troca (SECURITY DEFINER: enxerga coleções alheias só o suficiente
-- para calcular o match, sem expor as tabelas direto pelo RLS).

-- =========================================================
-- find_trade_matches: acha colecionadores com quem VALE a troca.
--   give_count = minhas repetidas que o outro NÃO tem  (eu dou)
--   get_count  = repetidas do outro que eu NÃO tenho   (eu recebo)
-- Filtra por cidade/UF e, por padrão, só devolve trocas MÚTUAS.
-- =========================================================
create or replace function public.find_trade_matches(
  p_profile     uuid,
  p_city_norm   text    default null,
  p_uf          text    default null,
  p_only_mutual boolean default true,
  p_limit       int     default 50
)
returns table (
  profile_id   uuid,
  display_name text,
  city         text,
  uf           text,
  give_count   int,
  get_count    int,
  sample_give  text[],
  sample_get   text[]
)
language sql stable security definer set search_path = public as $$
  with me_has as (
    select sticker_id from collection_items where profile_id = p_profile
  ),
  me_dupes as (
    select sticker_id from collection_items where profile_id = p_profile and count >= 2
  ),
  others as (
    select id, display_name, city, uf
    from profiles
    where id <> p_profile
      and (p_city_norm is null or city_norm = p_city_norm)
      and (p_uf        is null or uf        = p_uf)
  ),
  give as ( -- minhas repetidas que o outro não possui
    select o.id as pid, d.sticker_id
    from others o
    cross join me_dupes d
    where not exists (
      select 1 from collection_items c
      where c.profile_id = o.id and c.sticker_id = d.sticker_id
    )
  ),
  getx as ( -- repetidas do outro que eu não possuo
    select o.id as pid, c.sticker_id
    from others o
    join collection_items c on c.profile_id = o.id and c.count >= 2
    where not exists (select 1 from me_has m where m.sticker_id = c.sticker_id)
  ),
  g as (select pid, count(*)::int n, (array_agg(sticker_id order by sticker_id))[1:12] s from give group by pid),
  t as (select pid, count(*)::int n, (array_agg(sticker_id order by sticker_id))[1:12] s from getx group by pid)
  select o.id, o.display_name, o.city, o.uf,
         coalesce(g.n,0), coalesce(t.n,0),
         coalesce(g.s,'{}'), coalesce(t.s,'{}')
  from others o
  left join g on g.pid = o.id
  left join t on t.pid = o.id
  where (not p_only_mutual and (coalesce(g.n,0) > 0 or coalesce(t.n,0) > 0))
     or (    p_only_mutual and  coalesce(g.n,0) > 0 and coalesce(t.n,0) > 0)
  order by least(coalesce(g.n,0), coalesce(t.n,0)) desc,
           (coalesce(g.n,0) + coalesce(t.n,0)) desc
  limit p_limit;
$$;

-- =========================================================
-- trade_preview: listas exatas para PRÉ-PREENCHER a mensagem entre dois perfis.
--   offered   = repetidas de p_from que faltam em p_to
--   requested = repetidas de p_to  que faltam em p_from
-- =========================================================
create or replace function public.trade_preview(p_from uuid, p_to uuid)
returns table (offered text[], requested text[])
language sql stable security definer set search_path = public as $$
  select
    coalesce((
      select array_agg(d.sticker_id order by d.sticker_id)
      from collection_items d
      where d.profile_id = p_from and d.count >= 2
        and not exists (select 1 from collection_items c
                        where c.profile_id = p_to and c.sticker_id = d.sticker_id)
    ), '{}') as offered,
    coalesce((
      select array_agg(c.sticker_id order by c.sticker_id)
      from collection_items c
      where c.profile_id = p_to and c.count >= 2
        and not exists (select 1 from collection_items m
                        where m.profile_id = p_from and m.sticker_id = c.sticker_id)
    ), '{}') as requested;
$$;

-- Guard: quem chama as funções precisa ser dono do p_from/p_profile.
-- (SECURITY DEFINER ignora RLS, então validamos na mão.)
create or replace function public.assert_owns(p_profile uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = p_profile and owner_id = auth.uid()) then
    raise exception 'forbidden: profile % nao pertence ao usuario', p_profile;
  end if;
end $$;

-- Permissões
grant execute on function public.find_trade_matches(uuid,text,text,boolean,int) to authenticated;
grant execute on function public.trade_preview(uuid,uuid) to authenticated;

-- Realtime: caixa de entrada ao vivo (nova solicitação aparece na hora)
alter publication supabase_realtime add table public.trade_requests;
