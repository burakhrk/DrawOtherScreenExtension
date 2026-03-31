// Sketch Party / Patreon auth bridge for Supabase Edge Functions (Deno)
// Routes:
//   GET  /auth/patreon/start
//   GET  /auth/patreon/callback
//   POST /auth/patreon/webhook   (placeholder, not implemented here)
//
// Env required:
//   PATREON_CLIENT_ID
//   PATREON_CLIENT_SECRET
//   PATREON_REDIRECT_URI   (e.g. https://<project-ref>.functions.supabase.co/auth/patreon/callback)
//   PATREON_CAMPAIGN_ID    (optional but recommended)
//   PATREON_TIER_MAP_JSON  (optional, see docs)
// Optional for DB upsert:
//   SUPABASE_SERVICE_ROLE_KEY (use service key for writes from the function)
//
// NOTE: This bridge returns identity + entitlements to the extension.
// App-session minting is intentionally left for the next step.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.0";

type PatreonTier = { id: string; title: string; amountCents: number | null };
type AppEntitlementMap = Record<string, { plan: "pro" | "free"; source: string }>;

const patreonClientId = Deno.env.get("PATREON_CLIENT_ID") ?? "";
const patreonClientSecret = Deno.env.get("PATREON_CLIENT_SECRET") ?? "";
const patreonCampaignId = Deno.env.get("PATREON_CAMPAIGN_ID") ?? "";
const patreonRedirectUri = Deno.env.get("PATREON_REDIRECT_URI") ?? "";
const patreonScope = "identity identity.memberships identity[email]";
const patreonTierMapJson = Deno.env.get("PATREON_TIER_MAP_JSON") ?? "";
const patreonStateTtlMs = 10 * 60 * 1000;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

const patreonStates = new Map<string, { createdAt: number; redirect: string; source: string; appId: string }>();

