async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  return tabs[0];
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
