-- Routes: the ones an adapter read exactly, stored as rows, and the ones it
-- couldn't, kept with the analysis as the reason each was left out.

-- Where the route is declared, so the table can point at the line. Nothing has
-- written a route before this, so the column can be required outright.
alter table public.routes
  add column line integer not null check (line >= 1);

-- Shaped like coverage: read whole with the analysis, never queried into.
-- Each entry is { file, line, reason }.
alter table public.analyses
  add column withheld_routes jsonb;

-- ---------------------------------------------------------------------------
-- Storing a parse now stores its routes in the same transaction. Every route
-- must land on a stored file, like edges and roles, or the store fails.
-- ---------------------------------------------------------------------------

drop function public.store_analysis(uuid, text, text, jsonb, jsonb, jsonb, text[]);

create function public.store_analysis(
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

  insert into public.file_roles (organization_id, file_id, role, source)
  select org, s.id, f.role, 'convention'
  from jsonb_to_recordset(p_files) as f (path text, role text)
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

revoke execute on function public.store_analysis(uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.store_analysis(uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, text[])
  to service_role;
