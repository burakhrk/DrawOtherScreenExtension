import { getSketchPartyAvatarDataUrl } from "../lib/avatar.js";
import {
  AUTH_PROVIDER,
  beginPrimarySignIn,
  getAuthenticatedUser,
  onPrimaryAuthStateChange,
  signOut,
} from "../lib/auth.js";
import { createPartyCode } from "../lib/party-code.js";
import {
  FRIEND_ONLINE_NOTIFICATIONS_ENABLED_KEY,
  POPUP_ONBOARDING_SEEN_KEY,
  PROFILE_STORAGE_KEY,
  QUICK_ACTION_KEY,
  DEFAULT_RELAY_URL as DEFAULT_SERVER_URL,
} from "../lib/constants.js";
import { getLocalObject, setLocalObject } from "../lib/chrome-storage.js";
import { getLocalPreferences, saveLocalPreferences, updateStoredProfile } from "../lib/preferences.js";
import { bootstrap, setPreferences } from "../lib/sketch-party-social-client.js";

const QUICK_EFFECTS = {
  confetti: { effect: "confetti", color: "#2563eb", size: 7, label: "Confetti" },
  drip: { effect: "drip", color: "#16a34a", size: 6, label: "Paint drip" },
  inkslap: { effect: "inkslap", color: "#0f172a", size: 7, label: "Ink splash" },
  scribble: { effect: "scribble", color: "#f97316", size: 6, label: "Scribble" },
  crack: { effect: "crack", color: "#1f2937", size: 6, label: "Cracked glass" },
};

const QUICK_EFFECT_ORDER = ["confetti", "drip", "inkslap", "scribble", "crack"];

const accountStatePill = document.getElementById("accountStatePill");
const accountTitle = document.getElementById("accountTitle");
const accountSubtitle = document.getElementById("accountSubtitle");
const accountAvatar = document.getElementById("accountAvatar");
const signInButton = document.getElementById("signInButton");
const signOutButton = document.getElementById("signOutButton");
const openBoardButton = document.getElementById("openBoardButton");
const addFriendInput = document.getElementById("addFriendInput");
const addFriendButton = document.getElementById("addFriendButton");
const popupPartyCode = document.getElementById("popupPartyCode");
const copyPopupPartyCode = document.getElementById("copyPopupPartyCode");
const friendsListCompact = document.getElementById("friendsListCompact");
const friendCountMini = document.getElementById("friendCountMini");
const noFriendsHint = document.getElementById("noFriendsHint");
const quickEffectCards = document.getElementById("quickEffectCards");
const selectedFriendLabel = document.getElementById("selectedFriendLabel");
const sendEffectButton = document.getElementById("sendEffectButton");
const quickFriendSelect = document.getElementById("quickFriendSelect");
const quickEffectSelect = document.getElementById("quickEffect");
const serverUrlInput = document.getElementById("serverUrl");
const extensionEnabledInput = document.getElementById("extensionEnabled");
const onlinePresenceToggle = document.getElementById("onlinePresenceToggle");
const allowSurpriseInput = document.getElementById("allowSurprise");
const friendOnlineNotificationsInput = document.getElementById("friendOnlineNotifications");
const statusText = document.getElementById("statusText");
const onboardingCard = document.getElementById("onboardingCard");
const onboardingTitle = document.getElementById("onboardingTitle");
const onboardingText = document.getElementById("onboardingText");
const onboardingStepIndicator = document.getElementById("onboardingStepIndicator");
const nextOnboarding = document.getElementById("nextOnboarding");
const skipOnboarding = document.getElementById("skipOnboarding");

let currentState = null;
let suppressNextAuthRefresh = false;
let selectedFriendId = "";
let selectedEffectKey = "";
let onboardingStep = 0;

const onboardingSteps = [
  {
    title: "Add a friend fast",
    text: "Paste their party code or profile name. We’ll remember it.",
  },
  {
    title: "Send a quick animation",
    text: "Pick a friend, choose an animation card, and send.",
  },
];

function normalizeServerUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return DEFAULT_SERVER_URL;
  }

  const url = new URL(trimmed);
  return url.toString().replace(/\/$/, "");
}

function applyAvatar(seed, name) {
  const label = name || "Sketch Party";
  accountAvatar.textContent = "";
  accountAvatar.setAttribute("aria-label", label);
  accountAvatar.title = label;
  accountAvatar.style.setProperty("--avatar-image", `url("${getSketchPartyAvatarDataUrl(seed || label, label)}")`);
}

function setStatus(text) {
  statusText.textContent = text;
}

function updateSendButtonState() {
  const ready = Boolean(currentState && selectedFriendId && selectedEffectKey);
  sendEffectButton.disabled = !ready;
}

function selectFriend(userId, displayName) {
  selectedFriendId = userId || "";
  quickFriendSelect.value = userId || "";
  selectedFriendLabel.textContent = displayName ? `Sending to ${displayName}` : "Choose a friend";
  updateSendButtonState();

  for (const chip of friendsListCompact.querySelectorAll(".friend-chip")) {
    chip.classList.toggle("selected", chip.dataset.userId === userId);
  }
}

