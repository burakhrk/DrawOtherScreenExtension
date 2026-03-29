import { track } from "../lib/analytics.js";
import { getSketchPartyAvatarDataUrl } from "../lib/avatar.js";
import {
  DASHBOARD_ONBOARDING_SEEN_KEY,
  FRIEND_ONLINE_NOTIFICATION_KEY,
  FRIEND_ONLINE_NOTIFICATIONS_ENABLED_KEY,
  FREE_EFFECTS,
  GUEST_INSTALL_ID_KEY,
  PAYWALL_URL,
  PRO_ADVANCED_EFFECTS,
  PROFILE_STORAGE_KEY,
  QUICK_ACTION_KEY,
} from "../lib/constants.js";
import { getAccessToken, getCurrentUser, signInWithGoogle } from "../lib/auth.js";
import { getLocalObject, setLocalObject } from "../lib/chrome-storage.js";
import { getEntitlementBadge } from "../lib/entitlements.js";
import { createPartyCode, isPartyCode, isUuidLike, normalizePartyIdentifier } from "../lib/party-code.js";
import { getLocalPreferences, saveLocalPreferences, updateStoredProfile } from "../lib/preferences.js";
import { supabase } from "../lib/supabase-client.js";
import {
  acceptFriendRequest,
  bootstrap,
  endSession as endSocialSession,
  getSocialState,
  rejectFriendRequest,
  sendFriendRequest,
  startSession as startSocialSession,
  updateProfile,
} from "../lib/sketch-party-social-client.js";

const params = new URLSearchParams(window.location.search);
const rawServerUrl = params.get("serverUrl") || "https://sync-sketch-party.onrender.com";
const clientId = crypto.randomUUID();
const socialRefreshIntervalMs = 3000;

const layout = document.getElementById("layout");
const profileName = document.getElementById("profileName");
const profileAvatar = document.getElementById("profileAvatar");
const profileMeta = document.getElementById("profileMeta");
const globalStatus = document.getElementById("globalStatus");
const syncCode = document.getElementById("syncCode");
const copySyncCodeButton = document.getElementById("copySyncCode");
const dashboardAuthCard = document.getElementById("dashboardAuthCard");
const dashboardSignInButton = document.getElementById("dashboardSignInButton");
const profileForm = document.getElementById("profileForm");
const profileNameInput = document.getElementById("profileNameInput");
const pairForm = document.getElementById("pairForm");
const pairCodeInput = document.getElementById("pairCodeInput");
const friendCount = document.getElementById("friendCount");
const membershipTitle = document.getElementById("membershipTitle");
const membershipDetail = document.getElementById("membershipDetail");
const membershipPill = document.getElementById("membershipPill");
const upgradePlanButton = document.getElementById("upgradePlan");
const requestList = document.getElementById("requestList");
const friendsList = document.getElementById("friendsList");
const sessionTitle = document.getElementById("sessionTitle");
const sessionModeText = document.getElementById("sessionModeText");
const selectedTargetPill = document.getElementById("selectedTargetPill");
const presence = document.getElementById("presence");
const statusPill = document.getElementById("statusPill");
const drawGuard = document.getElementById("drawGuard");
const chatPanel = document.getElementById("chatPanel");
const closeChatPanelButton = document.getElementById("closeChatPanel");
const inboxDock = document.getElementById("inboxDock");
const inboxDockBadge = document.getElementById("inboxDockBadge");
const messages = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const effectPicker = document.getElementById("effectPicker");
const colorPicker = document.getElementById("colorPicker");
const brushSize = document.getElementById("brushSize");
const brushValue = document.getElementById("brushValue");
const openOnboardingButton = document.getElementById("openOnboardingButton");
const onboardingOverlay = document.getElementById("onboardingOverlay");
const onboardingTitle = document.getElementById("onboardingTitle");
const onboardingText = document.getElementById("onboardingText");
const onboardingVisual = document.getElementById("onboardingVisual");
const onboardingStepIndicator = document.getElementById("onboardingStepIndicator");
const onboardingPrevButton = document.getElementById("onboardingPrevButton");
const onboardingNextButton = document.getElementById("onboardingNextButton");
const closeOnboardingButton = document.getElementById("closeOnboardingButton");
const clearCanvasButton = document.getElementById("clearCanvas");
const sendDraftButton = document.getElementById("sendDraft");
const messageFriendButton = document.getElementById("messageFriend");
const startLiveModeButton = document.getElementById("startLiveMode");
const leaveSessionButton = document.getElementById("leaveSession");
const canvas = document.getElementById("drawCanvas");
const context = canvas.getContext("2d", { willReadFrequently: true });
const toastStack = document.getElementById("toastStack");

let socket;
let userId = "";
let displayName = "Guest";
let partyCode = "-";
let extensionEnabled = true;
let appearOnline = true;
let allowSurprise = true;
let entitlement = null;
let isDrawing = false;
let lastPoint = null;
let activeStrokeId = null;
let friends = [];
let incomingRequests = [];
let outgoingRequests = [];
let currentSession = null;
let currentRpcSession = null;
let draftSegments = [];
let pendingDraftTarget = null;
let pendingTextTarget = null;
let selectedFriendId = "";
let onlineUserIds = new Set();
let previousOnlineUserIds = new Set();
let hasPresenceSnapshot = false;
let socialRefreshTimer = null;
let socialRefreshInFlight = false;
let chatPanelOpen = false;
let unreadMessageCount = 0;
let latestMessagePreview = "Messages";
let hasDirectMessages = false;
let onboardingStep = 0;
let isGuestMode = false;
let activeMexicanWaveCleanup = null;

function applyRuntimePreferences(nextPreferences, { updateStatus = true } = {}) {
  extensionEnabled = nextPreferences.extensionEnabled !== false;
  appearOnline = nextPreferences.appearOnline !== false;
  allowSurprise = nextPreferences.allowSurprise !== false;

  if (!updateStatus) {
    return;
  }

  if (isGuestMode) {
    profileMeta.textContent = extensionEnabled
      ? "Guest mode is live. You can pair with a party code now, or sign in later to save friends."
      : "Guest mode is paused. Turn Sketch Party back on in the popup to receive sessions.";
    setGlobalStatus(appearOnline && extensionEnabled ? "Guest online" : "Guest", appearOnline && extensionEnabled);
    return;
  }

  profileMeta.textContent = extensionEnabled
    ? "Ready for quick sends and surprise moments."
    : "Inactive mode. Friends will see you as unavailable.";
  setGlobalStatus(appearOnline && extensionEnabled ? "Online" : "Inactive", appearOnline && extensionEnabled);
}

async function syncLivePreferencesFromStorage(nextPreferences) {
  applyRuntimePreferences(nextPreferences);

  if (socket?.readyState !== WebSocket.OPEN) {
    return;
  }

  try {
    const accessToken = isGuestMode ? null : await getAccessToken();
    send({
      type: "register-user",
      userId,
      clientId,
      displayName,
      accessToken,
      guest: isGuestMode,
      preferences: {
        extensionEnabled,
        appearOnline,
        allowSurprise,
      },
    });
    setStatus("Preferences synced", "ok");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Preferences could not be synced");
  }
}

const onboardingSteps = [
  {
    title: "Draw something fun",
    text: "Use the board to sketch a quick idea, a prank, or a reaction. Drafts stay here until you choose who should get them.",
    chip: "Draw here",
    scene: `
      <div class="onboarding-demo">
        <span class="demo-chip">Draw here</span>
        <div class="demo-canvas">
          <span class="scribble scribble-one"></span>
          <span class="scribble scribble-two"></span>
          <span class="spark spark-one"></span>
        </div>
      </div>
    `,
  },
  {
    title: "Choose a friend",
    text: "Pick someone from the left, send a quick drawing, or open a text session. Party codes and friend requests make pairing fast.",
    chip: "Choose a friend",
    scene: `
      <div class="onboarding-demo">
        <span class="demo-chip">Choose a friend</span>
        <div class="demo-canvas">
          <div style="position:absolute; top:20px; left:22px; right:22px; display:grid; gap:12px;">
            <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-radius:18px; background:white; box-shadow:0 10px 18px rgba(32,29,23,0.08);">
              <strong>Maya</strong>
              <span class="status-dot online">Online</span>
            </div>
            <div style="display:flex; gap:10px;">
              <span class="demo-chip" style="background:var(--accent);">Send drawing</span>
              <span class="demo-chip" style="background:#3a3128;">Text</span>
            </div>
          </div>
        </div>
      </div>
    `,
  },
  {
    title: "Let it pop on their page",
    text: "When your friend is online and allows surprises, your drawing or effect can suddenly appear over the page they are browsing.",
    chip: "It pops up here",
    scene: `
      <div class="onboarding-demo">
        <span class="demo-chip">It pops up here</span>
        <div class="demo-canvas">
          <div style="position:absolute; inset:18px; border-radius:20px; background:linear-gradient(180deg,#ffffff,#f7f1e7); border:2px solid rgba(32,29,23,0.08);"></div>
          <div style="position:absolute; top:40px; left:34px; right:34px; height:14px; border-radius:999px; background:rgba(32,29,23,0.08);"></div>
          <span class="scribble scribble-one" style="top:58px; left:110px; width:120px; height:82px;"></span>
          <span class="spark spark-one" style="top:54px; right:110px;"></span>
        </div>
      </div>
    `,
  },
];

