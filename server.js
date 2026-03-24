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

function ensureUserRecord(userId, displayName = "Misafir") {
  if (!store.users[userId]) {
    store.users[userId] = {
      userId,
      displayName,
      friends: []
    };
  } else if (displayName) {
    store.users[userId].displayName = displayName;
  }

  if (!Array.isArray(store.users[userId].friends)) {
    store.users[userId].friends = [];
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
  const sockets = getSocketMap(userId);

  for (const socket of sockets.values()) {
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

function getFriendList(userId) {
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

function pushFriendList(userId) {
  if (!store.users[userId]) {
    return;
  }

  sendToUser(userId, {
    type: "friends-update",
    friends: getFriendList(userId)
  });
}

function notifyPresenceChange(userId) {
  pushFriendList(userId);
  const user = store.users[userId];

  if (!user) {
    return;
  }

  for (const friendId of user.friends) {
    pushFriendList(friendId);
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
  const clientId = session.clientIds[userId];
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

  if (!sendToClient(userId, clientId, payload)) {
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

function isFriend(userId, friendId) {
  return store.users[userId]?.friends.includes(friendId) ?? false;
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

  const user = ensureUserRecord(message.userId, message.displayName);
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

      sendToSocket(socket, {
        type: "registered",
        userId: user.userId,
        clientId: socket.clientId,
        displayName: user.displayName,
        syncCode: user.userId,
        friends: getFriendList(user.userId)
      });

      const activeSessionId = activeSessionByUserId.get(user.userId);
      const activeSession = sessions.get(activeSessionId);

      if (activeSession) {
        activeSession.clientIds[user.userId] = socket.clientId;
        sendSessionStarted(user.userId, activeSession, true);
      }

      notifyPresenceChange(user.userId);
      return;
    }

    if (!socket.userId || !socket.clientId) {
      return;
    }

    const userId = socket.userId;
    const user = ensureUserRecord(userId);
    activeClientByUserId.set(userId, socket.clientId);

    if (message.type === "sync-friend") {
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
          message: "Kendinle sync olamazsin."
        });
        return;
      }

      const friend = ensureUserRecord(friendId);

      if (!user.friends.includes(friendId)) {
        user.friends.push(friendId);
      }

      if (!friend.friends.includes(userId)) {
        friend.friends.push(userId);
      }

      writeStore(store);
      pushFriendList(userId);
      pushFriendList(friendId);

      sendToSocket(socket, {
        type: "sync-success",
        friend: {
          userId: friend.userId,
          displayName: friend.displayName,
          online: isOnline(friend.userId)
        }
      });
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

      if (!isFriend(userId, targetUserId)) {
        sendToSocket(socket, {
          type: "error",
          message: "Yalnizca sync oldugun kisilerle oturum baslatabilirsin."
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

    if (
      !session ||
      message.sessionId !== sessionId ||
      session.clientIds[userId] !== socket.clientId
    ) {
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
          notifyPresenceChange(userId);
        }
      }, reconnectGraceMs));
    }

    notifyPresenceChange(userId);
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
