import {
  APP_ID,
  PAYWALL_URL,
  PRO_ADVANCED_EFFECTS,
  PRO_TRIAL_HOURS,
} from "./constants.js";

function getAppEntitlementMetadata(user) {
  const appMetadata = user?.app_metadata || {};

  return (
    appMetadata.extension_entitlements?.[APP_ID] ||
    appMetadata[APP_ID] ||
    appMetadata.drawing_office ||
    {}
  );
}

function toTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function resolveEntitlement(user) {
  const metadata = getAppEntitlementMetadata(user);
  const explicitPlan = String(metadata.plan || "").trim().toLowerCase();
  const paidUntil = toTimestamp(metadata.pro_until || metadata.proUntil || metadata.expires_at);
  const createdAt = toTimestamp(user?.created_at);
  const now = Date.now();
  const trialEndsAt = createdAt ? createdAt + (PRO_TRIAL_HOURS * 60 * 60 * 1000) : null;
  const trialActive = Boolean(trialEndsAt && now < trialEndsAt);
  const paidActive = Boolean(explicitPlan === "pro" || (paidUntil && paidUntil > now));

  if (paidActive) {
    return {
      plan: "pro",
      isPro: true,
      isTrial: false,
      source: explicitPlan === "pro" ? "app_metadata" : "expires_at",
      trialEndsAt: trialEndsAt ? new Date(trialEndsAt).toISOString() : null,
      hoursRemaining: 0,
      paywallUrl: PAYWALL_URL,
      advancedEffects: PRO_ADVANCED_EFFECTS,
    };
  }

  if (trialActive) {
    return {
      plan: "pro-trial",
      isPro: true,
      isTrial: true,
      source: "signup-trial",
      trialEndsAt: new Date(trialEndsAt).toISOString(),
      hoursRemaining: Math.max(1, Math.ceil((trialEndsAt - now) / (60 * 60 * 1000))),
      paywallUrl: PAYWALL_URL,
      advancedEffects: PRO_ADVANCED_EFFECTS,
    };
  }

  return {
    plan: "free",
    isPro: false,
    isTrial: false,
    source: "free",
    trialEndsAt: trialEndsAt ? new Date(trialEndsAt).toISOString() : null,
    hoursRemaining: 0,
    paywallUrl: PAYWALL_URL,
    advancedEffects: PRO_ADVANCED_EFFECTS,
  };
}

export function getEntitlementBadge(entitlement) {
  if (!entitlement) {
    return {
      title: "Plan bilinmiyor",
      detail: "Hesap bilgisi yuklenince plan durumu gorunur.",
      cta: "Planlari gor",
    };
  }

  if (entitlement.plan === "pro") {
    return {
      title: "Pro aktif",
      detail: "Tum premium cizim modlari ve gelismis efektler acik.",
      cta: "Planlari gor",
    };
  }

  if (entitlement.plan === "pro-trial") {
    return {
      title: "Pro deneme acik",
      detail: `${entitlement.hoursRemaining} saat kadar daha premium ozellikler acik kalacak.`,
      cta: "Pro'ya gec",
    };
  }

  return {
    title: "Free plan",
    detail: "Canli ortak cizim ve gelismis efektler Pro ile acilir.",
    cta: "Pro'ya gec",
  };
}
