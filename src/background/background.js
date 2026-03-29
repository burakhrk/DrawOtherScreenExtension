async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  return tabs[0];
}

const surpriseEffectCooldownState = new Map();

function getSurpriseCooldownMs(effectName) {
  if (effectName === "mexicanwave") {
    return 12_000;
  }

  if (effectName === "stickerslap") {
    return 1_400;
  }

  if (effectName && effectName !== "draw") {
    return 450;
  }

  return 0;
}

function shouldDeliverSurprise(tabId, effectName) {
  const cooldownMs = getSurpriseCooldownMs(effectName);
  if (!cooldownMs) {
    return true;
  }

  const key = `${tabId}:${effectName}`;
  const lastAt = surpriseEffectCooldownState.get(key) || 0;
  if ((Date.now() - lastAt) < cooldownMs) {
    return false;
  }

  surpriseEffectCooldownState.set(key, Date.now());
  return true;
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install") {
    return;
  }

  const dashboardUrl = chrome.runtime.getURL("src/dashboard/dashboard.html");
  void chrome.tabs.create({ url: dashboardUrl });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SHOW_SURPRISE_EFFECT") {
    getActiveTab()
      .then((tab) => {
        if (!tab?.id || tab.url?.startsWith("chrome://")) {
          sendResponse({ ok: false });
          return;
        }

        if (!shouldDeliverSurprise(tab.id, message.segment?.effect)) {
          sendResponse({ ok: true, skipped: true });
          return;
        }

        chrome.tabs.sendMessage(tab.id, {
          type: "SHOW_SURPRISE_EFFECT",
          segment: message.segment
        }).then(() => sendResponse({ ok: true }))
          .catch(() => sendResponse({ ok: false }));
      })
      .catch(() => sendResponse({ ok: false }));

    return true;
  }

  if (message?.type === "CLEAR_SURPRISE_EFFECT") {
    getActiveTab()
      .then((tab) => {
        if (!tab?.id) {
          sendResponse({ ok: false });
          return;
        }

        chrome.tabs.sendMessage(tab.id, {
          type: "CLEAR_SURPRISE_EFFECT"
        }).then(() => sendResponse({ ok: true }))
          .catch(() => sendResponse({ ok: false }));
      })
      .catch(() => sendResponse({ ok: false }));

    return true;
  }
});
