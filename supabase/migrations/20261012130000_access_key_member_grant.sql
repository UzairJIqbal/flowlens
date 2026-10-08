-- Members read through current_org_id() too, and Postgres checks EXECUTE on
-- every function a query references before running it, not only the branches
-- it takes. So the key lookup inside current_org_id() needs a grant for
-- authenticated even though, for them, the case around it never calls it.
-- Without it, every signed-in read fails with "permission denied".
--
-- Safe to grant: private isn't exposed through the API, and the function only
-- ever answers for the key the request itself carries.

grant execute on function private.access_key_org_id() to authenticated;