function errorJson(status: number, message: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ok: false, error: message, ...extra }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function okJson(body: Record<string, unknown>) {
  return new Response(JSON.stringify({ ok: true, ...body }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function buildAuthorizeUrl(stateId: string) {
  const url = new URL("https://www.patreon.com/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", patreonClientId);
  url.searchParams.set("redirect_uri", patreonRedirectUri);
  url.searchParams.set("scope", patreonScope);
  url.searchParams.set("state", stateId);
  return url.toString();
}

function normalizeTierTitle(value: string) {
  return value.trim().toLowerCase();
}

let cachedTierMap: Record<string, { tierIds?: string[]; tierTitles?: string[] }> | null = null;
function getTierMap() {
  if (cachedTierMap !== null) return cachedTierMap;
  if (!patreonTierMapJson.trim()) {
    cachedTierMap = {};
    return cachedTierMap;
  }
  try {
    cachedTierMap = JSON.parse(patreonTierMapJson);
  } catch (_err) {
    cachedTierMap = {};
  }
  return cachedTierMap;
}

function inferDefaultEntitlements(tiers: PatreonTier[]): AppEntitlementMap {
  const titles = tiers.map((t) => normalizeTierTitle(t.title));
  const hasSketchPro = titles.some((t) =>
    t.includes("sketch party pro") || t.includes("all extensions") || t.includes("bundle")
  );
  const hasDeepPro = titles.some((t) =>
    t.includes("deep note pro") || t.includes("all extensions") || t.includes("bundle")
  );
  return {
    "sketch-party": { plan: hasSketchPro ? "pro" : "free", source: hasSketchPro ? "patreon-title" : "patreon-no-match" },
    "deep-note": { plan: hasDeepPro ? "pro" : "free", source: hasDeepPro ? "patreon-title" : "patreon-no-match" },
  };
}

function resolveEntitlements(tiers: PatreonTier[]): AppEntitlementMap {
  const tierIds = new Set(tiers.map((t) => t.id.trim()).filter(Boolean));
  const tierTitles = new Set(tiers.map((t) => normalizeTierTitle(t.title)).filter(Boolean));
  const map = getTierMap();
  const fallback = inferDefaultEntitlements(tiers);
  const apps = new Set([...Object.keys(map), ...Object.keys(fallback)]);
  const out: AppEntitlementMap = {};

  for (const app of apps) {
    const conf = map[app] || {};
    const confIds = (conf.tierIds || []).map((t) => t.trim()).filter(Boolean);
    const confTitles = (conf.tierTitles || []).map(normalizeTierTitle).filter(Boolean);
    const matched =
      confIds.some((id) => tierIds.has(id)) ||
      confTitles.some((title) => tierTitles.has(title));

    if (matched) {
      out[app] = { plan: "pro", source: "patreon-tier-map" };
    } else {
      out[app] = fallback[app] || { plan: "free", source: "patreon-no-match" };
    }
  }

  return out;
}

async function exchangeCode(code: string) {
  const res = await fetch("https://www.patreon.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: patreonClientId,
      client_secret: patreonClientSecret,
      redirect_uri: patreonRedirectUri,
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || "token exchange failed");
  return data as { access_token: string };
}

async function fetchIdentity(accessToken: string) {
  const url = new URL("https://www.patreon.com/api/oauth2/v2/identity");
  url.searchParams.set("include", "memberships.currently_entitled_tiers");
  url.searchParams.set("fields[user]", "email,full_name,vanity");
  url.searchParams.set("fields[member]", "patron_status,last_charge_status");
  url.searchParams.set("fields[tier]", "title,amount_cents");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.errors?.[0]?.detail || "identity fetch failed");
  return data;
}

function extractIdentity(payload: any) {
  const data = payload?.data || {};
  const included = Array.isArray(payload?.included) ? payload.included : [];
  const attrs = data.attributes || {};
  const userId = data.id ? `patreon:${data.id}` : "";
  const displayName = attrs.full_name || attrs.vanity || "";
  const email = attrs.email || "";
  const membership = included.find((item: any) => item?.type === "member") || null;
  const membershipStatus = membership?.attributes?.patron_status || membership?.attributes?.last_charge_status || "unknown";
  const tiers: PatreonTier[] = included
    .filter((item: any) => item?.type === "tier")
    .map((item: any) => ({
      id: String(item.id || ""),
      title: item?.attributes?.title || "",
      amountCents: item?.attributes?.amount_cents ?? null,
    }));

  const appEntitlements = resolveEntitlements(tiers);
  const isPro = Object.values(appEntitlements).some((entry) => entry.plan === "pro");

  return {
    userId,
    displayName,
    email,
    membershipStatus,
    tiers,
    appEntitlements,
    isPro,
  };
}

async function upsertPatreonMember(identity: ReturnType<typeof extractIdentity>) {
  if (!supabaseUrl || !serviceRoleKey) {
    return;
  }
  const client = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await client
    .from("patreon_members")
    .upsert({
      patreon_user_id: identity.userId,
      email: identity.email || null,
      tier_id: identity.tiers[0]?.id || null,
      tier_title: identity.tiers[0]?.title || null,
      membership_status: identity.membershipStatus,
      app_entitlements: identity.appEntitlements,
      is_pro: identity.isPro,
      updated_at: new Date().toISOString(),
    })
    .select("patreon_user_id")
    .maybeSingle();
  if (error) {
    console.error("patreon_member_upsert_failed", error.message);
  }
}

function pruneStates() {
  const now = Date.now();
  for (const [key, value] of patreonStates.entries()) {
    if (now - value.createdAt > patreonStateTtlMs) {
      patreonStates.delete(key);
    }
  }
}

function consumeState(stateId: string) {
  pruneStates();
  const entry = patreonStates.get(stateId) || null;
  patreonStates.delete(stateId);
  return entry;
}

serve(async (req) => {
  try {
    const url = new URL(req.url);

    if (url.pathname === "/auth/patreon/start") {
      if (!patreonClientId || !patreonClientSecret || !patreonRedirectUri) {
        return errorJson(503, "Patreon broker is not fully configured", {
          missing: {
            clientId: !patreonClientId,
            clientSecret: !patreonClientSecret,
            redirect: !patreonRedirectUri,
          },
        });
      }

      const stateId = crypto.randomUUID();
      patreonStates.set(stateId, {
        createdAt: Date.now(),
        redirect: url.searchParams.get("redirect_uri") || "",
        source: url.searchParams.get("source") || "extension",
        appId: url.searchParams.get("app_id") || "sketch-party",
      });

      return Response.redirect(buildAuthorizeUrl(stateId), 302);
    }

    if (url.pathname === "/auth/patreon/callback") {
      const err = url.searchParams.get("error") || url.searchParams.get("error_description");
      if (err) return errorJson(400, err);

      const stateId = url.searchParams.get("state") || "";
      const state = consumeState(stateId);
      if (!state) return errorJson(400, "Patreon auth state is missing or expired");

      const code = url.searchParams.get("code") || "";
      if (!code) return errorJson(400, "Missing authorization code");

      const tokens = await exchangeCode(code);
      const identityRaw = await fetchIdentity(tokens.access_token);
      const identity = extractIdentity(identityRaw);
      await upsertPatreonMember(identity);

      const redirect = state.redirect || "";
      const payload = {
        ok: true,
        provider: "patreon",
        status: "identity-only",
        auth_ready: false,
        patreon_user_id: identity.userId,
        display_name: identity.displayName,
        email: identity.email,
        membership_status: identity.membershipStatus,
        tier_titles: identity.tiers.map((t) => t.title).join("|"),
        tier_ids: identity.tiers.map((t) => t.id).join("|"),
        app_entitlements: JSON.stringify(identity.appEntitlements),
        is_pro: identity.isPro,
      };

      if (redirect) {
        const redirectUrl = new URL(redirect);
        for (const [k, v] of Object.entries(payload)) {
          redirectUrl.searchParams.set(k, String(v));
        }
        return Response.redirect(redirectUrl.toString(), 302);
      }

      return okJson(payload);
    }

    if (url.pathname === "/auth/patreon/status") {
      return okJson({
        appId: "sketch-party",
        configured: Boolean(patreonClientId && patreonClientSecret && patreonRedirectUri),
        missing: [
          !patreonClientId ? "PATREON_CLIENT_ID" : null,
          !patreonClientSecret ? "PATREON_CLIENT_SECRET" : null,
          !patreonRedirectUri ? "PATREON_REDIRECT_URI" : null,
        ].filter(Boolean),
        campaignConfigured: Boolean(patreonCampaignId),
        tierMapConfigured: Boolean(patreonTierMapJson),
        note: "OAuth exchange and entitlement mapping are implemented. App-session minting is pending.",
      });
    }

    if (url.pathname === "/auth/patreon/webhook") {
      // Placeholder: implement Patreon webhook verification + membership refresh here.
      return errorJson(501, "Webhook handling not implemented in this scaffold.");
    }

    return errorJson(404, "Not found");
  } catch (error) {
    console.error("patreon_edge_error", error?.message || error);
    return errorJson(500, "Unexpected error", { detail: error?.message || "unknown" });
  }
});
