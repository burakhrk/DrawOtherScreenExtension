import { track } from "../lib/analytics.js";
import {
  FRIEND_ONLINE_NOTIFICATION_KEY,
  FRIEND_ONLINE_NOTIFICATIONS_ENABLED_KEY,
  FREE_EFFECTS,
  PRO_ADVANCED_EFFECTS,
  QUICK_ACTION_KEY,
} from "../lib/constants.js";
import { getAccessToken, getCurrentUser } from "../lib/auth.js";
import { getLocalObject, setLocalObject } from "../lib/chrome-storage.js";
import { getEntitlementBadge } from "../lib/entitlements.js";
import { createPartyCode, isPartyCode, isUuidLike, normalizePartyIdentifier } from "../lib/party-code.js";
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
const socialRefreshIntervalMs = 7000;

const profileName = document.getElementById("profileName");
const profileMeta = document.getElementById("profileMeta");
const globalStatus = document.getElementById("globalStatus");
const syncCode = document.getElementById("syncCode");
const copySyncCodeButton = document.getElementById("copySyncCode");
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
const presence = document.getElementById("presence");
const statusPill = document.getElementById("statusPill");
const drawGuard = document.getElementById("drawGuard");
const messages = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const effectPicker = document.getElementById("effectPicker");
const colorPicker = document.getElementById("colorPicker");
const brushSize = document.getElementById("brushSize");
const clearCanvasButton = document.getElementById("clearCanvas");
const sendDraftButton = document.getElementById("sendDraft");
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
let onlineUserIds = new Set();
let previousOnlineUserIds = new Set();
let hasPresenceSnapshot = false;
let socialRefreshTimer = null;
let socialRefreshInFlight = false;

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
  const paywallUrl = entitlement?.paywallUrl;
  if (!paywallUrl) {
    setStatus("The paywall URL is not configured yet");
    return;
  }

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

