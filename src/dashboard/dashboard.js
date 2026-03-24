import { track } from "../lib/analytics.js";
import {
  FRIEND_ONLINE_NOTIFICATION_KEY,
  FRIEND_ONLINE_NOTIFICATIONS_ENABLED_KEY,
  QUICK_ACTION_KEY,
} from "../lib/constants.js";
import { getAccessToken, getCurrentUser } from "../lib/auth.js";
import { getLocalObject, setLocalObject } from "../lib/chrome-storage.js";
import {
  acceptFriendRequest,
  bootstrap,
  endSession as endSocialSession,
  getSocialState,
  rejectFriendRequest,
  sendFriendRequest,
  startSession as startSocialSession,
  updateProfile,
} from "../lib/drawing-office-social-client.js";

const params = new URLSearchParams(window.location.search);
const rawServerUrl = params.get("serverUrl") || "https://sync-sketch-party.onrender.com";
const clientId = crypto.randomUUID();

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
const context = canvas.getContext("2d");
const toastStack = document.getElementById("toastStack");

let socket;
let userId = "";
let displayName = "Misafir";
let extensionEnabled = true;
let appearOnline = true;
let allowSurprise = true;
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
  showToast(`${friend.displayName} online oldu`, "Istersen hemen bir cizim ya da surpriz gonderebilirsin.");
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

  const time = new Date(message.timestamp).toLocaleTimeString("tr-TR", {
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
    text: `${draftSegments.length} taslak oge gonderildi.`,
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
      <div class="friend-meta">Sana arkadaslik istegi gonderdi.</div>
      <div class="request-actions">
        <button class="mini-button" data-action="accept" data-request-id="${request.id}">Kabul et</button>
        <button class="mini-button" data-action="reject" data-request-id="${request.id}">Reddet</button>
      </div>
    `;
    requestList.appendChild(card);
  }

  for (const request of outgoingRequests) {
    const card = document.createElement("article");
    card.className = "request-card";
    card.innerHTML = `
      <strong>${request.displayName}</strong>
      <div class="friend-meta">Istek bekleniyor.</div>
    `;
    requestList.appendChild(card);
  }
}

function renderFriends() {
  friendCount.textContent = `${friends.length} kisi`;
  friendsList.innerHTML = "";

  if (friends.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Henuz kabul edilmis arkadasin yok. Yukaridaki alandan bir kullanici ID'si gonder.";
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

    card.innerHTML = `
      <div class="friend-top">
        <div>
          <strong>${friend.displayName}</strong>
          <div class="friend-meta">${friend.userId}</div>
        </div>
        <span class="status-dot ${online ? "online" : ""}">
          ${online ? "Online" : "Offline"}
        </span>
      </div>
      <div class="friend-actions">
        <button class="mode-button" data-user-id="${friend.userId}" data-mode="send" ${disabled} ${allowSurprise ? "" : surpriseDisabled}>Ciz gonder</button>
        <button class="mode-button" data-user-id="${friend.userId}" data-mode="live" ${disabled}>Es zamanli</button>
        <button class="mode-button" data-user-id="${friend.userId}" data-mode="draft" ${draftDisabled}>Taslak gonder</button>
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
    sessionTitle.textContent = draftSegments.length > 0 ? "Taslak hazir" : "Bir arkadas sec";
    sessionModeText.textContent = draftSegments.length > 0
      ? `${draftSegments.length} oge hazir. Soldan bir arkadas secip Taslak gonder diyebilirsin.`
      : "Cizim baslatmak icin soldan bir kisi sec veya once taslak hazirla.";
    presence.textContent = "Arkadas bekleniyor";
    drawGuard.classList.remove("hidden");
    drawGuard.textContent = draftSegments.length > 0
      ? "Taslagin kaydedildi. Simdi soldan bir alici sec."
      : "Aktif oturum yok. Burada once ciz, sonra alici secebilirsin.";
    return;
  }

  const modeLabel = currentSession.mode === "live" ? "Es zamanli cizim" : "Tek yonlu cizim gonderme";
  const modeHint = currentSession.drawEnabled
    ? "Bu oturumda cizim yapabilirsin."
    : "Surpriz efektler karsinin aktif sekmesine duser.";

  sessionTitle.textContent = currentSession.partner.displayName;
  sessionModeText.textContent = `${modeLabel} - ${modeHint}`;
  presence.textContent = getFriendOnline(currentSession.partner.userId) ? "Secilen arkadas online" : "Secilen arkadas offline";
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
  friends = state.friends;
  incomingRequests = state.incomingRequests;
  outgoingRequests = state.outgoingRequests;

  profileName.textContent = displayName;
  profileNameInput.value = displayName;
  profileMeta.textContent = extensionEnabled
    ? `Sunucu: ${serverUrl}`
    : `Pasif mod - Sunucu: ${serverUrl}`;
  syncCode.textContent = userId;

  renderRequests();
  renderFriends();
  updateSessionUI();
  setGlobalStatus(appearOnline && extensionEnabled ? "Online" : "Pasif", appearOnline && extensionEnabled);
}

