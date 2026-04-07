# Relay deployment without Render secrets

Goal: stop storing Supabase/Patreon secrets on Render and move the relay to Cloudflare (or any host you control) while keeping the same protocol.

## What changed in the repo
- `relay/server.js` no longer carries baked-in Supabase or Patreon defaults. It now **requires** `SUPABASE_URL` and `SUPABASE_ANON_KEY` at process start; otherwise it exits. Patreon keys are also env-only.
- `render.yaml` remains for reference but no secrets are expected there.

## Recommended hosting: Cloudflare Worker
Cloudflare Workers support WebSockets. Use the native Worker WebSocket APIs (no `ws` dependency). A drop-in Durable Object version lives in `workers/relay-do/worker.js`.

Quick deploy outline
1. Copy `workers/relay-do` and create a Worker (e.g., `sketch-party-relay`).
2. Bind a Durable Object:
   ```toml
   [[durable_objects.bindings]]
   name = "RelayHub"
   class_name = "RelayHub"
   ```
3. Env vars:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `RELAY_METRICS_TOKEN` (protects `/api/relay/metrics`)
   - `RELAY_ALLOWED_ORIGINS` (comma-separated; include `chrome-extension://<id>` and `https://extensions-hub-sites.vercel.app`)
   - Optional Patreon vars if this relay needs billing: `PATREON_CLIENT_ID`, `PATREON_CLIENT_SECRET`, `PATREON_CAMPAIGN_ID`, `PATREON_REDIRECT_URI`, `PATREON_TIER_MAP_JSON`
4. Routes:
   - `GET /api/relay/health`
   - `GET /api/relay/metrics` (Bearer token)
   - `WS /api/relay` (or `/api/relay/ws`)
5. Message types supported: `register-user`, `start-session`, `leave-session`, `draw-segment`, `clear-canvas`, `chat`.
6. CORS allowlist to the extension and `https://extensions-hub-sites.vercel.app`; metrics is token-protected.

> Tip: If you prefer not to port now, you can run the existing Node relay on another host (Fly, Railway, or a VPS) with only the env vars above. Render can stay unused.

## When to use a relay (keep Worker shared-safe)
- Use a relay only for products that truly need live canvas/party sessions (e.g., Sketch Party). Simple note/sync flows (e.g., Deep Note) can stay on Supabase + HTTP APIs; no relay needed.
- If the Worker host is shared, isolate relay routes (e.g., `/api/relay/*`) so existing `/api/*` endpoints keep working.
- Prefer Durable Objects for WebSocket coordination; KV is not suitable for realtime state.
- Protect `/api/relay/metrics` with a bearer token or admin password if exposed.
- CORS: allowlist `chrome-extension://<id>` and `https://extensions-hub-sites.vercel.app`; remember WS `Origin` may differ—still enforce allowlist.

## Running locally without secrets in code
```bash
SUPABASE_URL=https://lpgdopfqvertiwcmyokh.supabase.co \
SUPABASE_ANON_KEY=... \
PATREON_CLIENT_ID=... \
PATREON_CLIENT_SECRET=... \
PATREON_REDIRECT_URI=... \
npm start
```

## Next actions (pick one)
1) Port relay to a Cloudflare Worker and deploy (preferred).
2) Host the existing Node relay on a non-Render host with env vars set.
3) If keeping Render temporarily, set env vars there; the code will refuse to start without them, preventing accidental secretless boots.
