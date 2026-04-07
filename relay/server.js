const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const reconnectGraceMs = Number(process.env.RECONNECT_GRACE_MS || 8000);
const maxPayloadBytes = Number(process.env.MAX_PAYLOAD_BYTES || 32 * 1024);
const appId = process.env.APP_ID || "sketch-party";
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
const logLevel = process.env.LOG_LEVEL || "info";
const metricsSampleWindowMs = Number(process.env.METRICS_SAMPLE_WINDOW_MS || 60_000);
const patreonClientId = process.env.PATREON_CLIENT_ID || "";
const patreonClientSecret = process.env.PATREON_CLIENT_SECRET || "";
const patreonCampaignId = process.env.PATREON_CAMPAIGN_ID || "";
const patreonRedirectUri = process.env.PATREON_REDIRECT_URI || "";
const patreonScope = process.env.PATREON_SCOPE || "identity identity.memberships identity[email]";
const patreonStateTtlMs = Number(process.env.PATREON_STATE_TTL_MS || 10 * 60 * 1000);
const patreonTierMapJson = process.env.PATREON_TIER_MAP_JSON || "";

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
const serverStartedAt = Date.now();
const metricsSamples = [];
const patreonAuthStates = new Map();
let parsedPatreonTierMap = null;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    JSON.stringify(
      {
        level: "error",
        event: "missing_required_env",
        missing: {
          SUPABASE_URL: !supabaseUrl,
          SUPABASE_ANON_KEY: !supabaseAnonKey,
        },
      },
      null,
      2,
    ),
  );
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be provided via environment variables.");
}

const partyCodeAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function shouldLog(level) {
  if (logLevel === "silent") {
    return false;
  }

  if (logLevel === "error") {
    return level === "error";
  }

  if (logLevel === "warn") {
    return level === "warn" || level === "error";
  }

  return true;
}

function writeLog(level, event, details = {}) {
  if (!shouldLog(level)) {
    return;
  }

  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...details,
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }

  console.log(line);
}

function collectMetricsSnapshot() {
  const memory = process.memoryUsage();
  const snapshot = {
    at: Date.now(),
    connectedUsers: runtimeUsers.size,
    socketCount: wss?.clients?.size || 0,
    activeSessions: sessions.size,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
  };

  metricsSamples.push(snapshot);

  while (metricsSamples.length > 0 && (snapshot.at - metricsSamples[0].at) > metricsSampleWindowMs) {
    metricsSamples.shift();
  }

  return snapshot;
}

function getPeakMetrics() {
  let peakConnectedUsers = 0;
  let peakSocketCount = 0;
  let peakActiveSessions = 0;
  let peakRssBytes = 0;
  let peakHeapUsedBytes = 0;

  for (const sample of metricsSamples) {
    peakConnectedUsers = Math.max(peakConnectedUsers, sample.connectedUsers);
    peakSocketCount = Math.max(peakSocketCount, sample.socketCount);
    peakActiveSessions = Math.max(peakActiveSessions, sample.activeSessions);
    peakRssBytes = Math.max(peakRssBytes, sample.rssBytes);
    peakHeapUsedBytes = Math.max(peakHeapUsedBytes, sample.heapUsedBytes);
  }

  return {
    peakConnectedUsers,
    peakSocketCount,
    peakActiveSessions,
    peakRssBytes,
    peakHeapUsedBytes,
    sampleWindowMs: metricsSampleWindowMs,
  };
}

function defaultPreferences() {
  return {
    extensionEnabled: true,
    appearOnline: true,
    allowSurprise: true,
  };
}

function normalizeDisplayName(value) {
  const nextValue = String(value || "").trim().slice(0, 32);
  return nextValue || "Guest";
}

