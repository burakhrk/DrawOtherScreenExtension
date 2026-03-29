import { track } from "../lib/analytics.js";
import { getCurrentUser, onAuthStateChange, signInWithGoogle, signOut } from "../lib/auth.js";
import {
  FRIEND_ONLINE_NOTIFICATIONS_ENABLED_KEY,
  POPUP_HERO_DISMISSED_KEY,
  QUICK_ACTION_KEY,
  PROFILE_STORAGE_KEY,
} from "../lib/constants.js";
import { getLocalObject, setLocalObject } from "../lib/chrome-storage.js";
import { bootstrap, setPreferences } from "../lib/sketch-party-social-client.js";

const DEFAULT_SERVER_URL = "https://sync-sketch-party.onrender.com";
const QUICK_EFFECTS = {
  crack: { effect: "crack", color: "#f4f0ea", size: 6, label: "Broken screen" },
  drip: { effect: "drip", color: "#cb3046", size: 6, label: "Paint drip" },
  bullet: { effect: "bullet", color: "#d8d2ca", size: 6, label: "Bullet impact - Pro", pro: true },
  zap: { effect: "zap", color: "#f8f2b3", size: 6, label: "Lightning - Pro", pro: true },
  heartburst: { effect: "heartburst", color: "#ff5b7c", size: 6, label: "Heart burst - Pro", pro: true },
  stickman: { effect: "stickman", color: "#232018", size: 6, label: "Stickman - Pro", pro: true },
};

const form = document.getElementById("session-form");
const accountCard = document.getElementById("accountCard");
const heroCard = document.getElementById("heroCard");
const closeHeroButton = document.getElementById("closeHeroButton");
const onlinePresenceToggle = document.getElementById("onlinePresenceToggle");
const serverUrlInput = document.getElementById("serverUrl");
const extensionEnabledInput = document.getElementById("extensionEnabled");
const allowSurpriseInput = document.getElementById("allowSurprise");
const friendOnlineNotificationsInput = document.getElementById("friendOnlineNotifications");
const quickMessageInput = document.getElementById("quickMessage");
const quickEffectSelect = document.getElementById("quickEffect");
const openWithMessageButton = document.getElementById("openWithMessage");
const sendEffectButton = document.getElementById("sendEffectButton");
const accountTitle = document.getElementById("accountTitle");
const accountSubtitle = document.getElementById("accountSubtitle");
const accountAvatar = document.getElementById("accountAvatar");
const accountStatePill = document.getElementById("accountStatePill");
const signInButton = document.getElementById("signInButton");
const signOutButton = document.getElementById("signOutButton");
const statusText = document.getElementById("statusText");
const openBoardButton = document.getElementById("openBoardButton");
const quickActionsBlock = document.getElementById("quickActionsBlock");
const noFriendsHint = document.getElementById("noFriendsHint");

let currentState = null;
let suppressNextAuthRefresh = false;

async function applyHeroVisibility() {
  const dismissed = await getLocalObject(POPUP_HERO_DISMISSED_KEY, false);
  heroCard.classList.toggle("hidden", Boolean(dismissed));
}

function avatarFromName(name) {
  const safe = (name || "SP").trim();
  const parts = safe.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "SP";
}

function normalizeServerUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_SERVER_URL;
  }

  const url = new URL(trimmed);
  return url.toString().replace(/\/$/, "");
}

function setGuardedState(element, guarded) {
  element.classList.toggle("is-guarded", guarded);
  element.setAttribute("aria-disabled", String(guarded));
}

function toggleAuthenticatedUI(isAuthenticated) {
  form.classList.toggle("is-disabled", !isAuthenticated);
  setGuardedState(openBoardButton, false);
  setGuardedState(openWithMessageButton, !isAuthenticated);
  setGuardedState(sendEffectButton, !isAuthenticated);
  onlinePresenceToggle.disabled = !isAuthenticated;
  quickEffectSelect.disabled = false;
  signInButton.classList.toggle("hidden", isAuthenticated);
  signOutButton.classList.toggle("hidden", !isAuthenticated);
}

function updateQuickActionsVisibility(friendCount) {
  const hasFriends = friendCount > 0;
  quickActionsBlock.classList.toggle("hidden", !hasFriends);
  noFriendsHint.classList.toggle("hidden", hasFriends);
}

