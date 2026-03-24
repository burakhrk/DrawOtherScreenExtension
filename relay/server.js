const http = require("http");
const { WebSocketServer } = require("ws");

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const reconnectGraceMs = Number(process.env.RECONNECT_GRACE_MS || 8000);
const maxPayloadBytes = Number(process.env.MAX_PAYLOAD_BYTES || 32 * 1024);
const appId = process.env.APP_ID || "drawing-office";
const supabaseUrl = process.env.SUPABASE_URL || "https://euzeprutflhfavzxuwfs.supabase.co";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1emVwcnV0ZmxoZmF2enh1d2ZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2ODIzMTgsImV4cCI6MjA4OTI1ODMxOH0.C80nlS1Y_p8faRp2vHkRpGfVoYRubHH9Ja7yfxyPmbw";

const sessions = new Map();
const socketsByUserId = new Map();
const activeSessionByUserId = new Map();
const activeClientByUserId = new Map();
const pendingSessionClosures = new Map();
const runtimeUsers = new Map();
const metrics = {
  totalConnections: 0,
  successfulRegistrations: 0,
  failedRegistrations: 0,
  startedSessions: 0,
  endedSessions: 0,
  forwardedChats: 0,
  forwardedDrawSegments: 0,
  clearedCanvases: 0,
  protocolErrors: 0,
  rateLimitHits: 0,
};

function defaultPreferences() {
  return {
    extensionEnabled: true,
    appearOnline: true,
    allowSurprise: true,
  };
}

function normalizeDisplayName(value) {
  const nextValue = String(value || "").trim().slice(0, 32);
  return nextValue || "Misafir";
}

function normalizePreferences(preferences) {
  return {
    extensionEnabled: preferences?.extensionEnabled !== false,
    appearOnline: preferences?.appearOnline !== false,
    allowSurprise: preferences?.allowSurprise !== false,
  };
}

function ensureRuntimeUser(userId, displayName) {
  if (!runtimeUsers.has(userId)) {
    runtimeUsers.set(userId, {
      userId,
      displayName: normalizeDisplayName(displayName),
      preferences: defaultPreferences(),
      lastAccessToken: null,
      lastSeenAt: Date.now(),
    });
  } else if (displayName) {
    runtimeUsers.get(userId).displayName = normalizeDisplayName(displayName);
  }

  return runtimeUsers.get(userId);
}

function getSocketMap(userId) {
  if (!socketsByUserId.has(userId)) {
    socketsByUserId.set(userId, new Map());
  }

  return socketsByUserId.get(userId);
}

function getSocketByClient(userId, clientId) {
  return getSocketMap(userId).get(clientId);
}

function getPreferredClientId(userId) {
  const activeClientId = activeClientByUserId.get(userId);
  const sockets = getSocketMap(userId);

  if (activeClientId && sockets.has(activeClientId)) {
    return activeClientId;
  }

  const firstEntry = sockets.keys().next();
  return firstEntry.done ? null : firstEntry.value;
}

function isOnline(userId) {
  return getSocketMap(userId).size > 0;
}

function isVisibleOnline(userId) {
  const user = runtimeUsers.get(userId);
  return Boolean(
    user &&
    user.preferences.extensionEnabled !== false &&
    user.preferences.appearOnline !== false &&
    isOnline(userId)
  );
}