function createPartyCode(userId) {
  const normalized = String(userId || "").trim().toLowerCase();
  let hash = 2166136261;

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  hash >>>= 0;
  let output = "";

  for (let index = 0; index < 5; index += 1) {
    output += partyCodeAlphabet[hash % partyCodeAlphabet.length];
    hash = Math.floor(hash / partyCodeAlphabet.length);
  }

  return output;
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
      guest: false,
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
  writeLog("warn", "protocol_error", {
    userId: socket.userId || null,
    clientId: socket.clientId || null,
    message,
    close: shouldClose,
  });
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
  writeLog("info", "session_ended", {
    sessionId,
    reason,
    participants: session.participants,
  });

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
  const allowedEffects = new Set([
    "draw",
    "crack",
    "scribble",
    "drip",
    "inkslap",
    "confetti",
    "zap",
    "heartburst",
    "bullet",
    "stickman",
    "stickerslap",
    "mexicanwave",
  ]);

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

function getEffectRateLimit(effect) {
  if (effect === "mexicanwave") {
    return { key: "effect-heavy-mexicanwave", limit: 2, windowMs: 30_000, message: "Text wave is cooling down. Try again in a moment." };
  }

  if (effect !== "draw") {
    return { key: "effect-burst", limit: 18, windowMs: 10_000, message: "Effects are being sent too quickly." };
  }

  return null;
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

  for (let attempt = 0; attempt < 4; attempt += 1) {
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

    if (response.ok) {
      const rows = await response.json();
      const session = rows[0];

      if (
        session &&
        session.initiator_id === initiatorId &&
        session.recipient_id === recipientId &&
        session.mode === mode &&
        session.status === "active"
      ) {
        return session;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
  }

  return null;
}

async function validateUserIdentity(message, socket) {
  if (!message.userId || !message.clientId) {
    sendProtocolError(socket, "Registration requires userId and clientId.", true);
    return null;
  }

  if (message.guest === true) {
    if (!String(message.userId).startsWith("guest:")) {
      sendProtocolError(socket, "Guest registration requires a guest identity.", true);
      return null;
    }

    const user = ensureRuntimeUser(message.userId, message.displayName || "Guest");
    user.lastSeenAt = Date.now();
    user.preferences = normalizePreferences(message.preferences);
    user.guest = true;
    return user;
  }

  if (!message.accessToken) {
    sendProtocolError(socket, "Registration requires an access token.", true);
    return null;
  }

  const verifiedUser = await fetchVerifiedUser(message.accessToken);

  if (!verifiedUser || verifiedUser.id !== message.userId) {
    sendProtocolError(socket, "JWT verification failed.", true);
    writeLog("warn", "registration_rejected", {
      claimedUserId: message.userId || null,
      clientId: message.clientId || null,
      reason: "jwt_verification_failed",
    });
    return null;
  }

  const user = ensureRuntimeUser(message.userId, message.displayName || "Guest");
  user.lastAccessToken = message.accessToken;
  user.lastSeenAt = Date.now();
  user.preferences = normalizePreferences(message.preferences);
  user.guest = false;
  return user;
}

function sendPreferenceNudge(targetUserId, initiatorDisplayName, reason) {
  const message = reason === "extension-disabled"
    ? `${initiatorDisplayName} tried to send you a drawing, but you are not accepting drawings right now.`
    : `${initiatorDisplayName} tried to send you a surprise, but your receiving setting is turned off right now.`;

  sendToUser(targetUserId, {
    type: "guest-preference-nudge",
    message,
  });
}

function encodePatreonBrokerState(payload) {
  const stateId = crypto.randomUUID();
  patreonAuthStates.set(stateId, {
    ...payload,
    createdAt: Date.now(),
  });
  return stateId;
}

function consumePatreonBrokerState(stateId) {
  if (!stateId) {
    return null;
  }

  const entry = patreonAuthStates.get(stateId) || null;
  patreonAuthStates.delete(stateId);

  if (!entry) {
    return null;
  }

  if ((Date.now() - entry.createdAt) > patreonStateTtlMs) {
    return null;
  }

  return entry;
}

function prunePatreonBrokerStates() {
  const now = Date.now();
  for (const [stateId, entry] of patreonAuthStates.entries()) {
    if ((now - entry.createdAt) > patreonStateTtlMs) {
      patreonAuthStates.delete(stateId);
    }
  }
}

function buildPatreonAuthorizeUrl(requestStateId) {
  const authorizeUrl = new URL("https://www.patreon.com/oauth2/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", patreonClientId);
  authorizeUrl.searchParams.set("redirect_uri", patreonRedirectUri);
  authorizeUrl.searchParams.set("scope", patreonScope);
  authorizeUrl.searchParams.set("state", requestStateId);
  return authorizeUrl.toString();
}

function getPatreonTierMap() {
  if (parsedPatreonTierMap !== null) {
    return parsedPatreonTierMap;
  }

  if (!patreonTierMapJson.trim()) {
    parsedPatreonTierMap = {};
    return parsedPatreonTierMap;
  }

  try {
    parsedPatreonTierMap = JSON.parse(patreonTierMapJson);
    return parsedPatreonTierMap;
  } catch (error) {
    writeLog("error", "patreon_tier_map_invalid", {
      message: error?.message || "invalid_json",
    });
    parsedPatreonTierMap = {};
    return parsedPatreonTierMap;
  }
}

function normalizePatreonTierTitle(value) {
  return String(value || "").trim().toLowerCase();
}

function inferDefaultEntitlementsFromTiers(tiers) {
  const titles = tiers.map((tier) => normalizePatreonTierTitle(tier.title));
  const hasSketchPartyPro = titles.some((title) =>
    title.includes("sketch party pro") ||
    title.includes("pro sketcher") ||
    title.includes("all extensions") ||
    title.includes("bundle")
  );

  return {
    "sketch-party": {
      plan: hasSketchPartyPro ? "pro" : "free",
      source: hasSketchPartyPro ? "patreon-tier-title" : "patreon-no-match",
    },
  };
}

function resolveAppEntitlementsFromPatreon(identity) {
  const tiers = Array.isArray(identity?.tiers) ? identity.tiers : [];
  const tierIds = new Set(tiers.map((tier) => String(tier.id || "").trim()).filter(Boolean));
  const tierTitles = new Set(tiers.map((tier) => normalizePatreonTierTitle(tier.title)).filter(Boolean));
  const configuredMap = getPatreonTierMap();
  const fallback = inferDefaultEntitlementsFromTiers(tiers);
  const mergedApps = new Set([
    ...Object.keys(fallback),
    ...Object.keys(configuredMap || {}),
  ]);

  const output = {};

  for (const appKey of mergedApps) {
    const mapping = configuredMap?.[appKey] || {};
    const mappingTierIds = Array.isArray(mapping.tierIds) ? mapping.tierIds.map((item) => String(item || "").trim()).filter(Boolean) : [];
    const mappingTierTitles = Array.isArray(mapping.tierTitles) ? mapping.tierTitles.map(normalizePatreonTierTitle).filter(Boolean) : [];
    const matchedConfiguredTier = mappingTierIds.some((tierId) => tierIds.has(tierId))
      || mappingTierTitles.some((title) => tierTitles.has(title));

    if (matchedConfiguredTier) {
      output[appKey] = {
        plan: "pro",
        source: "patreon-tier-map",
      };
      continue;
    }

    output[appKey] = fallback[appKey] || {
      plan: "free",
      source: "patreon-no-match",
    };
  }

  return output;
}

function extractPatreonIdentity(payload) {
  const data = payload?.data || {};
  const included = Array.isArray(payload?.included) ? payload.included : [];
  const attributes = data.attributes || {};
  const userId = data.id ? `patreon:${data.id}` : "";
  const displayName = attributes.full_name || attributes.vanity || "";
  const email = attributes.email || "";

  const membership = included.find((item) => item?.type === "member") || null;
  const membershipAttributes = membership?.attributes || {};
  const patronStatus = membershipAttributes.patron_status || membershipAttributes.last_charge_status || "unknown";
  const entitledTiers = included
    .filter((item) => item?.type === "tier")
    .map((item) => ({
      id: item.id || "",
      title: item?.attributes?.title || "",
      amountCents: item?.attributes?.amount_cents || null,
    }));
  const tierTitle = entitledTiers[0]?.title || "";
  const appEntitlements = resolveAppEntitlementsFromPatreon({
    tiers: entitledTiers,
  });
  const isPro = Object.values(appEntitlements).some((entry) => entry?.plan === "pro");

  return {
    userId,
    displayName,
    email,
    membershipStatus: patronStatus,
    tierTitle,
    tiers: entitledTiers,
    appEntitlements,
    isPro,
  };
}

async function exchangePatreonCodeForTokens(code) {
  const response = await fetch("https://www.patreon.com/api/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: patreonClientId,
      client_secret: patreonClientSecret,
      redirect_uri: patreonRedirectUri,
    }).toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || "Patreon token exchange failed.");
  }

  return payload;
}

