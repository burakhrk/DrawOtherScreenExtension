# Relay deployment without Render secrets

Goal: stop storing Supabase/Patreon secrets on Render and move the relay to Cloudflare (or any host you control) while keeping the same protocol.

## What changed in the repo
- `relay/server.js` no longer carries baked-in Supabase or Patreon defaults. It now **requires** `SUPABASE_URL` and `SUPABASE_ANON_KEY` at process start; otherwise it exits. Patreon keys are also env-only.
- `render.yaml` remains for reference but no secrets are expected there.

## Recommended hosting: Cloudflare Worker
Cloudflare Workers support WebSockets. The existing relay logic is Node-based; to run it on Workers, use the native Worker WebSocket APIs (no `ws` dependency). Outline:

1. Create a new Worker (e.g., `sketch-party-relay`).
2. Store env vars in the Worker:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - (optional) `PATREON_CLIENT_ID`, `PATREON_CLIENT_SECRET`, `PATREON_CAMPAIGN_ID`, `PATREON_REDIRECT_URI`, `PATREON_TIER_MAP_JSON`
3. Port the relay logic to Workers (native `WebSocketPair`). Keep the message types identical (`register-user`, `start-session`, `chat`, `draw`, `clear`, etc.) so the extension and dashboard continue working.
4. Expose:
   - `GET /health`
   - `GET /metrics` (can be a lightweight JSON snapshot)
   - WebSocket upgrade at `/` (or `/relay`)
   - Patreon broker routes if you still want them on the relay host.
5. Keep CORS allowlist to the extension and `https://extensions-hub-sites.vercel.app`.

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
