# Flowlens

**A map of the code nobody read.**

Paste a public TypeScript or JavaScript repository and Flowlens draws what imports what: folders as boxes, imports as lines. Every line comes from parsing the code. The AI explains what the parser found, but it never decides what's there.

![Flowlens map view](docs/screenshot.png)

> Screenshot placeholder. Add `docs/screenshot.png` (or a GIF) of the map with a file selected.

## What and why

Codebases now hold a lot of code nobody on the team has read. An agent wrote it, someone confirmed it worked, and it shipped. Questions about structure follow: what is this file, what depends on it, what breaks if it changes. Answering them by reading imports one file at a time stops working at around thirty files.

Flowlens answers those questions from the code itself. An edge exists only because an import resolved to a real file. An import that can't be resolved is reported with a reason, never guessed.

## Features

- **Dependency map.** Folders fold into boxes and open into their files. Fan-in and fan-out for every file.
- **What it uses, what uses it.** Select a file to highlight its imports in blue and its importers in amber.
- **Blast radius and dependency chain.** Everything two imports away in either direction, computed from the edge list.
- **Framework adapters.** Next.js, NestJS, Express and React name each file's role and pull out routes. A route whose full path can't be read from the syntax is left out, with the reason listed.
- **Coverage.** How much of the repository was parsed, and why the rest wasn't.
- **Live progress** while a repository is downloaded, parsed and stored.
- **Explanations.** A paragraph about a file or folder, written from its real neighbours, then cached and traced.
- **Ask the repository.** A chat panel answered by an agent that can only look facts up. Every lookup is shown before the answer.
- **Invented-path check.** Every explanation is checked for file paths the model was never shown.
- **Teams.** Each analysis belongs to an organization, and row-level security decides who can read it.

## Tech stack

| Area      | Choice                                                    |
| --------- | --------------------------------------------------------- |
| App       | Next.js 16 (App Router), React 19, TypeScript (strict)    |
| Parsing   | ts-morph (the TypeScript compiler API)                    |
| Map       | React Flow, dagre                                         |
| Auth      | Clerk (sign-in and organizations)                         |
| Data      | Supabase Postgres, row-level security, realtime           |
| AI        | OpenAI SDK against Gemini's OpenAI-compatible endpoint    |
| Tracing   | LangSmith                                                 |
| Agent     | Managed Deep Agents, run as a separate service            |
| Styling   | Tailwind CSS v4                                           |

## Architecture

```
GitHub archive ─▶ parser ─▶ adapters ─▶ Postgres (RLS) ─▶ map, graph functions, AI
```

- **Parser** (`lib/parser`). Path in, data out. It walks the repository, reads imports, re-exports, dynamic imports and `require()` through the TypeScript compiler, and resolves each one through path aliases, index files and workspace packages. It doesn't import Next.js, React or the database client, so it runs from a plain script (`pnpm parse`).
- **Adapters** (`lib/adapters`). All framework knowledge lives here, never in the parser. An adapter is chosen from the repository's dependencies. It names file roles from conventions and pulls out routes it can read in full.
- **Graph functions** (`lib/graph`). Pure functions over a file list and an edge list. Blast radius and dependency chain are the same walk with a direction argument and a depth limit. The agent picks a file and a direction, and this code does the walk.
- **Pipeline** (`lib/pipeline`). Fetch, select, parse, store, with named stages published to the database. The page subscribes to them over realtime.
- **Row-level security** (`supabase/migrations`). Every table is scoped to a Clerk organization by a database policy that reads the organization claim from the session token. Application code never filters by organization. If a query needed a `where` clause to return the right rows, the policy would be wrong.
- **AI** (`lib/ai`). One module builds the model client and wraps it for tracing. Every call reads the cache inside its trace, so a cache hit is recorded as a run with no model call in it.
- **Agent** (`agent/`). A separate service with its own dependencies. Its tools call back into `/api/agent/*` with a short-lived credential minted by the database for one analysis.

## Setup

