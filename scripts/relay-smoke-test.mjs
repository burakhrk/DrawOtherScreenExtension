import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import process from "node:process";
import { WebSocket } from "ws";

const relayPort = 43110;
const supabasePort = 43111;
const supabaseUrl = `http://127.0.0.1:${supabasePort}`;
const relayUrl = `ws://127.0.0.1:${relayPort}`;
const relayHttpUrl = `http://127.0.0.1:${relayPort}`;

const usersByToken = new Map([
  ["token-a", { id: "user-a", email: "a@example.com" }],
  ["token-b", { id: "user-b", email: "b@example.com" }],
]);

const sessionRows = new Map([
  ["session-live-1", {
    id: "session-live-1",
    app_id: "sketch-party",
    initiator_id: "user-a",
    recipient_id: "user-b",
    mode: "live",
    status: "active",
    created_at: new Date().toISOString(),
    ended_at: null,
  }],
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseBearer(request) {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}

function createMockSupabaseServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, supabaseUrl);
    const token = parseBearer(request);

    if (url.pathname === "/auth/v1/user") {
      const user = usersByToken.get(token);
      if (!user) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: "invalid token" }));
        return;
      }

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(user));
      return;
    }

    if (url.pathname === "/rest/v1/sessions") {
      const user = usersByToken.get(token);
      const sessionId = url.searchParams.get("id")?.replace(/^eq\./, "") || "";
      const session = sessionRows.get(sessionId);

      if (!user || !session) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("[]");
        return;
      }

      const canSee =
        session.app_id === (url.searchParams.get("app_id")?.replace(/^eq\./, "") || "") &&
        session.status === (url.searchParams.get("status")?.replace(/^eq\./, "") || "") &&
        session.initiator_id === user.id;

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(canSee ? [session] : []));
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ message: "not found" }));
  });
}

async function waitForServer(url, attempts = 30) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {}

    await sleep(150);
  }

  throw new Error(`Server did not become ready: ${url}`);
}

function createSocketClient(name) {
  const socket = new WebSocket(relayUrl);
  const messages = [];
  const waiters = [];

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    messages.push(message);

    for (let index = 0; index < waiters.length; index += 1) {
      const waiter = waiters[index];
      if (waiter.predicate(message)) {
        waiters.splice(index, 1);
        waiter.resolve(message);
        break;
      }
    }
  });

  socket.on("error", (error) => {
    for (const waiter of waiters.splice(0)) {
      waiter.reject(error);
    }
  });

  async function waitFor(predicate, timeoutMs = 5000) {
    const existing = messages.find(predicate);
    if (existing) {
      return existing;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = waiters.findIndex((item) => item.resolve === wrappedResolve);
        if (index >= 0) {
          waiters.splice(index, 1);
        }
        reject(new Error(`Timeout waiting for ${name} message`));
      }, timeoutMs);

      function wrappedResolve(message) {
        clearTimeout(timeout);
        resolve(message);
      }

      waiters.push({
        predicate,
        resolve: wrappedResolve,
        reject,
      });
    });
  }

  return { socket, messages, waitFor };
}

