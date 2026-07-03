-- 0004_harden_rpc.sql
-- Endurecimento das RPCs de troca (HANDOFF §8 / T8). NÃO edita migrations anteriores.
--
-- Problema (confirmado em teste): find_trade_matches e trade_preview são SECURITY DEFINER
-- e não validavam o chamador; além disso o Postgres/Supabase concede EXECUTE amplo por
-- padrão, então até um usuário ANÔNIMO (sem login) conseguia chamá-las passando o perfil
-- de outra pessoa e sondar a coleção alheia.
--
-- Correção:
--   1) exigir que auth.uid() seja dono do perfil consultado -> public.assert_owns() (já em 0003);
--   2) revogar EXECUTE de public/anon; deixar apenas authenticated.
-- Como assert_owns exige um perfil do próprio usuário, um anônimo é barrado de qualquer forma.

-- =========================================================
-- find_trade_matches: agora plpgsql, valida dono de p_profile antes de rodar o match.
-- (Corpo idêntico ao de 0003, só embrulhado em begin/return query.)
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
language plpgsql stable security definer set search_path = public as $$
-- colunas do RETURNS TABLE (display_name/city/uf) colidem com colunas homônimas
-- de profiles; use_column resolve a ambiguidade a favor da coluna.
#variable_conflict use_column
begin
  perform public.assert_owns(p_profile);
  return query
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
end $$;

-- =========================================================
-- trade_preview: agora plpgsql, valida dono de p_from (você só pré-preenche trocas SUAS).
-- =========================================================
create or replace function public.trade_preview(p_from uuid, p_to uuid)
returns table (offered text[], requested text[])
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.assert_owns(p_from);
  return query
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
end $$;

-- =========================================================
-- Permissões: tirar de public/anon, manter só authenticated.
-- (revoke de public E anon cobre tanto o grant default do Postgres quanto o do Supabase.)
-- =========================================================
revoke execute on function public.find_trade_matches(uuid,text,text,boolean,int) from public, anon;
revoke execute on function public.trade_preview(uuid,uuid)                        from public, anon;
revoke execute on function public.assert_owns(uuid)                               from public, anon;
grant  execute on function public.find_trade_matches(uuid,text,text,boolean,int)  to authenticated;
grant  execute on function public.trade_preview(uuid,uuid)                        to authenticated;
