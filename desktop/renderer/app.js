const elements = Object.fromEntries([
  "wordCount", "accuracy", "attemptCount", "correctCount", "dueCount", "welcome", "quiz", "loading",
  "studyHint", "startStudy", "modeLabel", "providerBadge", "question", "options", "result", "resultTitle",
  "explanation", "nextQuestion", "wordFile", "wordSearch", "wordList", "importStatus", "settingsForm",
  "provider", "baseUrl", "model", "apiKey", "additionalParams", "testProvider", "settingsStatus"
].map(id => [id, document.getElementById(id)]));

let state = { words: [], progress: {}, settings: {} };
let currentQuiz = null;

const modeNames = {
  situation: "状況 → 単語",
  distinction: "似た語の使い分け",
  misuse: "誤用判定",
  cloze: "穴埋め"
};

document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item === button));
    document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));
    document.getElementById(`${button.dataset.view}View`).classList.add("active");
  });
});

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.style.color = isError ? "#9b4545" : "";
}

function updateStats() {
  const entries = Object.values(state.progress || {});
  const attempts = entries.reduce((sum, item) => sum + (item.attempts || 0), 0);
  const correct = entries.reduce((sum, item) => sum + (item.correct || 0), 0);
  const due = state.words.filter(word => {
    const item = state.progress[word.id];
    return !item?.dueAt || Date.parse(item.dueAt) <= Date.now();
  }).length;
  elements.wordCount.textContent = String(state.words.length);
  elements.attemptCount.textContent = String(attempts);
  elements.correctCount.textContent = String(correct);
  elements.dueCount.textContent = String(due);
  elements.accuracy.textContent = attempts ? `${Math.round(correct / attempts * 100)}%` : "—";
  elements.startStudy.disabled = state.words.length < 2;
  elements.studyHint.textContent = state.words.length < 2 ? "単語画面から2語以上を読み込んでください。" : "";
}

function renderWords() {
  const query = elements.wordSearch.value.trim().toLocaleLowerCase();
  const words = state.words.filter(entry => `${entry.word} ${entry.translated}`.toLocaleLowerCase().includes(query));
  elements.wordList.replaceChildren();
  if (!words.length) {
    const empty = document.createElement("p");
    empty.className = "notice";
    empty.textContent = state.words.length ? "一致する単語はありません。" : "単語はまだありません。CSV または JSON を読み込んでください。";
    elements.wordList.append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of words) {
    const row = document.createElement("div");
    row.className = "word-row";
    const word = document.createElement("strong");
    word.textContent = entry.word;
    const translation = document.createElement("span");
    translation.textContent = entry.translated || "意味なし";
    const date = document.createElement("time");
    date.textContent = new Date(entry.timestamp).toLocaleDateString();
    row.append(word, translation, date);
    fragment.append(row);
  }
  elements.wordList.append(fragment);
}

function fillSettings() {
  elements.provider.value = state.settings.provider || "openai-compatible";
  elements.baseUrl.value = state.settings.baseUrl || "http://127.0.0.1:3000/api";
  elements.model.value = state.settings.model || "";
  elements.additionalParams.value = state.settings.additionalParams || "{}";
  elements.apiKey.value = "";
  elements.apiKey.placeholder = state.settings.hasApiKey ? "保存済み（変更時だけ入力）" : "OpenWebUI の API キー";
}

async function load() {
  state = await window.wordbook.load();
  updateStats();
  renderWords();
  fillSettings();
}

elements.wordSearch.addEventListener("input", renderWords);
elements.wordFile.addEventListener("change", async () => {
  const file = elements.wordFile.files?.[0];
  if (!file) return;
  setStatus(elements.importStatus, "読み込んでいます…");
  try {
    const result = await window.wordbook.importWords({ name: file.name, text: await file.text() });
    state.words = result.words;
    updateStats();
    renderWords();
    setStatus(elements.importStatus, `${result.parsedCount}語を解析し、${result.importedCount}語を追加しました（合計${result.words.length}語）。`);
  } catch (error) {
    setStatus(elements.importStatus, error.message, true);
  } finally {
    elements.wordFile.value = "";
  }
});

