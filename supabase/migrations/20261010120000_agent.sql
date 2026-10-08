-- The agent reads one analysis, and nothing else, without a signed-in user.
--
-- It carries a short-lived credential naming one analysis and its
-- organization, signed and checked here in Postgres with a key that never
-- leaves Vault. The surface it calls reads with the publishable key and
-- forwards that credential as a header; the policies below admit the rows it
-- names and nothing more. So nothing outside the database holds a key that
-- reads everything on the agent's path: not the agent, not the surface, not
-- the app. The secret key stays the pipeline's writer and nothing else.
--
-- Signed here rather than by the app because a signing key the app held would
-- be a key that reads everything: whoever has it can name any analysis.

-- ---------------------------------------------------------------------------
-- The signing key: 32 random bytes, generated once, stored only in Vault.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'agent_credential_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'agent_credential_key',
      'Signs the agent''s per-run credentials. Never read outside the database.'
    );
  end if;
end;
$$;

-- Raises rather than returning null: a missing key must stop every credential
-- loudly, not quietly sign or check against nothing.
create or replace function private.agent_credential_key()
returns bytea
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  key text;
begin
  select s.decrypted_secret into key from vault.decrypted_secrets s where s.name = 'agent_credential_key';
  if key is null then
    raise exception 'agent_credential_key is missing from Vault';
  end if;
  return decode(key, 'hex');
end;
$$;

revoke execute on function private.agent_credential_key() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The token: base64url(payload) "." base64url(hmac-sha256(payload)). The
-- payload is {a: analysis, o: organization, exp: unix seconds}.
-- ---------------------------------------------------------------------------

create or replace function private.base64url(data bytea)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(rtrim(replace(encode(data, 'base64'), E'\n', ''), '='), '+/', '-_');
$$;

create or replace function private.unbase64url(data text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select decode(rpad(translate(data, '-_', '+/'), (length(data) + 3) / 4 * 4, '='), 'base64');
$$;

revoke execute on function private.base64url(bytea) from public, anon, authenticated;
revoke execute on function private.unbase64url(text) from public, anon, authenticated;

-- Five minutes: one question is three or four lookups over half a minute, and
-- each question gets a fresh credential, so a leaked one is dead almost at once.
create or replace function private.sign_agent_credential(p_analysis uuid, p_org text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payload text;
begin
  -- A credential only ever names the caller's own organization, so even
  -- called directly this can't mint one for anyone else's rows.
  if p_org is null or p_org is distinct from private.current_org_id() then
    raise exception 'a credential can only name your own organization';
  end if;
  payload := private.base64url(convert_to(
    jsonb_build_object('a', p_analysis, 'o', p_org, 'exp', floor(extract(epoch from now()))::bigint + 300)::text,
    'utf8'
  ));
  return payload || '.' || private.base64url(extensions.hmac(convert_to(payload, 'utf8'), private.agent_credential_key(), 'sha256'));
end;
$$;

revoke execute on function private.sign_agent_credential(uuid, text) from public, anon, authenticated;
grant execute on function private.sign_agent_credential(uuid, text) to authenticated;

-- Called with the signed-in user's token. Whether they may have a credential
-- for this analysis is the analyses policy's decision: it returns the row only
-- to its own organization.
create or replace function public.mint_agent_credential(p_analysis uuid)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  org text;
begin
  select a.organization_id into org from public.analyses a where a.id = p_analysis;
  if org is null then
    raise exception 'no analysis % in your organization', p_analysis using errcode = 'P0002';
  end if;
  return private.sign_agent_credential(p_analysis, org);
end;
$$;

revoke execute on function public.mint_agent_credential(uuid) from public, anon, authenticated;
grant execute on function public.mint_agent_credential(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Checking it. The surface forwards the credential as the x-agent-credential
-- header, which PostgREST exposes to SQL as request.headers. Anything wrong
-- with it (absent, malformed, a bad signature, expired) reads as no
-- credential, so the policies admit nothing.
-- ---------------------------------------------------------------------------

create or replace function private.agent_claims()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  token text := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-agent-credential';
  parts text[];
  claims jsonb;
begin
  if token is null then
    return null;
  end if;
  parts := string_to_array(token, '.');
  if array_length(parts, 1) is distinct from 2 then
    return null;
  end if;
  -- Outside the handler below, so a missing key raises instead of reading as
  -- a bad signature.
  if private.base64url(extensions.hmac(convert_to(parts[1], 'utf8'), private.agent_credential_key(), 'sha256'))
     is distinct from parts[2] then
    return null;
  end if;
  begin
    claims := convert_from(private.unbase64url(parts[1]), 'utf8')::jsonb;
  exception when others then
    return null;
  end;
  if (claims ->> 'exp')::bigint is null or (claims ->> 'exp')::bigint <= extract(epoch from now()) then
    return null;
  end if;
  return claims;
end;
$$;

create or replace function private.agent_analysis_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select (private.agent_claims() ->> 'a')::uuid;
$$;

create or replace function private.agent_org_id()
returns text
language sql
stable
set search_path = ''
as $$
  select private.agent_claims() ->> 'o';
$$;

-- The surface reads as anon, so anon evaluates these in its policies; nothing
-- in private is exposed through the API, so they're callable only from there.
grant usage on schema private to anon;
revoke execute on function private.agent_claims() from public, anon, authenticated;
revoke execute on function private.agent_analysis_id() from public, anon, authenticated;
revoke execute on function private.agent_org_id() from public, anon, authenticated;
grant execute on function private.agent_claims() to anon;
grant execute on function private.agent_analysis_id() to anon;
grant execute on function private.agent_org_id() to anon;

-- ---------------------------------------------------------------------------
-- Policies: exactly what the agent's lookups read, for the one analysis its
-- credential names. Explanations, insights and the model cache aren't read,
-- so they get nothing.
-- ---------------------------------------------------------------------------

create policy "the agent reads the analysis its credential names"
  on public.analyses for select to anon
  using (id = (select private.agent_analysis_id()) and organization_id = (select private.agent_org_id()));

create policy "the agent reads the analysis its credential names"
  on public.projects for select to anon
  using (
    organization_id = (select private.agent_org_id())
    and id in (select a.project_id from public.analyses a where a.id = (select private.agent_analysis_id()))
  );

create policy "the agent reads the analysis its credential names"
  on public.files for select to anon
  using (analysis_id = (select private.agent_analysis_id()) and organization_id = (select private.agent_org_id()));

create policy "the agent reads the analysis its credential names"
  on public.edges for select to anon
  using (analysis_id = (select private.agent_analysis_id()) and organization_id = (select private.agent_org_id()));

create policy "the agent reads the analysis its credential names"
  on public.routes for select to anon
  using (analysis_id = (select private.agent_analysis_id()) and organization_id = (select private.agent_org_id()));

create policy "the agent reads the analysis its credential names"
  on public.file_roles for select to anon
  using (
    organization_id = (select private.agent_org_id())
    and file_id in (select f.id from public.files f where f.analysis_id = (select private.agent_analysis_id()))
  );

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