async function getOrCreateGuestIdentity() {
  let installId = await getLocalObject(GUEST_INSTALL_ID_KEY, "");
  if (!installId) {
    installId = crypto.randomUUID();
    await setLocalObject(GUEST_INSTALL_ID_KEY, installId);
  }

  const localProfile = (await getLocalObject(PROFILE_STORAGE_KEY, {})) || {};
  const guestUserId = `guest:${installId}`;
  const guestCode = createPartyCode(guestUserId);
  const guestName = String(localProfile.guestName || "").trim() || `Guest ${guestCode}`;

  return {
    userId: guestUserId,
    displayName: guestName,
    partyCode: guestCode,
  };
}

function setSignedOutDashboardUI() {
  profileName.textContent = displayName || "Guest";
  profileAvatar.style.setProperty("--avatar-image", `url("${getSketchPartyAvatarDataUrl(userId || "signed-out", displayName || "Sketch Party")}")`);
  profileMeta.textContent = extensionEnabled
    ? "Guest mode is live. You can pair with a party code now, or sign in later to save friends."
    : "Guest mode is paused. Turn Sketch Party back on in the popup to receive sessions.";
  syncCode.textContent = partyCode || "-";
  friendCount.textContent = "Guest sessions";
  requestList.innerHTML = "";
  friendsList.innerHTML = "";
  membershipTitle.textContent = "Guest mode";
  membershipDetail.textContent = "Temporary sessions work right away. Sign in when you want saved friends and restored social state.";
  membershipPill.textContent = "Guest";
  dashboardAuthCard.classList.remove("hidden");
  profileForm.classList.remove("hidden");
  pairForm.classList.remove("hidden");
  messages.innerHTML = "";
  latestMessagePreview = "Messages";
  unreadMessageCount = 0;
  hasDirectMessages = false;
  closeInbox();
  copySyncCodeButton.disabled = false;
  upgradePlanButton.disabled = false;
  clearCanvasButton.disabled = false;
  sendDraftButton.disabled = draftSegments.length === 0;
  leaveSessionButton.disabled = true;
  chatInput.disabled = true;
  setGlobalStatus(appearOnline && extensionEnabled ? "Guest online" : "Guest", appearOnline && extensionEnabled);
  setStatus("Guest mode ready");
  drawGuard.classList.remove("hidden");
  drawGuard.innerHTML = `
    <div class="draw-guard-content">
      <p>Draw here, paste a party code on the left, and start a temporary guest session. Sign in later if you want saved friends.</p>
    </div>
  `;
  profileNameInput.value = displayName;
}

function setSignedInDashboardUI() {
  isGuestMode = false;
  dashboardAuthCard.classList.add("hidden");
  profileForm.classList.remove("hidden");
  pairForm.classList.remove("hidden");
  copySyncCodeButton.disabled = false;
  upgradePlanButton.disabled = false;
  drawGuard.textContent = "";
}

function updateInboxUI() {
  const shouldShowDock = unreadMessageCount > 0 || hasDirectMessages || Boolean(pendingTextTarget);
  layout.classList.toggle("chat-collapsed", !chatPanelOpen);
  chatPanel.classList.toggle("hidden", !chatPanelOpen);
  inboxDock.classList.toggle("hidden", !shouldShowDock || chatPanelOpen);
  inboxDock.querySelector(".inbox-dock-label").textContent = latestMessagePreview || "Messages";
  inboxDockBadge.textContent = String(unreadMessageCount);
  inboxDockBadge.classList.toggle("hidden", unreadMessageCount === 0);

  if (chatPanelOpen) {
    unreadMessageCount = 0;
    inboxDockBadge.textContent = "0";
    inboxDockBadge.classList.add("hidden");
  }
}

function openInbox({ focusComposer = false } = {}) {
  chatPanelOpen = true;
  updateInboxUI();
  if (focusComposer) {
    window.setTimeout(() => {
      chatInput.focus();
    }, 60);
  }
}

function updateBrushValue() {
  if (!brushValue) {
    return;
  }

  brushValue.textContent = `${brushSize.value}px`;
}

function closeInbox() {
  chatPanelOpen = false;
  updateInboxUI();
}

async function markOnboardingSeen() {
  await setLocalObject(DASHBOARD_ONBOARDING_SEEN_KEY, true);
}

function renderOnboardingStep() {
  const step = onboardingSteps[onboardingStep];
  onboardingTitle.textContent = step.title;
  onboardingText.textContent = step.text;
  onboardingVisual.innerHTML = step.scene;
  onboardingStepIndicator.textContent = `${onboardingStep + 1} / ${onboardingSteps.length}`;
  onboardingPrevButton.disabled = onboardingStep === 0;
  onboardingNextButton.textContent = onboardingStep === onboardingSteps.length - 1 ? "Got it" : "Next";
}

async function openOnboarding({ force = false } = {}) {
  if (!force) {
    const seen = await getLocalObject(DASHBOARD_ONBOARDING_SEEN_KEY, false);
    if (seen) {
      return;
    }
  }

  onboardingStep = 0;
  renderOnboardingStep();
  onboardingOverlay.classList.remove("hidden");
}

async function closeOnboarding() {
  onboardingOverlay.classList.add("hidden");
  await markOnboardingSeen();
}

function getTodayStamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function showToast(title, text) {
  if (!toastStack) {
    return;
  }

  const toast = document.createElement("article");
  toast.className = "toast";
  const titleElement = document.createElement("strong");
  titleElement.textContent = title;
  const textElement = document.createElement("p");
  textElement.textContent = text;
  toast.append(titleElement, textElement);

  toastStack.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("is-visible");
  });

  const removeToast = () => {
    toast.classList.remove("is-visible");
    window.setTimeout(() => toast.remove(), 180);
  };

  window.setTimeout(removeToast, 2600);
}

async function openPaywall(source = "dashboard") {
  const paywallUrl = entitlement?.paywallUrl || PAYWALL_URL;

  await track("Opened Paywall", {
    screen: "board",
    surface: source,
    result: "success",
  });

  await chrome.tabs.create({ url: paywallUrl });
}

function getHttpBaseUrl() {
  const url = new URL(rawServerUrl);
  if (url.protocol === "ws:") {
    url.protocol = "http:";
  } else if (url.protocol === "wss:") {
    url.protocol = "https:";
  }
  return url.toString().replace(/\/$/, "");
}

