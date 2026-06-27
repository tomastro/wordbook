const list = document.getElementById("wordList");
const count = document.getElementById("count");
const showBtn = document.getElementById("show");

// Returns true if a translation string looks like a legacy/mechanical one
// (GOOGLETRANSLATE output: single word/phrase, no bullets or newlines)
function isStale(t) {
  return !t || t.startsWith('=') || (!t.includes('\n') && !t.includes('\u2022'));
}

async function loadWords() {
  const { words = [] } = await chrome.storage.local.get("words");
  list.innerHTML = "";
  count.textContent = `${words.length} words`;

  for (const w of words.slice().reverse()) {
    const li = document.createElement("li");
    const url = "gemini.html?word=" + encodeURIComponent(w.word);
    const stale = isStale(w.translated);
    li.innerHTML = `
      <div class="word-row">
        <label>
          <input type="checkbox" data-word="${w.word}">
          <a href="${url}" target="_blank">${w.word}</a>
        </label>
        <div class="word-row-right">
          <small class="word-meta">${w.domain} · ${new Date(w.timestamp).toLocaleDateString()}</small>
          <button class="word-fix-btn${stale ? ' stale' : ''}" data-word="${w.word}" title="Re-translate with Gemini">✦</button>
        </div>
      </div>
      ${w.translated ? `<div class="word-translation">${w.translated}</div>` : ""}
      <small class="word-time">${new Date(w.timestamp).toLocaleString()}</small>
    `;

    list.appendChild(li);
  }
}

showBtn.addEventListener("click", async () => {
  if (!list.hidden) {
    list.hidden = true;
    showBtn.textContent = "単語を表示";
    return;
  }

  await loadWords();
  list.hidden = false;
  showBtn.textContent = "隠す";
});

document.getElementById("search").addEventListener("input", async (e) => {
  list.hidden = false;
  showBtn.textContent = "隠す";
  await loadWords();
  const q = e.target.value.toLowerCase();
  [...document.querySelectorAll("#wordList li")].forEach(li => {
    li.hidden = !li.textContent.toLowerCase().includes(q);
  });
});

document.getElementById("search").addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const q = e.target.value.toLowerCase();

    // Open the tab
    const win = window.open("gemini.html?word=" + encodeURIComponent(q), "_blank");
  }
});


document.getElementById("remove").addEventListener("click", async () => {
  const checked = [...document.querySelectorAll("input[type=checkbox]:checked")];
  if (!checked.length) return;

  const removeWords = checked.map(c => c.dataset.word);

  const { words = [] } = await chrome.storage.local.get("words");

  const filtered = words.filter(w => !removeWords.includes(w.word));

  await chrome.storage.local.set({ words: filtered });

  await loadWords();
});

// Focus the search box when the popup opens
document.getElementById("search").focus();

/* ── Per-word fix button (event delegation) ── */
list.addEventListener("click", async (e) => {
  const btn = e.target.closest(".word-fix-btn");
  if (!btn) return;

  const word = btn.dataset.word;
  if (!word) return;

  btn.disabled = true;
  btn.textContent = "…";

  try {
    const res = await chrome.runtime.sendMessage({ type: "RETRANSLATE_ONE", word });
    if (res?.success) {
      btn.textContent = "✓";
      btn.classList.remove("stale");
      // Refresh just the translation block in this li
      const li = btn.closest("li");
      const { words = [] } = await chrome.storage.local.get("words");
      const updated = words.find(w => w.word === word);
      if (updated?.translated) {
        let block = li.querySelector(".word-translation");
        if (!block) {
          block = document.createElement("div");
          block.className = "word-translation";
          li.querySelector(".word-row").after(block);
        }
        block.textContent = updated.translated;
      }
    } else {
      btn.textContent = "!";
    }
  } catch (err) {
    btn.textContent = "!";
    console.error("word fix failed:", err);
  } finally {
    btn.disabled = false;
    setTimeout(() => { btn.textContent = "✦"; }, 3000);
  }
});