function drawCrack(segment, ctx = context) {
  const center = segment.to;
  const baseRadius = Math.max(24, segment.size * 6);
  ctx.save();
  ctx.strokeStyle = hexToRgba(segment.color, 0.85);
  ctx.lineWidth = Math.max(1, segment.size * 0.45);

  for (let index = 0; index < 10; index += 1) {
    const angle = (Math.PI * 2 * index) / 10 + ((segment.seed || 0) * 0.35);
    const radius = baseRadius * (0.72 + ((index % 4) * 0.16));
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(x, y);
    ctx.stroke();
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

  if (drawableSegment.effect === "crack") return drawCrack(drawableSegment);
  if (drawableSegment.effect === "scribble") return drawScribble(drawableSegment);
  if (drawableSegment.effect === "drip") return drawDrip(drawableSegment);
  if (drawableSegment.effect === "zap") return drawZap(drawableSegment);
  if (drawableSegment.effect === "heartburst") return drawHeartburst(drawableSegment);
  if (drawableSegment.effect === "bullet") return drawBullet(drawableSegment);
  if (drawableSegment.effect === "stickman") return drawStickman(drawableSegment);

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

function storeDraft(segment) {
  draftSegments.push(toOutboundSegment(segment));
  updateSessionUI();
}

function replayDraftToCurrentSession() {
  if (!currentSession || !currentSession.drawEnabled || draftSegments.length === 0) {
    return;
  }

  for (const segment of draftSegments) {
    send({
      type: "draw-segment",
      sessionId: currentSession.sessionId,
      segment,
    });
  }

  addMessage({
    system: true,
    text: `${draftSegments.length} draft items were sent.`,
  });
  draftSegments = [];
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
  if (!chrome?.runtime?.sendMessage) {
    return;
  }

  chrome.runtime.sendMessage({ type: "CLEAR_SURPRISE_EFFECT" }).catch(() => {});
}

function getFriendOnline(friendId) {
  return onlineUserIds.has(friendId);
}

function renderRequests() {
  requestList.innerHTML = "";

  for (const request of incomingRequests) {
    const card = document.createElement("article");
    card.className = "request-card";
    card.innerHTML = `
      <strong>${request.displayName}</strong>
      <div class="friend-meta">Sent you a friend request.</div>
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
      <strong>${request.displayName}</strong>
      <div class="friend-meta">Request pending.</div>
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
    empty.textContent = "You do not have any accepted friends yet. Send a user ID from the field above.";
    friendsList.appendChild(empty);
    return;
  }

  for (const friend of friends) {
    const online = getFriendOnline(friend.userId);
    const card = document.createElement("article");
    card.className = "friend-card";
    const disabled = online ? "" : "disabled";
    const surpriseDisabled = allowSurprise ? "" : "disabled";
    const draftDisabled = draftSegments.length > 0 && online ? "" : "disabled";
    const liveLocked = !entitlement?.isPro;

    card.innerHTML = `
      <div class="friend-top">
        <div>
          <strong>${friend.displayName}</strong>
          <div class="friend-meta">${online ? "Available now" : "Offline right now"}</div>
        </div>
        <span class="status-dot ${online ? "online" : ""}">
          ${online ? "Online" : "Offline"}
        </span>
      </div>
      <div class="friend-actions">
        <button class="mode-button" data-user-id="${friend.userId}" data-mode="send" ${disabled} ${allowSurprise ? "" : surpriseDisabled}>Send drawing</button>
        <button class="mode-button ${liveLocked ? "pro-lock" : ""}" data-user-id="${friend.userId}" data-mode="live" ${disabled} ${liveLocked ? "data-pro-lock=\"true\"" : ""}>${liveLocked ? "Live mode - Pro" : "Live mode"}</button>
        <button class="mode-button" data-user-id="${friend.userId}" data-mode="draft" ${draftDisabled}>Send draft</button>
      </div>
    `;

    friendsList.appendChild(card);
  }
}

function updateSessionUI() {
  const hasSession = Boolean(currentSession);
  chatInput.disabled = !hasSession;
  clearCanvasButton.disabled = !hasSession && draftSegments.length === 0;
  sendDraftButton.disabled = draftSegments.length === 0;
  leaveSessionButton.disabled = !hasSession;

  if (!hasSession) {
    sessionTitle.textContent = draftSegments.length > 0 ? "Draft ready" : "Choose a friend";
    sessionModeText.textContent = draftSegments.length > 0
      ? `${draftSegments.length} items are ready. Choose a friend on the left and press Send draft.`
      : "Choose someone on the left to start drawing, or prepare a draft first.";
    presence.textContent = "Waiting for a friend";
    drawGuard.classList.remove("hidden");
    drawGuard.textContent = draftSegments.length > 0
      ? "Your draft is saved. Now choose a recipient from the left."
      : "There is no active session. Draw here first, then choose a recipient.";
    return;
  }

  const modeLabel = currentSession.mode === "live" ? "Live drawing" : "One-way drawing send";
  const modeHint = currentSession.drawEnabled
    ? "You can draw in this session."
    : "Surprise effects will appear on the other person's active tab.";

  sessionTitle.textContent = currentSession.partner.displayName;
  sessionModeText.textContent = `${modeLabel} - ${modeHint}`;
  presence.textContent = getFriendOnline(currentSession.partner.userId) ? "Selected friend is online" : "Selected friend is offline";
  drawGuard.classList.add("hidden");
}

function applySocialState(state) {
  if (!state) {
    return;
  }

  userId = state.user.id;
  displayName = state.user.displayName;
  extensionEnabled = state.preferences.extensionEnabled;
  appearOnline = state.preferences.appearOnline;
  allowSurprise = state.preferences.allowSurprise;
  entitlement = state.entitlement;
  friends = state.friends;
  incomingRequests = state.incomingRequests;
  outgoingRequests = state.outgoingRequests;
  partyCode = createPartyCode(userId);

  profileName.textContent = displayName;
  profileNameInput.value = displayName;
  profileMeta.textContent = extensionEnabled
    ? `Server: ${serverUrl}`
    : `Inactive mode - Server: ${serverUrl}`;
  updateSyncCodeUI();

  updateMembershipUI();
  ensureAllowedEffectSelection();
  renderRequests();
  renderFriends();
  updateSessionUI();
  setGlobalStatus(appearOnline && extensionEnabled ? "Online" : "Inactive", appearOnline && extensionEnabled);
}

async function refreshSocialState({ silent = true } = {}) {
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
      const accessToken = await getAccessToken();

      if (!accessToken) {
        setStatus("Session expired");
        socket.close();
        return;
      }

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
        text: `Connected as ${displayName}. Your friends were loaded from your Supabase account.`,
      });
      void refreshSocialState();
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

      void getSocialState().then((state) => {
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

  const onlineFriends = friends.filter((friend) => getFriendOnline(friend.userId));
  if (onlineFriends.length === 1) {
    pendingDraftTarget = { userId: onlineFriends[0].userId };
    void handleSessionStart(onlineFriends[0].userId, "send");
    return;
  }

  addMessage({
    system: true,
    text: "Your draft is ready. Press Send draft next to a friend in the list on the left.",
  });
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
  const button = event.target.closest(".mode-button");
  if (!button) {
    return;
  }

  if (button.dataset.proLock === "true") {
    setStatus("Live drawing is available to Pro members");
    void openPaywall("live-mode-locked");
    return;
  }

  const mode = button.dataset.mode === "draft" ? "send" : button.dataset.mode;
  if (button.dataset.mode === "draft") {
    pendingDraftTarget = { userId: button.dataset.userId };
  }
  void handleSessionStart(button.dataset.userId, mode);
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

window.addEventListener("resize", resizeCanvas);
effectPicker.addEventListener("change", () => {
  if (!canUseEffect(effectPicker.value)) {
    setStatus("This effect is available to Pro members");
    void openPaywall("effect-picker-locked");
    ensureAllowedEffectSelection();
  }
});
upgradePlanButton.addEventListener("click", () => {
  void openPaywall("membership-card");
});

async function handleSessionStart(targetUserId, mode) {
  try {
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

async function initialize() {
  resizeCanvas();
  updateSessionUI();
  setStatus("Loading account...");
  setGlobalStatus("Connecting");

  const user = await getCurrentUser();
  if (!user) {
    setStatus("No session found");
    drawGuard.classList.remove("hidden");
    drawGuard.textContent = "Sign in with Google from the popup first.";
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
  profileNameInput.value = displayName;
  profileMeta.textContent = `Server: ${serverUrl}`;
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




