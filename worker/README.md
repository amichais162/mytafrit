# Mytafrit Cloudflare Worker

Middleware that injects dynamic Open Graph meta tags into menu.html based on the `?slug=xxx` query parameter.

## Files

- `src/worker.js` — main worker code
- `wrangler.toml` — Cloudflare Wrangler config
- `package.json` — npm dependencies

## Development

```bash
cd worker
npm install
npm run dev    # local dev server
npm run deploy # deploy to Cloudflare
```

## How it works

1. Request comes to `mytafrit.co.il/menu?slug=xxx`
2. Worker extracts the slug
3. Fetches business settings from Supabase
4. Fetches original HTML from GitHub Pages
5. Replaces `<title>`, `meta description`, favicon, and injects OG/Twitter tags
6. Caches the result for 5 minutes per slug
7. On any error — falls back to serving the original HTML
