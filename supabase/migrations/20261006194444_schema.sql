-- The whole schema for one analysis of one repository, owned by an organization.
--
-- Authorization lives here and nowhere else: every table's rows carry an
-- organization id, and a policy compares it with the organization claim on the
-- Clerk session token. Application code never adds that filter itself.

-- ---------------------------------------------------------------------------
-- Row-level security is on by default, not per table.
--
-- A table with RLS on and no policy returns nothing, which someone notices. A
-- table where enabling it was forgotten returns everything, silently. So any
-- table created in public gets RLS the moment it exists, and the check at the
-- end of this file refuses to commit if one somehow didn't.
-- ---------------------------------------------------------------------------

create or replace function public.enable_rls_on_new_tables()
returns event_trigger
language plpgsql
set search_path = ''
as $$
declare
  obj record;
begin
  for obj in
    select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type = 'table'
      and schema_name = 'public'
  loop
    execute format('alter table %s enable row level security', obj.object_identity);
  end loop;
end;
$$;

revoke execute on function public.enable_rls_on_new_tables() from public, anon, authenticated;

create event trigger enable_rls_on_new_tables
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.enable_rls_on_new_tables();

-- ---------------------------------------------------------------------------
-- The organization claim.
--
-- Clerk's v2 session token nests it as o.id; older tokens put it at org_id.
-- One definition, so every policy reads it the same way.
-- ---------------------------------------------------------------------------

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.current_org_id()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'o' ->> 'id', auth.jwt() ->> 'org_id');
$$;

revoke execute on function private.current_org_id() from public, anon;
grant execute on function private.current_org_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Organizations.
--
-- Clerk owns organizations; this table exists so every other row can point at
-- one with a foreign key and disappear with it. The id is Clerk's org id.
-- Nothing syncs rows in from Clerk yet.
-- ---------------------------------------------------------------------------

create table public.organizations (
  id text primary key check (id like 'org\_%'),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The eight tables.
--
-- Children reference their parent through (id, organization_id) rather than
-- id alone, so a row can never claim one organization while hanging off
-- another organization's analysis.
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  repo_owner text not null,
  repo_name text not null,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  -- A repository is mapped once per team, and everyone after starts from it.
  unique (organization_id, repo_owner, repo_name)
);

create type public.analysis_status as enum ('queued', 'parsing', 'complete', 'failed');

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  status public.analysis_status not null default 'queued',
  commit_sha text,
  -- Why it failed, in words. Only a failed analysis has one.
  error text check ((status = 'failed') = (error is not null)),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (id, organization_id),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  path text not null,
  unique (id, organization_id),
  unique (analysis_id, path),
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade
);

create type public.edge_kind as enum ('import', 'reexport', 'dynamic_import', 'require');

-- An edge exists only because the parser resolved a real import to a real
-- file, so both ends are foreign keys to files in the same analysis.
create table public.edges (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  source_file_id uuid not null,
  target_file_id uuid not null,
  kind public.edge_kind not null,
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade,
  foreign key (source_file_id, organization_id)
    references public.files (id, organization_id) on delete cascade,
  foreign key (target_file_id, organization_id)
    references public.files (id, organization_id) on delete cascade
);

-- A route is stored only when both method and full path were recovered.
create table public.routes (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null,
  method text not null,
  path text not null,
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade,
  foreign key (file_id, organization_id)
    references public.files (id, organization_id) on delete cascade
);

create table public.explanations (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  file_id uuid not null,
  body text not null,
  model text not null,
  created_at timestamptz not null default now(),
  foreign key (file_id, organization_id)
    references public.files (id, organization_id) on delete cascade
);

create type public.file_role_source as enum ('convention', 'model');

-- Where the role came from is kept, so a convention match and a model's label
-- are never presented as the same kind of fact.
create table public.file_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  file_id uuid not null unique,
  role text not null,
  source public.file_role_source not null,
  foreign key (file_id, organization_id)
    references public.files (id, organization_id) on delete cascade
);

create table public.insights (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  body text not null,
  created_at timestamptz not null default now(),
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Indexes. Every policy filters on organization_id and every cascade walks a
-- foreign key, so both are indexed.
-- ---------------------------------------------------------------------------

create index projects_organization_id_idx on public.projects (organization_id);
create index analyses_organization_id_created_at_idx on public.analyses (organization_id, created_at desc);
create index analyses_project_id_idx on public.analyses (project_id);
create index files_organization_id_idx on public.files (organization_id);
create index edges_organization_id_idx on public.edges (organization_id);
create index edges_analysis_id_idx on public.edges (analysis_id);
create index edges_source_file_id_idx on public.edges (source_file_id);
create index edges_target_file_id_idx on public.edges (target_file_id);
create index routes_organization_id_idx on public.routes (organization_id);
create index routes_analysis_id_idx on public.routes (analysis_id);
create index routes_file_id_idx on public.routes (file_id);
create index explanations_organization_id_idx on public.explanations (organization_id);
create index explanations_file_id_idx on public.explanations (file_id);
create index file_roles_organization_id_idx on public.file_roles (organization_id);
create index insights_organization_id_idx on public.insights (organization_id);
create index insights_analysis_id_idx on public.insights (analysis_id);

-- ---------------------------------------------------------------------------
-- Policies. Read access only: nothing in the app writes yet, and a write
-- policy with nothing behind it is a door nobody is watching.
-- ---------------------------------------------------------------------------

create policy "members read their organization"
  on public.organizations for select to authenticated
  using (id = (select private.current_org_id()));

create policy "members read their organization's rows"
  on public.projects for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy "members read their organization's rows"
  on public.analyses for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy "members read their organization's rows"
  on public.files for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy "members read their organization's rows"
  on public.edges for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy "members read their organization's rows"
  on public.routes for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy "members read their organization's rows"
  on public.explanations for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy "members read their organization's rows"
  on public.file_roles for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy "members read their organization's rows"
  on public.insights for select to authenticated
  using (organization_id = (select private.current_org_id()));

-- ---------------------------------------------------------------------------
-- Refuse to commit if any table in public is readable without RLS, or has RLS
-- but no policy. A check that can't pass fails the migration, loudly.
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
