import { APP_ID } from "./constants.js";
import { track } from "./analytics.js";
import { createPartyCode } from "./party-code.js";
import { supabase } from "./supabase-client.js";

export const AUTH_PROVIDER = {
  key: "google",
  strategy: "supabase-oauth-google",
  signInButtonLabel: "Sign in with Google",
  signInStatusLabel: "Opening Google sign-in...",
  signInErrorLabel: "Google sign-in failed.",
  signedOutTitle: "Waiting for sign-in",
  signedOutSubtitle: "Your account, friends, and preferences will load after sign-in.",
};

function getDisplayName(user, ownProfile = null) {
  return (
    ownProfile?.display_name ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    (user?.id ? `Party ${createPartyCode(user.id)}` : null) ||
    "Guest"
  );
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
  return signInWithGoogle();
}

export async function signOut() {
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
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session;
}

export async function getAccessToken() {
  const session = await getSession();
  return session?.access_token || null;
}

export async function getCurrentUser() {
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

export { signInWithGoogle };
