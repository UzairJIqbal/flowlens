-- Pull request previews: the same repository parsed at two commits, kept side
-- by side so the difference can be computed from them.
--
-- Each side is stored whole as the parser's JSON rather than in files and
-- edges. Those tables hold one graph per repository and a re-run replaces it;
-- a preview is two graphs that never replace anything, and is only ever read
-- whole.

create type public.preview_stage as enum ('fetch', 'parse', 'store');

create table public.pr_previews (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  pr_number integer not null check (pr_number > 0),
  pr_title text not null,
  -- The merge base and the pull request's head, both read from GitHub before
  -- the row exists. Together with the repository they are what is cached on:
  -- the same two commits are never parsed twice by one organization.
  base_sha text not null check (base_sha ~ '^[0-9a-f]{40}$'),
  head_sha text not null check (head_sha ~ '^[0-9a-f]{40}$'),
  -- GitHub's own list of changed files, exactly as it reported it.
  changed jsonb not null check (jsonb_typeof(changed) = 'array'),
  status public.analysis_status not null default 'queued',
  stage public.preview_stage,
  stage_message text,
  error text check ((status = 'failed') = (error is not null)),
  base jsonb,
  head jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (project_id, base_sha, head_sha),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade,
  constraint pr_previews_stage_check check ((status = 'queued') = (stage is null)),
  constraint pr_previews_complete_check check (
    status <> 'complete' or (base is not null and head is not null and finished_at is not null)
  )
);

create index pr_previews_organization_id_created_at_idx on public.pr_previews (organization_id, created_at desc);

-- Written by the server with the secret key, like everything else; read here.
create policy "members read their organization's rows"
  on public.pr_previews for select to authenticated
  using (organization_id = (select private.current_org_id()));

-- ---------------------------------------------------------------------------
-- Live progress, the same way an analysis publishes it, on its own topic.
-- ---------------------------------------------------------------------------

create or replace function private.publish_preview_progress()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('stage', new.stage, 'message', coalesce(new.error, new.stage_message)),
    new.status::text,
    'preview:' || new.id::text,
    true
  );
  return null;
end;
$$;

revoke execute on function private.publish_preview_progress() from public, anon, authenticated;

create trigger pr_previews_publish_progress
  after update of status, stage, stage_message, error on public.pr_previews
  for each row
  when (
    old.status is distinct from new.status
    or old.stage is distinct from new.stage
    or old.stage_message is distinct from new.stage_message
    or old.error is distinct from new.error
  )
  execute function private.publish_preview_progress();

-- A preview's topic is admitted only when the subscriber can already select
-- the preview, so the pr_previews policy decides who listens.
create policy "members receive their organization's preview progress"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1 from public.pr_previews p
      where 'preview:' || p.id::text = (select realtime.topic())
    )
  );

-- ---------------------------------------------------------------------------
-- Explaining a change is cached like every other model call.
-- ---------------------------------------------------------------------------

alter table public.model_cache drop constraint model_cache_task_check;
alter table public.model_cache
  add constraint model_cache_task_check check (task in ('explain-file', 'explain-folder', 'classify', 'explain-change'));

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
