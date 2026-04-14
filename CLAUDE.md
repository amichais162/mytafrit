# Mytafrit — Project Context for Claude Code

## What this is
SaaS platform for Israeli home food businesses. Business owners build a digital menu, share a WhatsApp link, customers order through it, and the system sends a formatted WhatsApp message to the owner.

Live at `mytafrit.co.il`. Currently in development — no real paying users yet.

## Stack
- **Frontend**: Vanilla HTML/CSS/JS (no framework). RTL Hebrew.
- **Styling**: Tailwind CSS with **local build** (not CDN). Config in `tailwind.config.js`, source in `styles.src.css`, compiled output in `styles.css`. Build: `npm run build`, watch: `npm run watch`.
- **Backend**: Supabase (Postgres + Auth + Storage). Free tier.
- **Hosting**: GitHub Pages, repo `amichais162/mytafrit`.
- **CDN**: Cloudflare in front of GitHub Pages.
- **Worker**: Cloudflare Worker at `mytafrit.co.il/menu*`. Source in `worker/` directory. Deploy with `wrangler deploy` from that directory. Currently injects dynamic OG meta tags based on `?slug=xxx`. Will be expanded in later stages to include a `/publish` endpoint and data injection.

## Files in the project

### Public HTML pages
- `index.html` — landing page
- `menu.html` — public menu (customer-facing). Recently completed a 14-stage improvement project. Currently in good shape.
- `admin.html` — admin panel for business owners. Currently being refactored (this project).
- `login.html` — Supabase auth screens (login, register, forgot, reset, check-email)
- `terms.html` — terms of service

### Config & build
- `tailwind.config.js` — Tailwind config. Content paths must include all HTML files that use Tailwind classes.
- `styles.src.css` — Tailwind source with custom CSS for menu.html
- `admin.css` — (will be created) custom CSS for admin.html
- `styles.css` — compiled output (git-ignored? check)
- `package.json` — npm scripts
- `supabase.js` — shared Supabase client module

### Private / local-only
- `admin_users.html` — personal super-admin tool. Runs only on localhost. Contains service_role key. **Never touch this file. Never suggest moving it to production.**
- `.claude/` — Claude Code settings
- `start.bat` — local dev server launcher

### Worker
- `worker/wrangler.toml`, `worker/src/worker.js`, `worker/package.json`, `worker/README.md`

## Supabase schema (current reality)

Tables: `profiles`, `settings`, `categories`, `products`.

### profiles
- `id` (uuid, FK to auth.users)
- `status` (text, 'trial' | 'active' | 'expired')
- `trial_ends_at` (timestamptz)
- `created_at`, `notes`

### settings (per-user, UNIQUE on user_id)
- `id`, `user_id` (FK, UNIQUE)
- `business_name`, `tagline`, `contact_name`
- `whatsapp`, `phone`, `pickup_area`
- `logo_url`, `hero_bg_url`, `about_image_url`
- `about_text`, `terms_text`, `banner_text`, `banner_active`
- `working_hours` (text — pre-formatted string)
- `active_days` (jsonb — currently messy, contains `_overrides` and `_defaults` fields mixed with day data)
- `allow_same_day` (bool)
- `slug` (text, UNIQUE)
- `testimonials` (jsonb array)
- `created_at`, `updated_at`

### categories
- `id`, `user_id` (FK), `name`, `sort_order`, `created_at`

### products
- `id`, `user_id` (FK), `name`, `description`, `price`
- `image_url`, `allergens`, `dietary_type`
- `is_active`, `is_bestseller`, `is_new`, `is_sold_out`
- `sort_order`, `categories` (uuid[] — **array**, not FK)
- `created_at`, `updated_at`

### RLS
- Users can read/write their own data (auth.uid() = user_id).
- Public can read `settings` where `slug IS NOT NULL`.
- Public can read all `categories` and `products` (RLS policies use `USING (true)`).

### Auto-trigger on signup
`handle_new_user()` creates `profiles` row with 14-day trial + empty `settings` row. Fires after INSERT on auth.users.

### Schema is maintained manually
Schema changes are run manually via Supabase SQL Editor. No migrations framework. There used to be `schema.sql` and `fix-trigger.sql` files but they are outdated and will be deleted.

## Storage
- Single bucket: `images` (public)
- Folders: `products/`, `settings/`
- File naming: `{user_id}_{timestamp}.jpg`

## Design system (admin.html vs menu.html are different!)

### menu.html — uses Tailwind tokens from tailwind.config.js
- surface: #fcf9f4
- primary: #712c00
- primary-container: #92400e
- primary-fixed: #ffdbcb
- on-surface: #1c1c19
- outline: #887269
- Fonts: Heebo (Hebrew), Plus Jakarta Sans (Latin), Material Symbols Outlined
- Border radius: DEFAULT 1rem, lg 2rem, xl 3rem

### admin.html — uses custom CSS variables (different aesthetic)
- --accent: #92400e
- --accent-light: #fffbeb
- --accent-dark: #78350f
- --surface: #ffffff
- --bg: #f5f7fa
- --border: #e8ecf0
- --text: #111827
- --text-2: #6b7280
- --text-3: #9ca3af
- Cleaner, whiter, more minimal look. Not the same as menu.html.

**Do not unify the two design systems.** They serve different audiences (customers vs business owners).

## How we work

1. **Stages, not chaos**: The refactoring is structured into ordered stages. Each stage has prompts with clear scope. Don't add "improvements" not asked for.
2. **One focus per prompt**: Each prompt touches a specific area. Don't ricochet across files.
3. **No git commits from Claude Code**: The user (amichai) runs `git add .`, `git commit -m "..."`, `git push` manually after reviewing each stage.
4. **Small steps verifiable one-by-one**: Better 5 small safe changes than one big risky one.
5. **Preserve what works**: menu.html is in good shape after a 14-stage project. Don't refactor it for aesthetics — only touch it when a stage explicitly requires it.
6. **Hebrew UI, English code**: User-facing text is Hebrew. Code, comments, commit messages, file names are English.
7. **Report, don't improvise**: If a step fails or reveals something unexpected, stop and report. Don't "fix" things you weren't asked to fix.

## Things that must never happen

- **Never touch `admin_users.html`.** It's personal and local-only. Don't edit, don't suggest changes, don't include in builds.
- **Never commit to git.** User does it manually.
- **Never add Tailwind CDN back to any page.** We use local build only.
- **Never hardcode Supabase service_role key anywhere in production files.**
- **Never assume schema matches `schema.sql` or `fix-trigger.sql`.** Those files are outdated and should be deleted.
- **Never delete data without explicit user confirmation.** Especially not from Supabase or localStorage with user content.
