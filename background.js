// URL of the Google Apps Script web app used to store and retrieve word entries
const GAS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzwBFYBSNEYKpnMfaibPslA3fiiEGsyQ48f5_TcaUtlHnLLfslCzwuZ9STiRoFAeZyz/exec";

// When the extension is installed, create a context menu item
// and pull any existing word entries from the remote spreadsheet.
chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: "add-word",
    title: "単語帳に追加",
    contexts: ["selection"]
  });
  await pullFromSpreadsheet();
});

// Handle clicks on the context menu. When the user selects text and
// chooses "add-word", create a new entry and save it locally, then
// attempt to sync it to the remote spreadsheet.
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "add-word") return;

  // Get the selected text and normalize
  const word = info.selectionText?.trim();
  if (!word) return;

  // Build a new entry for the selected word
  const entry = {
    id: crypto.randomUUID(), // unique local identifier
    word,
    timestamp: new Date().toISOString(), // time added/modified
    url: info.pageUrl, // page where word was found
    domain: new URL(info.pageUrl).hostname, // domain of the page
    synced: false // whether this entry has been pushed to remote
  };

  // Load existing words from local storage and merge with new entry
  const { words = [] } =
    await chrome.storage.local.get("words");
  const merged = mergeWords(words, [entry]);

  // Update the extension action badge to show current count
  chrome.action.setBadgeText({ text: String(words.length) });
  chrome.action.setBadgeBackgroundColor({ color: "#555" });

  // Save merged list to local storage and try to sync the new item
  await chrome.storage.local.set({ words: merged });
  const saved = merged.find(w => w.word === entry.word);
  await trySync(saved, words);
});

// Attempt to send a single entry to the remote Google Apps Script.
// If successful, mark the entry as synced and update local storage.
async function trySync(entry, words) {
  try {
    entry.timestamp = new Date().toISOString();
    await fetch(GAS_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry)
    });
    // Mark as synced so we don't retry repeatedly
    entry.synced = true;
    await chrome.storage.local.set({ words });
  } catch (e) {
    // Network or server error — leave synced as false to retry later
    console.log(e);
  }
};
// When the browser starts, restore badge count, pull remote data,
// and attempt to sync any entries that previously failed to sync.
chrome.runtime.onStartup.addListener(async () => {
  const { words = [] } =
    await chrome.storage.local.get("words");
  chrome.action.setBadgeText({ text: String(words.length) });
  chrome.action.setBadgeBackgroundColor({ color: "#555" });
  await pullFromSpreadsheet();
  await syncUnsynced();
});

// Find any locally stored entries that are not marked synced and
// attempt to POST them to the remote endpoint. On success, mark
// each entry as synced and save the updated list locally.
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
    } catch { }
  }

  await chrome.storage.local.set({ words });
}

// Pull the list of words from the remote spreadsheet (via GAS). Merge
// remote entries with local entries, preferring the more recent
// timestamp for each word, but preserve the local `id` when present.
async function pullFromSpreadsheet() {
  const res = await fetch(GAS_WEBAPP_URL);
  const remote = await res.json();

  const { words = [] } =
    await chrome.storage.local.get("words");

  // Create a map of local words keyed by the word string
  const localMap = new Map(
    words.map(w => [w.word, w])
  );

  for (const r of remote) {
    const local = localMap.get(r.word);

    if (!local) {
      // Remote word doesn't exist locally — keep remote version
      localMap.set(r.word, r);
      continue;
    }

    // If remote is newer than local, merge remote fields into local
    if (new Date(r.timestamp) > new Date(local.timestamp)) {
      localMap.set(r.word, {
        ...local,
        ...r,
        id: local.id // preserve local id when updating from remote
      });
    }
  }

  const merged = [...localMap.values()];
  await chrome.storage.local.set({ words: merged });

  // Update badge to show total count after merge
  chrome.action.setBadgeText({ text: String(merged.length) });
}


// Merge two lists of word entries. For duplicate words, combine fields
// and deduplicate urls/domains. The timestamp chosen is the earliest
// of the two (the code uses Math.min), and `synced` is true only if
// both entries were synced.
function mergeWords(existing, incoming) {
  const map = new Map();

  // Add existing entries to the map keyed by word
  for (const e of existing) {
    map.set(e.word, { ...e });
  }

  // Merge incoming entries into the map
  for (const e of incoming) {
    if (map.has(e.word)) {
      const prev = map.get(e.word);

      map.set(e.word, {
        ...prev,
        // Keep the earliest timestamp (as implemented by Math.min)
        timestamp: new Date(
          Math.min(
            new Date(prev.timestamp),
            new Date(e.timestamp)
          )
        ).toISOString(),
        // Combine and deduplicate URLs and domains
        url: Array.from(
          new Set([prev.url, e.url])
        ).join(", "),
        domain: Array.from(
          new Set([prev.domain, e.domain])
        ).join(", "),
        // Only mark synced if both sides are synced
        synced: prev.synced && e.synced
      });
    } else {
      map.set(e.word, { ...e });
    }
  }

  return Array.from(map.values());
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "ADD_WORD") {
    (async () => {
      const entry = {
        id: crypto.randomUUID(),
        word: request.word,
        timestamp: new Date().toISOString(),
        url: request.url || "",
        domain: request.domain || "Gemini Search",
        synced: false
      };
      
      const { words = [] } = await chrome.storage.local.get("words");
      const merged = mergeWords(words, [entry]);
      
      chrome.action.setBadgeText({ text: String(merged.length) });
      chrome.action.setBadgeBackgroundColor({ color: "#555" });
      
      await chrome.storage.local.set({ words: merged });
      const saved = merged.find(w => w.word === entry.word);
      await trySync(saved, merged);
      
      sendResponse({ success: true });
    })();
    return true; // Keep message channel open for async response
  }
});

