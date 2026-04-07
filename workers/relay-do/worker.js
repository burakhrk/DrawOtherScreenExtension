// Cloudflare Worker + Durable Object relay for Sketch Party–style realtime.
// Minimal parity with the existing Node relay: register-user, start-session, leave-session,
// draw-segment, clear-canvas, chat, health, metrics (token-protected).
// Bindings required:
// - SUPABASE_URL
// - SUPABASE_ANON_KEY
// - RELAY_METRICS_TOKEN (optional; if set, required for /api/relay/metrics)
// - RelayHub (Durable Object binding)
// Optional:
// - RELAY_ALLOWED_ORIGINS (comma-separated), defaults to "*"

import { nanoid } from "./worker_utils.js";

const JSON_HEADERS = { "content-type": "application/json" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return corsResponse(204, null, request, env);
    }

    if (url.pathname === "/api/relay/health") {
      return corsResponse(200, { ok: true }, request, env);
    }

    if (url.pathname === "/api/relay/metrics") {
      if (env.RELAY_METRICS_TOKEN) {
        const token = request.headers.get("authorization")?.replace("Bearer ", "");
        if (token !== env.RELAY_METRICS_TOKEN) {
          return corsResponse(401, { error: "unauthorized" }, request, env);
        }
      }
      const id = env.RelayHub.idFromName("global");
      const stub = env.RelayHub.get(id);
      const res = await stub.fetch("https://relay.internal/metrics", { method: "GET" });
      return corsPassthrough(res, request, env);
    }

    if (url.pathname === "/api/relay" || url.pathname === "/api/relay/ws") {
      if (request.headers.get("upgrade") !== "websocket") {
        return corsResponse(400, { error: "Expected WebSocket" }, request, env);
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      const id = env.RelayHub.idFromName("global");
      const stub = env.RelayHub.get(id);
      await stub.fetch("https://relay.internal/connect", { method: "POST", webSocket: server });
      return new Response(null, { status: 101, webSocket: client });
    }

    return corsResponse(404, { error: "not_found" }, request, env);
  },
};

