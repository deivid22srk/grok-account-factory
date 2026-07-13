# Grok Account Factory

Web UI (Next.js 16 + TypeScript + Tailwind + shadcn/ui) for creating and
managing xAI / Grok accounts that work with
[`grok-proxy-cli`](https://github.com/deivid22srk/grok-proxy-cli).

## What it does

- **Lists existing accounts** from `grok-proxy-cli`'s on-disk store
  (`~/.local/share/GrokDesktop/accounts/*.json`)
- **Creates new accounts** end-to-end:
  1. Provisions a temporary mailbox at [mail.tm](https://mail.tm)
  2. Starts an OAuth 2.0 device-code flow against `auth.x.ai`
  3. Returns a verification URL + email + password to the user
  4. User opens the URL in a browser, signs in with the temp email,
     clicks "Allow"
  5. The UI polls in the background, detects the token, and saves it
     to the store in the exact format `grok-proxy-cli` expects
- **Manages accounts**: activate, refresh tokens, delete

## Architecture

```
src/lib/account-factory/
  tempmail.ts      # mail.tm client (temp email + inbox polling)
  oauth.ts         # OAuth 2.0 device-code flow against auth.x.ai
  store.ts         # read/write grok-proxy-cli's on-disk store format
  jobs.ts          # in-memory job manager for async creation flows

src/app/api/
  accounts/list            GET    - list stored accounts
  accounts/create          POST   - start a new creation job
  accounts/[id]            DELETE - remove an account
  accounts/[id]/activate   POST   - mark as active
  accounts/[id]/refresh    POST   - refresh tokens
  jobs/[id]                GET    - poll a creation job
  jobs/list                GET    - list all jobs

src/app/page.tsx           # the UI (accounts table + creation flow panel)
```

## Local development

```bash
bun install
bun run dev          # http://localhost:3000
```

## Deploy on Render

This repo includes a `render.yaml` blueprint. Connect the repo on Render
and the service will be created automatically. Or use the Render API:

```bash
curl -X POST https://api.render.com/v1/services \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d @render-service.json
```

The app persists account data under `GROK_DATA_DIR` (defaults to
`~/.local/share/GrokDesktop`, set to `/data/GrokDesktop` on Render with
a 1GB persistent disk).

## Notes / limitations

- `accounts.x.ai` (the human login UI) is behind Cloudflare; this app
  talks only to `auth.x.ai` (the OAuth API) which is reachable from
  any IP.
- The user still has to click "Allow" on the xAI verification page —
  that step is intentional and required by the OAuth device-code flow.
- This project is **not affiliated with xAI**. Use at your own risk
  and review xAI's ToS before creating accounts in bulk.

## License

MIT (non-commercial) — same as the upstream `grok-proxy-cli`.
