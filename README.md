# margaret.memorial

A memorial site for Margaret Stewart Kennedy-Cairns (1929 to 2026). Astro static pages served by one Cloudflare Worker, with a small API for shared memories.

## Local

    npm install
    npx wrangler d1 execute margaret-memorial --local --file=schema.sql
    npm run build && npx wrangler dev --var DEV_ADMIN:1

Open http://localhost:8787 for the site and http://localhost:8787/admin to review memories.

## First deploy (needs the family's Cloudflare account)

1. `npx wrangler d1 create margaret-memorial` and paste the `database_id` into `wrangler.jsonc`.
2. `npx wrangler d1 execute margaret-memorial --remote --file=schema.sql`
3. `npx wrangler r2 bucket create margaret-memorial-photos`
4. Create a Turnstile widget for margaret.memorial. Put the site key in `.env` as `PUBLIC_TURNSTILE_SITE_KEY`, and run `npx wrangler secret put TURNSTILE_SECRET`.
5. In Zero Trust, add an Access application covering `margaret.memorial/admin*` and `margaret.memorial/api/admin/*`, allowing only the family's emails. Put the team domain and audience tag in `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`.
6. `npm run deploy`, then add margaret.memorial as a custom domain on the Worker.

## Content still to come

- Photos: drop files in `public/photos/` and pass `src` to each `<Frame>` in `src/pages/index.astro`.
- Charity: set `CHARITY` at the top of `src/pages/index.astro`.
- Date of passing: replace `November [X]`.
- Search engines: the site is `noindex` by default (`src/layouts/Base.astro`).