async function fetchPatreonIdentity(accessToken) {
  const identityUrl = new URL("https://www.patreon.com/api/oauth2/v2/identity");
  identityUrl.searchParams.set("include", "memberships.currently_entitled_tiers");
  identityUrl.searchParams.set("fields[user]", "email,full_name,image_url,thumb_url,vanity");
  identityUrl.searchParams.set("fields[member]", "patron_status,last_charge_status,last_charge_date");
  identityUrl.searchParams.set("fields[tier]", "title,amount_cents");

  const response = await fetch(identityUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.errors?.[0]?.detail || "Patreon identity lookup failed.");
  }

  return extractPatreonIdentity(payload);
}

function sendJson(response, statusCode, body) {
  const raw = JSON.stringify(body);
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(raw),
  });
  response.end(raw);
}

function sendPatreonBridgeResult(response, statusCode, payload, extensionRedirectUri = "") {
  if (extensionRedirectUri) {
    const redirect = new URL(extensionRedirectUri);
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined || value === null) {
        continue;
      }
      redirect.searchParams.set(key, String(value));
    }

    response.writeHead(302, {
      Location: redirect.toString(),
      "Cache-Control": "no-store",
    });
    response.end();
    return;
  }

  sendJson(response, statusCode, payload);
}

function getPatreonBrokerStatus() {
  const missing = [];

  if (!patreonClientId) {
    missing.push("PATREON_CLIENT_ID");
  }

  if (!patreonClientSecret) {
    missing.push("PATREON_CLIENT_SECRET");
  }

  if (!patreonCampaignId) {
    missing.push("PATREON_CAMPAIGN_ID");
  }

  if (!patreonRedirectUri) {
    missing.push("PATREON_REDIRECT_URI");
  }

  return {
    provider: "patreon",
    configured: missing.length === 0,
    missing,
    redirectUri: patreonRedirectUri || null,
    campaignLinked: Boolean(patreonCampaignId),
    oauthExchangeImplemented: true,
    appSessionMinting: false,
    note: "Patreon OAuth exchange is implemented, but internal app-session minting is still pending.",
  };
}