You need Node 26, pnpm (the version is pinned in `package.json`), a Clerk application, and a Supabase project.

1. **Clone and install.**

   ```sh
   git clone https://github.com/UzairJIqbal/flowlens.git
   cd flowlens
   pnpm install
   ```

2. **Clerk.** Create an application and enable Organizations.

3. **Supabase.** Create a project and add Clerk as a third-party auth provider, so Postgres accepts Clerk session tokens. Then apply the migrations in `supabase/migrations`, in order (for example with `supabase db push`).

4. **Environment.** Copy `.env.example` to `.env.local` and fill it in. The app refuses to start, build or generate types while a required variable is missing.

5. **Run.**

   ```sh
   pnpm dev
   ```

   Open http://localhost:3000.

6. **Agent (optional, for the chat panel).**

   ```sh
   cd agent
   cp .env.example .env
   pnpm install
   pnpm dev
   ```

   It listens on http://localhost:2024. The app reaches it through `AGENT_URL`.

## Environment variables

App (`.env.local`):

| Name                                              | Required | Purpose                                  |
| ------------------------------------------------- | -------- | ---------------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`               | Yes      | Clerk, browser                           |
| `CLERK_SECRET_KEY`                                | Yes      | Clerk, server                            |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`                   | Yes      | Sign-in route                            |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL`                   | Yes      | Sign-up route                            |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | Yes      | Where sign-in lands                      |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | Yes      | Where sign-up lands                      |
| `NEXT_PUBLIC_SUPABASE_URL`                        | Yes      | Supabase project URL                     |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`            | Yes      | Supabase, browser and RLS-scoped queries |
| `SUPABASE_SECRET_KEY`                             | Yes      | Supabase, pipeline writes                |
| `GOOGLE_API_KEY`                                  | Yes      | Model calls                              |
| `LANGSMITH_TRACING`                               | No       | Turns tracing on                         |
| `LANGSMITH_ENDPOINT`                              | No       | LangSmith API                            |
| `LANGSMITH_API_KEY`                               | No       | LangSmith, needed for the evals          |
| `LANGSMITH_PROJECT`                               | No       | LangSmith project name                   |
| `AGENT_URL`                                       | No       | Agent service, defaults to port 2024     |

Agent (`agent/.env`): `GOOGLE_API_KEY`, `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT` and `FLOWLENS_URL`.

## Scripts

| Script                                       | What it does                                                   |
| -------------------------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                                   | Development server                                             |
| `pnpm build` / `pnpm start`                  | Production build and server                                    |
| `pnpm lint`                                  | ESLint                                                         |
| `pnpm typecheck`                             | Generates route types, then runs `tsc`                         |
| `pnpm parse <dir> [--out file] [--skipped]`  | Runs the parser on a directory on disk and prints the result   |
| `pnpm analyze <github url> --org org_...`    | Runs the full pipeline from a terminal for one organization    |
| `pnpm eval:paths`                            | Checks recent explanations for invented paths (needs LangSmith) |
| `pnpm eval:roles`                            | Measures model role labels against convention (needs LangSmith) |
| `pnpm eval:prompts`                          | Compares prompt versions (needs LangSmith)                     |

CI runs lint, typecheck and build for the app and a typecheck for the agent. There is no unit test suite. Correctness of the AI output is measured by the evals above, which need live traces and keys.

## Roadmap

These are known limits, not commitments.

- **Private repositories.** Reading one needs a GitHub token stored somewhere, which v1 deliberately avoids.
- **Larger repositories.** Archives over 100 MB are refused. Everything runs in one request, with no queue or workers.
- **Answer quality.** The invented-path check and the role evals are a start. How to measure explanation quality well is still open.
- **More framework adapters.** Repositories outside Next.js, NestJS, Express and React are fully mapped, but their file roles come from a model rather than a convention.

Not planned: scores or grades for code, approximate routes, or languages other than TypeScript and JavaScript.

## License

[MIT](LICENSE)
