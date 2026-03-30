import {
  APP_ID,
  DEFAULT_RELAY_URL,
  PATREON_AUTH_STATE_KEY,
  PRIMARY_AUTH_MODE,
  PROFILE_STORAGE_KEY,
} from "./constants.js";
import { track } from "./analytics.js";
import { getLocalObject, setLocalObject } from "./chrome-storage.js";
import { createPartyCode } from "./party-code.js";
import { supabase } from "./supabase-client.js";

const AUTH_PROVIDER_MAP = {
  google: {
    key: "google",
    strategy: "supabase-oauth-google",
    signInButtonLabel: "Sign in with Google",
    signInStatusLabel: "Opening Google sign-in...",
    signInErrorLabel: "Google sign-in failed.",
    signedOutTitle: "Waiting for sign-in",
    signedOutSubtitle: "Your account, friends, and preferences will load after sign-in.",
  },
  patreon: {
    key: "patreon",
    strategy: "relay-patreon-bridge",
    signInButtonLabel: "Sign in with Patreon",
    signInStatusLabel: "Opening Patreon sign-in...",
    signInErrorLabel: "Patreon sign-in failed.",
    signedOutTitle: "Waiting for sign-in",
    signedOutSubtitle: "Your account, friends, and preferences will load after sign-in.",
  },
};

export const AUTH_PROVIDER = AUTH_PROVIDER_MAP[PRIMARY_AUTH_MODE] || AUTH_PROVIDER_MAP.patreon;
const patreonAuthListeners = new Set();

function getDisplayName(user, ownProfile = null) {
  return (
    ownProfile?.display_name ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    (user?.id ? `Party ${createPartyCode(user.id)}` : null) ||
    "Guest"
  );
}

function emitPatreonAuthState(event, session) {
  const mappedSession = session
    ? {
        ...session,
        user: mapPatreonSessionToUser(session),
      }
    : null;

  for (const listener of patreonAuthListeners) {
    try {
      listener(event, mappedSession);
    } catch (error) {
      console.error(error);
    }
  }
}

function normalizeRelayUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return DEFAULT_RELAY_URL;
  }

  return new URL(trimmed).toString().replace(/\/$/, "");
}

async function getRelayBaseUrl() {
  const localProfile = await getLocalObject(PROFILE_STORAGE_KEY, {});
  return normalizeRelayUrl(localProfile?.serverUrl || DEFAULT_RELAY_URL);
}

function mapPatreonSessionToUser(session) {
  if (!session?.userId) {
    return null;
  }

  return {
    id: session.userId,
    email: session.email || null,
    user_metadata: {
      full_name: session.displayName || null,
      name: session.displayName || null,
      provider: "patreon",
      membership_status: session.membershipStatus || null,
      is_pro: session.isPro === true,
    },
  };
}

async function getPatreonSession() {
  return getLocalObject(PATREON_AUTH_STATE_KEY, null);
}

async function setPatreonSession(session) {
  await setLocalObject(PATREON_AUTH_STATE_KEY, session);
  emitPatreonAuthState("SIGNED_IN", session);
  return session;
}

async function clearPatreonSession() {
  await chrome.storage.local.remove(PATREON_AUTH_STATE_KEY);
  emitPatreonAuthState("SIGNED_OUT", null);
}

async function signInWithPatreonBridge() {
  const relayBaseUrl = await getRelayBaseUrl();
  const extensionRedirect = chrome.identity.getRedirectURL("patreon");
  const startUrl = new URL(`${relayBaseUrl}/auth/patreon/start`);
  startUrl.searchParams.set("redirect_uri", extensionRedirect);
  startUrl.searchParams.set("app_id", APP_ID);
  startUrl.searchParams.set("source", "chrome-extension");

  let callbackUrl;
  try {
    callbackUrl = await chrome.identity.launchWebAuthFlow({
      url: startUrl.toString(),
      interactive: true,
    });
  } catch (launchError) {
    throw new Error(
      `Patreon login popup could not complete. Make sure the Patreon app redirect URI is set to ${relayBaseUrl}/auth/patreon/callback and that the broker is live. ${launchError?.message || ""}`.trim(),
    );
  }

  const callback = new URL(callbackUrl);
  const authError = callback.searchParams.get("error_description")
    || callback.searchParams.get("message")
    || callback.searchParams.get("error");

  if (authError) {
    throw new Error(authError);
  }

  const status = callback.searchParams.get("status") || "";
  if (!status) {
    throw new Error("Patreon sign-in did not return a usable result.");
  }

  const session = {
    provider: "patreon",
    userId: callback.searchParams.get("patreon_user_id") || "",
    displayName: callback.searchParams.get("display_name") || "",
    email: callback.searchParams.get("email") || "",
    membershipStatus: callback.searchParams.get("membership_status") || "unknown",
    tierTitle: callback.searchParams.get("tier_title") || "",
    isPro: callback.searchParams.get("is_pro") === "true",
    authReady: callback.searchParams.get("auth_ready") === "true",
    accessToken: null,
    source: "relay-broker",
  };

  if (!session.userId) {
    throw new Error("Patreon sign-in did not return a Patreon user id.");
  }

  await setPatreonSession(session);
  await track("Signed In", {
    surface: "extension",
    result: "success",
    provider: "patreon",
    appId: APP_ID,
    authReady: session.authReady,
  });

  if (session.authReady !== true) {
    throw new Error(
      "Patreon identity was received, but Sketch Party app session minting is not connected yet. Finish the relay auth bridge before switching the extension to Patreon-only mode.",
    );
  }

  return session;
}