function sendToSocket(socket, payload) {
  if (!socket || socket.readyState !== socket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
}

function sendToUser(userId, payload) {
  for (const socket of getSocketMap(userId).values()) {
    sendToSocket(socket, payload);
  }
}

function sendToClient(userId, clientId, payload) {
  const socket = getSocketByClient(userId, clientId);

  if (socket) {
    sendToSocket(socket, payload);
    return true;
  }

  return false;
}

function sendProtocolError(socket, message, shouldClose = false) {
  metrics.protocolErrors += 1;
  sendToSocket(socket, {
    type: "error",
    message,
  });

  if (shouldClose) {
    socket.close();
  }
}

function broadcastPresenceState() {
  const onlineUserIds = Array.from(runtimeUsers.values())
    .filter((user) => isVisibleOnline(user.userId))
    .map((user) => user.userId);

  for (const socket of wss.clients) {
    sendToSocket(socket, {
      type: "presence-state",
      onlineUserIds,
    });
  }
}

function clearPendingSessionClose(userId) {
  const timeout = pendingSessionClosures.get(userId);
  if (timeout) {
    clearTimeout(timeout);
    pendingSessionClosures.delete(userId);
  }
}

function sendSessionStarted(userId, session, restored = false) {
  const partnerId = session.participants.find((participantId) => participantId !== userId);
  const partner = ensureRuntimeUser(partnerId);
  const payload = {
    type: "session-started",
    sessionId: session.sessionId,
    mode: session.mode,
    drawEnabled: session.mode === "live" || session.initiatorId === userId,
    restored,
    partner: {
      userId: partner.userId,
      displayName: partner.displayName,
      online: isOnline(partner.userId),
    },
  };

  if (!sendToClient(userId, session.clientIds[userId], payload)) {
    sendToUser(userId, payload);
  }
}

function endSession(sessionId, reason) {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  sessions.delete(sessionId);
  metrics.endedSessions += 1;

  for (const participantId of session.participants) {
    if (activeSessionByUserId.get(participantId) === sessionId) {
      activeSessionByUserId.delete(participantId);
    }

    clearPendingSessionClose(participantId);
    const payload = {
      type: "session-ended",
      sessionId,
      reason,
    };

    if (!sendToClient(participantId, session.clientIds[participantId], payload)) {
      sendToUser(participantId, payload);
    }
  }
}

function closeUserSession(userId, reason) {
  const sessionId = activeSessionByUserId.get(userId);
  if (sessionId) {
    endSession(sessionId, reason);
  }
}

function createRateLimitKey(socket, key) {
  if (!socket.rateLimitState) {
    socket.rateLimitState = new Map();
  }

  if (!socket.rateLimitState.has(key)) {
    socket.rateLimitState.set(key, []);
  }

  return socket.rateLimitState.get(key);
}

function enforceRateLimit(socket, key, limit, windowMs) {
  const now = Date.now();
  const entries = createRateLimitKey(socket, key);

  while (entries.length > 0 && now - entries[0] > windowMs) {
    entries.shift();
  }

  if (entries.length >= limit) {
    metrics.rateLimitHits += 1;
    return false;
  }

  entries.push(now);
  return true;
}

function isValidHexColor(value) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function isValidPoint(point) {
  return Boolean(
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= 1000 &&
    point.y >= 0 &&
    point.y <= 1000
  );
}

function sanitizeSegment(segment) {
  if (!segment || typeof segment !== "object") {
    return null;
  }

  const effect = typeof segment.effect === "string" ? segment.effect : "draw";
  const allowedEffects = new Set(["draw", "crack", "scribble", "drip", "zap", "heartburst", "bullet", "stickman"]);

  if (!allowedEffects.has(effect)) {
    return null;
  }

  if (!segment.normalized || !isValidPoint(segment.from) || !isValidPoint(segment.to)) {
    return null;
  }

  const size = Number(segment.size);
  if (!Number.isFinite(size) || size < 1 || size > 32) {
    return null;
  }

  const color = isValidHexColor(segment.color) ? segment.color : "#232018";
  const strokeId = typeof segment.strokeId === "string" ? segment.strokeId.slice(0, 80) : crypto.randomUUID();
  const seed = Number.isFinite(segment.seed) ? segment.seed : 0;

  return {
    strokeId,
    effect,
    normalized: true,
    from: {
      x: Number(segment.from.x),
      y: Number(segment.from.y),
    },
    to: {
      x: Number(segment.to.x),
      y: Number(segment.to.y),
    },
    color,
    size,
    seed,
  };
}

function sanitizeChatText(value) {
  const nextValue = typeof value === "string" ? value.trim() : "";
  if (!nextValue) {
    return null;
  }

  return nextValue.slice(0, 240);
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw.toString());
  } catch (error) {
    return null;
  }
}

