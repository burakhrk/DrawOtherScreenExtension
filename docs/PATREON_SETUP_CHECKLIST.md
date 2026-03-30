# Patreon Setup Checklist

Use this checklist before enabling Patreon-only auth for Sketch Party.

## Patreon app details needed

- `PATREON_CLIENT_ID`
- `PATREON_CLIENT_SECRET`
- `PATREON_CAMPAIGN_ID`
- `PATREON_REDIRECT_URI`

## Recommended OAuth scopes

- `identity`
- `identity.memberships`
- `identity[email]` if you want email

## Redirect URI guidance

Choose one redirect URI for the auth broker first, for example:

- `https://your-relay-domain.com/auth/patreon/callback`

That exact URL should be configured in the Patreon app.

## Current relay support

The relay now exposes:

- `GET /auth/patreon/status`

This returns:

- whether the Patreon broker env vars are present
- which env vars are still missing
- whether the broker is fully implemented yet

At this stage:

- config readiness is supported
- the actual Patreon OAuth callback exchange is not implemented yet
- the app-session minting step is not implemented yet

## What happens after credentials are added

Next implementation step:

1. redirect user to Patreon OAuth
2. handle callback on the broker
3. fetch Patreon identity + memberships
4. resolve or create the internal Sketch Party user
5. mint the app session used by the extension afterward

## Notes

- Patreon-only login should become the single primary identity
- membership / entitled tiers should become the paid entitlement signal
- do not remove the current working auth path until the Patreon broker can mint a valid app session for:
  - social RPC calls
  - profile writes
  - relay registration
  - session verification
