# Sketch Party

Sketch Party is a Chrome extension plus a stateless WebSocket relay for social drawing, surprise effects, and lightweight realtime sessions.

## Project Structure

- `src/background/`: service worker and tab messaging bridge
- `src/content/`: surprise overlay content script
- `src/dashboard/`: main board UI
- `src/popup/`: popup sign-in and quick actions UI
- `src/lib/`: Supabase auth, social client, analytics, and shared helpers
- `src/types/`: reserved for future type files
- `relay/`: deployable stateless WebSocket relay
- `public/icons/`: extension icons
- `scripts/`: project scripts, build helpers, smoke tests, and load tests
- `store-assets/`: store screenshots and promo outputs
- `docs/`: product, analytics, metrics, and production notes
- `extension-marketing-kit/`: reusable screenshot and promo generation scripts

## Important Files

- `manifest.json`: Chrome extension manifest
- `src/popup/popup.html`: popup UI
- `src/dashboard/dashboard.html`: friends, drawing, and chat UI
- `src/lib/`: auth, Supabase client, and social wrapper
- `relay/server.js`: JWT-verified realtime relay
- `docs/ANALYTICS_ROADMAP.md`: analytics expansion notes
- `docs/RELAY_METRICS_GUIDE.md`: how to read hosted relay metrics
- `docs/PRODUCTION_LOAD_CHECKLIST.md`: rollout and hosted load test checklist
- `docs/PATREON_ONLY_AUTH_MIGRATION.md`: staged plan for moving from the current auth path to Patreon-only identity
- `docs/PATREON_SETUP_CHECKLIST.md`: the Patreon app values and broker configuration needed before the switch

## Local Setup

1. Install Node.js if needed.
2. Run `npm install` in this folder.
3. Run `npm run build` for the extension package.
4. Run `npm start` to start the relay.
5. Open `chrome://extensions`.
6. Turn on Developer mode.
7. Use `Load unpacked` and select `dist`.
8. In the popup, use `http://localhost:3000` as the server URL for local testing.
9. Open the board and share your party code with a friend.
10. Send a friend request with their party code or exact profile name.
11. Start a session from the friend list.
12. In `Send drawing` mode, one side draws and the other watches.
13. In `Live mode`, both sides can draw together.

## Build Output

- `npm run build` recreates `dist/` from scratch every time.
- `dist/` only contains the files needed by the extension: `manifest.json`, `src/`, `public/`.
- `dist/` is ignored by Git, so repeated builds do not dirty the repo.
- Use `dist/` for Chrome `Load unpacked` and store packaging.

## Hosted Relay

This project is designed to be deployed to an internet-accessible Node host.

1. `relay/server.js` serves both HTTP and WebSocket on one port.
2. `GET /health` is available for health checks.
3. `GET /metrics` is available for runtime counters and memory snapshots.
4. `GET /auth/patreon/status` reports whether the Patreon broker env vars are present yet.
5. In the extension, entering `https://your-domain.com` is enough; the client converts it to `wss://` automatically.

Example deployment options:

- A VPS with `npm install` and `npm start`
- Docker on a cloud host
- Render, Railway, or Fly.io single-instance Node services

To run with Docker:

1. `docker build -t sync-sketch-party .`
2. `docker run -p 3000:3000 -e APP_ID=sketch-party -e SUPABASE_URL=https://... -e SUPABASE_ANON_KEY=... sync-sketch-party`

After deployment, enter a hosted URL such as `https://draw.yourapp.com` in the extension.

## Quick Hosted Test: Render

To test quickly across different computers, deploy the relay on Render.

1. Push this repo to GitHub.
2. In Render, choose `New +` -> `Blueprint`.
3. Connect the repo; Render will read `render.yaml`.
4. After deployment, Render gives you a `https://...onrender.com` URL.
5. Use that URL in the extension popup.
6. The client automatically converts it to a secure WebSocket connection.

Notes:

- Render supports public WebSocket connections. [WebSockets on Render](https://render.com/docs/websocket)
- Render web services expose a public TLS URL and require the app to bind to `PORT`. The relay already does this. [Web Services](https://render.com/docs/web-services)

## Notes

- Drawings are only live inside the current session; past canvas history is not replayed to future sessions.
- The relay is stateless; Supabase is the source of truth for account, friendship, and preference data.
- Identity is account-based, not device-key-based; the relay verifies access tokens during registration.
- Realtime session start must match an active row in Supabase `sessions`; a WebSocket message alone is not enough.
- Brief disconnects do not drop the session immediately; the default reconnect grace window is `8` seconds.
- The relay includes basic payload guards and rate limits for safer public distribution.
- The current relay is still single-instance realtime infrastructure; multi-instance scaling is not implemented yet.

## Tests

- `npm run test:relay-smoke`: tests register, presence, session verification, chat/draw forwarding, rate limiting, and metrics using a mock Supabase.
- `npm run test:relay-load`: runs a local concurrent relay benchmark with many simulated users and sessions.