async function resolveUserByRelay(identifier) {
  const trimmed = normalizePartyIdentifier(identifier);
  if (!trimmed) {
    return null;
  }

  try {
    const response = await fetch(
      `${getHttpBaseUrl()}/resolve-user?identifier=${encodeURIComponent(trimmed)}`,
      {
        headers: {
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    if (!payload?.ok || !payload?.userId) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

async function resolveUserByProfileName(identifier) {
  const trimmed = normalizePartyIdentifier(identifier);
  if (!trimmed || isUuidLike(trimmed) || isPartyCode(trimmed)) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("user_id, display_name")
      .ilike("display_name", trimmed)
      .limit(2);

    if (error || !Array.isArray(data) || data.length !== 1) {
      return null;
    }

    return {
      userId: data[0].user_id,
      displayName: data[0].display_name || trimmed,
      source: "profile",
    };
  } catch (error) {
    return null;
  }
}

async function resolveRecipientIdentifier(identifier) {
  const trimmed = normalizePartyIdentifier(identifier);
  if (!trimmed) {
    throw new Error("Enter a party code or profile name first.");
  }

  if (isUuidLike(trimmed)) {
    return {
      userId: trimmed,
      displayName: trimmed,
      source: "uuid",
    };
  }

  const relayMatch = await resolveUserByRelay(trimmed.toUpperCase());
  if (relayMatch) {
    return relayMatch;
  }

  const profileMatch = await resolveUserByProfileName(trimmed);
  if (profileMatch) {
    return profileMatch;
  }

   if (isPartyCode(trimmed.toUpperCase())) {
    throw new Error("That party code is not available right now. Ask your friend to open Sketch Party first.");
  }

  throw new Error("That party code or profile name could not be found right now.");
}

function updateSyncCodeUI() {
  syncCode.textContent = partyCode;
}

function updateMembershipUI() {
  const badge = getEntitlementBadge(entitlement);
  membershipTitle.textContent = badge.title;
  membershipDetail.textContent = badge.detail;
  membershipPill.textContent = entitlement?.plan === "pro-trial" ? "Pro trial" : entitlement?.isPro ? "Pro" : "Free";
  membershipPill.style.background = entitlement?.isPro ? "rgba(33, 111, 67, 0.12)" : "#f3e5d5";
  upgradePlanButton.textContent = badge.cta;
  upgradePlanButton.classList.toggle("upgrade-cta", !entitlement?.isPro);
}

function ensureAllowedEffectSelection() {
  const currentEffect = effectPicker.value;
  if (!entitlement?.isPro && PRO_ADVANCED_EFFECTS.includes(currentEffect)) {
    effectPicker.value = FREE_EFFECTS.includes("draw") ? "draw" : FREE_EFFECTS[0];
  }

  for (const option of effectPicker.options) {
    if (option.dataset.pro === "true") {
      option.disabled = !entitlement?.isPro;
    }
  }
}

function canUseEffect(effectName) {
  return entitlement?.isPro || !PRO_ADVANCED_EFFECTS.includes(effectName);
}

async function maybeNotifyFriendOnline(friendId) {
  const notificationsEnabled = await getLocalObject(FRIEND_ONLINE_NOTIFICATIONS_ENABLED_KEY, false);
  if (!notificationsEnabled) {
    return;
  }

  const friend = friends.find((entry) => entry.userId === friendId);
  if (!friend) {
    return;
  }

  const todayStamp = getTodayStamp();
  const notificationsByFriend = (await getLocalObject(FRIEND_ONLINE_NOTIFICATION_KEY, {})) || {};

  if (notificationsByFriend[friendId] === todayStamp) {
    return;
  }

  notificationsByFriend[friendId] = todayStamp;
  await setLocalObject(FRIEND_ONLINE_NOTIFICATION_KEY, notificationsByFriend);
  showToast(`${friend.displayName} is online`, "You can send a drawing or surprise right away.");
}

function toWebSocketUrl(value) {
  const url = new URL(value);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }
  return url.toString();
}

const serverUrl = toWebSocketUrl(rawServerUrl);

function resizeCanvas() {
  const hadContent = canvas.width > 0 && canvas.height > 0;
  const previous = hadContent ? context.getImageData(0, 0, canvas.width, canvas.height) : null;
  const ratio = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();

  canvas.width = Math.max(1, Math.floor(width * ratio));
  canvas.height = Math.max(1, Math.floor(height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.lineCap = "round";
  context.lineJoin = "round";

  if (previous && previous.width > 1 && previous.height > 1) {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = previous.width;
    tempCanvas.height = previous.height;
    tempCanvas.getContext("2d").putImageData(previous, 0, 0);
    context.drawImage(tempCanvas, 0, 0, width, height);
  }
}

function setStatus(text, tone = "dark") {
  statusPill.textContent = text;
  statusPill.style.background = tone === "ok" ? "rgba(33, 111, 67, 0.9)" : "rgba(32, 29, 23, 0.82)";
}

function setGlobalStatus(text, online = false) {
  globalStatus.textContent = text;
  globalStatus.style.background = online ? "var(--blue-soft)" : "#f3e5d5";
}

function addMessage(message) {
  const item = document.createElement("article");
  item.className = `message${message.system ? " system" : ""}${message.userId === userId ? " self" : ""}`;

  if (message.system) {
    item.textContent = message.text;
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
    return;
  }

  const time = new Date(message.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  item.innerHTML = `
    <div class="message-meta">${message.displayName} - ${time}</div>
    <div>${message.text}</div>
  `;

  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
  hasDirectMessages = true;
  latestMessagePreview = message.userId === userId
    ? `You: ${message.text}`
    : `${message.displayName}: ${message.text}`;
  if (!chatPanelOpen && message.userId !== userId) {
    unreadMessageCount += 1;
    showToast(`${message.displayName} sent a message`, message.text);
  }
  updateInboxUI();
}

function hexToRgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((part) => part + part).join("")
    : normalized;
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function clearMexicanWaveEffect() {
  if (activeMexicanWaveCleanup) {
    activeMexicanWaveCleanup();
    activeMexicanWaveCleanup = null;
  }
}

function canAnimateTextNode(node) {
  if (!node || !node.parentElement) {
    return false;
  }

  const parent = node.parentElement;
  if (
    parent.closest("script, style, noscript, textarea, input, select, option, button, canvas, svg, code, pre") ||
    parent.closest("[contenteditable='true']") ||
    parent.closest("#toastStack")
  ) {
    return false;
  }

  const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
  if (text.length < 4) {
    return false;
  }

  const style = window.getComputedStyle(parent);
  if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) < 0.05) {
    return false;
  }

  return true;
}

function getVisibleTextTargets(limit = 14) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const candidates = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!canAnimateTextNode(node)) {
      continue;
    }

    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects());
    range.detach?.();

    if (rects.length === 0) {
      continue;
    }

    let visibleArea = 0;
    let maxWidth = 0;
    let maxHeight = 0;
    let firstTop = Number.POSITIVE_INFINITY;

    for (const rect of rects) {
      const width = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
      const height = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
      if (width <= 0 || height <= 0) {
        continue;
      }

      visibleArea += width * height;
      maxWidth = Math.max(maxWidth, width);
      maxHeight = Math.max(maxHeight, height);
      firstTop = Math.min(firstTop, rect.top);
    }

    if (visibleArea <= 0 || maxWidth < 28 || maxHeight < 10) {
      continue;
    }

    candidates.push({
      node,
      text: node.textContent,
      score: visibleArea,
      top: firstTop,
    });
  }

  return candidates
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.top - right.top;
    })
    .slice(0, limit);
}

function wrapTextNodeLetters(node, text) {
  const wrapper = document.createElement("span");
  wrapper.dataset.sketchPartyWaveRoot = "true";
  wrapper.style.display = "inline";
  wrapper.style.whiteSpace = "pre-wrap";

  const letters = [];
  const fragment = document.createDocumentFragment();

  for (const character of text) {
    const letter = document.createElement("span");
    letter.textContent = character === " " ? "\u00A0" : character;
    letter.style.display = "inline-block";
    letter.style.willChange = "transform";
    letter.style.transform = "translateY(0px)";
    letter.style.transition = "transform 0s linear";
    letter.style.textShadow = "0 0 0 rgba(255,255,255,0)";
    fragment.appendChild(letter);
    letters.push(letter);
  }

  wrapper.appendChild(fragment);
  node.replaceWith(wrapper);
  return { wrapper, letters };
}