function showLoading() {
  elements.welcome.hidden = true;
  elements.quiz.hidden = true;
  elements.loading.hidden = false;
  elements.loading.style.display = "block";
}

async function generateQuiz() {
  showLoading();
  try {
    const response = await window.wordbook.generateQuiz();
    currentQuiz = response.quiz;
    elements.modeLabel.textContent = modeNames[currentQuiz.mode] || currentQuiz.mode;
    elements.providerBadge.textContent = response.providerUsed ? "AI生成" : "オフライン問題";
    elements.providerBadge.title = response.warning || "";
    elements.question.textContent = currentQuiz.prompt;
    elements.result.hidden = true;
    elements.options.replaceChildren();
    currentQuiz.options.forEach((option, index) => {
      const button = document.createElement("button");
      button.className = "option";
      button.textContent = option;
      button.addEventListener("click", () => answerQuestion(index));
      elements.options.append(button);
    });
    elements.quiz.hidden = false;
  } catch (error) {
    elements.welcome.hidden = false;
    setStatus(elements.studyHint, error.message, true);
  } finally {
    elements.loading.hidden = true;
    elements.loading.style.display = "none";
  }
}

async function answerQuestion(selectedIndex) {
  const correct = selectedIndex === currentQuiz.answerIndex;
  const buttons = [...elements.options.querySelectorAll("button")];
  buttons.forEach((button, index) => {
    button.disabled = true;
    if (index === currentQuiz.answerIndex) button.classList.add("correct");
    if (index === selectedIndex && !correct) button.classList.add("incorrect");
  });
  elements.resultTitle.textContent = correct ? "正解です" : `正解は ${currentQuiz.options[currentQuiz.answerIndex]}`;
  elements.explanation.textContent = currentQuiz.explanation;
  elements.result.hidden = false;
  try {
    state.progress = await window.wordbook.recordAnswer({ wordId: currentQuiz.wordId, correct });
    updateStats();
  } catch (error) {
    setStatus(elements.explanation, `結果を保存できませんでした: ${error.message}`, true);
  }
}

elements.startStudy.addEventListener("click", generateQuiz);
elements.nextQuestion.addEventListener("click", generateQuiz);

function settingsPayload() {
  return {
    provider: elements.provider.value,
    baseUrl: elements.baseUrl.value,
    model: elements.model.value,
    apiKey: elements.apiKey.value,
    additionalParams: elements.additionalParams.value
  };
}

elements.settingsForm.addEventListener("submit", async event => {
  event.preventDefault();
  setStatus(elements.settingsStatus, "保存しています…");
  try {
    state.settings = await window.wordbook.saveSettings(settingsPayload());
    fillSettings();
    setStatus(elements.settingsStatus, "設定を保存しました。");
  } catch (error) {
    setStatus(elements.settingsStatus, error.message, true);
  }
});

elements.testProvider.addEventListener("click", async () => {
  elements.testProvider.disabled = true;
  setStatus(elements.settingsStatus, "接続を確認しています…");
  try {
    const result = await window.wordbook.testProvider(settingsPayload());
    const modelStatus = elements.model.value && !result.selectedAvailable ? " 指定モデルは一覧にありません。" : "";
    setStatus(elements.settingsStatus, `接続できました。${result.models.length}モデルを確認しました。${modelStatus}`, Boolean(modelStatus));
  } catch (error) {
    setStatus(elements.settingsStatus, error.message, true);
  } finally {
    elements.testProvider.disabled = false;
  }
});

load().catch(error => {
  setStatus(elements.studyHint, `起動データを読み込めませんでした: ${error.message}`, true);
});
