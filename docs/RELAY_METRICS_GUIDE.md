# Relay Metrics Guide

Use the relay metrics endpoint to sanity-check a deployed Sketch Party relay while users are online.

## Endpoint

- `GET /health`
- `GET /metrics`

Example:

```bash
curl https://your-relay.example.com/metrics
```

## What `/metrics` returns

- `uptimeSeconds`
  How long the current relay process has been running.
- `connectedUsers`
  Runtime users currently connected to the relay.
- `activeSessions`
  Realtime sessions currently active in memory.
- `current`
  A point-in-time snapshot:
  - `connectedUsers`
  - `socketCount`
  - `activeSessions`
  - `rssBytes`
  - `heapUsedBytes`
  - `heapTotalBytes`
- `peaks`
  Peak values seen during the recent sample window:
  - `peakConnectedUsers`
  - `peakSocketCount`
  - `peakActiveSessions`
  - `peakRssBytes`
  - `peakHeapUsedBytes`
  - `sampleWindowMs`
- `metrics`
  Cumulative counters since process start:
  - `totalConnections`
  - `successfulRegistrations`
  - `failedRegistrations`
  - `startedSessions`
  - `endedSessions`
  - `forwardedChats`
  - `forwardedDrawSegments`
  - `clearedCanvases`
  - `protocolErrors`
  - `rateLimitHits`

## Healthy signs

- `successfulRegistrations` increases with new users.
- `failedRegistrations` stays near `0`.
- `protocolErrors` stays low.
- `rateLimitHits` stays low during normal usage.
- `peakHeapUsedBytes` climbs gradually, not sharply.
- `activeSessions` roughly matches what you expect from real usage.

## Warning signs

- `failedRegistrations` rising:
  JWT mismatch, expired sessions, or bad auth wiring.
- `protocolErrors` rising:
  Client/relay message mismatch or malformed traffic.
- `rateLimitHits` rising fast:
  Spam, aggressive retry loops, or limits that are too strict.
- `peakHeapUsedBytes` and `rssBytes` increasing continuously without falling:
  Possible memory leak or too-small instance.
- `uptimeSeconds` resetting unexpectedly:
  Crashes or restarts.

## Recommended live checks during a test

1. Open `/metrics` before users join.
2. Ask a small group to sign in and connect.
3. Check `successfulRegistrations`, `connectedUsers`, and `peakSocketCount`.
4. Start several sessions and send drawings/messages.
5. Re-check `startedSessions`, `forwardedChats`, and `forwardedDrawSegments`.
6. Watch for `protocolErrors`, `failedRegistrations`, and `rateLimitHits`.
7. Repeat during a larger session and compare the peaks.
