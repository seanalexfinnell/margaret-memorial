# margaret.memorial

A memorial site for Margaret Stewart Kennedy-Cairns (1929 to 2026). Astro static pages served by one Cloudflare Worker, with a small API for shared memories.

## Local

    npm install
    cp .dev.vars.example .dev.vars
    npx wrangler d1 execute margaret-memorial --local --file=schema.sql
    npm run build && npx wrangler dev

Open http://localhost:8787 for the site and http://localhost:8787/admin to review memories.

## Cloudflare

Already created: D1 database `margaret-memorial` (schema applied) and R2 bucket `margaret-memorial-photos`.
Deploys run through Workers Builds on every push to `main` (build `npm run build`, deploy `npx wrangler deploy`).
The Worker serves margaret.memorial as a custom domain.

Settings that live in the dashboard:

- Worker > Settings > Variables and Secrets: `TURNSTILE_SECRET` (secret), `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`.
- Worker > Settings > Builds > Build variables: `PUBLIC_TURNSTILE_SITE_KEY`.
- Zero Trust > Access: a self-hosted application covering `margaret.memorial/admin` and `margaret.memorial/api/admin`, allowing only family emails.

Until Turnstile is set, the memory form refuses submissions. Until Access is set, the admin page refuses everyone.

## Content still to come

- Photos: drop files in `public/photos/` and pass `src` to each `<Frame>` in `src/pages/index.astro`.
- Charity: set `CHARITY` at the top of `src/pages/index.astro`.
- Date of passing: replace `November [X]`.
- Search engines: the site is `noindex` by default (`src/layouts/Base.astro`).
