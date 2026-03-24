import { track } from "../lib/analytics.js";
import { signInWithGoogle, signOut } from "../lib/auth.js";
import { QUICK_ACTION_KEY, PROFILE_STORAGE_KEY } from "../lib/constants.js";
import { getLocalObject, setLocalObject } from "../lib/chrome-storage.js";
import { bootstrap, setPreferences } from "../lib/drawing-office-social-client.js";

const DEFAULT_SERVER_URL = "https://sync-sketch-party.onrender.com";

const form = document.getElementById("session-form");
const serverUrlInput = document.getElementById("serverUrl");
const extensionEnabledInput = document.getElementById("extensionEnabled");
const appearOnlineInput = document.getElementById("appearOnline");
const allowSurpriseInput = document.getElementById("allowSurprise");
const quickMessageInput = document.getElementById("quickMessage");
const openWithMessageButton = document.getElementById("openWithMessage");
const effectShortcutButtons = Array.from(document.querySelectorAll(".effect-chip"));
const accountTitle = document.getElementById("accountTitle");
const accountSubtitle = document.getElementById("accountSubtitle");
const accountAvatar = document.getElementById("accountAvatar");
const accountStatePill = document.getElementById("accountStatePill");
const signInButton = document.getElementById("signInButton");
const signOutButton = document.getElementById("signOutButton");
const statusText = document.getElementById("statusText");
const openBoardButton = document.getElementById("openBoardButton");

let currentState = null;

function avatarFromName(name) {
  const safe = (name || "DO").trim();
  const parts = safe.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "DO";
}

function normalizeServerUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_SERVER_URL;
  }

  const url = new URL(trimmed);
  return url.toString().replace(/\/$/, "");
}

function toggleAuthenticatedUI(isAuthenticated) {
  form.classList.toggle("is-disabled", !isAuthenticated);
  openWithMessageButton.disabled = !isAuthenticated;
  openBoardButton.disabled = !isAuthenticated;

  for (const button of effectShortcutButtons) {
    button.disabled = !isAuthenticated;
  }

  signInButton.classList.toggle("hidden", isAuthenticated);
  signOutButton.classList.toggle("hidden", !isAuthenticated);
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

  if (!state) {
    accountTitle.textContent = "Google ile giris bekleniyor";
    accountSubtitle.textContent = "Oturum acinca arkadaslarin ve tercihler tekrar yuklenecek.";
    accountAvatar.textContent = "DO";
    accountStatePill.textContent = "Hazir degil";
    accountStatePill.style.background = "#f3e5d5";
    statusText.textContent = "Giris yapmadan panel acilmaz.";
    serverUrlInput.value = (await getLocalObject(PROFILE_STORAGE_KEY, {}))?.serverUrl || DEFAULT_SERVER_URL;
    toggleAuthenticatedUI(false);
    return;
  }

  const localProfile = (await getLocalObject(PROFILE_STORAGE_KEY, {})) || {};
  serverUrlInput.value = localProfile.serverUrl || DEFAULT_SERVER_URL;
  extensionEnabledInput.checked = state.preferences.extensionEnabled;
  appearOnlineInput.checked = state.preferences.appearOnline;
  allowSurpriseInput.checked = state.preferences.allowSurprise;
  accountTitle.textContent = state.user.displayName;
  accountSubtitle.textContent = state.user.email || "Drawing Office hesabi baglandi.";
  accountAvatar.textContent = avatarFromName(state.user.displayName);
  accountStatePill.textContent = state.preferences.extensionEnabled
    ? (state.preferences.appearOnline ? "Online" : "Gizli")
    : "Pasif";
  accountStatePill.style.background = state.preferences.extensionEnabled
    ? (state.preferences.appearOnline ? "var(--success)" : "var(--blue)")
    : "#f3e5d5";
  statusText.textContent = `${state.friends.length} arkadas, ${state.incomingRequests.length} gelen istek hazir.`;
  toggleAuthenticatedUI(true);
}

async function refreshBootstrapState() {
  try {
    const state = await bootstrap();
    await applyBootstrapState(state);
  } catch (error) {
    console.error(error);
    statusText.textContent = error.message || "Hesap durumu yuklenemedi.";
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
      appearOnline: appearOnlineInput.checked,
      allowSurprise: allowSurpriseInput.checked,
    });
    await applyBootstrapState(state);
  } catch (error) {
    console.error(error);
    statusText.textContent = error.message || "Tercihler kaydedilemedi.";
  }
}

signInButton.addEventListener("click", async () => {
  statusText.textContent = "Google oturumu aciliyor...";
  signInButton.disabled = true;

  try {
    await signInWithGoogle();
    await refreshBootstrapState();
  } catch (error) {
    console.error(error);
    statusText.textContent = error.message || "Google girisi basarisiz oldu.";
  } finally {
    signInButton.disabled = false;
  }
});

signOutButton.addEventListener("click", async () => {
  signOutButton.disabled = true;

  try {
    await signOut();
    await applyBootstrapState(null);
  } catch (error) {
    console.error(error);
    statusText.textContent = error.message || "Cikis yapilamadi.";
  } finally {
    signOutButton.disabled = false;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentState) {
    statusText.textContent = "Once Google ile giris yap.";
    return;
  }

  await track("Extension Installed", {
    screen: "popup",
    surface: "open-board",
    result: "success",
  });

  await openBoard();
});

openBoardButton.addEventListener("click", async () => {
  if (!currentState) {
    statusText.textContent = "Once Google ile giris yap.";
    return;
  }

  await openBoard();
});

openWithMessageButton.addEventListener("click", async () => {
  if (!currentState) {
    statusText.textContent = "Once Google ile giris yap.";
    return;
  }

  const text = quickMessageInput.value.trim();
  await openBoard(text ? {
    type: "message",
    text,
    label: "Hizli mesaj",
  } : null);
});

for (const button of effectShortcutButtons) {
  button.addEventListener("click", async () => {
    if (!currentState) {
      statusText.textContent = "Once Google ile giris yap.";
      return;
    }

    await openBoard({
      type: "effect",
      effect: button.dataset.effect,
      color: button.dataset.color || "#232018",
      size: 6,
      label: button.textContent.trim(),
    });
  });
}

extensionEnabledInput.addEventListener("change", () => {
  void updatePreferenceState();
});

appearOnlineInput.addEventListener("change", () => {
  void updatePreferenceState();
});

allowSurpriseInput.addEventListener("change", () => {
  void updatePreferenceState();
});

void refreshBootstrapState();