function syncEffectEntitlementUI(entitlement) {
  const isPro = Boolean(entitlement?.isPro);

  for (const option of quickEffectSelect.options) {
    const requiresPro = option.dataset.pro === "true";
    option.disabled = requiresPro && !isPro;
  }

  const currentOption = quickEffectSelect.selectedOptions[0];
  if (currentOption?.dataset.pro === "true" && !isPro) {
    quickEffectSelect.value = "";
  }
}

function applySignedInPendingUI(user) {
  const displayName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email ||
    "Sketch Party user";

  currentState = {
    user: {
      displayName,
      email: user?.email || "",
    },
    preferences: {
      extensionEnabled: true,
      appearOnline: true,
      allowSurprise: true,
    },
    entitlement: null,
    friends: [],
    incomingRequests: [],
  };

  accountTitle.textContent = displayName;
  accountSubtitle.textContent = user?.email || "Your account is connected. Loading your Sketch Party state...";
  accountAvatar.textContent = avatarFromName(displayName);
  accountStatePill.textContent = "Signed in";
  accountStatePill.style.background = "var(--success)";
  onlinePresenceToggle.checked = true;
  statusText.textContent = "Finishing setup and loading your friends...";
  accountCard.classList.remove("is-signed-out-minimal");
  accountCard.classList.add("is-signed-in-minimal");
  syncEffectEntitlementUI(null);
  updateQuickActionsVisibility(0);
  toggleAuthenticatedUI(true);
}

async function openPaywall() {
  const paywallUrl = currentState?.entitlement?.paywallUrl;
  if (!paywallUrl) {
    statusText.textContent = "The paywall URL is not configured yet.";
    return;
  }

  await track("Opened Paywall", {
    screen: "popup",
    surface: "membership",
    result: "success",
  });

  await chrome.tabs.create({ url: paywallUrl });
}

async function openBoard(quickAction = null) {
  const storedProfile = (await getLocalObject(PROFILE_STORAGE_KEY, {})) || {};
  const serverUrl = normalizeServerUrl(serverUrlInput.value);

  await setLocalObject(PROFILE_STORAGE_KEY, {
    ...storedProfile,
    serverUrl,
  });

  if (quickAction) {
    await setLocalObject(QUICK_ACTION_KEY, quickAction);
  } else {
    await chrome.storage.local.remove(QUICK_ACTION_KEY);
  }

  const url = new URL(chrome.runtime.getURL("src/dashboard/dashboard.html"));
  url.searchParams.set("serverUrl", serverUrl);
  await chrome.tabs.create({ url: url.toString() });
  window.close();
}

async function applyBootstrapState(state) {
  currentState = state;
  const notificationsEnabled = await getLocalObject(FRIEND_ONLINE_NOTIFICATIONS_ENABLED_KEY, false);
  friendOnlineNotificationsInput.checked = Boolean(notificationsEnabled);

  if (!state) {
    accountTitle.textContent = "Sketch Party";
    accountSubtitle.textContent = "";
    accountAvatar.textContent = "SP";
    accountStatePill.textContent = "Not ready";
    accountStatePill.style.background = "#f3e5d5";
    onlinePresenceToggle.checked = false;
    statusText.textContent = "Open the board anytime or sign in here.";
    serverUrlInput.value = (await getLocalObject(PROFILE_STORAGE_KEY, {}))?.serverUrl || DEFAULT_SERVER_URL;
    syncEffectEntitlementUI(null);
    accountCard.classList.add("is-signed-out-minimal");
    accountCard.classList.remove("is-signed-in-minimal");
    updateQuickActionsVisibility(0);
    toggleAuthenticatedUI(false);
    return;
  }

  const localProfile = (await getLocalObject(PROFILE_STORAGE_KEY, {})) || {};
  serverUrlInput.value = localProfile.serverUrl || DEFAULT_SERVER_URL;
  extensionEnabledInput.checked = state.preferences.extensionEnabled;
  onlinePresenceToggle.checked = state.preferences.appearOnline;
  allowSurpriseInput.checked = state.preferences.allowSurprise;
  accountTitle.textContent = state.user.displayName;
  accountSubtitle.textContent = state.user.email || "Your Sketch Party account is connected.";
  accountAvatar.textContent = avatarFromName(state.user.displayName);
  accountStatePill.textContent = state.preferences.extensionEnabled
    ? (state.preferences.appearOnline ? "Online" : "Hidden")
    : "Inactive";
  accountStatePill.style.background = state.preferences.extensionEnabled
    ? (state.preferences.appearOnline ? "var(--success)" : "var(--blue)")
    : "#f3e5d5";
  syncEffectEntitlementUI(state.entitlement);
  statusText.textContent = `${state.friends.length} friends and ${state.incomingRequests.length} incoming requests are ready.`;
  accountCard.classList.remove("is-signed-out-minimal");
  accountCard.classList.add("is-signed-in-minimal");
  updateQuickActionsVisibility(state.friends.length);
  toggleAuthenticatedUI(true);
}

