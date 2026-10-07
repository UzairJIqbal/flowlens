-- The model arrives: it explains files and folders, and labels the files no
-- convention identified. Nothing here lets it connect two files.

-- ---------------------------------------------------------------------------
-- The cache.
--
-- Keyed on the content of what was explained, not on a file row. A re-run
-- deletes and re-inserts every file, so a cache hanging off file ids would be
-- emptied by every re-run, including the ones that changed nothing. The key is
-- a sha256 over everything the model was handed plus the pinned model name,
-- so re-pinning a model misses only that model's entries.
--
-- Nothing ever wrote to explanations; it is replaced rather than reshaped.
-- ---------------------------------------------------------------------------

drop table public.explanations;

create table public.model_cache (
  organization_id text not null references public.organizations (id) on delete cascade,
  key text not null check (key ~ '^[0-9a-f]{64}$'),
  task text not null check (task in ('explain-file', 'explain-folder', 'classify')),
  model text not null,
  output text not null,
  created_at timestamptz not null default now(),
  -- Leads with organization_id, so it also serves the policy.
  primary key (organization_id, key)
);

-- Written by the server with the secret key, like everything else; read here.
create policy "members read their organization's rows"
  on public.model_cache for select to authenticated
  using (organization_id = (select private.current_org_id()));

-- ---------------------------------------------------------------------------
-- A model's role can never be structural. Page, route and controller decide
-- the route table and the entry-point colouring, and convention owns them.
-- Enforced here as well as in the prompt, so no path around the prompt can
-- store one.
-- ---------------------------------------------------------------------------

alter table public.file_roles
  add constraint file_roles_model_role_check check (
    source = 'convention'
    or role in ('service', 'repository', 'model', 'util', 'config', 'component', 'hook')
  );

-- Labelling runs after parsing and before the store.
alter type public.analysis_stage add value 'label' after 'parse';

-- ---------------------------------------------------------------------------
-- Storing a parse now says where each role came from. Same signature, so the
-- grants carry over.
-- ---------------------------------------------------------------------------

create or replace function public.store_analysis(
  p_analysis uuid,
  p_commit text,
  p_adapter text,
  p_files jsonb,
  p_edges jsonb,
  p_routes jsonb,
  p_withheld_routes jsonb,
  p_coverage jsonb,
  p_warnings text[]
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  org text;
  file_count integer;
  edge_count integer;
  role_count integer;
  route_count integer;
begin
  select a.organization_id into org
  from public.analyses a
  where a.id = p_analysis and a.status = 'parsing'
  for update;
  if org is null then
    raise exception 'analysis % is not running', p_analysis;
  end if;

  -- Roles, edges and routes hanging off the old files cascade away with them.
  delete from public.files f where f.analysis_id = p_analysis;

  insert into public.files (organization_id, analysis_id, path, folder, lines, hash)
  select org, p_analysis, f.path, f.folder, f.lines, f.hash
  from jsonb_to_recordset(p_files) as f (path text, folder text, lines integer, hash text);
  get diagnostics file_count = row_count;

  -- A role without a source is refused by the not-null column rather than
  -- defaulted: which kind of fact it is must be said, never assumed.
  insert into public.file_roles (organization_id, file_id, role, source)
  select org, s.id, f.role, f."roleSource"
  from jsonb_to_recordset(p_files) as f (path text, role text, "roleSource" public.file_role_source)
  join public.files s on s.analysis_id = p_analysis and s.path = f.path
  where f.role is not null;
  get diagnostics role_count = row_count;

  if role_count <> (select count(*) from jsonb_array_elements(p_files) x where x ->> 'role' is not null) then
    raise exception 'a role names a file that was not stored';
  end if;

  insert into public.edges (organization_id, analysis_id, source_file_id, target_file_id, kinds, type_only)
  select org, p_analysis, s.id, t.id, e.kinds, e."typeOnly"
  from jsonb_to_recordset(p_edges) as e ("from" text, "to" text, kinds public.edge_kind[], "typeOnly" boolean)
  join public.files s on s.analysis_id = p_analysis and s.path = e."from"
  join public.files t on t.analysis_id = p_analysis and t.path = e."to";
  get diagnostics edge_count = row_count;

  if edge_count <> jsonb_array_length(p_edges) then
    raise exception 'an edge names a file that was not stored';
  end if;

  insert into public.routes (organization_id, analysis_id, file_id, method, path, line)
  select org, p_analysis, s.id, r.method, r.path, r.line
  from jsonb_to_recordset(p_routes) as r (file text, line integer, method text, path text)
  join public.files s on s.analysis_id = p_analysis and s.path = r.file;
  get diagnostics route_count = row_count;

  if route_count <> jsonb_array_length(p_routes) then
    raise exception 'a route names a file that was not stored';
  end if;

  update public.analyses a set
    status = 'complete',
    stage = 'store',
    stage_message = format('Stored %s files, %s edges and %s routes', file_count, edge_count, route_count),
    commit_sha = p_commit,
    adapter = p_adapter,
    withheld_routes = p_withheld_routes,
    coverage = p_coverage,
    warnings = p_warnings,
    finished_at = now()
  where a.id = p_analysis;
end;
$$;

-- ---------------------------------------------------------------------------
-- Same refusal as the first migration: no table in public without RLS or
-- without a policy.
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
