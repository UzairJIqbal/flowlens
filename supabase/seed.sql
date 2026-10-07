-- Placeholder analyses for two organizations, because nothing creates a real
-- one yet. Re-runnable: deleting the organizations cascades away everything
-- seeded under them, then it is all inserted again.
--
-- Commit SHAs are left empty on purpose; a made-up one would look real.

delete from public.organizations
where id in ('org_3KKlZ3gCFxwGRkOTvLkm8Ckjp6g', 'org_3KKnP7kPpQq7nDYytHP44FKvXhY');

insert into public.organizations (id) values
  ('org_3KKlZ3gCFxwGRkOTvLkm8Ckjp6g'),
  ('org_3KKnP7kPpQq7nDYytHP44FKvXhY');

with p as (
  insert into public.projects (organization_id, repo_owner, repo_name) values
    ('org_3KKlZ3gCFxwGRkOTvLkm8Ckjp6g', 'vercel', 'next.js'),
    ('org_3KKlZ3gCFxwGRkOTvLkm8Ckjp6g', 'colinhacks', 'zod'),
    ('org_3KKlZ3gCFxwGRkOTvLkm8Ckjp6g', 'facebook', 'react'),
    ('org_3KKnP7kPpQq7nDYytHP44FKvXhY', 'trpc', 'trpc'),
    ('org_3KKnP7kPpQq7nDYytHP44FKvXhY', 'honojs', 'hono')
  returning id, organization_id, repo_owner, repo_name
)
insert into public.analyses (organization_id, project_id, status, error, created_at, finished_at)
select p.organization_id, p.id, s.status::public.analysis_status, s.error,
       now() - s.age, case when s.status in ('complete', 'failed') then now() - s.age + interval '40 seconds' end
from p
join (values
  ('vercel/next.js',    'complete', null,                                   interval '3 days'),
  ('colinhacks/zod',    'parsing',  null,                                   interval '2 minutes'),
  ('facebook/react',    'failed',   'Seeded failure; no analysis actually ran.', interval '1 day'),
  ('trpc/trpc',         'complete', null,                                   interval '5 hours'),
  ('honojs/hono',       'queued',   null,                                   interval '30 seconds')
) as s(repo, status, error, age) on s.repo = p.repo_owner || '/' || p.repo_name;
