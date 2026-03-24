const params = new URLSearchParams(window.location.search);

const userId = params.get("userId") || crypto.randomUUID();
const deviceKey = params.get("deviceKey") || crypto.randomUUID();
const clientId = crypto.randomUUID();
const displayName = params.get("displayName") || "Misafir";
const rawServerUrl = params.get("serverUrl") || "ws://localhost:3000";

const profileName = document.getElementById("profileName");
const profileMeta = document.getElementById("profileMeta");
const globalStatus = document.getElementById("globalStatus");
const syncCode = document.getElementById("syncCode");
const copySyncCodeButton = document.getElementById("copySyncCode");
const pairForm = document.getElementById("pairForm");
const pairCodeInput = document.getElementById("pairCodeInput");
const friendCount = document.getElementById("friendCount");
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
const leaveSessionButton = document.getElementById("leaveSession");
const canvas = document.getElementById("drawCanvas");
const context = canvas.getContext("2d");

let socket;
let isDrawing = false;
let lastPoint = null;
let activeStrokeId = null;
let friends = [];
let currentSession = null;

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

profileName.textContent = displayName;
profileMeta.textContent = `Sunucu: ${serverUrl}`;
syncCode.textContent = userId;

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
    minute: "2-digit"
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

function drawCrack(segment) {
  const center = segment.to;
  const baseRadius = Math.max(24, segment.size * 6);
  const spikes = 8;

  context.save();
  context.strokeStyle = hexToRgba(segment.color, 0.85);
  context.lineWidth = Math.max(1, segment.size * 0.45);

  for (let index = 0; index < spikes; index += 1) {
    const angle = (Math.PI * 2 * index) / spikes + ((segment.seed || 0) * 0.35);
    const radius = baseRadius * (0.75 + ((index % 3) * 0.18));
    const branchX = center.x + Math.cos(angle) * radius;
    const branchY = center.y + Math.sin(angle) * radius;

    context.beginPath();
    context.moveTo(center.x, center.y);
    context.lineTo(branchX, branchY);
    context.stroke();

    const splitAngle = angle + 0.35;
    const splitX = center.x + Math.cos(splitAngle) * (radius * 0.56);
    const splitY = center.y + Math.sin(splitAngle) * (radius * 0.56);
    context.beginPath();
    context.moveTo(branchX, branchY);
    context.lineTo(splitX, splitY);
    context.stroke();
  }

  context.fillStyle = hexToRgba("#ffffff", 0.3);
  context.beginPath();
  context.arc(center.x, center.y, Math.max(4, segment.size * 0.8), 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawScribble(segment) {
  const center = segment.to;
  const loops = 3;
  const radius = Math.max(14, segment.size * 3.4);

  context.save();
  context.strokeStyle = hexToRgba(segment.color, 0.9);
  context.lineWidth = Math.max(2, segment.size * 0.9);
  context.beginPath();

  for (let index = 0; index <= 24; index += 1) {
    const angle = (Math.PI * 2 * loops * index) / 24;
    const wobble = radius * (0.75 + (Math.sin(angle * 1.7 + (segment.seed || 0)) * 0.22));
    const x = center.x + Math.cos(angle) * wobble;
    const y = center.y + Math.sin(angle) * wobble;

    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }

  context.stroke();
  context.restore();
}

function drawDrip(segment) {
  const point = segment.to;
  const height = Math.max(30, segment.size * 10);
  const width = Math.max(8, segment.size * 1.8);

  context.save();
  context.strokeStyle = hexToRgba(segment.color, 0.92);
  context.fillStyle = hexToRgba(segment.color, 0.26);
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(point.x, point.y);
  context.bezierCurveTo(
    point.x + width * 0.2,
    point.y + height * 0.28,
    point.x - width * 0.25,
    point.y + height * 0.72,
    point.x,
    point.y + height
  );
  context.stroke();

  context.beginPath();
  context.ellipse(point.x, point.y + height + width * 0.1, width * 0.9, width * 1.15, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawSegment(segment) {
  if (segment.effect === "crack") {
    drawCrack(segment);
    return;
  }

  if (segment.effect === "scribble") {
    drawScribble(segment);
    return;
  }

  if (segment.effect === "drip") {
    drawDrip(segment);
    return;
  }

  context.strokeStyle = segment.color;
  context.lineWidth = segment.size;
  context.beginPath();
  context.moveTo(segment.from.x, segment.from.y);
  context.lineTo(segment.to.x, segment.to.y);
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

function renderFriends() {
  friendCount.textContent = `${friends.length} kisi`;
  friendsList.innerHTML = "";

  if (friends.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Henuz sync oldugun biri yok. Yukaridaki alandan bir sync kodu ekleyebilirsin.";
    friendsList.appendChild(empty);
    return;
  }

  for (const friend of friends) {
    const card = document.createElement("article");
    card.className = "friend-card";
    const disabled = friend.online ? "" : "disabled";

    card.innerHTML = `
      <div class="friend-top">
        <div>
          <strong>${friend.displayName}</strong>
          <div class="friend-meta">${friend.userId}</div>
        </div>
        <span class="status-dot ${friend.online ? "online" : ""}">
          ${friend.online ? "Online" : "Offline"}
        </span>
      </div>
      <div class="friend-actions">
        <button class="mode-button" data-user-id="${friend.userId}" data-mode="send" ${disabled}>Ciz gonder</button>
        <button class="mode-button" data-user-id="${friend.userId}" data-mode="live" ${disabled}>Es zamanli</button>
      </div>
    `;

    friendsList.appendChild(card);
  }
}

function updateSessionUI() {
  const hasSession = Boolean(currentSession);
  chatInput.disabled = !hasSession;
  clearCanvasButton.disabled = !hasSession;
  leaveSessionButton.disabled = !hasSession;

  if (!hasSession) {
    sessionTitle.textContent = "Bir arkadas sec";
    sessionModeText.textContent = "Cizim baslatmak icin soldan bir kisi sec.";
    presence.textContent = "Arkadas bekleniyor";
    drawGuard.classList.remove("hidden");
    drawGuard.textContent = "Aktif cizim yok. Soldan bir arkadas secerek mod baslat.";
    return;
  }

  const modeLabel = currentSession.mode === "live" ? "Es zamanli cizim" : "Tek yonlu cizim gonderme";
  const modeHint = currentSession.drawEnabled
    ? "Bu oturumda cizim yapabilirsin."
    : "Bu modda yalnizca diger kullanicinin gonderdigi cizimi izliyorsun.";

  sessionTitle.textContent = currentSession.partner.displayName;
  sessionModeText.textContent = `${modeLabel} - ${modeHint}`;
  presence.textContent = currentSession.partner.online ? "Secilen arkadas online" : "Secilen arkadas offline";

  drawGuard.classList.add("hidden");
}

function applyFriends(nextFriends) {
  friends = nextFriends;

  if (currentSession) {
    const updatedPartner = friends.find((friend) => friend.userId === currentSession.partner.userId);
    if (updatedPartner) {
      currentSession.partner = updatedPartner;
    }
  }

  renderFriends();
  updateSessionUI();
}

function connect() {
  setStatus("Baglanti kuruluyor...");
  setGlobalStatus("Baglaniyor");
  socket = new WebSocket(serverUrl);

  socket.addEventListener("open", () => {
    send({
      type: "register-user",
      userId,
      clientId,
      deviceKey,
      displayName
    });
    setStatus("Bagli", "ok");
    setGlobalStatus("Online", true);
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "registered") {
      applyFriends(message.friends);
      addMessage({
        system: true,
        text: "Profil hazir. Sync kodunu paylasip arkadas ekleyebilirsin."
      });
      return;
    }

    if (message.type === "friends-update") {
      applyFriends(message.friends);
      return;
    }

    if (message.type === "sync-success") {
      pairCodeInput.value = "";
      setStatus("Sync tamamlandi", "ok");
      addMessage({
        system: true,
        text: `${message.friend.displayName} ile basariyla sync oldun.`
      });
      return;
    }

    if (message.type === "session-started") {
      currentSession = {
        sessionId: message.sessionId,
        mode: message.mode,
        drawEnabled: message.drawEnabled,
        partner: message.partner
      };
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (!message.restored) {
        messages.innerHTML = "";
      }
      updateSessionUI();
      addMessage({
        system: true,
        text: message.restored
          ? `${message.partner.displayName} ile oturum geri baglandi.`
          : `${message.partner.displayName} ile yeni bir oturum basladi.`
      });
      return;
    }

    if (message.type === "session-ended") {
      currentSession = null;
      resetPointerState();
      context.clearRect(0, 0, canvas.width, canvas.height);
      updateSessionUI();
      addMessage({
        system: true,
        text: message.reason || "Oturum kapatildi."
      });
      return;
    }

    if (message.type === "chat") {
      addMessage(message);
      return;
    }

    if (message.type === "draw-segment") {
      drawSegment(message.segment);
      return;
    }

    if (message.type === "clear-canvas") {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    if (message.type === "error") {
      setStatus(message.message);
      addMessage({
        system: true,
        text: message.message
      });
    }
  });

  socket.addEventListener("close", () => {
    currentSession = null;
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

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

canvas.addEventListener("pointerdown", (event) => {
  if (!currentSession?.drawEnabled) {
    return;
  }

  const point = pointerPosition(event);
  const selectedEffect = effectPicker.value;

  if (selectedEffect !== "draw") {
    const segment = {
      strokeId: crypto.randomUUID(),
      effect: selectedEffect,
      from: point,
      to: point,
      color: colorPicker.value,
      size: Number(brushSize.value),
      seed: Math.random() * Math.PI * 2
    };

    drawSegment(segment);
    send({
      type: "draw-segment",
      sessionId: currentSession.sessionId,
      segment
    });
    return;
  }

  isDrawing = true;
  lastPoint = point;
  activeStrokeId = crypto.randomUUID();
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!isDrawing || !lastPoint || !currentSession?.drawEnabled) {
    return;
  }

  const nextPoint = pointerPosition(event);
  const segment = {
    strokeId: activeStrokeId,
    effect: "draw",
    from: lastPoint,
    to: nextPoint,
    color: colorPicker.value,
    size: Number(brushSize.value)
  };

  drawSegment(segment);
  send({
    type: "draw-segment",
    sessionId: currentSession.sessionId,
    segment
  });

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
    timestamp: Date.now()
  });

  chatInput.value = "";
});

clearCanvasButton.addEventListener("click", () => {
  if (!currentSession) {
    return;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  send({
    type: "clear-canvas",
    sessionId: currentSession.sessionId
  });
});

leaveSessionButton.addEventListener("click", () => {
  if (!currentSession) {
    return;
  }

  send({
    type: "leave-session",
    sessionId: currentSession.sessionId
  });
});

friendsList.addEventListener("click", (event) => {
  const button = event.target.closest(".mode-button");
  if (!button) {
    return;
  }

  send({
    type: "start-session",
    targetUserId: button.dataset.userId,
    mode: button.dataset.mode
  });
});

pairForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const friendCode = pairCodeInput.value.trim();

  if (!friendCode) {
    return;
  }

  send({
    type: "sync-friend",
    friendCode
  });
});

copySyncCodeButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(userId);
  setStatus("Sync kodu kopyalandi", "ok");
});

window.addEventListener("resize", resizeCanvas);

resizeCanvas();
updateSessionUI();
connect();
