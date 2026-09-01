/* ================================================================
   Word Collector — Popup Logic
   ================================================================ */

const list = document.getElementById("wordList");
const countText = document.getElementById("countText");
const searchInput = document.getElementById("search");
const clearSearchBtn = document.getElementById("clearSearch");
const emptyState = document.getElementById("emptyState");
const emptyTitle = document.getElementById("emptyTitle");
const emptyDesc = document.getElementById("emptyDesc");
const removeBtn = document.getElementById("remove");
const removeLabel = document.getElementById("removeLabel");
const exportBtn = document.getElementById("export");
const selectionStatus = document.getElementById("selectionStatus");
const feedback = document.getElementById("feedback");
let totalWords = 0;

/* ── Environment Helper ── */
const isExtension = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

// Mock data for previewing in standalone browser
const mockWords = [
  { word: "serendipity", translated: "偶然の幸運、思いがけない発見", domain: "wikipedia.org", timestamp: new Date().toISOString() },
  { word: "ephemeral", translated: "つかの間の、はかない", domain: "medium.com", timestamp: new Date(Date.now() - 3600000).toISOString() },
  { word: "solitude", translated: "孤独、独居", domain: "nytimes.com", timestamp: new Date(Date.now() - 86400000).toISOString() }
];

/* ── Word helpers ── */

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

// Returns true if a translation string looks like a legacy/mechanical one
// (GOOGLETRANSLATE output: single word/phrase, no bullets or newlines)
function isStale(t) {
  return !t || t.startsWith('=') || (!t.includes('\n') && !t.includes('\u2022'));
}

async function getWords() {
  if (isExtension) {
    const data = await chrome.storage.local.get("words");
    return data.words || [];
  } else {
    return mockWords;
  }
}

async function loadWords() {
  const words = await getWords();
  totalWords = words.length;
  list.innerHTML = "";
  if (countText) {
    countText.textContent = `${words.length}語`;
  }
  exportBtn.disabled = words.length === 0;

  const reversed = words.slice().reverse();
  for (let i = 0; i < reversed.length; i++) {
    const w = reversed[i];
    const li = document.createElement("li");
    const url = "gemini.html?word=" + encodeURIComponent(w.word);
    const stale = isStale(w.translated);

    li.innerHTML = `
      <div class="word-row">
        <label>
          <input type="checkbox" data-id="${escapeHtml(w.id || '')}" data-word="${escapeHtml(w.word)}" aria-label="${escapeHtml(w.word)}を選択">
          <a href="${url}" target="_blank">${escapeHtml(w.word)}</a>
        </label>
        <div class="word-row-right">
          <small class="word-meta">${escapeHtml(w.domain || 'web')} · ${new Date(w.timestamp).toLocaleDateString()}</small>
          <button class="word-fix-btn${stale ? ' stale' : ''}" data-word="${escapeHtml(w.word)}" title="意味を再生成" aria-label="${escapeHtml(w.word)}の意味を再生成">↻</button>
        </div>
      </div>
      ${w.translated ? `<div class="word-translation">${escapeHtml(w.translated)}</div>` : ""}
      <small class="word-time">${new Date(w.timestamp).toLocaleString()}</small>
    `;

    list.appendChild(li);
  }

  filterWords();
  updateSelection();
}

function filterWords() {
  const q = searchInput.value.trim().toLowerCase();
  clearSearchBtn.hidden = !searchInput.value;

  const items = [...document.querySelectorAll("#wordList li")];
  let visibleCount = 0;

  items.forEach(li => {
    const match = li.textContent.toLowerCase().includes(q);
    li.hidden = !match;
    if (match) visibleCount++;
  });

  if (visibleCount === 0) {
    emptyState.hidden = false;
    if (totalWords === 0) {
      emptyTitle.textContent = "単語はまだありません";
      emptyDesc.textContent = "Webページで単語を選択して右クリックすると追加できます。";
    } else {
      emptyTitle.textContent = "一致する単語がありません";
      emptyDesc.textContent = "別のキーワードを試すか、Enterで辞書を開けます。";
    }
  } else {
    emptyState.hidden = true;
  }
}

searchInput.addEventListener("input", filterWords);

clearSearchBtn.addEventListener("click", () => {
  searchInput.value = "";
  clearSearchBtn.hidden = true;
  filterWords();
  searchInput.focus();
});
searchInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const q = searchInput.value.trim().toLowerCase();
    if (q) {
      window.open("gemini.html?word=" + encodeURIComponent(q), "_blank");
    }
  }
});

