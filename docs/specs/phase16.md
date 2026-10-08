# Phase 16 — Map access for coding agents

## Goal

A coding agent like Claude Code can ask Flowlens what depends on a file before it changes it, and gets back the same parsed facts the map shows.

## Where this starts

The stored analyses, the graph functions and the chat agent's lookup functions all exist. This phase puts them behind an MCP endpoint, the standard way coding agents plug into outside tools.

## Build

* An MCP endpoint inside the existing application. Same deployable, no separate service.
* Read-only tools: list the organization's analyses, a file's imports and importers, blast radius up to two levels, the dependency chain between two files, and the coverage report.
* Every response includes the commit the analysis came from, when it was made, and a one-line coverage summary.
* Access keys a signed-in member creates for their organization: named, shown once, stored hashed, revocable, with a last-used time.
* A settings page inside the existing shell listing keys, a button to create one, the copyable command to connect Claude Code, and one example instruction for an agent, such as checking blast radius before editing a shared file.

## Constraints

* The server returns parsed facts and nothing else. No model call happens inside it and nothing is summarised. The agent on the other end can reason; the server doesn't.
* The walk stays arithmetic. The agent picks a file and a direction, and the existing graph functions do the walking.
* One set of lookup functions, two callers. The MCP tools call exactly what the chat agent calls. If a tool needs something the shared function lacks, it's added to the shared function, not to the server.
* A key resolves to an organization, and the request then runs with that organization's claim so the existing row-level security policies decide what comes back. No access check written in application code. Two authorization layers means one of them gets forgotten.
* An unknown path returns an explicit "not in this analysis" result, never the nearest match. Obvious path variations (leading slash, Windows separators) are normalised in one documented place; anything beyond that is not found.
* Responses are compact: paths and edge kinds, not decorated objects. Agents pay for every token they read.
* Nothing in the server re-parses on request. A stale map is stated through the commit on every response, not fixed by building a queue.

## Acceptance check

1. For one file in a real analysis, every tool's answer matches the detail panel for the same file.
2. A key from a second organization gets nothing back from the query, not an error the application chose to show.
3. The traces for a session of MCP calls contain no model calls.
4. An unknown path returns "not in this analysis".
5. Revoke a key, and the next request with it fails.
6. A real Claude Code session connected with the settings page command, given the example instruction, calls blast radius before editing a shared file.

## Not in this phase

Any tool that writes, starts an analysis or deletes. File explanations through the server. Analysing the agent's local, uncommitted code. Private repositories. Roles beyond the defaults.