function selectEffect(effectKey) {
  selectedEffectKey = effectKey || "";
  quickEffectSelect.value = effectKey || "";
  updateSendButtonState();

  for (const card of quickEffectCards.querySelectorAll(".effect-card")) {
    card.classList.toggle("selected", card.dataset.effect === effectKey);
  }
}

function renderEffectCards() {
  quickEffectCards.innerHTML = "";
  quickEffectSelect.innerHTML = "";

  for (const key of QUICK_EFFECT_ORDER) {
    const effect = QUICK_EFFECTS[key];
    const option = document.createElement("option");
    option.value = key;
    option.textContent = effect.label;
    quickEffectSelect.appendChild(option);

    const card = document.createElement("button");
    card.type = "button";
    card.className = "effect-card";
    card.dataset.effect = key;
    card.innerHTML = `
      <div class="effect-name">${effect.label}</div>
      <div class="effect-meta">${effect.effect}</div>
    `;
    card.addEventListener("click", () => selectEffect(key));
    quickEffectCards.appendChild(card);
  }

  selectEffect(QUICK_EFFECT_ORDER[0]);
}

function renderFriendsList(friends = []) {
  friendsListCompact.innerHTML = "";
  friendCountMini.textContent = `${friends.length} ready`;

  if (!friends.length) {
    noFriendsHint.classList.remove("hidden");
    selectFriend("", "");
    updateSendButtonState();
    return;
  }

  noFriendsHint.classList.add("hidden");

  for (const friend of friends) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "friend-chip";
    chip.dataset.userId = friend.userId;
    chip.innerHTML = `
      <span class="friend-name">${friend.displayName}</span>
      <span class="status-dot ${friend.online ? "online" : ""}"></span>
    `;
    chip.addEventListener("click", () => selectFriend(friend.userId, friend.displayName));
    friendsListCompact.appendChild(chip);
  }

  if (!selectedFriendId) {
    selectFriend(friends[0]?.userId, friends[0]?.displayName);
  } else {
    const stillExists = friends.some((f) => f.userId === selectedFriendId);
    if (!stillExists) {
      selectFriend(friends[0]?.userId, friends[0]?.displayName);
    }
  }
}

function toggleAuthenticatedUI(isAuthenticated) {
  signInButton.classList.toggle("hidden", isAuthenticated);
  signOutButton.classList.toggle("hidden", !isAuthenticated);
  accountStatePill.textContent = isAuthenticated ? "Online" : "Offline";
  accountStatePill.style.background = isAuthenticated ? "#d1fae5" : "#fef3c7";
}

async function applyBootstrapState(state) {
  currentState = state;
  const localProfile = await getLocalObject(PROFILE_STORAGE_KEY, {});
  const localPreferences = await getLocalPreferences();
  const notificationsEnabled = await getLocalObject(FRIEND_ONLINE_NOTIFICATIONS_ENABLED_KEY, false);
  friendOnlineNotificationsInput.checked = Boolean(notificationsEnabled);
  serverUrlInput.value = localProfile?.serverUrl || DEFAULT_SERVER_URL;

  if (!state) {
    accountTitle.textContent = AUTH_PROVIDER.signedOutTitle;
    accountSubtitle.textContent = AUTH_PROVIDER.signedOutSubtitle;
    applyAvatar("popup-signed-out", "Sketch Party");
    popupPartyCode.textContent = "-";
    extensionEnabledInput.checked = localPreferences.extensionEnabled;
    onlinePresenceToggle.checked = localPreferences.appearOnline;
    allowSurpriseInput.checked = localPreferences.allowSurprise;
    renderFriendsList([]);
    toggleAuthenticatedUI(false);
    setStatus("Open the board or sign in to load your friends.");
    updateSendButtonState();
    return;
  }

  extensionEnabledInput.checked = state.preferences.extensionEnabled;
  onlinePresenceToggle.checked = state.preferences.appearOnline;
  allowSurpriseInput.checked = state.preferences.allowSurprise;
  popupPartyCode.textContent = createPartyCode(state.user.id || state.user.displayName);
  accountTitle.textContent = state.user.displayName;
  accountSubtitle.textContent = state.user.email || "Your account is connected.";
  applyAvatar(state.user.id || state.user.displayName, state.user.displayName);
  renderFriendsList(state.friends);
  toggleAuthenticatedUI(true);
  setStatus(`${state.friends.length} friends ready. Choose one and send an animation.`);
  updateSendButtonState();
}

async function refreshBootstrapState() {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      await applyBootstrapState(null);
      return;
    }

    const state = await bootstrap();
    await applyBootstrapState(state);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Account state could not be loaded.");
    await applyBootstrapState(null);
  }
}

async function updatePreferenceState() {
  try {
    const nextPreferences = {
      extensionEnabled: extensionEnabledInput.checked,
      appearOnline: onlinePresenceToggle.checked,
      allowSurprise: allowSurpriseInput.checked,
    };

    await saveLocalPreferences(nextPreferences);

    if (!currentState) {
      setStatus("Preferences saved for your next session.");
      return;
    }

    const state = await setPreferences(nextPreferences);
    await applyBootstrapState(state);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Preferences could not be saved.");
  }
}

