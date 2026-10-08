-- Access keys: how a coding agent reads its organization's maps over MCP.
--
-- A member creates one for their organization. Only its hash is stored; the
-- key itself is returned once, by the function that makes it. A request
-- carrying a key reads as anon with the key forwarded in the x-flowlens-key
-- header, and the organization claim then resolves to the key's organization.
-- So the policies members already read through decide what a key reads: no
-- second set of rules to keep in step with the first.

-- ---------------------------------------------------------------------------
-- The table. Members see a key's name and dates, never its hash.
-- ---------------------------------------------------------------------------

create table public.access_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  name text not null check (name = btrim(name) and length(name) between 1 and 60),
  -- Hex sha256 of the key. A key is 32 random bytes, so a plain digest is
  -- enough: there is nothing to guess that a slow hash would protect.
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index access_keys_organization_id_created_at_idx on public.access_keys (organization_id, created_at desc);

revoke all on public.access_keys from anon, authenticated;
grant select (id, organization_id, name, created_at, last_used_at, revoked_at) on public.access_keys to authenticated;
grant insert (organization_id, name, key_hash) on public.access_keys to authenticated;
grant update (revoked_at) on public.access_keys to authenticated;

create policy "members read their organization's rows"
  on public.access_keys for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy "members create keys for their organization"
  on public.access_keys for insert to authenticated
  with check (organization_id = (select private.current_org_id()));

-- Revoking is one way: a revoked key can't be revived, only replaced.
create policy "members revoke their organization's keys"
  on public.access_keys for update to authenticated
  using (organization_id = (select private.current_org_id()) and revoked_at is null)
  with check (organization_id = (select private.current_org_id()) and revoked_at is not null);

-- ---------------------------------------------------------------------------
-- Hashing, in one place, for both making a key and recognising one.
-- ---------------------------------------------------------------------------

create or replace function private.access_key_hash(p_key text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(extensions.digest(p_key, 'sha256'), 'hex');
$$;

revoke execute on function private.access_key_hash(text) from public, anon, authenticated;
grant execute on function private.access_key_hash(text) to authenticated;

-- The hash of the key the request carries, or null when it carries none.
create or replace function private.presented_key_hash()
returns text
language sql
stable
set search_path = ''
as $$
  select private.access_key_hash(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-flowlens-key');
$$;

revoke execute on function private.presented_key_hash() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Making one, as the signed-in member. The insert policy decides which
-- organization it may belong to; this never names one itself.
-- ---------------------------------------------------------------------------

create or replace function public.create_access_key(p_name text)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  key text := 'flk_' || encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into public.access_keys (organization_id, name, key_hash)
  values (private.current_org_id(), btrim(p_name), private.access_key_hash(key));
  return key;
end;
$$;

revoke execute on function public.create_access_key(text) from public, anon, authenticated;
grant execute on function public.create_access_key(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Recognising one. Security definer because nobody may read the hashes; it
-- answers only for the key the request itself carries, and only while that
-- key is unrevoked.
-- ---------------------------------------------------------------------------

create or replace function private.access_key_org_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select k.organization_id
  from public.access_keys k
  where k.key_hash = private.presented_key_hash() and k.revoked_at is null;
$$;

revoke execute on function private.access_key_org_id() from public, anon, authenticated;
grant execute on function private.access_key_org_id() to anon;

-- Stamps the key the request carries as used and returns its id, or null when
-- the key is unknown or revoked. The MCP route calls it first, so a dead key
-- is refused outright instead of reading as an organization with no maps.
create or replace function public.touch_access_key()
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  update public.access_keys k
  set last_used_at = now()
  where k.key_hash = private.presented_key_hash() and k.revoked_at is null
  returning k.id;
$$;

revoke execute on function public.touch_access_key() from public, anon, authenticated;
grant execute on function public.touch_access_key() to anon;

-- ---------------------------------------------------------------------------
-- The organization claim, now with a key's organization in it.
--
-- Only for anon: a request with a session already has its organization, and
-- a key must never lend one to a signed-in user's writes. Anon has no write
-- policy anywhere, so a key reads and nothing more.
-- ---------------------------------------------------------------------------

create or replace function private.current_org_id()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    auth.jwt() -> 'o' ->> 'id',
    auth.jwt() ->> 'org_id',
    case when current_user = 'anon' then private.access_key_org_id() end
  );
$$;

grant execute on function private.current_org_id() to anon;

-- ---------------------------------------------------------------------------
-- The existing member policies, opened to anon for exactly what the MCP tools
-- read. Explanations, insights, previews and the model cache stay members'.
-- ---------------------------------------------------------------------------

alter policy "members read their organization's rows" on public.projects to authenticated, anon;
alter policy "members read their organization's rows" on public.analyses to authenticated, anon;
alter policy "members read their organization's rows" on public.files to authenticated, anon;
alter policy "members read their organization's rows" on public.edges to authenticated, anon;
alter policy "members read their organization's rows" on public.routes to authenticated, anon;
alter policy "members read their organization's rows" on public.file_roles to authenticated, anon;

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