async function refreshSocialState() {
  const state = await getSocialState();
  applySocialState(state);
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
      text: "Hizli mesaj taslagi eklendi. Bir arkadas secip gonderebilirsin.",
    });
  }

  if (action.type === "effect" && action.effect) {
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
      text: `${action.label || action.effect} hizli taslak olarak eklendi.`,
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
  setStatus("Baglanti kuruluyor...");
  socket = new WebSocket(serverUrl);

  socket.addEventListener("open", async () => {
    try {
      const accessToken = await getAccessToken();

      if (!accessToken) {
        setStatus("Oturum zamani dolmus");
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
      setStatus("Bagli", "ok");
    } catch (error) {
      setStatus(error.message || "Oturum dogrulanamadi");
      socket.close();
    }
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "registered") {
      addMessage({
        system: true,
        text: `${displayName} olarak baglandin. Arkadaslarin Supabase hesabindan yuklendi.`,
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
          ? `${message.partner.displayName} ile oturum geri baglandi.`
          : `${message.partner.displayName} ile yeni bir oturum basladi.`,
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
        text: message.reason || "Oturum kapatildi.",
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
    setStatus("Baglanti koptu, tekrar deneniyor...");
    setGlobalStatus("Offline");
    window.setTimeout(connect, 1500);
  });

  socket.addEventListener("error", () => {
    setStatus("Sunucuya ulasilamadi");
  });
}

canvas.addEventListener("pointerdown", (event) => {
  const point = pointerPosition(event);
  const selectedEffect = effectPicker.value;

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
    setStatus("Profil guncellendi", "ok");
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
    setStatus(error.message || "Profil guncellenemedi");
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
    setStatus("Once taslak hazirla");
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
    text: "Taslak hazir. Soldaki listeden bir arkadasin yanindaki Taslak gonder dugmesine bas.",
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
      .then(() => setStatus("Istek kabul edildi", "ok"))
      .catch((error) => setStatus(error.message || "Istek kabul edilemedi"));
  } else if (button.dataset.action === "reject") {
    void rejectFriendRequest(requestId)
      .then(applySocialState)
      .then(() => setStatus("Istek reddedildi", "ok"))
      .catch((error) => setStatus(error.message || "Istek reddedilemedi"));
  }
});

pairForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const friendCode = pairCodeInput.value.trim();

  if (!friendCode) {
    return;
  }

  try {
    const state = await sendFriendRequest(friendCode);
    applySocialState(state);
    pairCodeInput.value = "";
    setStatus("Istek gonderildi", "ok");
  } catch (error) {
    setStatus(error.message || "Istek gonderilemedi");
  }
});

copySyncCodeButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(userId);
  setStatus("Kullanici ID kopyalandi", "ok");
});

window.addEventListener("resize", resizeCanvas);

async function handleSessionStart(targetUserId, mode) {
  try {
    currentRpcSession = await startSocialSession(targetUserId, mode);
    send({
      type: "start-session",
      targetUserId,
      mode,
    });
  } catch (error) {
    setStatus(error.message || "Oturum baslatilamadi");
  }
}

async function initialize() {
  resizeCanvas();
  updateSessionUI();
  setStatus("Hesap yukleniyor...");
  setGlobalStatus("Baglaniyor");

  const user = await getCurrentUser();
  if (!user) {
    setStatus("Oturum bulunamadi");
    drawGuard.classList.remove("hidden");
    drawGuard.textContent = "Once popup uzerinden Google ile giris yap.";
    return;
  }

  const state = await bootstrap();
  applySocialState(state);
  connect();
  await applyQuickAction();
  await track("Loaded Social State", {
    screen: "board",
    surface: "bootstrap",
    result: "success",
  });
}

void initialize().catch((error) => {
  console.error(error);
  setStatus(error.message || "Sayfa baslatilamadi");
  drawGuard.classList.remove("hidden");
  drawGuard.textContent = "Hesap veya sosyal durum yuklenemedi.";
});