const httpServer = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  prunePatreonBrokerStates();

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
    const latestSample = collectMetricsSnapshot();
    const body = JSON.stringify({
      ok: true,
      appId,
      uptimeSeconds: Math.floor((Date.now() - serverStartedAt) / 1000),
      connectedUsers: runtimeUsers.size,
      activeSessions: sessions.size,
      current: latestSample,
      peaks: getPeakMetrics(),
      metrics,
    });

    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    response.end(body);
    return;
  }

  if (request.url === "/auth/patreon/status") {
    const body = {
      ok: true,
      appId,
      ...getPatreonBrokerStatus(),
    };

    sendJson(response, 200, body);
    return;
  }

  if (requestUrl.pathname === "/auth/patreon/start") {
    const status = getPatreonBrokerStatus();

    if (!status.configured) {
      sendJson(response, 503, {
        ok: false,
        ...status,
        message: "Patreon broker is not configured yet.",
      });
      return;
    }

    const extensionRedirectUri = String(requestUrl.searchParams.get("redirect_uri") || "").trim();
    const source = String(requestUrl.searchParams.get("source") || "extension").trim();
    const appIdParam = String(requestUrl.searchParams.get("app_id") || appId).trim();

    const stateId = encodePatreonBrokerState({
      extensionRedirectUri,
      source,
      appId: appIdParam,
    });

    response.writeHead(302, {
      Location: buildPatreonAuthorizeUrl(stateId),
      "Cache-Control": "no-store",
    });
    response.end();
    return;
  }

  if (requestUrl.pathname === "/auth/patreon/callback") {
    const stateId = requestUrl.searchParams.get("state") || "";
    const state = consumePatreonBrokerState(stateId);
    const extensionRedirectUri = state?.extensionRedirectUri || "";
    const callbackError = requestUrl.searchParams.get("error_description")
      || requestUrl.searchParams.get("error")
      || "";

    if (callbackError) {
      sendPatreonBridgeResult(response, 400, {
        ok: false,
        provider: "patreon",
        status: "error",
        error: callbackError,
      }, extensionRedirectUri);
      return;
    }

    if (!state) {
      sendPatreonBridgeResult(response, 400, {
        ok: false,
        provider: "patreon",
        status: "error",
        error: "Patreon auth state is missing or expired.",
      }, extensionRedirectUri);
      return;
    }

    const code = requestUrl.searchParams.get("code") || "";
    if (!code) {
      sendPatreonBridgeResult(response, 400, {
        ok: false,
        provider: "patreon",
        status: "error",
        error: "Patreon callback did not include an authorization code.",
      }, extensionRedirectUri);
      return;
    }

    Promise.resolve()
      .then(async () => {
        const tokens = await exchangePatreonCodeForTokens(code);
        const identity = await fetchPatreonIdentity(tokens.access_token);

        writeLog("info", "patreon_identity_linked", {
          patreonUserId: identity.userId,
          membershipStatus: identity.membershipStatus,
          tierTitle: identity.tierTitle || null,
          source: state.source,
          appId: state.appId,
        });

        sendPatreonBridgeResult(response, 200, {
          ok: true,
          provider: "patreon",
          status: "identity-only",
          auth_ready: false,
          message: "Patreon identity received. Internal Sketch Party app-session minting is still pending.",
          patreon_user_id: identity.userId,
          display_name: identity.displayName,
          email: identity.email,
          membership_status: identity.membershipStatus,
          tier_title: identity.tierTitle,
          tier_titles: identity.tiers.map((tier) => tier.title).join("|"),
          tier_ids: identity.tiers.map((tier) => tier.id).join("|"),
          app_entitlements: JSON.stringify(identity.appEntitlements),
          is_pro: identity.isPro,
        }, extensionRedirectUri);
      })
      .catch((error) => {
        writeLog("error", "patreon_callback_failed", {
          message: error?.message || "unknown_error",
        });
        sendPatreonBridgeResult(response, 500, {
          ok: false,
          provider: "patreon",
          status: "error",
          error: error?.message || "Patreon callback processing failed.",
        }, extensionRedirectUri);
      });

    return;
  }

  if (request.url?.startsWith("/resolve-user")) {
    const identifier = String(requestUrl.searchParams.get("identifier") || "").trim();
    const normalizedIdentifier = identifier.toUpperCase();
    let matches = [];

    if (normalizedIdentifier) {
      matches = Array.from(runtimeUsers.values()).filter((user) => {
        if (!isVisibleOnline(user.userId)) {
          return false;
        }

        const partyCode = createPartyCode(user.userId);
        if (partyCode === normalizedIdentifier) {
          return true;
        }

        return user.displayName.toLowerCase() === identifier.toLowerCase();
      });
    }

    if (matches.length !== 1) {
      const body = JSON.stringify({
        ok: false,
        reason: matches.length > 1 ? "ambiguous" : "not-found",
      });

      response.writeHead(matches.length > 1 ? 409 : 404, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      });
      response.end(body);
      return;
    }

    const matchedUser = matches[0];
    const body = JSON.stringify({
      ok: true,
      userId: matchedUser.userId,
      displayName: matchedUser.displayName,
      partyCode: createPartyCode(matchedUser.userId),
    });

    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    response.end(body);
    return;
  }

  const body = JSON.stringify({
    name: "Sketch Party Relay",
    websocket: true,
    health: "/health",
    patreonStatus: "/auth/patreon/status",
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
      sendProtocolError(socket, "Binary payloads are not supported.");
      return;
    }

    const message = safeJsonParse(raw);
    if (!message || typeof message.type !== "string") {
      sendProtocolError(socket, "Invalid message format.");
      return;
    }

    if (message.type === "register-user") {
      if (!enforceRateLimit(socket, "register-user", 6, 60_000)) {
        sendProtocolError(socket, "Registration requests are being sent too often.");
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
      writeLog("info", "registered", {
        userId: user.userId,
        clientId: socket.clientId,
        visibleOnline: isVisibleOnline(user.userId),
      });
      broadcastPresenceState();
      return;
    }

    if (!socket.userId || !socket.clientId) {
      sendProtocolError(socket, "The socket must register before using realtime features.");
      return;
    }

    const userId = socket.userId;
    const user = ensureRuntimeUser(userId);
    user.lastSeenAt = Date.now();
    activeClientByUserId.set(userId, socket.clientId);

    if (message.type === "start-session") {
      if (!enforceRateLimit(socket, "start-session", 12, 60_000)) {
        sendProtocolError(socket, "Too many session start attempts were made.");
        return;
      }

      const targetUserId = typeof message.targetUserId === "string" ? message.targetUserId : "";
      const mode = message.mode === "live" ? "live" : message.mode === "send" ? "send" : "";
      const rpcSessionId = typeof message.rpcSessionId === "string" ? message.rpcSessionId : "";
      const guestSession = message.guestSession === true;
      const sessionAccessToken = typeof message.accessToken === "string" ? message.accessToken : user.lastAccessToken;

      if (sessionAccessToken) {
        user.lastAccessToken = sessionAccessToken;
      }

      if (!targetUserId || !mode || (!rpcSessionId && !guestSession)) {
        sendProtocolError(socket, "The session start payload is invalid.");
        return;
      }

      if (user.preferences.extensionEnabled === false) {
        sendProtocolError(socket, "You cannot start a session while the extension is inactive.");
        return;
      }

      if (!isVisibleOnline(targetUserId)) {
        sendProtocolError(socket, "The selected user is not available right now.");
        return;
      }

      const targetClientId = getPreferredClientId(targetUserId);
      if (!targetClientId) {
        sendProtocolError(socket, "The selected user's active window could not be found.");
        return;
      }

      const targetUser = ensureRuntimeUser(targetUserId);

      if (targetUser.preferences.extensionEnabled === false) {
        sendProtocolError(socket, `${targetUser.displayName} is online but not accepting drawings right now.`);
        sendPreferenceNudge(targetUserId, user.displayName, "extension-disabled");
        return;
      }

      if (mode === "send" && targetUser.preferences.allowSurprise === false) {
        sendProtocolError(socket, `${targetUser.displayName} has receiving drawings turned off right now.`);
        sendPreferenceNudge(targetUserId, user.displayName, "surprise-disabled");
        return;
      }

      if (guestSession) {
        closeUserSession(userId, "A new guest session was started.");
        closeUserSession(targetUserId, "A new guest session was started.");

        const session = {
          sessionId: `guest-${crypto.randomUUID()}`,
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
        writeLog("info", "guest_session_started", {
          sessionId: session.sessionId,
          mode,
          initiatorId: userId,
          recipientId: targetUserId,
        });

        sendSessionStarted(userId, session, false);
        sendSessionStarted(targetUserId, session, false);
        broadcastPresenceState();
        return;
      }

      const verifiedSession = await fetchVerifiedSession({
        accessToken: sessionAccessToken,
        sessionId: rpcSessionId,
        initiatorId: userId,
        recipientId: targetUserId,
        mode,
      });

      if (!verifiedSession) {
        sendProtocolError(socket, "The realtime session could not be verified against Supabase.");
        return;
      }

      closeUserSession(userId, "A new session was started.");
      closeUserSession(targetUserId, "A new session was started.");

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
      writeLog("info", "session_started", {
        sessionId: session.sessionId,
        mode,
        initiatorId: userId,
        recipientId: targetUserId,
      });

      sendSessionStarted(userId, session, false);
      sendSessionStarted(targetUserId, session, false);
      broadcastPresenceState();
      return;
    }

    if (message.type === "leave-session") {
      if (!enforceRateLimit(socket, "leave-session", 20, 60_000)) {
        sendProtocolError(socket, "Session end requests are being sent too often.");
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
        sendProtocolError(socket, "You do not have permission to end this session.");
        return;
      }

      endSession(message.sessionId, "Session ended.");
      return;
    }

    const sessionId = activeSessionByUserId.get(userId);
    const session = sessions.get(sessionId);

    if (!session || message.sessionId !== sessionId || session.clientIds[userId] !== socket.clientId) {
      sendProtocolError(socket, "No active session was found.");
      return;
    }

    const partnerId = session.participants.find((participantId) => participantId !== userId);
    const canDraw = session.mode === "live" || session.initiatorId === userId;

    if (message.type === "draw-segment") {
      if (!enforceRateLimit(socket, "draw-segment", 240, 10_000)) {
        sendProtocolError(socket, "Drawing data is being sent too quickly.");
        return;
      }

      if (!canDraw) {
        return;
      }

      const segment = sanitizeSegment(message.segment);
      if (!segment) {
        sendProtocolError(socket, "The drawing payload is invalid.");
        return;
      }

      const effectRateLimit = getEffectRateLimit(segment.effect);
      if (effectRateLimit && !enforceRateLimit(socket, effectRateLimit.key, effectRateLimit.limit, effectRateLimit.windowMs)) {
        sendProtocolError(socket, effectRateLimit.message);
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
        sendProtocolError(socket, "Clear-canvas requests are being sent too quickly.");
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
        sendProtocolError(socket, "Messages are being sent too quickly.");
        return;
      }

      const text = sanitizeChatText(message.text);
      if (!text) {
        sendProtocolError(socket, "A chat message cannot be empty.");
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

    sendProtocolError(socket, "Unsupported realtime message type.");
  });

  socket.on("close", () => {
    const { userId, clientId } = socket;

    if (!userId || !clientId) {
      return;
    }
    writeLog("info", "socket_closed", {
      userId,
      clientId,
      remainingSocketsForUser: Math.max(0, getSocketMap(userId).size - 1),
    });

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
          closeUserSession(userId, "The other side disconnected.");
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
  writeLog("info", "relay_started", {
    host,
    port,
    appId,
  });
});