async function main() {
  const mockSupabase = createMockSupabaseServer();
  mockSupabase.listen(supabasePort, "127.0.0.1");
  await once(mockSupabase, "listening");

  const relayProcess = spawn(process.execPath, ["relay/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(relayPort),
      HOST: "127.0.0.1",
      SUPABASE_URL: supabaseUrl,
      SUPABASE_ANON_KEY: "test-anon-key",
  APP_ID: "sketch-party",
      RECONNECT_GRACE_MS: "1200",
      MAX_PAYLOAD_BYTES: "32768",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  relayProcess.stdout.on("data", () => {});
  relayProcess.stderr.on("data", () => {});

  try {
    await waitForServer(`${relayHttpUrl}/health`);
    const health = await fetch(`${relayHttpUrl}/health`).then((response) => response.json());
    assert(health.ok === true, "Health endpoint should return ok=true");
    assert(health.statelessRelay === true, "Health endpoint should report stateless relay");

    const clientA = createSocketClient("clientA");
    const clientB = createSocketClient("clientB");
    const invalidClient = createSocketClient("invalidClient");

    await Promise.all([
      once(clientA.socket, "open"),
      once(clientB.socket, "open"),
      once(invalidClient.socket, "open"),
    ]);

    invalidClient.socket.send(JSON.stringify({
      type: "register-user",
      userId: "user-x",
      clientId: "client-x",
      displayName: "X",
      accessToken: "bad-token",
      preferences: {},
    }));

    const invalidError = await invalidClient.waitFor((message) => message.type === "error");
    assert(
      invalidError.message.includes("JWT verification failed"),
      "Invalid token should be rejected",
    );

    clientA.socket.send(JSON.stringify({
      type: "register-user",
      userId: "user-a",
      clientId: "client-a",
      displayName: "A User",
      accessToken: "token-a",
      preferences: {
        extensionEnabled: true,
        appearOnline: true,
        allowSurprise: true,
      },
    }));

    clientB.socket.send(JSON.stringify({
      type: "register-user",
      userId: "user-b",
      clientId: "client-b",
      displayName: "B User",
      accessToken: "token-b",
      preferences: {
        extensionEnabled: true,
        appearOnline: true,
        allowSurprise: true,
      },
    }));

    await clientA.waitFor((message) => message.type === "registered");
    await clientB.waitFor((message) => message.type === "registered");

    const presenceForA = await clientA.waitFor((message) =>
      message.type === "presence-state" &&
      message.onlineUserIds?.includes("user-a") &&
      message.onlineUserIds?.includes("user-b")
    );
    assert(presenceForA.onlineUserIds.length === 2, "Presence should contain both users");

    clientA.socket.send(JSON.stringify({
      type: "start-session",
      targetUserId: "user-b",
      mode: "live",
      sessionId: "missing-rpc-id",
    }));
    const invalidSessionError = await clientA.waitFor((message) =>
      message.type === "error" &&
      message.message.includes("invalid")
    );
    assert(Boolean(invalidSessionError), "Missing rpcSessionId should fail");

    clientA.socket.send(JSON.stringify({
      type: "start-session",
      rpcSessionId: "session-live-1",
      targetUserId: "user-b",
      mode: "live",
    }));

    const startedA = await clientA.waitFor((message) => message.type === "session-started");
    const startedB = await clientB.waitFor((message) => message.type === "session-started");
    assert(startedA.sessionId === "session-live-1", "Session should use verified Supabase session id");
    assert(startedB.partner.userId === "user-a", "Partner should be set for recipient");

    clientA.socket.send(JSON.stringify({
      type: "chat",
      sessionId: "session-live-1",
      text: "hello world",
      timestamp: 123,
    }));

    const chatMessage = await clientB.waitFor((message) =>
      message.type === "chat" && message.text === "hello world"
    );
    assert(chatMessage.displayName === "A User", "Chat should forward sender display name");

    clientA.socket.send(JSON.stringify({
      type: "draw-segment",
      sessionId: "session-live-1",
      segment: {
        strokeId: "stroke-1",
        effect: "draw",
        normalized: true,
        from: { x: 10, y: 20 },
        to: { x: 120, y: 160 },
        color: "#232018",
        size: 4,
        seed: 0,
      },
    }));

    const drawMessage = await clientB.waitFor((message) =>
      message.type === "draw-segment" && message.segment?.strokeId === "stroke-1"
    );
    assert(drawMessage.segment.color === "#232018", "Draw segment should be forwarded");

    clientA.socket.send(JSON.stringify({
      type: "draw-segment",
      sessionId: "session-live-1",
      segment: {
        strokeId: "stroke-bad",
        effect: "draw",
        normalized: true,
        from: { x: -5, y: 20 },
        to: { x: 120, y: 160 },
        color: "#232018",
        size: 4,
      },
    }));

    const invalidDraw = await clientA.waitFor((message) =>
      message.type === "error" && message.message.includes("drawing payload is invalid")
    );
    assert(Boolean(invalidDraw), "Invalid draw payload should be rejected");

    for (let index = 0; index < 41; index += 1) {
      clientA.socket.send(JSON.stringify({
        type: "chat",
        sessionId: "session-live-1",
        text: `msg-${index}`,
        timestamp: Date.now(),
      }));
    }

    const rateLimitError = await clientA.waitFor((message) =>
      message.type === "error" && message.message.includes("Messages are being sent too quickly")
    );
    assert(Boolean(rateLimitError), "Chat spam should trigger rate limiting");

    clientA.socket.send(JSON.stringify({
      type: "leave-session",
      sessionId: "session-live-1",
    }));

    const endedMessage = await clientB.waitFor((message) => message.type === "session-ended");
    assert(endedMessage.sessionId === "session-live-1", "Leave session should end on partner");

    const metrics = await fetch(`${relayHttpUrl}/metrics`).then((response) => response.json());
    assert(metrics.ok === true, "Metrics endpoint should return ok=true");
    assert(metrics.metrics.successfulRegistrations >= 2, "Metrics should count successful registrations");
    assert(metrics.metrics.failedRegistrations >= 1, "Metrics should count failed registrations");
    assert(metrics.metrics.startedSessions >= 1, "Metrics should count started sessions");
    assert(metrics.metrics.forwardedChats >= 1, "Metrics should count forwarded chats");
    assert(metrics.metrics.forwardedDrawSegments >= 1, "Metrics should count forwarded draws");
    assert(metrics.metrics.rateLimitHits >= 1, "Metrics should count rate limit hits");

    clientA.socket.close();
    clientB.socket.close();
    invalidClient.socket.close();

    console.log(JSON.stringify({
      ok: true,
      checks: [
        "health",
        "jwt-register",
        "presence",
        "session-verification",
        "chat-forwarding",
        "draw-forwarding",
        "invalid-draw-rejected",
        "chat-rate-limit",
        "leave-session",
        "metrics",
      ],
    }, null, 2));
  } finally {
    relayProcess.kill();
    mockSupabase.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
