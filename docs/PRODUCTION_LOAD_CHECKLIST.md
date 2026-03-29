# Production Load Checklist

Use this before or right after deploying Sketch Party to a public relay.

## Before the test

1. Confirm the relay uses the correct `APP_ID`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY`.
2. Confirm `/health` returns `ok: true`.
3. Confirm `/metrics` returns valid JSON.
4. Set `LOG_LEVEL=info` for the test window.
5. Make sure the relay host has enough memory for long-lived WebSocket connections.

## During the test

1. Start with `5-10` real users.
2. Check `/metrics`:
   - `successfulRegistrations`
   - `connectedUsers`
   - `activeSessions`
   - `peakHeapUsedBytes`
   - `protocolErrors`
   - `rateLimitHits`
3. Move to `20-30` users if the first batch stays clean.
4. Ask people to:
   - sign in
   - add friends
   - open sessions
   - send quick drawings
   - send chat messages
   - disconnect and reconnect once
5. Watch process logs for:
   - `registration_rejected`
   - `protocol_error`
   - repeated reconnect churn
   - unexpected restarts

## Safe pass criteria

- No unexpected restarts.
- No meaningful growth in `failedRegistrations`.
- `protocolErrors` stays low.
- `rateLimitHits` only happen during intentional spam tests.
- Reconnect works after brief disconnects.
- Session start and drawing latency feel normal to users.

## If the relay struggles

- Increase instance size first.
- Reduce noisy client retries.
- Lower public rollout speed.
- Keep to a single relay instance until shared presence/session state exists.

## Important scaling note

The current relay is still a single-instance realtime process.

That means:
- tens of users is realistic
- low hundreds may still work on a strong single instance
- multi-instance scaling is not ready yet because realtime session state lives in process memory