async function signInWithGoogle() {
  const redirectTo = chrome.identity.getRedirectURL();
  let data;
  let error;

  try {
    const response = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
    data = response.data;
    error = response.error;
  } catch (oauthError) {
    throw new Error(
      `Google OAuth could not start. This callback must be allowlisted in Supabase: ${redirectTo}. ${oauthError?.message || ""}`.trim(),
    );
  }

  if (error) {
    throw new Error(
      `${error.message || "Google OAuth could not start."} Callback: ${redirectTo}`,
    );
  }

  let callbackUrl;
  try {
    callbackUrl = await chrome.identity.launchWebAuthFlow({
      url: data.url,
      interactive: true,
    });
  } catch (launchError) {
    throw new Error(
      `Google login popup could not complete. You may need to update the redirect allowlist for the new extension ID. Callback: ${redirectTo}. ${launchError?.message || ""}`.trim(),
    );
  }

  const callback = new URL(callbackUrl);
  const authCode = callback.searchParams.get("code");
  const authError = callback.searchParams.get("error_description") || callback.searchParams.get("error");

  if (authError) {
    throw new Error(`${authError}. Callback: ${redirectTo}`);
  }

  if (!authCode) {
    throw new Error(`Google sign-in could not be completed. Callback: ${redirectTo}`);
  }

  const exchange = await supabase.auth.exchangeCodeForSession(authCode);
  if (exchange.error) {
    throw new Error(`${exchange.error.message || "Session exchange failed."} Callback: ${redirectTo}`);
  }

  await track("Signed In", {
    surface: "popup",
    result: "success",
    appId: APP_ID,
  });

  return exchange.data.session;
}

export async function beginPrimarySignIn() {
  if (AUTH_PROVIDER.key === "patreon") {
    return signInWithPatreonBridge();
  }

  return signInWithGoogle();
}

export async function signOut() {
  if (AUTH_PROVIDER.key === "patreon") {
    await clearPatreonSession();
    await track("Signed Out", {
      surface: "popup",
      result: "success",
      provider: "patreon",
    });
    return;
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }

  await track("Signed Out", {
    surface: "popup",
    result: "success",
  });
}

export async function getSession() {
  if (AUTH_PROVIDER.key === "patreon") {
    const session = await getPatreonSession();
    return session
      ? {
          ...session,
          user: mapPatreonSessionToUser(session),
        }
      : null;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session;
}

export async function getAccessToken() {
  if (AUTH_PROVIDER.key === "patreon") {
    const session = await getPatreonSession();
    return session?.accessToken || null;
  }

  const session = await getSession();
  return session?.access_token || null;
}

export async function getCurrentUser() {
  if (AUTH_PROVIDER.key === "patreon") {
    const session = await getPatreonSession();
    return mapPatreonSessionToUser(session);
  }

  const { data, error } = await supabase.auth.getUser();
  if (error?.name === "AuthSessionMissingError") {
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.user ?? null;
  }
  if (error) {
    throw error;
  }
  return data.user ?? null;
}

export function onAuthStateChange(callback) {
  if (AUTH_PROVIDER.key === "patreon") {
    patreonAuthListeners.add(callback);
    return {
      data: {
        subscription: {
          unsubscribe() {
            patreonAuthListeners.delete(callback);
          },
        },
      },
    };
  }

  return supabase.auth.onAuthStateChange(callback);
}

export function getBestDisplayName(user, ownProfile = null) {
  return getDisplayName(user, ownProfile);
}

export async function getAuthenticatedUser() {
  return getCurrentUser();
}

export async function getPrimaryAccessToken() {
  return getAccessToken();
}

export function onPrimaryAuthStateChange(callback) {
  return onAuthStateChange(callback);
}

export { signInWithGoogle, signInWithPatreonBridge };