async function fetchVerifiedUser(accessToken) {
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function fetchVerifiedSession({ accessToken, sessionId, initiatorId, recipientId, mode }) {
  if (!accessToken || !sessionId) {
    return null;
  }

  const searchParams = new URLSearchParams({
    select: "id,app_id,initiator_id,recipient_id,mode,status,created_at,ended_at",
    id: `eq.${sessionId}`,
    app_id: `eq.${appId}`,
    status: "eq.active",
    limit: "1",
  });

  const response = await fetch(`${supabaseUrl}/rest/v1/sessions?${searchParams.toString()}`, {
    method: "GET",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const rows = await response.json();
  const session = rows[0];

  if (!session) {
    return null;
  }

  if (
    session.initiator_id !== initiatorId ||
    session.recipient_id !== recipientId ||
    session.mode !== mode ||
    session.status !== "active"
  ) {
    return null;
  }

  return session;
}

async function validateUserIdentity(message, socket) {
  if (!message.userId || !message.clientId || !message.accessToken) {
    sendProtocolError(socket, "Kayit icin userId, clientId ve access token gerekli.", true);
    return null;
  }

  const verifiedUser = await fetchVerifiedUser(message.accessToken);

  if (!verifiedUser || verifiedUser.id !== message.userId) {
    sendProtocolError(socket, "JWT dogrulamasi basarisiz.", true);
    return null;
  }

  const user = ensureRuntimeUser(message.userId, message.displayName || "Misafir");
  user.lastAccessToken = message.accessToken;
  user.lastSeenAt = Date.now();
  user.preferences = normalizePreferences(message.preferences);
  return user;
}

const httpServer = http.createServer((request, response) => {
  if (request.url === "/health") {
    const body = JSON.stringify({
      ok: true,
      connectedUsers: runtimeUsers.size,
      activeSessions: sessions.size,
      statelessRelay: true,
      appId,
    });

    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    response.end(body);
    return;
  }

  if (request.url === "/metrics") {
    const body = JSON.stringify({
      ok: true,
      appId,
      connectedUsers: runtimeUsers.size,
      activeSessions: sessions.size,
      metrics,
    });

    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    response.end(body);
    return;
  }

  const body = JSON.stringify({
    name: "Sync Sketch Party Relay",
    websocket: true,
    health: "/health",
    appId,
  });

  response.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
});

const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: maxPayloadBytes,
});

wss.on("connection", (socket) => {
  metrics.totalConnections += 1;
  socket.isAlive = true;
  socket.rateLimitState = new Map();

  socket.on("pong", () => {
    socket.isAlive = true;
  });

  socket.on("message", async (raw, isBinary) => {
    if (isBinary) {
      sendProtocolError(socket, "Binary payload desteklenmiyor.");
      return;
    }

    const message = safeJsonParse(raw);
    if (!message || typeof message.type !== "string") {
      sendProtocolError(socket, "Gecersiz mesaj formati.");
      return;
    }

    if (message.type === "register-user") {
      if (!enforceRateLimit(socket, "register-user", 6, 60_000)) {
        sendProtocolError(socket, "Kayit istegi cok sik gonderildi.");
        return;
      }

      const user = await validateUserIdentity(message, socket);
      if (!user) {
        metrics.failedRegistrations += 1;
        return;
      }

      socket.userId = user.userId;
      socket.clientId = String(message.clientId).slice(0, 100);

      const sockets = getSocketMap(user.userId);
      sockets.set(socket.clientId, socket);
      activeClientByUserId.set(user.userId, socket.clientId);
      clearPendingSessionClose(user.userId);

      const activeSessionId = activeSessionByUserId.get(user.userId);
      const activeSession = sessions.get(activeSessionId);

      if (activeSession) {
        activeSession.clientIds[user.userId] = socket.clientId;
        sendSessionStarted(user.userId, activeSession, true);
      }

      sendToSocket(socket, {
        type: "registered",
        userId: user.userId,
        displayName: user.displayName,
      });
      metrics.successfulRegistrations += 1;
      broadcastPresenceState();
      return;
    }

    if (!socket.userId || !socket.clientId) {
      sendProtocolError(socket, "Baglanti once kayit olmali.");
      return;
    }

    const userId = socket.userId;
    const user = ensureRuntimeUser(userId);
    user.lastSeenAt = Date.now();
    activeClientByUserId.set(userId, socket.clientId);

    if (message.type === "start-session") {
      if (!enforceRateLimit(socket, "start-session", 12, 60_000)) {
        sendProtocolError(socket, "Cok fazla oturum denemesi yapildi.");
        return;
      }

      const targetUserId = typeof message.targetUserId === "string" ? message.targetUserId : "";
      const mode = message.mode === "live" ? "live" : message.mode === "send" ? "send" : "";
      const rpcSessionId = typeof message.rpcSessionId === "string" ? message.rpcSessionId : "";

      if (!targetUserId || !mode || !rpcSessionId) {
        sendProtocolError(socket, "Oturum baslatma bilgisi gecersiz.");
        return;
      }

      if (user.preferences.extensionEnabled === false) {
        sendProtocolError(socket, "Pasif moddayken oturum baslatamazsin.");
        return;
      }

      if (!isVisibleOnline(targetUserId)) {
        sendProtocolError(socket, "Secilen kullanici su an musait degil.");
        return;
      }

      const targetClientId = getPreferredClientId(targetUserId);
      if (!targetClientId) {
        sendProtocolError(socket, "Secilen kullanicinin aktif penceresi bulunamadi.");
        return;
      }

      const verifiedSession = await fetchVerifiedSession({
        accessToken: user.lastAccessToken,
        sessionId: rpcSessionId,
        initiatorId: userId,
        recipientId: targetUserId,
        mode,
      });

      if (!verifiedSession) {
        sendProtocolError(socket, "Realtime oturum Supabase tarafinda dogrulanamadi.");
        return;
      }

      closeUserSession(userId, "Yeni bir oturum baslatildi.");
      closeUserSession(targetUserId, "Yeni bir oturum baslatildi.");

      const session = {
        sessionId: verifiedSession.id,
        mode,
        initiatorId: userId,
        participants: [userId, targetUserId],
        clientIds: {
          [userId]: socket.clientId,
          [targetUserId]: targetClientId,
        },
      };

      sessions.set(session.sessionId, session);
      activeSessionByUserId.set(userId, session.sessionId);
      activeSessionByUserId.set(targetUserId, session.sessionId);
      metrics.startedSessions += 1;

      sendSessionStarted(userId, session, false);
      sendSessionStarted(targetUserId, session, false);
      broadcastPresenceState();
      return;
    }

    if (message.type === "leave-session") {
      if (!enforceRateLimit(socket, "leave-session", 20, 60_000)) {
        sendProtocolError(socket, "Oturum kapatma istegi cok sık gonderildi.");
        return;
      }

      const sessionId = activeSessionByUserId.get(userId);
      const session = sessions.get(sessionId);

      if (
        !session ||
        message.sessionId !== sessionId ||
        !session.participants.includes(userId) ||
        session.clientIds[userId] !== socket.clientId
      ) {
        sendProtocolError(socket, "Bu oturumu kapatma yetkin yok.");
        return;
      }

      endSession(message.sessionId, "Oturum sonlandirildi.");
      return;
    }

    const sessionId = activeSessionByUserId.get(userId);
    const session = sessions.get(sessionId);

    if (!session || message.sessionId !== sessionId || session.clientIds[userId] !== socket.clientId) {
      sendProtocolError(socket, "Aktif oturum bulunamadi.");
      return;
    }

    const partnerId = session.participants.find((participantId) => participantId !== userId);
    const canDraw = session.mode === "live" || session.initiatorId === userId;

    if (message.type === "draw-segment") {
      if (!enforceRateLimit(socket, "draw-segment", 240, 10_000)) {
        sendProtocolError(socket, "Cizim verisi cok hizli gonderiliyor.");
        return;
      }

      if (!canDraw) {
        return;
      }

      const segment = sanitizeSegment(message.segment);
      if (!segment) {
        sendProtocolError(socket, "Cizim verisi gecersiz.");
        return;
      }

      sendToClient(partnerId, session.clientIds[partnerId], {
        type: "draw-segment",
        userId,
        segment,
      });
      metrics.forwardedDrawSegments += 1;
      return;
    }

    if (message.type === "clear-canvas") {
      if (!enforceRateLimit(socket, "clear-canvas", 20, 60_000)) {
        sendProtocolError(socket, "Temizleme istegi cok hizli gonderiliyor.");
        return;
      }

      if (!canDraw) {
        return;
      }

      sendToClient(partnerId, session.clientIds[partnerId], {
        type: "clear-canvas",
        userId,
      });
      metrics.clearedCanvases += 1;
      return;
    }

    if (message.type === "chat") {
      if (!enforceRateLimit(socket, "chat", 40, 20_000)) {
        sendProtocolError(socket, "Mesajlar cok hizli gonderiliyor.");
        return;
      }

      const text = sanitizeChatText(message.text);
      if (!text) {
        sendProtocolError(socket, "Mesaj bos olamaz.");
        return;
      }

      const payload = {
        type: "chat",
        userId,
        displayName: user.displayName,
        text,
        timestamp: message.timestamp || Date.now(),
      };

      sendToClient(userId, session.clientIds[userId], payload);
      sendToClient(partnerId, session.clientIds[partnerId], payload);
      metrics.forwardedChats += 1;
      return;
    }

    sendProtocolError(socket, "Desteklenmeyen realtime mesaji.");
  });

  socket.on("close", () => {
    const { userId, clientId } = socket;

    if (!userId || !clientId) {
      return;
    }

    const sockets = getSocketMap(userId);
    sockets.delete(clientId);

    if (activeClientByUserId.get(userId) === clientId) {
      const nextClientId = getPreferredClientId(userId);
      if (nextClientId) {
        activeClientByUserId.set(userId, nextClientId);
      } else {
        activeClientByUserId.delete(userId);
      }
    }

    if (sockets.size === 0) {
      socketsByUserId.delete(userId);
      clearPendingSessionClose(userId);
      pendingSessionClosures.set(userId, setTimeout(() => {
        pendingSessionClosures.delete(userId);

        if (!isOnline(userId)) {
          closeUserSession(userId, "Karsi taraf baglantiyi kapatti.");
          runtimeUsers.delete(userId);
          activeClientByUserId.delete(userId);
          broadcastPresenceState();
        }
      }, reconnectGraceMs));
    } else {
      broadcastPresenceState();
    }
  });
});

const heartbeatInterval = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }

    socket.isAlive = false;
    socket.ping();
  }
}, 30_000);

wss.on("close", () => {
  clearInterval(heartbeatInterval);
});

httpServer.listen(port, host, () => {
  console.log(`Sync Sketch Party relay sunucusu http://${host}:${port} adresinde hazir.`);
});
