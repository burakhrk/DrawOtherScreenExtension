const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const dataFile = process.env.DATA_FILE || path.join(__dirname, "server-data.json");
const reconnectGraceMs = Number(process.env.RECONNECT_GRACE_MS || 8000);

const sessions = new Map();
const socketsByUserId = new Map();
const activeSessionByUserId = new Map();
const activeClientByUserId = new Map();
const pendingSessionClosures = new Map();

function ensureDataFile() {
  const directory = path.dirname(dataFile);

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify({ users: {} }, null, 2));
  }
}

function readStore() {
  ensureDataFile();

  try {
    return JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch (error) {
    return { users: {} };
  }
}

function writeStore(store) {
  ensureDataFile();
  fs.writeFileSync(dataFile, JSON.stringify(store, null, 2));
}

function hashDeviceKey(deviceKey) {
  return crypto.createHash("sha256").update(deviceKey).digest("hex");
}

const store = readStore();

function ensureUserRecord(userId, displayName) {
  if (!store.users[userId]) {
    store.users[userId] = {
      userId,
      displayName: displayName || "Misafir",
      friends: [],
      incomingRequests: []
    };
  } else if (displayName && displayName.trim()) {
    store.users[userId].displayName = displayName;
  }

  if (!Array.isArray(store.users[userId].friends)) {
    store.users[userId].friends = [];
  }

  if (!Array.isArray(store.users[userId].incomingRequests)) {
    store.users[userId].incomingRequests = [];
  }

  return store.users[userId];
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

function getFriends(userId) {
  const user = store.users[userId];
  if (!user) {
    return [];
  }

  return user.friends
    .map((friendId) => store.users[friendId])
    .filter(Boolean)
    .map((friend) => ({
      userId: friend.userId,
      displayName: friend.displayName,
      online: isOnline(friend.userId)
    }))
    .sort((left, right) => {
      if (left.online !== right.online) {
        return left.online ? -1 : 1;
      }

      return left.displayName.localeCompare(right.displayName, "tr");
    });
}

function getIncomingRequests(userId) {
  const user = store.users[userId];
  if (!user || !Array.isArray(user.incomingRequests)) {
    return [];
  }

  return user.incomingRequests
    .map((requesterId) => store.users[requesterId])
    .filter(Boolean)
    .map((requester) => ({
      userId: requester.userId,
      displayName: requester.displayName
    }));
}

function getOutgoingRequests(userId) {
  return Object.values(store.users)
    .filter((candidate) => Array.isArray(candidate.incomingRequests) && candidate.incomingRequests.includes(userId))
    .map((candidate) => ({
      userId: candidate.userId,
      displayName: candidate.displayName
    }));
}

function pushSocialState(userId, messageType = "social-state") {
  if (!store.users[userId]) {
    return;
  }

  sendToUser(userId, {
    type: messageType,
    userId,
    displayName: store.users[userId].displayName,
    syncCode: userId,
    friends: getFriends(userId),
    incomingRequests: getIncomingRequests(userId),
    outgoingRequests: getOutgoingRequests(userId)
  });
}

function notifySocialChange(userId) {
  const related = new Set([userId]);
  const user = store.users[userId];

  if (user) {
    for (const friendId of user.friends) {
      related.add(friendId);
    }

    for (const requesterId of user.incomingRequests || []) {
      related.add(requesterId);
    }
  }

  for (const candidate of Object.values(store.users)) {
    if (Array.isArray(candidate.incomingRequests) && candidate.incomingRequests.includes(userId)) {
      related.add(candidate.userId);
    }
  }

  for (const targetUserId of related) {
    pushSocialState(targetUserId);
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
  const partner = ensureUserRecord(partnerId);
  const payload = {
    type: "session-started",
    sessionId: session.sessionId,
    mode: session.mode,
    drawEnabled: session.mode === "live" || session.initiatorId === userId,
    restored,
    partner: {
      userId: partner.userId,
      displayName: partner.displayName,
      online: isOnline(partner.userId)
    }
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

  for (const participantId of session.participants) {
    if (activeSessionByUserId.get(participantId) === sessionId) {
      activeSessionByUserId.delete(participantId);
    }

    clearPendingSessionClose(participantId);
    const payload = {
      type: "session-ended",
      sessionId,
      reason
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

function validateUserIdentity(message, socket) {
  if (!message.userId || !message.clientId || !message.deviceKey) {
    sendToSocket(socket, {
      type: "error",
      message: "Kayit icin userId, clientId ve deviceKey gerekli."
    });
    socket.close();
    return null;
  }

  const user = ensureUserRecord(message.userId, message.displayName || "Misafir");
  const incomingHash = hashDeviceKey(message.deviceKey);

  if (!user.deviceKeyHash) {
    user.deviceKeyHash = incomingHash;
    writeStore(store);
  } else if (user.deviceKeyHash !== incomingHash) {
    sendToSocket(socket, {
      type: "error",
      message: "Bu kullanici kimligi baska bir cihaz anahtariyla kullaniliyor."
    });
    socket.close();
    return null;
  }

  return user;
}

function areFriends(userId, otherUserId) {
  return store.users[userId]?.friends.includes(otherUserId) ?? false;
}

const httpServer = http.createServer((request, response) => {
  if (request.url === "/health") {
    const body = JSON.stringify({
      ok: true,
      users: Object.keys(store.users).length,
      activeSessions: sessions.size
    });

    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body)
    });
    response.end(body);
    return;
  }

  const body = JSON.stringify({
    name: "Sync Sketch Party Relay",
    websocket: true,
    health: "/health"
  });

  response.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (socket) => {
  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });

  socket.on("message", (raw) => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      return;
    }

    if (message.type === "register-user") {
      const user = validateUserIdentity(message, socket);
      if (!user) {
        return;
      }

      socket.userId = user.userId;
      socket.clientId = message.clientId;

      const sockets = getSocketMap(user.userId);
      sockets.set(socket.clientId, socket);
      activeClientByUserId.set(user.userId, socket.clientId);
      clearPendingSessionClose(user.userId);
      pushSocialState(user.userId, "registered");

      const activeSessionId = activeSessionByUserId.get(user.userId);
      const activeSession = sessions.get(activeSessionId);

      if (activeSession) {
        activeSession.clientIds[user.userId] = socket.clientId;
        sendSessionStarted(user.userId, activeSession, true);
      }

      notifySocialChange(user.userId);
      return;
    }

    if (!socket.userId || !socket.clientId) {
      return;
    }

    const userId = socket.userId;
    const user = ensureUserRecord(userId);
    activeClientByUserId.set(userId, socket.clientId);

    if (message.type === "send-friend-request") {
      const friendId = message.friendCode;

      if (!store.users[friendId]) {
        sendToSocket(socket, {
          type: "error",
          message: "Boyle bir sync kodu bulunamadi."
        });
        return;
      }

      if (friendId === userId) {
        sendToSocket(socket, {
          type: "error",
          message: "Kendine istek gonderemezsin."
        });
        return;
      }

      const friend = ensureUserRecord(friendId);

      if (areFriends(userId, friendId)) {
        sendToSocket(socket, {
          type: "error",
          message: "Bu kullanici zaten arkadas listende."
        });
        return;
      }

      if (!friend.incomingRequests.includes(userId)) {
        friend.incomingRequests.push(userId);
        writeStore(store);
      }

      pushSocialState(userId);
      pushSocialState(friendId);
      sendToSocket(socket, {
        type: "friend-request-sent",
        friend: {
          userId: friend.userId,
          displayName: friend.displayName
        }
      });
      return;
    }

    if (message.type === "accept-friend-request" || message.type === "reject-friend-request") {
      const requesterId = message.requesterId;
      const requester = ensureUserRecord(requesterId);

      if (!user.incomingRequests.includes(requesterId)) {
        sendToSocket(socket, {
          type: "error",
          message: "Böyle bir istek bulunamadi."
        });
        return;
      }

      user.incomingRequests = user.incomingRequests.filter((id) => id !== requesterId);

      if (message.type === "accept-friend-request") {
        if (!user.friends.includes(requesterId)) {
          user.friends.push(requesterId);
        }

        if (!requester.friends.includes(userId)) {
          requester.friends.push(userId);
        }

        sendToUser(requesterId, {
          type: "friend-request-accepted",
          friend: {
            userId,
            displayName: user.displayName
          }
        });
      } else {
        sendToUser(requesterId, {
          type: "friend-request-rejected",
          friend: {
            userId,
            displayName: user.displayName
          }
        });
      }

      writeStore(store);
      pushSocialState(userId);
      pushSocialState(requesterId);
      return;
    }

    if (message.type === "start-session") {
      const { targetUserId, mode } = message;

      if (!targetUserId || !["send", "live"].includes(mode)) {
        sendToSocket(socket, {
          type: "error",
          message: "Oturum baslatma bilgisi gecersiz."
        });
        return;
      }

      if (!areFriends(userId, targetUserId)) {
        sendToSocket(socket, {
          type: "error",
          message: "Yalnizca kabul edilmis arkadaslarla oturum baslatabilirsin."
        });
        return;
      }

      if (!isOnline(targetUserId)) {
        sendToSocket(socket, {
          type: "error",
          message: "Secilen kullanici su an offline."
        });
        return;
      }

      closeUserSession(userId, "Yeni bir oturum baslatildi.");
      closeUserSession(targetUserId, "Yeni bir oturum baslatildi.");

      const targetClientId = getPreferredClientId(targetUserId);
      if (!targetClientId) {
        sendToSocket(socket, {
          type: "error",
          message: "Secilen kullanicinin aktif penceresi bulunamadi."
        });
        return;
      }

      const sessionId = crypto.randomUUID();
      const session = {
        sessionId,
        mode,
        initiatorId: userId,
        participants: [userId, targetUserId],
        clientIds: {
          [userId]: socket.clientId,
          [targetUserId]: targetClientId
        }
      };

      sessions.set(sessionId, session);
      activeSessionByUserId.set(userId, sessionId);
      activeSessionByUserId.set(targetUserId, sessionId);

      sendSessionStarted(userId, session, false);
      sendSessionStarted(targetUserId, session, false);
      return;
    }

    if (message.type === "leave-session") {
      const sessionId = activeSessionByUserId.get(userId);
      const session = sessions.get(sessionId);

      if (
        !session ||
        message.sessionId !== sessionId ||
        !session.participants.includes(userId) ||
        session.clientIds[userId] !== socket.clientId
      ) {
        sendToSocket(socket, {
          type: "error",
          message: "Bu oturumu kapatma yetkin yok."
        });
        return;
      }

      endSession(message.sessionId, "Oturum sonlandirildi.");
      return;
    }

    const sessionId = activeSessionByUserId.get(userId);
    const session = sessions.get(sessionId);

    if (!session || message.sessionId !== sessionId || session.clientIds[userId] !== socket.clientId) {
      return;
    }

    const partnerId = session.participants.find((participantId) => participantId !== userId);
    const canDraw = session.mode === "live" || session.initiatorId === userId;

    if (message.type === "draw-segment") {
      if (!canDraw) {
        return;
      }

      sendToClient(partnerId, session.clientIds[partnerId], {
        type: "draw-segment",
        userId,
        segment: message.segment
      });
      return;
    }

    if (message.type === "clear-canvas") {
      if (!canDraw) {
        return;
      }

      sendToClient(partnerId, session.clientIds[partnerId], {
        type: "clear-canvas",
        userId
      });
      return;
    }

    if (message.type === "chat") {
      const payload = {
        type: "chat",
        userId,
        displayName: user.displayName,
        text: message.text,
        timestamp: message.timestamp || Date.now()
      };

      sendToClient(userId, session.clientIds[userId], payload);
      sendToClient(partnerId, session.clientIds[partnerId], payload);
    }
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
          notifySocialChange(userId);
        }
      }, reconnectGraceMs));
    }

    notifySocialChange(userId);
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
}, 30000);

wss.on("close", () => {
  clearInterval(heartbeatInterval);
});

httpServer.listen(port, host, () => {
  console.log(`Sync Sketch Party relay sunucusu http://${host}:${port} adresinde hazir.`);
});
