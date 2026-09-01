// == CONFIGURATION ==
// Production URL (accessible to anyone, avoids multi-login bugs via credentials: omit)
const GAS_PROD_URL = "https://script.google.com/macros/s/AKfycbzVRYJuVPTuwdj7ola2_oXwL5cgPaCLF-S90mQTZhmUdWhEFfLxVl6RotMUcatHy9En/exec";

// Test Deployment URL (requires YOUR Google account authentication to access)
// Paste your /dev URL here
const GAS_TEST_URL = "https://script.google.com/macros/s/AKfycbyoXRahtr8FgY1HuRJiT5vc96URpB7pVAs5nXYV68o/dev";

// Change this to GAS_TEST_URL when working on this branch
const GAS_WEBAPP_URL = GAS_TEST_URL;

// Test deployments (/dev) require your Google Login. 
// Production deployments (/exec) with "Anyone" access need to omit credentials to avoid multi-login crashes.
const FETCH_CREDENTIALS = GAS_WEBAPP_URL.endsWith('/dev') ? "include" : "omit";

const DELETED_WORDS_KEY = "deletedWordKeys";
const PENDING_REMOTE_DELETES_KEY = "pendingRemoteDeletes";
let wordMutationQueue = Promise.resolve();

function runWordMutation(task) {
  const operation = wordMutationQueue.then(task, task);
  wordMutationQueue = operation.catch(() => {});
  return operation;
}

function normalizeWordKey(word) {
  return String(word || "").normalize("NFKC").trim().toLocaleLowerCase();
}

async function getDeletedWordKeys() {
  const data = await chrome.storage.local.get(DELETED_WORDS_KEY);
  return new Set(Array.isArray(data[DELETED_WORDS_KEY]) ? data[DELETED_WORDS_KEY] : []);
}

function clearDeletedWordKey(word) {
  return runWordMutation(async () => {
    const deletedKeys = await getDeletedWordKeys();
    const key = normalizeWordKey(word);
    if (!deletedKeys.delete(key)) return;
    await chrome.storage.local.set({ [DELETED_WORDS_KEY]: [...deletedKeys] });
  });
}

function saveWords(words) {
  return runWordMutation(async () => {
    const deletedKeys = await getDeletedWordKeys();
    const filtered = words.filter(w => !deletedKeys.has(normalizeWordKey(w.word)));
    await chrome.storage.local.set({ words: filtered });
    return filtered;
  });
}

function deleteWords(entries) {
  return runWordMutation(async () => {
    const targets = Array.isArray(entries) ? entries : [];
    const ids = new Set(targets.map(entry => entry.id).filter(Boolean));
    const keys = new Set(targets.map(entry => normalizeWordKey(entry.word)).filter(Boolean));
    const deletedKeys = await getDeletedWordKeys();
    keys.forEach(key => deletedKeys.add(key));

    const { words = [] } = await chrome.storage.local.get("words");
    const filtered = words.filter(word => {
      if (word.id && ids.has(word.id)) return false;
      return !keys.has(normalizeWordKey(word.word));
    });

    const pendingData = await chrome.storage.local.get(PENDING_REMOTE_DELETES_KEY);
    const existingPending = Array.isArray(pendingData[PENDING_REMOTE_DELETES_KEY])
      ? pendingData[PENDING_REMOTE_DELETES_KEY]
      : [];
    const pendingMap = new Map();
    for (const entry of [...existingPending, ...targets]) {
      const identity = entry.id
        ? `id:${entry.id}`
        : `word:${normalizeWordKey(entry.word)}`;
      if (identity !== "word:") {
        pendingMap.set(identity, { id: entry.id || "", word: entry.word || "" });
      }
    }

    await chrome.storage.local.set({
      words: filtered,
      [DELETED_WORDS_KEY]: [...deletedKeys],
      [PENDING_REMOTE_DELETES_KEY]: [...pendingMap.values()]
    });
    await chrome.action.setBadgeText({ text: filtered.length ? String(filtered.length) : "" });
    return words.length - filtered.length;
  });
}