function updateSelection() {
  const selectedCount = document.querySelectorAll("#wordList input[type=checkbox]:checked").length;
  removeBtn.disabled = selectedCount === 0;
  removeLabel.textContent = selectedCount ? `${selectedCount}件を削除` : "削除";
  selectionStatus.textContent = selectedCount ? `${selectedCount}件選択中` : "単語を選択して削除";
}

list.addEventListener("change", (event) => {
  if (event.target.matches('input[type="checkbox"]')) updateSelection();
});

removeBtn.addEventListener("click", async () => {
  const checked = [...document.querySelectorAll("input[type=checkbox]:checked")];
  if (!checked.length) return;

  const entries = checked.map(checkbox => ({
    id: checkbox.dataset.id || "",
    word: checkbox.dataset.word || ""
  }));

  removeBtn.disabled = true;
  removeLabel.textContent = "削除中…";
  feedback.textContent = "";

  try {
    let removedCount = 0;
    if (isExtension) {
      const response = await chrome.runtime.sendMessage({
        type: "DELETE_WORDS",
        entries
      });
      if (!response?.success) {
        throw new Error(response?.reason || "削除処理に失敗しました");
      }
      removedCount = response.removedCount ?? entries.length;
    } else {
      for (let i = mockWords.length - 1; i >= 0; i--) {
        if (entries.some(entry => entry.word === mockWords[i].word)) {
          mockWords.splice(i, 1);
          removedCount++;
        }
      }
    }

    await loadWords();
    feedback.textContent = `${removedCount}件を削除しました。`;
  } catch (error) {
    console.error("word removal failed:", error);
    feedback.textContent = "削除できませんでした。拡張機能を再読み込みして、もう一度お試しください。";
    updateSelection();
  }
});

// CSV Export feature
exportBtn.addEventListener("click", async () => {
  const words = await getWords();
  if (!words.length) return;

  let csvContent = "\uFEFFWord,Translation,Domain,Timestamp\n";
  words.forEach(w => {
    const cleanWord = `"${(w.word || '').replace(/"/g, '""')}"`;
    const cleanTrans = `"${(w.translated || '').replace(/"/g, '""')}"`;
    const cleanDomain = `"${(w.domain || '').replace(/"/g, '""')}"`;
    const cleanTime = `"${(w.timestamp || '')}"`;
    csvContent += `${cleanWord},${cleanTrans},${cleanDomain},${cleanTime}\n`;
  });

  const csvUrl = URL.createObjectURL(new Blob([csvContent], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.setAttribute("href", csvUrl);
  link.setAttribute("download", `wordbook_export_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(csvUrl);
  feedback.textContent = `${words.length}件を書き出しました。`;
});

loadWords().catch(err => {
  console.error("word list failed:", err);
  feedback.textContent = "単語を読み込めませんでした。";
});
searchInput.focus();

/* ── Per-word fix button (event delegation) ── */
list.addEventListener("click", async (e) => {
  const btn = e.target.closest(".word-fix-btn");
  if (!btn) return;

  const word = btn.dataset.word;
  if (!word) return;

  btn.disabled = true;
  btn.textContent = "…";

  try {
    if (isExtension) {
      const res = await chrome.runtime.sendMessage({ type: "RETRANSLATE_ONE", word });
      if (res?.success) {
        btn.textContent = "✓";
        btn.classList.remove("stale");
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
        feedback.textContent = `${word}の意味を更新しました。`;
      } else {
        btn.textContent = "!";
        feedback.textContent = `${word}の意味を更新できませんでした。`;
      }
    } else {
      // Mock retranslation
      await new Promise(r => setTimeout(r, 1000));
      btn.textContent = "✓";
      btn.classList.remove("stale");
      const li = btn.closest("li");
      let block = li.querySelector(".word-translation");
      if (!block) {
        block = document.createElement("div");
        block.className = "word-translation";
        li.querySelector(".word-row").after(block);
      }
      block.textContent = "✦ 再翻訳されたモック意味 ✦";
    }
  } catch (err) {
    btn.textContent = "!";
    feedback.textContent = `${word}の意味を更新できませんでした。`;
    console.error("word fix failed:", err);
  } finally {
    btn.disabled = false;
    setTimeout(() => { btn.textContent = "↻"; }, 3000);
  }
});