async function refreshBootstrapState() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      await applyBootstrapState(null);
      return;
    }

    const state = await bootstrap();
    await applyBootstrapState(state);
  } catch (error) {
    console.error(error);
    statusText.textContent = error.message || "Account state could not be loaded.";
    const user = await getCurrentUser().catch(() => null);
    if (!user) {
      await applyBootstrapState(null);
      return;
    }
    toggleAuthenticatedUI(false);
  }
}

async function updatePreferenceState() {
  if (!currentState) {
    return;
  }

  try {
    const state = await setPreferences({
      extensionEnabled: extensionEnabledInput.checked,
      appearOnline: onlinePresenceToggle.checked,
      allowSurprise: allowSurpriseInput.checked,
    });
    await applyBootstrapState(state);
  } catch (error) {
    console.error(error);
    statusText.textContent = error.message || "Preferences could not be saved.";
  }
}

async function updateLocalNotificationPreference() {
  await setLocalObject(
    FRIEND_ONLINE_NOTIFICATIONS_ENABLED_KEY,
    Boolean(friendOnlineNotificationsInput.checked),
  );
}

signInButton.addEventListener("click", async () => {
  statusText.textContent = "Opening Google sign-in...";
  signInButton.disabled = true;

  try {
    suppressNextAuthRefresh = true;
    const session = await signInWithGoogle();
    applySignedInPendingUI(session?.user);
    await refreshBootstrapState();
    statusText.textContent = "Signed in. Opening your board...";
    await openBoard();
  } catch (error) {
    suppressNextAuthRefresh = false;
    console.error(error);
    statusText.textContent = error.message || "Google sign-in failed.";
  } finally {
    signInButton.disabled = false;
  }
});

signOutButton.addEventListener("click", async () => {
  signOutButton.disabled = true;

  try {
    await signOut();
    quickEffectSelect.value = "";
    await applyBootstrapState(null);
  } catch (error) {
    console.error(error);
    statusText.textContent = error.message || "Sign out failed.";
  } finally {
    signOutButton.disabled = false;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  await track("Extension Installed", {
    screen: "popup",
    surface: "open-board",
    result: "success",
  });

  await openBoard();
});

openBoardButton.addEventListener("click", async () => {
  await openBoard();
});

openWithMessageButton.addEventListener("click", async () => {
  if (!currentState) {
    statusText.textContent = "Sign in with Google first.";
    return;
  }

  const text = quickMessageInput.value.trim();
  if (!text) {
    statusText.textContent = "Type a message first.";
    return;
  }

  await openBoard({
    type: "message",
    text,
    label: "Quick message",
  });
});

sendEffectButton.addEventListener("click", async () => {
  if (!currentState) {
    statusText.textContent = "Sign in with Google first.";
    return;
  }

  const selected = QUICK_EFFECTS[quickEffectSelect.value];
  if (!selected) {
    statusText.textContent = "Choose an effect first.";
    return;
  }

  if (selected.pro && !currentState.entitlement?.isPro) {
    statusText.textContent = "That effect is available on Pro.";
    await openPaywall();
    return;
  }

  await openBoard({
    type: "effect",
    effect: selected.effect,
    color: selected.color,
    size: selected.size,
    label: selected.label,
  });
});

extensionEnabledInput.addEventListener("change", () => {
  void updatePreferenceState();
});

onlinePresenceToggle.addEventListener("change", () => {
  void updatePreferenceState();
});

allowSurpriseInput.addEventListener("change", () => {
  void updatePreferenceState();
});

friendOnlineNotificationsInput.addEventListener("change", () => {
  void updateLocalNotificationPreference();
});

onAuthStateChange((event, session) => {
  if (!session?.user) {
    return;
  }

  if (suppressNextAuthRefresh) {
    suppressNextAuthRefresh = false;
    return;
  }

  if (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") {
    applySignedInPendingUI(session.user);
    void refreshBootstrapState();
  }
});

closeHeroButton.addEventListener("click", async () => {
  await setLocalObject(POPUP_HERO_DISMISSED_KEY, true);
  heroCard.classList.add("hidden");
});

void applyHeroVisibility();
void refreshBootstrapState();
