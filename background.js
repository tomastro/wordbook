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
    word,
    timestamp: new Date().toISOString(),
    url: info.pageUrl,
    domain: new URL(info.pageUrl).hostname
  };

  const { words = [] } =
    await chrome.storage.local.get("words");

  words.push(entry);
  chrome.action.setBadgeText({ text: String(words.length) });
  chrome.action.setBadgeBackgroundColor({ color: "#555" });

  await chrome.storage.local.set({ words });
});