async function syncPendingDeletes() {
  const data = await chrome.storage.local.get(PENDING_REMOTE_DELETES_KEY);
  const pending = Array.isArray(data[PENDING_REMOTE_DELETES_KEY])
    ? data[PENDING_REMOTE_DELETES_KEY]
    : [];
  if (pending.length === 0) return true;

  try {
    await fetch(GAS_WEBAPP_URL, {
      method: "POST",
      credentials: FETCH_CREDENTIALS,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "delete",
        entries: pending
      })
    }).then(async response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const result = await response.json().catch(() => null);
      if (result?.ok === false || result?.success === false) {
        throw new Error(result.error || "remote deletion failed");
      }
    });
    const sentIdentities = new Set(pending.map(entry => entry.id
      ? `id:${entry.id}`
      : `word:${normalizeWordKey(entry.word)}`));
    await runWordMutation(async () => {
      const latestData = await chrome.storage.local.get(PENDING_REMOTE_DELETES_KEY);
      const latest = Array.isArray(latestData[PENDING_REMOTE_DELETES_KEY])
        ? latestData[PENDING_REMOTE_DELETES_KEY]
        : [];
      const remaining = latest.filter(entry => {
        const identity = entry.id
          ? `id:${entry.id}`
          : `word:${normalizeWordKey(entry.word)}`;
        return !sentIdentities.has(identity);
      });
      await chrome.storage.local.set({ [PENDING_REMOTE_DELETES_KEY]: remaining });
    });
    return true;
  } catch (error) {
    console.warn("syncPendingDeletes: failed", error);
    return false;
  }
}

/* =========================
   Gemini Translation
========================= */

// Read GEMINI_API_KEY from the local .env file bundled with the extension.
// Handles bare format: GEMINI_API_KEY=AIza... (no quotes required)
async function getApiKey() {
  try {
    const envRes = await fetch(chrome.runtime.getURL('.env'));
    if (!envRes.ok) {
      console.error("background: .env not accessible, HTTP", envRes.status);
      return null;
    }
    const envText = await envRes.text();
    // Match key=value with optional surrounding whitespace/quotes on value
    const match = envText.match(/^GEMINI_API_KEY=([^\r\n]+)/m);
    return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : null;
  } catch (e) {
    console.error("background: failed to read API key from .env:", e);
    return null;
  }
}

// Call the Gemini API to produce a nuanced Japanese translation for an English word.
// Returns a plain-text string (may contain newlines and bullets), or null on failure.
async function translateWordWithGemini(word) {
  const apiKey = await getApiKey();
  if (!apiKey) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
  const prompt =
    `Translate the English word "${word}" to Japanese in 2-3 words maximum.\n` +
    `Output ONLY the Japanese translation. No explanations, no romanization, no punctuation other than 、 between alternatives.\n` +
    `Example: "import" → 輸入する、取り込む`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    if (!response.ok) {
      console.warn("translateWordWithGemini: HTTP", response.status);
      return null;
    }
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? text.trim() : null;
  } catch (e) {
    console.error("translateWordWithGemini: fetch failed:", e);
    return null;
  }
}

// When the extension is installed, create a context menu item
// and pull any existing word entries from the remote spreadsheet.
chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: "add-word",
    title: "単語帳に追加",
    contexts: ["selection"]
  });
  await syncPendingDeletes();
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

  // Fetch a nuanced Gemini translation before saving
  const translated = await translateWordWithGemini(word);

  // Build a new entry for the selected word
  const entry = {
    id: crypto.randomUUID(), // unique local identifier
    word,
    timestamp: new Date().toISOString(), // time added/modified
    url: info.pageUrl, // page where word was found
    domain: new URL(info.pageUrl).hostname, // domain of the page
    translated: translated ?? "", // Gemini translation (null → empty string)
    synced: false // whether this entry has been pushed to remote
  };

  await clearDeletedWordKey(entry.word);

  // Load existing words from local storage and merge with new entry
  const { words = [] } =
    await chrome.storage.local.get("words");
  const merged = mergeWords(words, [entry]);

  // Update the extension action badge to show current count
  chrome.action.setBadgeText({ text: String(words.length) });
  chrome.action.setBadgeBackgroundColor({ color: "#555" });

  // Save merged list to local storage and try to sync the new item
  const savedWords = await saveWords(merged);
  const saved = savedWords.find(w => w.word === entry.word);
  await trySync(saved, savedWords);
});

// Attempt to send a single entry to the remote Google Apps Script.
// Uses no-cors mode because GAS does not return CORS headers for POST,
// which causes some browsers to block the request. In no-cors mode we
// cannot read the response, so we optimistically mark synced=true.
async function trySync(entry, words) {
  if (!entry) return;
  try {
    entry.timestamp = new Date().toISOString();
    await fetch(GAS_WEBAPP_URL, {
      method: "POST",
      mode: "no-cors",
      credentials: FETCH_CREDENTIALS,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry)
    });
    // Mark as synced so we don't retry repeatedly
    entry.synced = true;
    await saveWords(words);
  } catch (e) {
    // Network or server error — leave synced as false to retry later
    console.warn("trySync failed:", e);
  }
}
// When the browser starts, restore badge count, pull remote data,
// and attempt to sync any entries that previously failed to sync.
chrome.runtime.onStartup.addListener(async () => {
  const { words = [] } =
    await chrome.storage.local.get("words");
  chrome.action.setBadgeText({ text: String(words.length) });
  chrome.action.setBadgeBackgroundColor({ color: "#555" });
  await syncPendingDeletes();
  await pullFromSpreadsheet();
  await syncUnsynced();
});