function runMexicanWaveEffect({
  durationMs = 2400,
  amplitude = 4.5,
  waveWidth = 5.5,
  speed = 0.016,
} = {}) {
  clearMexicanWaveEffect();

  const targets = getVisibleTextTargets();
  if (targets.length === 0) {
    return;
  }

  const wrappedTargets = [];

  for (const [index, target] of targets.entries()) {
    const trimmedText = target.text;
    const { wrapper, letters } = wrapTextNodeLetters(target.node, trimmedText);
    wrappedTargets.push({
      originalText: trimmedText,
      wrapper,
      letters,
      phaseOffset: (index * 1.7) + ((index % 3) * 0.55),
      localAmplitude: 2 + Math.min(4, amplitude + ((index % 4) * 0.2)),
    });
  }

  let rafId = 0;
  let disposed = false;
  const startedAt = performance.now();

  const restore = () => {
    if (disposed) {
      return;
    }

    disposed = true;
    if (rafId) {
      cancelAnimationFrame(rafId);
    }

    for (const target of wrappedTargets) {
      target.wrapper.replaceWith(document.createTextNode(target.originalText));
    }

    if (activeMexicanWaveCleanup === restore) {
      activeMexicanWaveCleanup = null;
    }
  };

  activeMexicanWaveCleanup = restore;

  const animate = (now) => {
    const elapsed = now - startedAt;
    const progress = elapsed / durationMs;
    if (progress >= 1) {
      restore();
      return;
    }

    for (const target of wrappedTargets) {
      const cycleLength = target.letters.length + (waveWidth * 2);
      const head = (((elapsed * speed) + target.phaseOffset) % cycleLength) - waveWidth;

      for (let index = 0; index < target.letters.length; index += 1) {
        const distance = Math.min(
          Math.abs(index - head),
          Math.abs(index - (head - cycleLength)),
          Math.abs(index - (head + cycleLength)),
        );
        const influence = Math.max(0, 1 - (distance / waveWidth));
        const offsetY = -target.localAmplitude * Math.sin(influence * Math.PI * 0.5);
        const glow = influence * 0.12;
        const letter = target.letters[index];
        letter.style.transform = `translateY(${offsetY.toFixed(2)}px)`;
        letter.style.textShadow = glow > 0.01 ? `0 0 ${glow.toFixed(2)}rem rgba(255,255,255,0.18)` : "0 0 0 rgba(255,255,255,0)";
      }
    }

    rafId = requestAnimationFrame(animate);
  };

  rafId = requestAnimationFrame(animate);
}