export class RelayHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.socketsByUser = new Map(); // userId -> Map(clientId, ws)
    this.activeSessionByUser = new Map(); // userId -> sessionId
    this.sessions = new Map(); // sessionId -> {mode, initiatorId, participants, clientIds}
    this.metrics = { connections: 0, startedSessions: 0, chats: 0, draws: 0, clears: 0 };
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/connect" && request.webSocket) {
      const ws = request.webSocket;
      ws.accept();
      this.metrics.connections += 1;
      this.attachSocket(ws);
      return new Response(null, { status: 101 });
    }

    if (url.pathname === "/metrics") {
      const body = JSON.stringify({
        ...this.metrics,
        users: this.socketsByUser.size,
        sessions: this.sessions.size,
        ts: Date.now(),
      });
      return new Response(body, { status: 200, headers: JSON_HEADERS });
    }

    return new Response("not_found", { status: 404 });
  }

  attachSocket(ws) {
    ws.userId = "";
    ws.clientId = "";
    ws.isAlive = true;

    ws.addEventListener("message", async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await this.handleMessage(ws, msg);
      } catch (err) {
        this.send(ws, { type: "error", message: err.message || "Invalid message" });
      }
    });

    ws.addEventListener("close", () => {
      if (ws.userId && ws.clientId) {
        const map = this.socketsByUser.get(ws.userId);
        if (map) {
          map.delete(ws.clientId);
          if (!map.size) {
            this.socketsByUser.delete(ws.userId);
            const sessionId = this.activeSessionByUser.get(ws.userId);
            if (sessionId) this.endSession(sessionId, "disconnect");
          }
        }
      }
    });

    // Simple heartbeat
    const interval = setInterval(() => {
      if (ws.readyState !== ws.OPEN) {
        clearInterval(interval);
        return;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        clearInterval(interval);
      }
    }, 30000);

    ws.addEventListener("pong", () => {
      ws.isAlive = true;
    });
  }

  async handleMessage(ws, msg) {
    if (!msg || typeof msg.type !== "string") {
      this.sendProtocolError(ws, "Invalid message");
      return;
    }

    if (msg.type === "register-user") {
      const user = await this.verifyUser(msg);
      if (!user) {
        this.sendProtocolError(ws, "Registration failed");
        return;
      }
      ws.userId = user.userId;
      ws.clientId = String(msg.clientId || "").slice(0, 100) || nanoid();
      const map = this.socketsByUser.get(user.userId) || new Map();
      map.set(ws.clientId, ws);
      this.socketsByUser.set(user.userId, map);
      this.send(ws, { type: "registered", userId: user.userId, displayName: user.displayName });
      return;
    }

    if (!ws.userId || !ws.clientId) {
      this.sendProtocolError(ws, "Must register first");
      return;
    }

    if (msg.type === "start-session") {
      const targetUserId = String(msg.targetUserId || "");
      const mode = msg.mode === "live" ? "live" : "send";
      const rpcSessionId = String(msg.rpcSessionId || "");
      const guestSession = msg.guestSession === true;
      const accessToken = msg.accessToken;

      if (!targetUserId) {
        this.sendProtocolError(ws, "Missing target user");
        return;
      }

      if (!guestSession) {
        const ok = await this.verifySupabaseSession({
          accessToken,
          sessionId: rpcSessionId,
          initiatorId: ws.userId,
          recipientId: targetUserId,
          mode,
        });
        if (!ok) {
          this.sendProtocolError(ws, "Session could not be verified");
          return;
        }
      }

      const sessionId = guestSession ? `guest-${nanoid()}` : rpcSessionId || nanoid();
      const targetClientId = this.preferredClient(targetUserId);
      if (!targetClientId) {
        this.sendProtocolError(ws, "Target user not available");
        return;
      }

      this.endSession(this.activeSessionByUser.get(ws.userId), "new session");
      this.endSession(this.activeSessionByUser.get(targetUserId), "new session");

      const session = {
        sessionId,
        mode,
        initiatorId: ws.userId,
        participants: [ws.userId, targetUserId],
        clientIds: {
          [ws.userId]: ws.clientId,
          [targetUserId]: targetClientId,
        },
      };

      this.sessions.set(sessionId, session);
      this.activeSessionByUser.set(ws.userId, sessionId);
      this.activeSessionByUser.set(targetUserId, sessionId);
      this.metrics.startedSessions += 1;

      this.sendToUser(ws.userId, session.clientIds[ws.userId], { type: "session-started", ...session });
      this.sendToUser(targetUserId, targetClientId, { type: "session-started", ...session });
      return;
    }

    if (msg.type === "leave-session") {
      const sessionId = this.activeSessionByUser.get(ws.userId);
      if (!sessionId || msg.sessionId !== sessionId) {
        this.sendProtocolError(ws, "No active session");
        return;
      }
      this.endSession(sessionId, "ended");
      return;
    }

    const sessionId = this.activeSessionByUser.get(ws.userId);
    const session = this.sessions.get(sessionId);
    if (!session || session.clientIds[ws.userId] !== ws.clientId || msg.sessionId !== sessionId) {
      this.sendProtocolError(ws, "No active session");
      return;
    }

    const partnerId = session.participants.find((p) => p !== ws.userId);
    const partnerClientId = session.clientIds[partnerId];
    const canDraw = session.mode === "live" || session.initiatorId === ws.userId;

    if (msg.type === "draw-segment") {
      if (!canDraw) return;
      const segment = sanitizeSegment(msg.segment);
      if (!segment) {
        this.sendProtocolError(ws, "Invalid segment");
        return;
      }
      this.metrics.draws += 1;
      this.sendToUser(partnerId, partnerClientId, { type: "draw-segment", userId: ws.userId, segment });
      return;
    }

    if (msg.type === "clear-canvas") {
      if (!canDraw) return;
      this.metrics.clears += 1;
      this.sendToUser(partnerId, partnerClientId, { type: "clear-canvas", userId: ws.userId });
      return;
    }

    if (msg.type === "chat") {
      const text = sanitizeChat(msg.text);
      if (!text) {
        this.sendProtocolError(ws, "Empty message");
        return;
      }
      this.metrics.chats += 1;
      const payload = {
        type: "chat",
        userId: ws.userId,
        displayName: "Friend",
        text,
        timestamp: msg.timestamp || Date.now(),
      };
      this.sendToUser(ws.userId, ws.clientId, payload);
      this.sendToUser(partnerId, partnerClientId, payload);
      return;
    }

    this.sendProtocolError(ws, "Unsupported message");
  }

  send(ws, payload) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (_) {}
  }

  sendProtocolError(ws, message) {
    this.send(ws, { type: "protocol-error", message });
  }

  sendToUser(userId, clientId, payload) {
    const map = this.socketsByUser.get(userId);
    if (!map) return;
    const ws = map.get(clientId);
    if (!ws) return;
    this.send(ws, payload);
  }

  preferredClient(userId) {
    const map = this.socketsByUser.get(userId);
    if (!map) return null;
    return map.keys().next().value || null;
  }

  endSession(sessionId, reason) {
    if (!sessionId) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;
    for (const userId of session.participants) {
      const cid = session.clientIds[userId];
      this.sendToUser(userId, cid, { type: "session-ended", sessionId, reason });
      if (this.activeSessionByUser.get(userId) === sessionId) {
        this.activeSessionByUser.delete(userId);
      }
    }
    this.sessions.delete(sessionId);
  }

  async verifyUser(msg) {
    if (msg.guest === true) {
      const userId = String(msg.userId || "").startsWith("guest:") ? String(msg.userId) : `guest:${nanoid()}`;
      return { userId, displayName: msg.displayName || "Guest" };
    }
    if (!msg.accessToken || !msg.userId) return null;
    const res = await fetch(`${this.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: this.env.SUPABASE_ANON_KEY,
        authorization: `Bearer ${msg.accessToken}`,
      },
    });
    if (!res.ok) return null;
    const user = await res.json();
    if (user?.id !== msg.userId) return null;
    return { userId: user.id, displayName: user.user_metadata?.full_name || user.email || "Sketch Party user" };
  }

  async verifySupabaseSession({ accessToken, sessionId, initiatorId, recipientId, mode }) {
    if (!accessToken || !sessionId) return false;
    const params = new URLSearchParams({
      select: "id,app_id,initiator_id,recipient_id,mode,status",
      id: `eq.${sessionId}`,
      app_id: "eq.sketch-party",
      status: "eq.active",
      limit: "1",
    });
    const res = await fetch(`${this.env.SUPABASE_URL}/rest/v1/sessions?${params.toString()}`, {
      headers: {
        apikey: this.env.SUPABASE_ANON_KEY,
        authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) return false;
    const rows = await res.json();
    const row = rows?.[0];
    if (!row) return false;
    return row.initiator_id === initiatorId && row.recipient_id === recipientId && row.mode === mode && row.status === "active";
  }
}

function sanitizeSegment(seg) {
  if (!seg || typeof seg !== "object") return null;
  const effect = typeof seg.effect === "string" ? seg.effect : "draw";
  const size = Number(seg.size || 4);
  const color = typeof seg.color === "string" ? seg.color : "#232018";
  const from = sanitizePoint(seg.from);
  const to = sanitizePoint(seg.to);
  if (!from || !to) return null;
  return { effect, size, color, from, to, seed: Number(seg.seed || 0) };
}

function sanitizePoint(p) {
  if (!p || typeof p.x !== "number" || typeof p.y !== "number") return null;
  return { x: clamp(p.x, 0, 2000), y: clamp(p.y, 0, 2000) };
}

function sanitizeChat(text) {
  if (typeof text !== "string") return "";
  return text.trim().slice(0, 500);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowed = (env.RELAY_ALLOWED_ORIGINS || "*")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const allowAll = allowed.includes("*");
  const allowOrigin = allowAll ? "*" : allowed.includes(origin) ? origin : null;
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Max-Age": "86400",
  };
  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
  }
  return headers;
}

function corsResponse(status, body, request, env) {
  const headers = { ...JSON_HEADERS, ...corsHeaders(request, env) };
  if (body === null) {
    return new Response(null, { status, headers });
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function corsPassthrough(response, request, env) {
  const headers = { ...Object.fromEntries(response.headers), ...corsHeaders(request, env) };
  const body = await response.text();
  return new Response(body, { status: response.status, headers });
}
