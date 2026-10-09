-- Daily ceilings on what reaches the model, per organization.
--
-- The site is public and the model runs on a free quota that one busy day can
-- spend. Each thing that can call the model is counted when it's asked for:
-- a run (which labels files), an explanation, a question. Past the ceiling the
-- request is refused with the limit stated, before any model call is made.
-- Days are UTC.

create table public.usage (
  organization_id text not null references public.organizations (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('run', 'explain', 'ask')),
  count integer not null check (count >= 0),
  primary key (organization_id, day, kind)
);

-- Members can see their organization's counts. Nobody writes them directly:
-- only spend() below does, so a count can't be reset from the browser.
revoke all on public.usage from anon, authenticated;
grant select on public.usage to authenticated;

create policy "members read their organization's rows"
  on public.usage for select to authenticated
  using (organization_id = (select private.current_org_id()));

-- ---------------------------------------------------------------------------
-- Spending one, as the signed-in member.
--
-- Security definer because members may not write counts. The organization is
-- the one on the caller's own token, never an argument. Only authenticated may
-- call it: an access key reads as anon, and anon calls no model.
--
-- Returns the ceiling when the request is refused, null when it may go ahead.
-- ---------------------------------------------------------------------------

create or replace function public.spend(p_kind text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  org text := private.current_org_id();
  ceiling integer := case p_kind when 'run' then 10 when 'explain' then 100 when 'ask' then 30 end;
  spent integer;
begin
  if org is null then raise exception 'No organization on this session'; end if;
  if ceiling is null then raise exception 'Unknown kind: %', p_kind; end if;

  -- Clerk owns organizations; the row exists only so usage can point at it.
  insert into public.organizations (id) values (org) on conflict do nothing;

  -- One statement, so two requests at once can't both take the last one.
  insert into public.usage as u (organization_id, day, kind, count)
  values (org, (now() at time zone 'utc')::date, p_kind, 1)
  on conflict (organization_id, day, kind) do update
    set count = u.count + 1
    where u.count < ceiling
  returning u.count into spent;

  return case when spent is null then ceiling end;
end;
$$;

revoke execute on function public.spend(text) from public, anon, authenticated;
grant execute on function public.spend(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Same refusal as every migration: no table in public without RLS or without
-- a policy.
-- ---------------------------------------------------------------------------

do $$
declare
  offenders text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into offenders
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and (
      not c.relrowsecurity
      or not exists (select 1 from pg_policy p where p.polrelid = c.oid)
    );

  if offenders is not null then
    raise exception 'tables in public without RLS or without a policy: %', offenders;
  end if;
end;
$$;
