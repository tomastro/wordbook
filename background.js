const GAS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzwBFYBSNEYKpnMfaibPslA3fiiEGsyQ48f5_TcaUtlHnLLfslCzwuZ9STiRoFAeZyz/exec";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-word",
    title: "単語帳に追加",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "add-word") return;

  const word = info.selectionText?.trim();
  if (!word) return;

  const entry = {
    id: crypto.randomUUID(),
    word,
    timestamp: new Date().toISOString(),
    url: info.pageUrl,
    domain: new URL(info.pageUrl).hostname,
    synced: false
  };

  const { words = [] } =
    await chrome.storage.local.get("words");

  words.push(entry);
  chrome.action.setBadgeText({ text: String(words.length) });
  chrome.action.setBadgeBackgroundColor({ color: "#555" });

  await chrome.storage.local.set({ words });
  await trySync(entry, words);
});

async function trySync(entry, words) {
  try {
    await fetch(GAS_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry)
    });
    entry.synced = true;
    await chrome.storage.local.set({ words });
  } catch(e) {
    console.log(e);
  }
};
chrome.runtime.onStartup.addListener(async () => {
  const { words = [] } =
    await chrome.storage.local.get("words");
  chrome.action.setBadgeText({ text: String(words.length) });
  chrome.action.setBadgeBackgroundColor({ color: "#555" });

  await syncUnsynced();
});

async function syncUnsynced() {
  const { words = [] } = await chrome.storage.local.get("words");

  for (const w of words.filter(x => !x.synced)) {
    try {
      await fetch(GAS_WEBAPP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(w)
      });
      w.synced = true;
    } catch {}
  }

  await chrome.storage.local.set({ words });
}