async function updateLocalNotificationPreference() {
  await setLocalObject(FRIEND_ONLINE_NOTIFICATIONS_ENABLED_KEY, Boolean(friendOnlineNotificationsInput.checked));
}

async function openBoard(quickAction = null) {
  const serverUrl = normalizeServerUrl(serverUrlInput.value);

  await updateStoredProfile({ serverUrl });

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

async function handleSendEffect() {
  if (!currentState) {
    setStatus(`${AUTH_PROVIDER.signInButtonLabel} first.`);
    return;
  }

  if (!selectedFriendId) {
    setStatus("Pick a friend first.");
    return;
  }

  const selected = QUICK_EFFECTS[selectedEffectKey];
  if (!selected) {
    setStatus("Choose an animation.");
    return;
  }

  await openBoard({
    type: "effect",
    targetUserId: selectedFriendId,
    effect: selected.effect,
    color: selected.color,
    size: selected.size,
    label: selected.label,
  });
}

async function handleAddFriend() {
  const identifier = addFriendInput.value.trim();
  if (!identifier) {
    setStatus("Paste a party code or profile name first.");
    return;
  }

  await setLocalObject(QUICK_ACTION_KEY, {
    type: "pair",
    identifier,
  });

  setStatus("Opening board to send the request...");
  await openBoard();
}

async function maybeShowOnboarding() {
  const seen = await getLocalObject(POPUP_ONBOARDING_SEEN_KEY, false);
  if (seen) {
    onboardingCard.classList.add("hidden");
    return;
  }

  onboardingStep = 0;
  renderOnboardingStep();
  onboardingCard.classList.remove("hidden");
}

async function finishOnboarding() {
  onboardingCard.classList.add("hidden");
  await setLocalObject(POPUP_ONBOARDING_SEEN_KEY, true);
}

function renderOnboardingStep() {
  const step = onboardingSteps[onboardingStep];
  onboardingTitle.textContent = step.title;
  onboardingText.textContent = step.text;
  onboardingStepIndicator.textContent = `${onboardingStep + 1} / ${onboardingSteps.length}`;
  nextOnboarding.textContent = onboardingStep === onboardingSteps.length - 1 ? "Got it" : "Next";
}

signInButton.addEventListener("click", async () => {
  setStatus(AUTH_PROVIDER.signInStatusLabel);
  signInButton.disabled = true;

  try {
    suppressNextAuthRefresh = true;
    const session = await beginPrimarySignIn();
    const user = session?.user || session;
    const displayName =
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.email ||
      "Sketch Party user";
    applyAvatar(user?.id || user?.email || displayName, displayName);
    accountTitle.textContent = displayName;
    accountSubtitle.textContent = user?.email || "Connected. Loading your friends...";
    popupPartyCode.textContent = createPartyCode(user?.id || displayName);
    toggleAuthenticatedUI(true);
    await refreshBootstrapState();
    setStatus("Signed in. Opening your board...");
    await openBoard();
  } catch (error) {
    suppressNextAuthRefresh = false;
    console.error(error);
    setStatus(error.message || AUTH_PROVIDER.signInErrorLabel);
  } finally {
    signInButton.disabled = false;
  }
});

signOutButton.addEventListener("click", async () => {
  signOutButton.disabled = true;

  try {
    await signOut();
    selectFriend("", "");
    selectEffect(QUICK_EFFECT_ORDER[0]);
    await applyBootstrapState(null);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Sign out failed.");
  } finally {
    signOutButton.disabled = false;
  }
});

openBoardButton.addEventListener("click", async () => {
  await openBoard();
});

sendEffectButton.addEventListener("click", () => {
  void handleSendEffect();
});

addFriendButton.addEventListener("click", () => {
  void handleAddFriend();
});

addFriendInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void handleAddFriend();
  }
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

quickFriendSelect.addEventListener("change", () => {
  const option = quickFriendSelect.selectedOptions[0];
  selectFriend(option?.value || "", option?.textContent || "");
});

quickEffectSelect.addEventListener("change", () => {
  selectEffect(quickEffectSelect.value);
});

copyPopupPartyCode.addEventListener("click", async () => {
  if (!popupPartyCode.textContent || popupPartyCode.textContent === "-") {
    return;
  }

  await navigator.clipboard.writeText(popupPartyCode.textContent);
  setStatus("Party code copied.");
});

nextOnboarding.addEventListener("click", () => {
  if (onboardingStep === onboardingSteps.length - 1) {
    void finishOnboarding();
    return;
  }

  onboardingStep += 1;
  renderOnboardingStep();
});

skipOnboarding.addEventListener("click", () => {
  void finishOnboarding();
});

onPrimaryAuthStateChange((event, session) => {
  if (!session?.user) {
    return;
  }

  if (suppressNextAuthRefresh) {
    suppressNextAuthRefresh = false;
    return;
  }

  if (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") {
    void refreshBootstrapState();
  }
});

signInButton.textContent = AUTH_PROVIDER.signInButtonLabel;

renderEffectCards();
void applyBootstrapState(null);
void refreshBootstrapState();
void maybeShowOnboarding();
