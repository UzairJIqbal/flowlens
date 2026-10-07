-- The pipeline: fetch, select, parse, store. The run writes what the parser
-- found, and says which stage it is in while it does.
--
-- Writes come from the server with the secret key, which bypasses RLS; that is
-- why no write policy appears here. Reads, including who may listen to a run's
-- progress, stay policies.

-- ---------------------------------------------------------------------------
-- Edges mirror the parser's: one row per connected pair, carrying every kind
-- of import behind it, rather than one row per kind. The enum takes the
-- parser's spelling so nothing translates between the two.
-- ---------------------------------------------------------------------------

alter type public.edge_kind rename value 'dynamic_import' to 'dynamic';

alter table public.edges
  drop column kind,
  add column kinds public.edge_kind[] not null check (cardinality(kinds) > 0),
  add column type_only boolean not null,
  add constraint edges_pair_key unique (analysis_id, source_file_id, target_file_id);

-- The pair key leads with analysis_id, so it serves every lookup this did.
drop index public.edges_analysis_id_idx;

-- Fan-in and fan-out are left out: they are arithmetic over the edges.
alter table public.files
  add column folder text not null,
  add column lines integer not null check (lines >= 0),
  add column hash text not null;

-- ---------------------------------------------------------------------------
-- The run.
--
-- One analysis per repository: a re-run replaces that analysis's graph rather
-- than adding a second analysis beside it.
-- ---------------------------------------------------------------------------

create type public.analysis_stage as enum ('fetch', 'select', 'parse', 'store');

alter table public.analyses
  add column stage public.analysis_stage,
  add column stage_message text,
  -- When the current run began. created_at stays the analysis's birth; this
  -- moves on every re-run, and is what makes an abandoned run recognisable.
  add column started_at timestamptz,
  add column adapter text,
  add column coverage jsonb,
  add column warnings text[],
  add constraint analyses_project_id_key unique (project_id),
  -- A queued analysis has not reached any stage; anything else has. A failed
  -- one keeps the stage it failed in.
  add constraint analyses_stage_check check ((status = 'queued') = (stage is null)),
  add constraint analyses_complete_check check (
    status <> 'complete'
    or (commit_sha is not null and adapter is not null and coverage is not null and finished_at is not null)
  );

-- The unique constraint indexes project_id.
drop index public.analyses_project_id_idx;

-- ---------------------------------------------------------------------------
-- Storing a parse, in one transaction.
--
-- The previous graph, the new graph and the analysis turning complete happen
-- together or not at all, so a failure mid-store never leaves half a map.
-- Every edge and role must land on a stored file; if any doesn't, the whole
-- store fails rather than quietly dropping it.
-- ---------------------------------------------------------------------------

create or replace function public.store_analysis(
  p_analysis uuid,
  p_commit text,
  p_adapter text,
  p_files jsonb,
  p_edges jsonb,
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

  update public.analyses a set
    status = 'complete',
    stage = 'store',
    stage_message = format('Stored %s files and %s edges', file_count, edge_count),
    commit_sha = p_commit,
    adapter = p_adapter,
    coverage = p_coverage,
    warnings = p_warnings,
    finished_at = now()
  where a.id = p_analysis;
end;
$$;

revoke execute on function public.store_analysis(uuid, text, text, jsonb, jsonb, jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.store_analysis(uuid, text, text, jsonb, jsonb, jsonb, text[])
  to service_role;

-- ---------------------------------------------------------------------------
-- Live progress.
--
-- A trigger on our own table publishes when the run moves. The event is the
-- status and the payload is only the stage and its message, so a listener has
-- nothing to filter and nothing to interpret. A failed run's message is why.
-- ---------------------------------------------------------------------------

create or replace function private.publish_analysis_progress()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('stage', new.stage, 'message', coalesce(new.error, new.stage_message)),
    new.status::text,
    'analysis:' || new.id::text,
    true
  );
  return null;
end;
$$;

revoke execute on function private.publish_analysis_progress() from public, anon, authenticated;

create trigger analyses_publish_progress
  after update of status, stage, stage_message, error on public.analyses
  for each row
  when (
    old.status is distinct from new.status
    or old.stage is distinct from new.stage
    or old.stage_message is distinct from new.stage_message
    or old.error is distinct from new.error
  )
  execute function private.publish_analysis_progress();

-- The channel pattern, declared. Private broadcasts reach only subscribers
-- this policy admits, and a topic is admitted only when it names an analysis
-- the subscriber can already select. That select runs under the analyses
-- policy, so another organization's channel is refused for the same reason
-- its rows are.
create policy "members receive their organization's analysis progress"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1 from public.analyses a
      where 'analysis:' || a.id::text = (select realtime.topic())
    )
  );
