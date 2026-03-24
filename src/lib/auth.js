import { APP_ID } from "./constants.js";
import { track } from "./analytics.js";
import { supabase } from "./supabase-client.js";

function getDisplayName(user, ownProfile = null) {
  return (
    ownProfile?.display_name ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email ||
    "Misafir"
  );
}

export async function signInWithGoogle() {
  const redirectTo = chrome.identity.getRedirectURL();
  const { data, error } = await supabase.auth.signInWithOAuth({
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

  if (error) {
    throw error;
  }

  const callbackUrl = await chrome.identity.launchWebAuthFlow({
    url: data.url,
    interactive: true,
  });

  const callback = new URL(callbackUrl);
  const authCode = callback.searchParams.get("code");
  const authError = callback.searchParams.get("error_description") || callback.searchParams.get("error");

  if (authError) {
    throw new Error(authError);
  }

  if (!authCode) {
    throw new Error("Google girisi tamamlanamadi.");
  }

  const exchange = await supabase.auth.exchangeCodeForSession(authCode);
  if (exchange.error) {
    throw exchange.error;
  }

  await track("Signed In", {
    surface: "popup",
    result: "success",
    appId: APP_ID,
  });

  return exchange.data.session;
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
