const form = document.getElementById("session-form");
const displayNameInput = document.getElementById("displayName");
const serverUrlInput = document.getElementById("serverUrl");

const STORAGE_KEY = "sync-sketch-profile";
const DEFAULT_SERVER_URL = "https://sync-sketch-party.onrender.com";

function normalizeServerUrl(value) {
  const trimmed = value.trim();

  if (!trimmed) {
    return DEFAULT_SERVER_URL;
  }

  const url = new URL(trimmed);
  return url.toString().replace(/\/$/, "");
}

async function hydrateForm() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const profile = stored[STORAGE_KEY];

  if (!profile) {
    serverUrlInput.value = DEFAULT_SERVER_URL;
    return;
  }

  displayNameInput.value = profile.displayName ?? "";
  serverUrlInput.value = profile.serverUrl ?? DEFAULT_SERVER_URL;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const existingProfile = stored[STORAGE_KEY];
  const payload = {
    userId: existingProfile?.userId ?? crypto.randomUUID(),
    deviceKey: existingProfile?.deviceKey ?? crypto.randomUUID(),
    displayName: displayNameInput.value.trim(),
    serverUrl: normalizeServerUrl(serverUrlInput.value)
  };

  await chrome.storage.local.set({ [STORAGE_KEY]: payload });

  const url = new URL(chrome.runtime.getURL("board.html"));
  url.searchParams.set("userId", payload.userId);
  url.searchParams.set("deviceKey", payload.deviceKey);
  url.searchParams.set("displayName", payload.displayName);
  url.searchParams.set("serverUrl", payload.serverUrl);

  await chrome.tabs.create({ url: url.toString() });
  window.close();
});

hydrateForm();
