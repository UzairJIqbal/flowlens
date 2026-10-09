# Connecting a coding agent

Flowlens serves its maps to coding agents over MCP, at `/api/mcp`. An agent connected to it can ask what a file imports, what imports it, and what may break if it changes, and get back the parsed edges with the commit they came from.

It's read-only and calls no model. Every answer is a lookup over a stored map. A path the analysis doesn't have comes back as "not in this analysis", never swapped for a similar one.

## 1. Create an access key

Sign in, open **Settings**, and create a key. Copy it straight away: only its hash is stored, so it can't be shown again.

A key reads the maps of the organization it was created in, and nothing else. Which rows it can see is decided by the same row-level security policies as the app. Revoking a key under Settings stops it immediately.

## 2. Add the server

The Settings page prints the exact command for the address you reached it at. For Claude Code against the live site:

```sh
claude mcp add --transport http flowlens https://flowlens-rouge.vercel.app/api/mcp \
  --header "Authorization: Bearer <key>"
```

For a local instance, use `http://localhost:3000/api/mcp`.

Any MCP client that speaks streamable HTTP works the same way: the endpoint URL, plus an `Authorization: Bearer <key>` header.

## 3. The tools

| Tool               | Takes              | Returns                                                                                       |
| ------------------ | ------------------ | --------------------------------------------------------------------------------------------- |
| `list_analyses`    | nothing            | The organization's analysed repositories, newest first, with ids, commits and coverage. Start here. |
| `file_neighbours`  | `analysis`, `path` | What one file imports and what imports it, one level each way, with the kind of each import.  |
| `blast_radius`     | `analysis`, `path` | Every file that imports this one, two levels deep, with each file's distance.                 |
| `dependency_chain` | `analysis`, `path` | Every file this one imports, two levels deep, with each file's distance.                      |
| `coverage_report`  | `analysis`         | Files parsed and skipped, imports by outcome, and why imports went unresolved.                |

Paths are from the repository root, for example `src/lib/db.ts`, and must match a file in the analysis exactly.

## What to keep in mind

- **The map is of one commit.** Every answer names the commit it was parsed from. If your working copy has moved on, re-run the analysis in Flowlens first.
- **Absent isn't the same as unused.** A file or import that wasn't parsed has no edges. `coverage_report` says what was left out and why.
- **Each call is traced** in LangSmith as a tool run with no model call inside it, tagged with the key that made it.
