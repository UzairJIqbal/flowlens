# Phase Final — Ship it

## Goal

Flowlens is live on Vercel's free Hobby plan at its free `vercel.app` address, and costs nothing to run. A stranger can open the link, understand what it does in ten seconds, sign in, and map a repository without anyone explaining it to them. The GitHub repository looks like a product someone maintains.

## Where this starts

Every phase is built. This phase adds nothing to what Flowlens does. It's about making sure what exists is all on GitHub, runs in production the same way it runs locally, and presents itself well to someone seeing it for the first time.

## Build

### Confirm GitHub is complete

* The default branch has every phase merged. No open pull requests that belong to a finished phase, no local commits that were never pushed, no work sitting on a stray branch.
* A clean clone of the default branch installs, builds, type-checks and passes its tests from scratch, following only the README.
* No secret has ever been committed. Check the full history, not just the current files. Anything that was ever committed gets rotated, not just deleted.
* `.env.example` lists every variable the app reads, with a one-line comment for each and no real values.
* Database migrations in the repository are the complete, ordered history, and applying them to an empty database produces the schema the app expects.

### Production services (all free plans)

* A production Supabase project on the free plan, separate from development (the free plan allows two projects, which is exactly dev and prod), with every migration applied from the repository. No hand-made changes in the dashboard.
* A second, separate Clerk application created just for the live site, using its development instance (see Constraints for why), so local testing and real users never share sign-ins. The Supabase integration is pointed at it so the organization claim reaches the policies exactly as it does locally.
* Every environment variable set in Vercel for Production and Preview separately, never with development keys in Production.
* The AI provider and tracing keys set for production, with tracing grouped under a production project so real usage and development runs never mix.

### Deploy

* The repository connected to Vercel. A push to the default branch deploys production. Every pull request gets a preview deployment with its own link.
* A CI workflow on GitHub runs install, type-check, lint, tests and build on every pull request. Vercel's own build is not the only check.
* Function time limits set deliberately for parsing routes, matching the honest size limit the app already states.
* Security headers set: a content security policy that allows only what the app actually loads, plus the standard frame, referrer and content-type headers.

### Make it attractive

* A public landing page at the root, readable without signing in. It opens with one sentence saying what Flowlens does, then a real screenshot or short screen recording of the map. Under that are three short sections covering the map, blast radius, and the chat that shows its lookups, then one button to sign in.
* A public demo: one well-known public repository mapped in advance and viewable read-only without signing in, so a visitor sees the product before giving it an email address.
* Favicon, app icon, page titles, and Open Graph and Twitter images, so a shared link shows a proper preview card.
* A real 404 page and a real error page, both in the app's own style.
* A README that sells and explains. It has a one-line description, the live link, a screenshot or GIF at the top, what makes it different (structure from parsing, not from a model), a short architecture section, the tech stack, how to run it locally, and the Answer Check results from Phase 15 with what they do and don't prove.
* A short `docs/` page or README section on connecting a coding agent to the Phase 16 endpoint.
* Repository settings: description, website link, topics, and a social preview image on GitHub.
* Vercel Web Analytics switched on within the Hobby plan's free allowance, so there are real numbers on visits.
* A licence file.

## Constraints

* Nothing about how Flowlens works changes in this phase. No new features, no "quick improvements" to the parser or the agent. A deploy phase that also changes behaviour makes every production bug ambiguous.
* The landing page follows the same interface rules as the app. It uses the same palette, a dense layout and no ambient animation. A product whose landing page pulses and drifts while the app refuses to is two products.
* The landing page shows the real product. Screenshots come from a real mapped repository, not a mockup. If the picture shows something the app doesn't do, it's a lie on the first page.
* No scores on the landing page either. "Maps 2,000 files in 40 seconds" is a measured fact and fine. "Finds 12 issues in your code" is the reviewer this product refuses to be.
* Production and development never share a database, a Clerk application or a tracing project. A test run that writes into production, or a production user who shows up in development, is the kind of mistake that can't be cleanly undone.
* Row-level security is checked in production, not assumed from development. Migrations applied by hand to one environment and not the other are how a table ends up open.
* GitHub's public API allows very few unauthenticated requests per hour, and on Vercel that limit is shared with every other site on the same IP addresses. Reads of public repositories go through an app-owned token that has no access beyond public data, stored as a Vercel secret. This is the app's token, not a user's, so it doesn't break the "no user tokens stored" rule. If that ever feels unclear, the rule wins and the limit gets stated honestly instead.
* AI calls on a public site need a ceiling. Every route that calls a model has a per-organization rate limit, and when the provider's quota runs out the app says so plainly instead of hanging or failing silently. The free tier used during Phase 15 ran out within a day of testing.
* Everything runs on free plans: Vercel Hobby, Supabase Free, Clerk Free, the AI provider's free tier, and the tracing tool's free tier. No paid add-on, no paid domain, and no new service that only has a paid plan. When a free limit is hit, the app states the limit plainly; it doesn't quietly upgrade to a paid plan.
* Clerk's production instance needs a domain you own and doesn't work on a `vercel.app` address. Staying free means staying on Clerk's development instance, so the README says so and the small development banner is accepted. Production Clerk is a later step, taken only if a domain is bought.
* Rate limits are stored in the existing Supabase database, not in a separate paid service.
* Supabase's free plan pauses a project after a week with no activity. The README says so, and the public demo is cached so a visitor doesn't land on a paused database without explanation.
* Vercel Hobby is for non-commercial projects and caps how long a function may run. The parsing size limit the app already states is set to fit inside that cap, measured on a real repository rather than guessed.
* Environment configuration still fails loudly at startup. A production deploy with a missing variable fails the build, not the first visitor's request.

## Acceptance check

1. Clone the repository fresh into an empty folder, follow only the README, and the app builds and its tests pass.
2. A secret scan of the full git history finds nothing live.
3. Open the production link in a private window. The landing page and the public demo load without signing in, and the demo map is a real analysis.
4. Sign up on production with each enabled sign-in method. Each lands inside an organization, exactly as Phase 1 required.
5. Signed in from a second production organization, the first organization's analyses don't come back from the query.
6. List every table in the production database. Every one has row-level security enabled.
7. Map a new public repository on production. Live progress, coverage, explain and chat all work, and the trace appears in the production tracing project, not the development one.
8. Open a pull request with a trivial change. CI runs and passes, and a preview deployment link appears on the pull request.
9. Paste the production link into a chat app or social post composer. A proper preview card with the image and title appears.
10. Run a Lighthouse check on the landing page. Performance, accessibility, best practices and SEO all come out in the green, and the page works at phone width.
11. Switch the theme on the landing page and in the app, reload, and the choice holds in both.
12. Visit a URL that doesn't exist and get the app's own 404 page.

## Not in this phase

New features of any kind. Private repositories. Paid plans of any service, a custom domain, billing or usage tiers. A marketing blog. Moving the parser to workers or queues to handle bigger repositories; the size limit stays stated, not engineered around.