function drawCrack(segment, ctx = context) {
  const center = segment.to;
  const baseRadius = Math.max(24, segment.size * 6);
  ctx.save();
  ctx.strokeStyle = hexToRgba(segment.color, 0.85);
  ctx.lineWidth = Math.max(1, segment.size * 0.45);

  ctx.beginPath();
  ctx.arc(center.x, center.y, baseRadius * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba("#ffffff", 0.16);
  ctx.fill();

  for (let index = 0; index < 10; index += 1) {
    const angle = (Math.PI * 2 * index) / 10 + ((segment.seed || 0) * 0.35);
    const radius = baseRadius * (0.72 + ((index % 4) * 0.16));
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(x, y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(center.x + Math.cos(angle) * (radius * 0.34), center.y + Math.sin(angle) * (radius * 0.34));
    ctx.lineTo(center.x + Math.cos(angle + 0.12) * (radius * 0.46), center.y + Math.sin(angle + 0.12) * (radius * 0.46));
    ctx.strokeStyle = hexToRgba("#ffffff", 0.2);
    ctx.stroke();
    ctx.strokeStyle = hexToRgba(segment.color, 0.85);
  }

  ctx.fillStyle = hexToRgba("#ffffff", 0.36);
  ctx.beginPath();
  ctx.arc(center.x, center.y, Math.max(4, segment.size), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawScribble(segment, ctx = context) {
  const center = segment.to;
  const radius = Math.max(14, segment.size * 3.4);
  ctx.save();
  ctx.strokeStyle = hexToRgba(segment.color, 0.94);
  ctx.lineWidth = Math.max(2, segment.size * 0.95);
  ctx.beginPath();

  for (let index = 0; index <= 28; index += 1) {
    const angle = (Math.PI * 7 * index) / 28;
    const wobble = radius * (0.76 + (Math.sin(angle * 1.9 + (segment.seed || 0)) * 0.24));
    const x = center.x + Math.cos(angle) * wobble;
    const y = center.y + Math.sin(angle) * wobble;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
  ctx.restore();
}

function drawDrip(segment, ctx = context) {
  const point = segment.to;
  const height = Math.max(30, segment.size * 10);
  const width = Math.max(8, segment.size * 1.8);
  ctx.save();
  ctx.strokeStyle = hexToRgba(segment.color, 0.92);
  ctx.fillStyle = hexToRgba(segment.color, 0.26);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.bezierCurveTo(
    point.x + width * 0.2,
    point.y + height * 0.28,
    point.x - width * 0.25,
    point.y + height * 0.72,
    point.x,
    point.y + height
  );
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + height + width * 0.1, width * 0.9, width * 1.15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawInkSlap(segment, ctx = context) {
  const center = segment.to;
  const splashRadius = Math.max(18, segment.size * 3.6);
  const droplets = 7;

  ctx.save();
  ctx.fillStyle = hexToRgba(segment.color, 0.9);
  ctx.strokeStyle = hexToRgba("#ffffff", 0.12);
  ctx.lineWidth = Math.max(1, segment.size * 0.22);

  ctx.beginPath();
  for (let index = 0; index < 18; index += 1) {
    const angle = (Math.PI * 2 * index) / 18;
    const wobble = splashRadius * (0.84 + (Math.sin(angle * 3 + (segment.seed || 0)) * 0.22));
    const x = center.x + Math.cos(angle) * wobble;
    const y = center.y + Math.sin(angle) * wobble;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  for (let index = 0; index < droplets; index += 1) {
    const angle = ((Math.PI * 2) / droplets) * index + (segment.seed || 0) * 0.4;
    const distance = splashRadius * (1.3 + ((index % 3) * 0.28));
    const radius = Math.max(3, segment.size * (0.55 + ((index % 2) * 0.22)));
    ctx.beginPath();
    ctx.arc(
      center.x + Math.cos(angle) * distance,
      center.y + Math.sin(angle) * distance,
      radius,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.restore();
}

function drawConfetti(segment, ctx = context) {
  const center = segment.to;
  const colors = ["#ef6a48", "#ffd05b", "#4d83ff", "#ff5b7c", "#35b56a", "#ffffff"];
  const pieces = 18;

  ctx.save();
  for (let index = 0; index < pieces; index += 1) {
    const angle = ((Math.PI * 2) / pieces) * index + ((segment.seed || 0) * 0.25);
    const distance = Math.max(18, segment.size * 4.6) * (0.5 + ((index % 5) * 0.13));
    const x = center.x + Math.cos(angle) * distance;
    const y = center.y + Math.sin(angle) * distance;
    const width = Math.max(5, segment.size * 0.9);
    const height = Math.max(8, segment.size * 1.5);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + (index % 3) * 0.4);
    ctx.fillStyle = colors[index % colors.length];
    ctx.fillRect(-width / 2, -height / 2, width, height);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(center.x, center.y, Math.max(3, segment.size * 0.8), 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba("#ffffff", 0.58);
  ctx.fill();
  ctx.restore();
}

function drawZap(segment, ctx = context) {
  const start = segment.from;
  const end = segment.to;
  const steps = 6;
  ctx.save();
  ctx.strokeStyle = hexToRgba("#f8f2b3", 0.95);
  ctx.lineWidth = Math.max(2, segment.size * 0.8);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);

  for (let index = 1; index < steps; index += 1) {
    const progress = index / steps;
    const x = start.x + ((end.x - start.x) * progress) + ((index % 2 === 0 ? -1 : 1) * segment.size * 5);
    const y = start.y + ((end.y - start.y) * progress);
    ctx.lineTo(x, y);
  }

  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.restore();
}

function drawHeartburst(segment, ctx = context) {
  const center = segment.to;
  const hearts = 6;
  ctx.save();
  ctx.fillStyle = hexToRgba(segment.color, 0.92);

  for (let index = 0; index < hearts; index += 1) {
    const angle = (Math.PI * 2 * index) / hearts;
    const distance = segment.size * 5 + (index % 2) * 10;
    const x = center.x + Math.cos(angle) * distance;
    const y = center.y + Math.sin(angle) * distance;
    const size = Math.max(8, segment.size * 1.8);
    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.25);
    ctx.bezierCurveTo(x - size, y - size * 0.7, x - size * 1.5, y + size * 0.8, x, y + size * 1.5);
    ctx.bezierCurveTo(x + size * 1.5, y + size * 0.8, x + size, y - size * 0.7, x, y + size * 0.25);
    ctx.fill();
  }

  ctx.restore();
}

function drawBullet(segment, ctx = context) {
  const center = segment.to;
  drawCrack({ ...segment, size: segment.size * 0.8, to: center }, ctx);
  ctx.save();
  ctx.fillStyle = hexToRgba("#201d17", 0.94);
  ctx.beginPath();
  ctx.arc(center.x, center.y, Math.max(4, segment.size * 0.8), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawStickman(segment, ctx = context) {
  const center = segment.to;
  const scale = Math.max(12, segment.size * 2.2);
  ctx.save();
  ctx.strokeStyle = hexToRgba(segment.color, 0.96);
  ctx.lineWidth = Math.max(2, segment.size * 0.7);
  ctx.beginPath();
  ctx.arc(center.x, center.y - scale * 1.3, scale * 0.45, 0, Math.PI * 2);
  ctx.moveTo(center.x, center.y - scale * 0.85);
  ctx.lineTo(center.x, center.y + scale * 0.7);
  ctx.moveTo(center.x - scale * 0.8, center.y - scale * 0.2);
  ctx.lineTo(center.x + scale * 0.8, center.y - scale * 0.55);
  ctx.moveTo(center.x, center.y + scale * 0.7);
  ctx.lineTo(center.x - scale * 0.8, center.y + scale * 1.6);
  ctx.moveTo(center.x, center.y + scale * 0.7);
  ctx.lineTo(center.x + scale * 0.9, center.y + scale * 1.5);
  ctx.stroke();
  ctx.restore();
}

function drawStickerSlap(segment, ctx = context) {
  const center = segment.to;
  const width = Math.max(54, segment.size * 10.5);
  const height = Math.max(42, segment.size * 7.8);
  const tilt = Math.sin(segment.seed || 0) * 0.18;

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(tilt);

  ctx.fillStyle = hexToRgba("#000000", 0.14);
  ctx.beginPath();
  ctx.roundRect(-width / 2 + 4, -height / 2 + 6, width, height, 18);
  ctx.fill();

  ctx.fillStyle = hexToRgba("#fffdf8", 0.98);
  ctx.strokeStyle = hexToRgba(segment.color, 0.92);
  ctx.lineWidth = Math.max(2, segment.size * 0.45);
  ctx.beginPath();
  ctx.roundRect(-width / 2, -height / 2, width, height, 18);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = hexToRgba(segment.color, 0.14);
  ctx.beginPath();
  ctx.roundRect(-width / 2 + 7, -height / 2 + 7, width - 14, height - 14, 14);
  ctx.fill();

  ctx.fillStyle = hexToRgba(segment.color, 0.94);
  ctx.font = `700 ${Math.max(14, segment.size * 2.1)}px "Trebuchet MS", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("NICE", 0, -3);

  ctx.fillStyle = hexToRgba("#ffd05b", 0.96);
  for (let index = 0; index < 3; index += 1) {
    const sparkleX = -width * 0.22 + (index * width * 0.22);
    const sparkleY = height * 0.28;
    ctx.beginPath();
    ctx.moveTo(sparkleX, sparkleY - 6);
    ctx.lineTo(sparkleX + 2.6, sparkleY - 1.8);
    ctx.lineTo(sparkleX + 7, sparkleY);
    ctx.lineTo(sparkleX + 2.6, sparkleY + 1.8);
    ctx.lineTo(sparkleX, sparkleY + 6);
    ctx.lineTo(sparkleX - 2.6, sparkleY + 1.8);
    ctx.lineTo(sparkleX - 7, sparkleY);
    ctx.lineTo(sparkleX - 2.6, sparkleY - 1.8);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function denormalizePoint(point) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (point.x / 1000) * rect.width,
    y: (point.y / 1000) * rect.height,
  };
}

function drawSegment(segment) {
  const drawableSegment = segment.normalized
    ? { ...segment, from: denormalizePoint(segment.from), to: denormalizePoint(segment.to) }
    : segment;

  if (drawableSegment.effect === "mexicanwave") return runMexicanWaveEffect();
  if (drawableSegment.effect === "crack") return drawCrack(drawableSegment);
  if (drawableSegment.effect === "scribble") return drawScribble(drawableSegment);
  if (drawableSegment.effect === "drip") return drawDrip(drawableSegment);
  if (drawableSegment.effect === "inkslap") return drawInkSlap(drawableSegment);
  if (drawableSegment.effect === "confetti") return drawConfetti(drawableSegment);
  if (drawableSegment.effect === "zap") return drawZap(drawableSegment);
  if (drawableSegment.effect === "heartburst") return drawHeartburst(drawableSegment);
  if (drawableSegment.effect === "bullet") return drawBullet(drawableSegment);
  if (drawableSegment.effect === "stickman") return drawStickman(drawableSegment);
  if (drawableSegment.effect === "stickerslap") return drawStickerSlap(drawableSegment);

  context.strokeStyle = drawableSegment.color;
  context.lineWidth = drawableSegment.size;
  context.beginPath();
  context.moveTo(drawableSegment.from.x, drawableSegment.from.y);
  context.lineTo(drawableSegment.to.x, drawableSegment.to.y);
  context.stroke();
}

function resetPointerState() {
  isDrawing = false;
  lastPoint = null;
  activeStrokeId = null;
}

function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function normalizePoint(point) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.width > 0 ? (point.x / rect.width) * 1000 : 0,
    y: rect.height > 0 ? (point.y / rect.height) * 1000 : 0,
  };
}

function toOutboundSegment(segment) {
  return {
    ...segment,
    normalized: true,
    from: normalizePoint(segment.from),
    to: normalizePoint(segment.to),
  };
}

function canSendSegment(segment) {
  return canUseEffect(segment.effect || "draw");
}

function sanitizeDraftSegmentsForEntitlement() {
  const nextDraftSegments = draftSegments.filter(canSendSegment);
  const removedCount = draftSegments.length - nextDraftSegments.length;

  if (removedCount <= 0) {
    return;
  }

  draftSegments = nextDraftSegments;
  addMessage({
    system: true,
    text: removedCount === 1
      ? "One Pro draft item was removed because your current plan cannot send it."
      : `${removedCount} Pro draft items were removed because your current plan cannot send them.`,
  });
  updateSessionUI();
}

function storeDraft(segment) {
  draftSegments.push(toOutboundSegment(segment));
  updateSessionUI();
}

function replayDraftToCurrentSession() {
  if (!currentSession || !currentSession.drawEnabled || draftSegments.length === 0) {
    return;
  }

  const sendableDraftSegments = draftSegments.filter(canSendSegment);

  if (sendableDraftSegments.length === 0) {
    addMessage({
      system: true,
      text: "Your current draft only contains Pro effects. Upgrade to send it.",
    });
    void openPaywall("draft-pro-locked");
    return;
  }

  for (const segment of sendableDraftSegments) {
    send({
      type: "draw-segment",
      sessionId: currentSession.sessionId,
      segment,
    });
  }

  addMessage({
    system: true,
    text: `${sendableDraftSegments.length} draft items were sent.`,
  });
  draftSegments = draftSegments.filter((segment) => !canSendSegment(segment));
  updateSessionUI();
}

function showSurpriseEffect(segment) {
  if (!extensionEnabled || !allowSurprise || !chrome?.runtime?.sendMessage) {
    return;
  }

  chrome.runtime.sendMessage({
    type: "SHOW_SURPRISE_EFFECT",
    segment,
  }).catch(() => {});
}

function clearSurpriseEffect() {
  clearMexicanWaveEffect();
  if (!chrome?.runtime?.sendMessage) {
    return;
  }

  chrome.runtime.sendMessage({ type: "CLEAR_SURPRISE_EFFECT" }).catch(() => {});
}

function getFriendOnline(friendId) {
  return onlineUserIds.has(friendId);
}

function getSelectedFriend() {
  return friends.find((friend) => friend.userId === selectedFriendId) || null;
}

function selectFriend(userId, { quiet = false } = {}) {
  selectedFriendId = userId || "";
  renderFriends();
  updateSessionUI();

  if (!quiet) {
    const friend = getSelectedFriend();
    if (friend) {
      setStatus(`${friend.displayName} selected`, "ok");
    }
  }
}

function renderRequests() {
  requestList.innerHTML = "";

  for (const request of incomingRequests) {
    const card = document.createElement("article");
      card.className = "request-card";
      card.innerHTML = `
        <div class="request-identity">
          <div class="user-avatar" style="--avatar-image:url('${request.avatarUrl}')"></div>
          <div>
            <strong>${request.displayName}</strong>
            <div class="friend-meta">Sent you a friend request.</div>
          </div>
        </div>
        <div class="request-actions">
          <button class="mini-button" data-action="accept" data-request-id="${request.id}">Accept</button>
          <button class="mini-button" data-action="reject" data-request-id="${request.id}">Reject</button>
        </div>
      `;
    requestList.appendChild(card);
  }

  for (const request of outgoingRequests) {
    const card = document.createElement("article");
      card.className = "request-card";
      card.innerHTML = `
        <div class="request-identity">
          <div class="user-avatar" style="--avatar-image:url('${request.avatarUrl}')"></div>
          <div>
            <strong>${request.displayName}</strong>
            <div class="friend-meta">Request pending.</div>
          </div>
        </div>
      `;
      requestList.appendChild(card);
    }
}

function renderFriends() {
  friendCount.textContent = `${friends.length} people`;
  friendsList.innerHTML = "";

  if (friends.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = isGuestMode
      ? "Guest mode does not save friends. Paste a party code or exact profile name above to start a temporary session."
      : "You do not have any accepted friends yet. Send a party code or exact profile name from the field above.";
    friendsList.appendChild(empty);
    return;
  }

  for (const friend of friends) {
    const online = getFriendOnline(friend.userId);
    const card = document.createElement("article");
    const isSelected = selectedFriendId === friend.userId;
    card.className = `friend-card${isSelected ? " is-selected" : ""}`;
    card.dataset.userId = friend.userId;

      card.innerHTML = `
        <div class="friend-top">
          <div class="friend-identity">
            <div class="user-avatar" style="--avatar-image:url('${friend.avatarUrl}')"></div>
            <div>
              <strong>${friend.displayName}</strong>
              <div class="friend-meta">${online ? "Available now" : "Offline right now"}</div>
            </div>
          </div>
          <span class="status-dot ${online ? "online" : ""}">
            ${online ? "Online" : "Offline"}
        </span>
      </div>
      <div class="friend-card-note"><strong>${isSelected ? "Selected" : "Click to select"}</strong><span>${online ? "Ready to receive" : "Wait until they come online"}</span></div>
    `;

    friendsList.appendChild(card);
  }
}

function updateSessionUI() {
  const hasSession = Boolean(currentSession);
  const selectedFriend = getSelectedFriend();
  const selectedFriendOnline = selectedFriend ? getFriendOnline(selectedFriend.userId) : false;
  chatInput.disabled = !hasSession;
  clearCanvasButton.disabled = !hasSession && draftSegments.length === 0;
  sendDraftButton.disabled = draftSegments.length === 0 || !selectedFriend;
  messageFriendButton.disabled = !selectedFriend;
  startLiveModeButton.disabled = !selectedFriend || !selectedFriendOnline || !entitlement?.isPro;
  leaveSessionButton.disabled = !hasSession;
  selectedTargetPill.classList.toggle("hidden", !selectedFriend || hasSession);
  if (selectedFriend && !hasSession) {
    selectedTargetPill.textContent = `Selected: ${selectedFriend.displayName}`;
  }

  if (!hasSession) {
    sessionTitle.textContent = selectedFriend ? selectedFriend.displayName : (draftSegments.length > 0 ? "Draft ready" : "Choose a friend");
    sessionModeText.textContent = selectedFriend
      ? (draftSegments.length > 0
          ? `${draftSegments.length} draft items are ready to send to ${selectedFriend.displayName}.`
          : `Draw anything, then send it to ${selectedFriend.displayName}.`)
      : (draftSegments.length > 0
          ? `${draftSegments.length} items are ready. Choose a friend on the left and press Send draft.`
          : "Choose someone from the left to start drawing.");
    presence.textContent = selectedFriend
      ? (selectedFriendOnline ? "Selected friend is online" : "Selected friend is offline")
      : "Waiting for a friend";
    drawGuard.classList.remove("hidden");
    drawGuard.textContent = selectedFriend
      ? (draftSegments.length > 0
          ? `Your draft is ready for ${selectedFriend.displayName}.`
          : `There is no active session. Draw here first, then send it to ${selectedFriend.displayName}.`)
      : (draftSegments.length > 0
          ? "Your draft is saved. Now choose a recipient from the left."
          : "There is no active session. Draw here first, then choose a recipient.");
    updateInboxUI();
    return;
  }

  const modeLabel = currentSession.mode === "live" ? "Live drawing" : "One-way drawing send";
  const modeHint = currentSession.drawEnabled
    ? "You can draw in this session."
    : "Surprise effects will appear on the other person's active tab.";

  sessionTitle.textContent = currentSession.partner.displayName;
  sessionModeText.textContent = `${modeLabel} - ${modeHint}`;
  presence.textContent = getFriendOnline(currentSession.partner.userId) ? "Selected friend is online" : "Selected friend is offline";
  selectedTargetPill.classList.add("hidden");
  drawGuard.classList.add("hidden");
  updateInboxUI();
}

function applySocialState(state) {
  if (!state) {
    return;
  }

  userId = state.user.id;
  displayName = state.user.displayName;
  applyRuntimePreferences(state.preferences, { updateStatus: false });
  entitlement = state.entitlement;
  friends = state.friends;
  incomingRequests = state.incomingRequests;
  outgoingRequests = state.outgoingRequests;
  partyCode = createPartyCode(userId);
  if (selectedFriendId && !friends.some((friend) => friend.userId === selectedFriendId)) {
    selectedFriendId = "";
  }

  profileName.textContent = displayName;
  profileAvatar.style.setProperty("--avatar-image", `url("${state.user.avatarUrl || getSketchPartyAvatarDataUrl(userId, displayName)}")`);
  profileNameInput.value = displayName;
  updateSyncCodeUI();

  setSignedInDashboardUI();
  updateMembershipUI();
  ensureAllowedEffectSelection();
  sanitizeDraftSegmentsForEntitlement();
  renderRequests();
  renderFriends();
  updateSessionUI();
  applyRuntimePreferences(state.preferences);
  void saveLocalPreferences(state.preferences);
}

async function refreshSocialState({ silent = true } = {}) {
  if (isGuestMode) {
    return;
  }

  if (socialRefreshInFlight) {
    return;
  }

  socialRefreshInFlight = true;

  try {
    const state = await getSocialState();
    applySocialState(state);
  } catch (error) {
    if (!silent) {
      setStatus(error.message || "Your social state could not be refreshed.");
    }
  } finally {
    socialRefreshInFlight = false;
  }
}

function startSocialRefreshLoop() {
  if (socialRefreshTimer) {
    clearInterval(socialRefreshTimer);
  }

  socialRefreshTimer = window.setInterval(() => {
    void refreshSocialState();
  }, socialRefreshIntervalMs);
}

async function applyQuickAction() {
  const stored = await chrome.storage.local.get(QUICK_ACTION_KEY);
  const action = stored[QUICK_ACTION_KEY];

  if (!action) {
    return;
  }

  await chrome.storage.local.remove(QUICK_ACTION_KEY);

  if (action.type === "message" && action.text) {
    openInbox({ focusComposer: false });
    chatInput.value = action.text;
    addMessage({
      system: true,
      text: "A quick message draft was added. Choose a friend and send it.",
    });
  }

  if (action.type === "effect" && action.effect) {
    if (!canUseEffect(action.effect)) {
      addMessage({
        system: true,
        text: "This quick effect is available with Pro. Redirecting you to the paywall.",
      });
      void openPaywall("quick-effect-locked");
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const point = {
      x: rect.width * 0.5,
      y: rect.height * 0.45,
    };

    const segment = {
      strokeId: crypto.randomUUID(),
      effect: action.effect,
      from: point,
      to: action.effect === "zap"
        ? { x: point.x + 90, y: point.y + 40 }
        : point,
      color: action.color || colorPicker.value,
      size: action.size || 6,
      seed: Math.random() * Math.PI * 2,
    };

    drawSegment(segment);
    storeDraft(segment);

    if (action.targetUserId) {
      pendingDraftTarget = { userId: action.targetUserId };
      addMessage({
        system: true,
        text: `${action.label || action.effect} was queued for your selected friend. Starting a send session now.`,
      });
      void handleSessionStart(action.targetUserId, "send");
      return;
    }

    addMessage({
      system: true,
      text: `${action.label || action.effect} was added as a quick draft.`,
    });
  }
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function createSegment(effect, point, nextPoint = point) {
  return {
    strokeId: crypto.randomUUID(),
    effect,
    from: point,
    to: nextPoint,
    color: colorPicker.value,
    size: Number(brushSize.value),
    seed: Math.random() * Math.PI * 2,
  };
}

function connect() {
  setStatus("Connecting...");
  socket = new WebSocket(serverUrl);

  socket.addEventListener("open", async () => {
    try {
      const accessToken = isGuestMode ? null : await getAccessToken();

      send({
        type: "register-user",
        userId,
        clientId,
        displayName,
        accessToken,
        guest: isGuestMode,
        preferences: {
          extensionEnabled,
          appearOnline,
          allowSurprise,
        },
      });
      setStatus("Connected", "ok");
    } catch (error) {
      setStatus(error.message || "Session could not be verified");
      socket.close();
    }
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "registered") {
      addMessage({
        system: true,
        text: isGuestMode
          ? `Connected as ${displayName}. Guest sessions are ready.`
          : `Connected as ${displayName}. Your friends were loaded from your Supabase account.`,
      });
      if (!isGuestMode) {
        void refreshSocialState();
      }
      return;
    }

    if (message.type === "guest-preference-nudge") {
      showToast("Someone tried to send you something", message.message || "Your current receiving settings blocked it.");
      addMessage({
        system: true,
        text: message.message || "Someone tried to start a session, but your current receiving settings blocked it.",
      });
      return;
    }

    if (message.type === "presence-state") {
      const nextOnlineUserIds = new Set(message.onlineUserIds || []);
      const newlyOnlineFriendIds = [];

      if (hasPresenceSnapshot) {
        for (const friend of friends) {
          if (!previousOnlineUserIds.has(friend.userId) && nextOnlineUserIds.has(friend.userId)) {
            newlyOnlineFriendIds.push(friend.userId);
          }
        }
      }

      onlineUserIds = nextOnlineUserIds;
      previousOnlineUserIds = new Set(nextOnlineUserIds);
      hasPresenceSnapshot = true;
      renderFriends();
      updateSessionUI();

      for (const friendId of newlyOnlineFriendIds) {
        void maybeNotifyFriendOnline(friendId);
      }

      return;
    }

    if (message.type === "session-started") {
      selectFriend(message.partner.userId, { quiet: true });
      currentSession = {
        sessionId: message.sessionId,
        mode: message.mode,
        drawEnabled: message.drawEnabled,
        partner: message.partner,
      };
      context.clearRect(0, 0, canvas.width, canvas.height);
      clearSurpriseEffect();
      if (!message.restored) {
        messages.innerHTML = "";
        hasDirectMessages = false;
        latestMessagePreview = "Messages";
        unreadMessageCount = 0;
      }
      updateSessionUI();
      addMessage({
        system: true,
        text: message.restored
          ? `Session restored with ${message.partner.displayName}.`
          : `A new session started with ${message.partner.displayName}.`,
      });

      if (
        pendingDraftTarget &&
        pendingDraftTarget.userId === message.partner.userId &&
        currentSession.drawEnabled &&
        draftSegments.length > 0
      ) {
        replayDraftToCurrentSession();
        pendingDraftTarget = null;
      }

      if (pendingTextTarget && pendingTextTarget.userId === message.partner.userId) {
        openInbox({ focusComposer: true });
        pendingTextTarget = null;
      }

      void getSocialState().then((state) => {
        if (isGuestMode) {
          return;
        }
        const matched = state?.activeSessions.find((session) =>
          [session.initiator_id, session.recipient_id].includes(message.partner.userId)
        );
        if (matched) {
          currentRpcSession = matched;
        }
      }).catch(() => {});
      void refreshSocialState();
      return;
    }

    if (message.type === "session-ended") {
      currentSession = null;
      currentRpcSession = null;
      resetPointerState();
      context.clearRect(0, 0, canvas.width, canvas.height);
      clearSurpriseEffect();
      updateSessionUI();
      addMessage({
        system: true,
        text: message.reason || "Session ended.",
      });
      return;
    }

    if (message.type === "chat") {
      addMessage(message);
      return;
    }

    if (message.type === "draw-segment") {
      drawSegment(message.segment);
      showSurpriseEffect(message.segment);
      return;
    }

    if (message.type === "clear-canvas") {
      context.clearRect(0, 0, canvas.width, canvas.height);
      clearSurpriseEffect();
      return;
    }

    if (message.type === "error") {
      setStatus(message.message);
      addMessage({
        system: true,
        text: message.message,
      });
    }
  });

  socket.addEventListener("close", () => {
    currentSession = null;
    currentRpcSession = null;
    previousOnlineUserIds = new Set();
    hasPresenceSnapshot = false;
    resetPointerState();
    updateSessionUI();
    setStatus("Connection lost, retrying...");
    setGlobalStatus("Offline");
    window.setTimeout(connect, 1500);
  });

  socket.addEventListener("error", () => {
    setStatus("The server could not be reached");
  });
}

canvas.addEventListener("pointerdown", (event) => {
  const point = pointerPosition(event);
  const selectedEffect = effectPicker.value;

  if (!canUseEffect(selectedEffect)) {
    addMessage({
      system: true,
      text: "This effect is available with Pro. On Free, you can use the basic effects.",
    });
    void openPaywall("effect-locked");
    ensureAllowedEffectSelection();
    return;
  }

  if (selectedEffect !== "draw") {
    const nextPoint = selectedEffect === "zap"
      ? { x: point.x + 90, y: point.y + 40 }
      : point;
    const segment = createSegment(selectedEffect, point, nextPoint);
    drawSegment(segment);

    if (currentSession?.drawEnabled) {
      send({
        type: "draw-segment",
        sessionId: currentSession.sessionId,
        segment: toOutboundSegment(segment),
      });
    } else {
      storeDraft(segment);
    }
    return;
  }

  isDrawing = true;
  lastPoint = point;
  activeStrokeId = crypto.randomUUID();
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!isDrawing || !lastPoint) {
    return;
  }

  const nextPoint = pointerPosition(event);
  const segment = {
    strokeId: activeStrokeId,
    effect: "draw",
    from: lastPoint,
    to: nextPoint,
    color: colorPicker.value,
    size: Number(brushSize.value),
  };

  drawSegment(segment);

  if (currentSession?.drawEnabled) {
    send({
      type: "draw-segment",
      sessionId: currentSession.sessionId,
      segment: toOutboundSegment(segment),
    });
  } else {
    storeDraft(segment);
  }

  lastPoint = nextPoint;
});

function stopDrawing() {
  resetPointerState();
}

canvas.addEventListener("pointerup", stopDrawing);
canvas.addEventListener("pointercancel", stopDrawing);
canvas.addEventListener("pointerleave", stopDrawing);

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();

  if (!text || !currentSession) {
    return;
  }

  send({
    type: "chat",
    sessionId: currentSession.sessionId,
    text,
    timestamp: Date.now(),
  });

  chatInput.value = "";
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nextName = profileNameInput.value.trim();

  if (!nextName) {
    return;
  }

  try {
    if (isGuestMode) {
      await updateStoredProfile({
        guestName: nextName,
      });
      displayName = nextName;
      profileName.textContent = displayName;
      profileAvatar.style.setProperty("--avatar-image", `url("${getSketchPartyAvatarDataUrl(userId, displayName)}")`);
      setStatus("Guest name updated", "ok");
      if (socket?.readyState === WebSocket.OPEN) {
        send({
          type: "register-user",
          userId,
          clientId,
          displayName,
          guest: true,
          preferences: {
            extensionEnabled,
            appearOnline,
            allowSurprise,
          },
        });
      }
      return;
    }

    const state = await updateProfile(nextName);
    applySocialState(state);
    setStatus("Profile updated", "ok");
    if (socket?.readyState === WebSocket.OPEN) {
      const accessToken = await getAccessToken();
      send({
        type: "register-user",
        userId,
        clientId,
        displayName,
        accessToken,
        preferences: {
          extensionEnabled,
          appearOnline,
          allowSurprise,
        },
      });
    }
  } catch (error) {
    setStatus(error.message || "Profile could not be updated");
  }
});

clearCanvasButton.addEventListener("click", () => {
  context.clearRect(0, 0, canvas.width, canvas.height);
  clearSurpriseEffect();

  if (currentSession) {
    send({
      type: "clear-canvas",
      sessionId: currentSession.sessionId,
    });
  } else {
    draftSegments = [];
    updateSessionUI();
  }
});

sendDraftButton.addEventListener("click", () => {
  if (draftSegments.length === 0) {
    setStatus("Create a draft first");
    return;
  }

  const selectedFriend = getSelectedFriend();
  if (selectedFriend) {
    pendingDraftTarget = { userId: selectedFriend.userId };
    void handleSessionStart(selectedFriend.userId, "send");
    return;
  }

  const onlineFriends = friends.filter((friend) => getFriendOnline(friend.userId));
  if (onlineFriends.length === 1) {
    pendingDraftTarget = { userId: onlineFriends[0].userId };
    void handleSessionStart(onlineFriends[0].userId, "send");
    return;
  }

  addMessage({
    system: true,
    text: "Your draft is ready. Select a friend on the left first.",
  });
});

messageFriendButton.addEventListener("click", () => {
  const selectedFriend = getSelectedFriend();
  if (!selectedFriend) {
    setStatus("Select a friend first");
    return;
  }

  pendingTextTarget = { userId: selectedFriend.userId };
  openInbox({ focusComposer: false });
  void handleSessionStart(selectedFriend.userId, "send");
});

startLiveModeButton.addEventListener("click", () => {
  const selectedFriend = getSelectedFriend();
  if (!selectedFriend) {
    setStatus("Select a friend first");
    return;
  }

  if (!entitlement?.isPro) {
    setStatus("Live drawing is available to Pro members");
    void openPaywall("live-mode-locked");
    return;
  }

  if (!getFriendOnline(selectedFriend.userId)) {
    setStatus(`${selectedFriend.displayName} is offline right now`);
    return;
  }

  void handleSessionStart(selectedFriend.userId, "live");
});

leaveSessionButton.addEventListener("click", async () => {
  if (!currentSession) {
    return;
  }

  try {
    if (currentRpcSession?.id) {
      await endSocialSession(currentRpcSession.id);
    }
  } catch (error) {
    console.error(error);
  }

  send({
    type: "leave-session",
    sessionId: currentSession.sessionId,
  });
});

friendsList.addEventListener("click", (event) => {
  const card = event.target.closest(".friend-card");
  if (!card) {
    return;
  }
  selectFriend(card.dataset.userId);
});

requestList.addEventListener("click", (event) => {
  const button = event.target.closest(".mini-button");
  if (!button) {
    return;
  }

  const requestId = button.dataset.requestId;
  if (!requestId) {
    return;
  }

  if (button.dataset.action === "accept") {
    void acceptFriendRequest(requestId)
      .then(applySocialState)
      .then(() => setStatus("Request accepted", "ok"))
      .catch((error) => setStatus(error.message || "The request could not be accepted"));
  } else if (button.dataset.action === "reject") {
    void rejectFriendRequest(requestId)
      .then(applySocialState)
      .then(() => setStatus("Request rejected", "ok"))
      .catch((error) => setStatus(error.message || "The request could not be rejected"));
  }
});

pairForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const friendCode = pairCodeInput.value.trim();

  if (!friendCode) {
    return;
  }

  try {
    const recipient = await resolveRecipientIdentifier(friendCode);
    if (isGuestMode) {
      await handleSessionStart(recipient.userId, "send");
      pairCodeInput.value = "";
      setStatus(`Trying ${recipient.displayName}...`, "ok");
      return;
    }

    const state = await sendFriendRequest(recipient.userId);
    applySocialState(state);
    pairCodeInput.value = "";
    setStatus(`Request sent to ${recipient.displayName}`, "ok");
  } catch (error) {
    setStatus(error.message || "The request could not be sent");
  }
});

copySyncCodeButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(partyCode);
  setStatus("Party code copied", "ok");
});

closeChatPanelButton.addEventListener("click", () => {
  closeInbox();
});

inboxDock.addEventListener("click", () => {
  openInbox({ focusComposer: true });
});

window.addEventListener("resize", resizeCanvas);
effectPicker.addEventListener("change", () => {
  if (!canUseEffect(effectPicker.value)) {
    setStatus("This effect is available to Pro members");
    void openPaywall("effect-picker-locked");
    ensureAllowedEffectSelection();
  }
});
brushSize.addEventListener("input", updateBrushValue);
upgradePlanButton.addEventListener("click", () => {
  void openPaywall("membership-card");
});

async function handleSessionStart(targetUserId, mode) {
  try {
    if (isGuestMode) {
      currentRpcSession = null;
      send({
        type: "start-session",
        targetUserId,
        mode,
        guestSession: true,
      });
      return;
    }

    currentRpcSession = await startSocialSession(targetUserId, mode);
    const accessToken = await getAccessToken();
    send({
      type: "start-session",
      rpcSessionId: currentRpcSession.id,
      targetUserId,
      mode,
      accessToken,
    });
  } catch (error) {
    setStatus(error.message || "The session could not be started");
  }
}

async function handleDashboardSignIn() {
  dashboardSignInButton.disabled = true;
  setStatus("Opening Google sign-in...");

  try {
    await signInWithGoogle();
    await initialize();
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Google sign-in failed");
    setSignedOutDashboardUI();
  } finally {
    dashboardSignInButton.disabled = false;
  }
}

async function initialize() {
  if (socialRefreshTimer) {
    clearInterval(socialRefreshTimer);
    socialRefreshTimer = null;
  }

  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }

  resizeCanvas();
  updateSessionUI();
  updateBrushValue();
  applyRuntimePreferences(await getLocalPreferences(), { updateStatus: false });
  setStatus("Loading account...");
  setGlobalStatus("Connecting");
  void openOnboarding();

  const user = await getCurrentUser();
  if (!user) {
    const guest = await getOrCreateGuestIdentity();
    isGuestMode = true;
    userId = guest.userId;
    displayName = guest.displayName;
    partyCode = guest.partyCode;
    profileName.textContent = displayName;
    profileAvatar.style.setProperty("--avatar-image", `url("${getSketchPartyAvatarDataUrl(userId, displayName)}")`);
    profileNameInput.value = displayName;
    profileMeta.textContent = "Guest mode is active. Your party code works right now.";
    updateSyncCodeUI();
    setSignedOutDashboardUI();
    connect();
    return;
  }

  userId = user.id;
  displayName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email ||
    "Guest";
  partyCode = createPartyCode(userId);
  profileName.textContent = displayName;
  profileAvatar.style.setProperty("--avatar-image", `url("${getSketchPartyAvatarDataUrl(userId, displayName)}")`);
  profileNameInput.value = displayName;
  profileMeta.textContent = "Loading your party code and friends...";
  updateSyncCodeUI();
  setStatus("Loading your Sketch Party state...");

  const state = await bootstrap();
  applySocialState(state);
  connect();
  startSocialRefreshLoop();
  await applyQuickAction();
  await track("Loaded Social State", {
    screen: "board",
    surface: "bootstrap",
    result: "success",
  });
}

dashboardSignInButton.addEventListener("click", () => {
  void handleDashboardSignIn();
});

openOnboardingButton.addEventListener("click", () => {
  void openOnboarding({ force: true });
});

closeOnboardingButton.addEventListener("click", () => {
  void closeOnboarding();
});

onboardingPrevButton.addEventListener("click", () => {
  onboardingStep = Math.max(0, onboardingStep - 1);
  renderOnboardingStep();
});

onboardingNextButton.addEventListener("click", () => {
  if (onboardingStep === onboardingSteps.length - 1) {
    void closeOnboarding();
    return;
  }

  onboardingStep += 1;
  renderOnboardingStep();
});

void initialize().catch((error) => {
  console.error(error);
  setStatus(error.message || "The page could not be initialized");
  drawGuard.classList.remove("hidden");
  drawGuard.textContent = error.message || "Account or social state could not be loaded.";
});

window.addEventListener("focus", () => {
  void refreshSocialState();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void refreshSocialState();
  }
});

window.addEventListener("beforeunload", () => {
  if (socialRefreshTimer) {
    clearInterval(socialRefreshTimer);
    socialRefreshTimer = null;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  const profileChange = changes[PROFILE_STORAGE_KEY];
  const nextPreferences = profileChange?.newValue?.preferences;
  if (!nextPreferences) {
    return;
  }

  if (
    nextPreferences.extensionEnabled === extensionEnabled &&
    nextPreferences.appearOnline === appearOnline &&
    nextPreferences.allowSurprise === allowSurprise
  ) {
    return;
  }

  void syncLivePreferencesFromStorage(nextPreferences);
});




