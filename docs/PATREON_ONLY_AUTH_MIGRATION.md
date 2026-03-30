# Patreon-only Auth Migration

This project can move to Patreon-only identity, but the current production-safe path is a staged migration.

## Why a direct button swap is not safe

The current extension relies on a Supabase-backed authenticated session for:

- `get_social_state(...)` and the other client RPC calls
- profile updates through `profiles`
- relay registration and session verification
- entitlement resolution tied to the current authenticated user

Today that authenticated session is created through the Google OAuth flow in `src/lib/auth.js`.

Patreon OAuth can provide:

- a stable Patreon user ID
- identity fields such as display name
- membership / entitled tier information

But Patreon OAuth does not drop directly into the existing Supabase session + RLS model without an auth bridge.

## Safe staged plan

### Stage 1

Keep the current working auth path alive while making the extension provider-agnostic:

- centralize auth labels and provider-specific copy in `src/lib/auth.js`
- replace direct `signInWithGoogle()` usage with generic auth entry points
- remove hard-coded Google wording from popup/dashboard surfaces

This stage is safe and keeps the extension working.

### Stage 2

Introduce a Patreon auth broker:

1. User signs in with Patreon
2. Broker exchanges the Patreon OAuth code for a Patreon access token
3. Broker fetches Patreon identity and membership details
4. Broker resolves or creates the app user in our data layer
5. Broker issues the app session that the extension will use afterward

## Data we need from Patreon

- Patreon OAuth client ID
- Patreon OAuth client secret
- creator campaign ID
- approved redirect URL(s)

Likely useful scopes:

- `identity`
- `identity.memberships`
- `identity[email]` if email is needed

## What must change in code later

- `src/lib/auth.js`
  - switch from Google OAuth launch to Patreon broker launch
- `src/lib/sketch-party-social-client.js`
  - depend on the new authenticated app session
- `relay/server.js`
  - validate the new app session format
- popup/dashboard auth copy
  - move from Google-first to Patreon-first wording
- entitlement resolution
  - move toward Patreon membership state as the primary paid signal

## Important note

Do not remove the current auth path until the Patreon broker can mint or provide a session that works with:

- social RPCs
- profile writes
- relay registration
- session verification

That session boundary is the part that keeps the extension from breaking.
