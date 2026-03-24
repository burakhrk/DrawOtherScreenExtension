import { APP_ID } from "./constants.js";

const ANALYTICS_KEY = "sketch-party-analytics-log";

function normalizePayload(payload = {}) {
  return {
    appId: APP_ID,
    timestamp: Date.now(),
    ...payload,
  };
}

export async function track(eventName, payload = {}) {
  const entry = {
    event: eventName,
    ...normalizePayload(payload),
  };

  const stored = await chrome.storage.local.get(ANALYTICS_KEY);
  const queue = stored[ANALYTICS_KEY] ?? [];
  queue.push(entry);
  await chrome.storage.local.set({
    [ANALYTICS_KEY]: queue.slice(-100),
  });
}