// Find any locally stored entries that are not marked synced and
// attempt to POST them to the remote endpoint. On success, mark
// each entry as synced and save the updated list locally.
async function syncUnsynced() {
  const { words = [] } = await chrome.storage.local.get("words");
  const unsynced = words.filter(x => !x.synced);
  if (unsynced.length === 0) return;

  for (const w of unsynced) {
    try {
      await fetch(GAS_WEBAPP_URL, {
        method: "POST",
        mode: "no-cors",
        credentials: FETCH_CREDENTIALS,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(w)
      });
      w.synced = true;
    } catch (e) {
      console.warn("syncUnsynced: failed for", w.word, e);
    }
  }

  await saveWords(words);
}

// Pull the list of words from the remote spreadsheet (via GAS). Merge
// remote entries with local entries, preferring the more recent
// timestamp for each word, but preserve the local `id` when present.
async function pullFromSpreadsheet() {
  let remote;
  try {
    const res = await fetch(GAS_WEBAPP_URL, {
      cache: "no-store",
      credentials: FETCH_CREDENTIALS
    });
    const contentType = res.headers.get("content-type") || "";
    if (!res.ok || !contentType.includes("application/json")) {
      console.warn("pullFromSpreadsheet: unexpected response", res.status, contentType);
      return;
    }
    remote = await res.json();
  } catch (e) {
    console.warn("pullFromSpreadsheet: fetch failed", e);
    return;
  }

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

    if (new Date(r.timestamp) > new Date(local.timestamp)) {
      // Remote is newer — merge all remote fields, preserving local id
      localMap.set(r.word, {
        ...local,
        ...r,
        id: local.id
      });
    } else {
      // Local is newer — but always pull `translated` from remote,
      // since it is computed by Google Sheets (GOOGLETRANSLATE) and
      // is never set locally.
      if (r.translated) {
        localMap.set(r.word, {
          ...local,
          translated: r.translated
        });
      }
    }
  }

  const merged = await saveWords([...localMap.values()]);

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
      // Use the translation passed from the caller, or fetch a fresh Gemini one
      let translated = request.translated || null;
      if (!translated) {
        translated = await translateWordWithGemini(request.word);
      }

      const entry = {
        id: crypto.randomUUID(),
        word: request.word,
        timestamp: new Date().toISOString(),
        url: request.url || "",
        domain: request.domain || "Gemini Search",
        translated: translated ?? "",
        synced: false
      };

      await clearDeletedWordKey(entry.word);

      const { words = [] } = await chrome.storage.local.get("words");
      const merged = mergeWords(words, [entry]);

      chrome.action.setBadgeText({ text: String(merged.length) });
      chrome.action.setBadgeBackgroundColor({ color: "#555" });

      const savedWords = await saveWords(merged);
      const saved = savedWords.find(w => w.word === entry.word);
      await trySync(saved, savedWords);

      sendResponse({ success: true });
    })();
    return true; // Keep message channel open for async response
  }

  if (request.type === "SYNC_NOW") {
    (async () => {
      await syncPendingDeletes();
      await pullFromSpreadsheet();
      await syncUnsynced();
      sendResponse({ success: true });
    })();
    return true;
  }

  if (request.type === "DELETE_WORDS") {
    (async () => {
      try {
        const removedCount = await deleteWords(request.entries);
        const remoteSynced = await syncPendingDeletes();
        sendResponse({ success: true, removedCount, remoteSynced });
      } catch (error) {
        console.error("DELETE_WORDS failed:", error);
        sendResponse({ success: false, reason: error.message });
      }
    })();
    return true;
  }

  // Re-translate a single word by name.
  if (request.type === "RETRANSLATE_ONE") {
    (async () => {
      const { words = [] } = await chrome.storage.local.get("words");
      const w = words.find(x => x.word === request.word);
      if (!w) { sendResponse({ success: false, reason: "not found" }); return; }

      const translated = await translateWordWithGemini(w.word);
      if (!translated) { sendResponse({ success: false, reason: "api failed" }); return; }

      w.translated = translated;
      w.synced = false;
      const savedWords = await saveWords(words);
      const saved = savedWords.find(x => x.id === w.id || x.word === w.word);
      await trySync(saved, savedWords);

      sendResponse({ success: true });
    })();
    return true;
  }
});
