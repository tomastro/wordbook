const list = document.getElementById("wordList");
const count = document.getElementById("count");
const showBtn = document.getElementById("show");

async function loadWords() {
  const { words = [] } = await chrome.storage.local.get("words");
  list.innerHTML = "";
  count.textContent = `${words.length} words`;

  for (const w of words.slice().reverse()) {
    const li = document.createElement("li");
    url = "https://dictionary.cambridge.org/dictionary/english/" + encodeURIComponent(w.word);
    li.innerHTML = `
      <label>
        <input type="checkbox" data-word="${w.word}">
        <a href="${url}" target="_blank">${w.word}</a>
      </label>
      <small>${new Date(w.timestamp).toLocaleString()}</small>
      <small>
  ${w.domain} · ${new Date(w.timestamp).toLocaleDateString()}
</small>

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
    const win = window.open("https://dictionary.cambridge.org/dictionary/english/" + encodeURIComponent(q), "_blank");
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
