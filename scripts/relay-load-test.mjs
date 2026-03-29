import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import process from "node:process";
import { WebSocket } from "ws";

const relayPort = 43210;
const supabasePort = 43211;
const supabaseUrl = `http://127.0.0.1:${supabasePort}`;
const relayUrl = `ws://127.0.0.1:${relayPort}`;
const relayHttpUrl = `http://127.0.0.1:${relayPort}`;

const totalUsers = Number(process.env.LOAD_TEST_USERS || 40);
const messagesPerSession = Number(process.env.LOAD_TEST_MESSAGES || 6);
const drawsPerSession = Number(process.env.LOAD_TEST_DRAWS || 12);

const users = Array.from({ length: totalUsers }, (_, index) => ({
  id: `user-${index + 1}`,
  email: `user-${index + 1}@example.com`,
  token: `token-${index + 1}`,
  clientId: `client-${index + 1}`,
  displayName: `User ${index + 1}`,
}));

const usersByToken = new Map(users.map((user) => [user.token, { id: user.id, email: user.email }]));

const sessionRows = new Map(
  Array.from({ length: Math.floor(totalUsers / 2) }, (_, index) => {
    const initiator = users[index * 2];
    const recipient = users[index * 2 + 1];
    const sessionId = `session-${index + 1}`;
    return [sessionId, {
      id: sessionId,
      app_id: "sketch-party",
      initiator_id: initiator.id,
      recipient_id: recipient.id,
      mode: "live",
      status: "active",
      created_at: new Date().toISOString(),
      ended_at: null,
    }];
  }),
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForServer(url, attempts = 40) {
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

function createSocketClient(user) {
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

  async function waitFor(predicate, timeoutMs = 8000) {
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
        reject(new Error(`Timeout waiting for ${user.id} message`));
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

  return { socket, messages, waitFor, user };
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

  const startedAt = Date.now();

  try {
    await waitForServer(`${relayHttpUrl}/health`);

    const clients = users.map((user) => createSocketClient(user));
    await Promise.all(clients.map((client) => once(client.socket, "open")));

    clients.forEach((client) => {
      client.socket.send(JSON.stringify({
        type: "register-user",
        userId: client.user.id,
        clientId: client.user.clientId,
        displayName: client.user.displayName,
        accessToken: client.user.token,
        preferences: {
          extensionEnabled: true,
          appearOnline: true,
          allowSurprise: true,
        },
      }));
    });

    await Promise.all(clients.map((client) => client.waitFor((message) => message.type === "registered")));
    await Promise.all(clients.map((client) => client.waitFor((message) =>
      message.type === "presence-state" &&
      Array.isArray(message.onlineUserIds) &&
      message.onlineUserIds.length === totalUsers
    )));

    const sessionPairs = Array.from({ length: Math.floor(totalUsers / 2) }, (_, index) => ({
      sessionId: `session-${index + 1}`,
      initiator: clients[index * 2],
      recipient: clients[index * 2 + 1],
    }));

    sessionPairs.forEach(({ sessionId, initiator, recipient }) => {
      initiator.socket.send(JSON.stringify({
        type: "start-session",
        rpcSessionId: sessionId,
        targetUserId: recipient.user.id,
        mode: "live",
        accessToken: initiator.user.token,
      }));
    });

    await Promise.all(sessionPairs.flatMap(({ sessionId, initiator, recipient }) => [
      initiator.waitFor((message) => message.type === "session-started" && message.sessionId === sessionId),
      recipient.waitFor((message) => message.type === "session-started" && message.sessionId === sessionId),
    ]));

    sessionPairs.forEach(({ sessionId, initiator }) => {
      for (let index = 0; index < messagesPerSession; index += 1) {
        initiator.socket.send(JSON.stringify({
          type: "chat",
          sessionId,
          text: `hello-${sessionId}-${index}`,
          timestamp: Date.now(),
        }));
      }

      for (let index = 0; index < drawsPerSession; index += 1) {
        initiator.socket.send(JSON.stringify({
          type: "draw-segment",
          sessionId,
          segment: {
            strokeId: `${sessionId}-stroke-${index}`,
            effect: "draw",
            normalized: true,
            from: { x: 10 + index, y: 20 + index },
            to: { x: 80 + index, y: 120 + index },
            color: "#232018",
            size: 4,
            seed: 0,
          },
        }));
      }
    });

    await Promise.all(sessionPairs.map(({ sessionId, recipient }) =>
      recipient.waitFor((message) => message.type === "chat" && message.text === `hello-${sessionId}-0`)
    ));

    await Promise.all(sessionPairs.map(({ sessionId, recipient }) =>
      recipient.waitFor((message) => message.type === "draw-segment" && message.segment?.strokeId === `${sessionId}-stroke-0`)
    ));

    const metrics = await fetch(`${relayHttpUrl}/metrics`).then((response) => response.json());
    const finishedAt = Date.now();

    const summary = {
      ok: true,
      users: totalUsers,
      sessions: sessionPairs.length,
      chatsSent: sessionPairs.length * messagesPerSession,
      drawSegmentsSent: sessionPairs.length * drawsPerSession,
      durationMs: finishedAt - startedAt,
      metrics: metrics.metrics,
    };

    clients.forEach((client) => client.socket.close());
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    relayProcess.kill();
    mockSupabase.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
