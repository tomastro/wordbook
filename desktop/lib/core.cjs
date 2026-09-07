const crypto = require("node:crypto");

function normalizeWordKey(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase();
}

function normalizeWord(entry) {
  const word = String(entry?.word || "").normalize("NFKC").trim();
  if (!word) return null;
  return {
    id: String(entry.id || crypto.randomUUID()),
    word,
    translated: String(entry.translated || entry.translation || "").trim(),
    domain: String(entry.domain || "desktop import").trim(),
    url: String(entry.url || "").trim(),
    timestamp: entry.timestamp && !Number.isNaN(Date.parse(entry.timestamp))
      ? new Date(entry.timestamp).toISOString()
      : new Date().toISOString(),
    synced: Boolean(entry.synced)
  };
}

function mergeWords(existing, incoming) {
  const merged = new Map();
  for (const raw of [...(existing || []), ...(incoming || [])]) {
    const entry = normalizeWord(raw);
    if (!entry) continue;
    const key = normalizeWordKey(entry.word);
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, entry);
      continue;
    }
    merged.set(key, {
      ...previous,
      ...entry,
      id: previous.id || entry.id,
      translated: entry.translated || previous.translated,
      url: [...new Set([previous.url, entry.url].filter(Boolean))].join(", "),
      domain: [...new Set([previous.domain, entry.domain].filter(Boolean))].join(", "),
      timestamp: new Date(Math.min(Date.parse(previous.timestamp), Date.parse(entry.timestamp))).toISOString(),
      synced: previous.synced && entry.synced
    });
  }
  return [...merged.values()];
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(cell);
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift().map(value => value.trim().toLocaleLowerCase());
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]))).map(rowValue => ({
    word: rowValue.word || rowValue.english || rowValue.term,
    translated: rowValue.translation || rowValue.translated || rowValue.japanese || rowValue.meaning,
    domain: rowValue.domain,
    timestamp: rowValue.timestamp,
    url: rowValue.url
  }));
}

function parseWordImport(name, text) {
  const lowerName = String(name || "").toLocaleLowerCase();
  let entries;
  if (lowerName.endsWith(".json")) {
    const parsed = JSON.parse(text);
    entries = Array.isArray(parsed) ? parsed : parsed.words;
    if (!Array.isArray(entries)) throw new Error("JSON に words 配列がありません。");
  } else {
    entries = parseCsv(text);
  }
  return mergeWords([], entries);
}

function chooseStudyWords(words, progress, count = 4) {
  const now = Date.now();
  return [...words]
    .sort((a, b) => {
      const pa = progress[a.id] || {};
      const pb = progress[b.id] || {};
      const dueA = pa.dueAt ? Date.parse(pa.dueAt) : 0;
      const dueB = pb.dueAt ? Date.parse(pb.dueAt) : 0;
      const overdueA = dueA <= now ? 0 : 1;
      const overdueB = dueB <= now ? 0 : 1;
      return overdueA - overdueB || dueA - dueB || (pa.attempts || 0) - (pb.attempts || 0);
    })
    .slice(0, Math.min(count, words.length));
}

function recordAnswer(progress, wordId, correct) {
  const current = progress[wordId] || { attempts: 0, correct: 0, streak: 0 };
  const streak = correct ? current.streak + 1 : 0;
  const intervals = [0, 1, 3, 7, 14, 30];
  const days = correct ? intervals[Math.min(streak, intervals.length - 1)] : 0;
  return {
    ...progress,
    [wordId]: {
      attempts: current.attempts + 1,
      correct: current.correct + (correct ? 1 : 0),
      streak,
      lastResult: correct,
      lastStudiedAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + days * 86400000).toISOString()
    }
  };
}

function validateQuiz(raw, allowedWords) {
  const quiz = typeof raw === "string" ? JSON.parse(raw) : raw;
  const modes = new Set(["situation", "distinction", "misuse", "cloze"]);
  if (!quiz || !modes.has(quiz.mode)) throw new Error("AI の問題形式が不正です。");
  if (!Array.isArray(quiz.options) || quiz.options.length < 2 || quiz.options.length > 5) {
    throw new Error("AI の選択肢が不正です。");
  }
  if (!Number.isInteger(quiz.answerIndex) || quiz.answerIndex < 0 || quiz.answerIndex >= quiz.options.length) {
    throw new Error("AI の正解番号が不正です。");
  }
  const answerWord = String(quiz.answerWord || quiz.options[quiz.answerIndex] || "").trim();
  const matched = allowedWords.find(entry => normalizeWordKey(entry.word) === normalizeWordKey(answerWord));
  if (!matched) throw new Error("AI の正解が学習対象の単語と一致しません。");
  return {
    mode: quiz.mode,
    prompt: String(quiz.prompt || "").trim(),
    options: quiz.options.map(option => String(option).trim()),
    answerIndex: quiz.answerIndex,
    answerWord: matched.word,
    wordId: matched.id,
    explanation: String(quiz.explanation || "").trim()
  };
}

function createFallbackQuiz(words) {
  const candidates = words.filter(entry => entry.translated);
  const selected = (candidates.length >= 2 ? candidates : words).slice(0, 4);
  if (selected.length < 2) throw new Error("出題には2語以上必要です。");
  const target = selected[0];
  return {
    mode: "situation",
    prompt: `「${target.translated || target.word}」に最も合う英単語はどれですか？`,
    options: selected.map(entry => entry.word),
    answerIndex: 0,
    answerWord: target.word,
    wordId: target.id,
    explanation: target.translated ? `${target.word}: ${target.translated}` : `${target.word} を復習しましょう。`,
    offline: true
  };
}

module.exports = {
  normalizeWordKey,
  normalizeWord,
  mergeWords,
  parseCsv,
  parseWordImport,
  chooseStudyWords,
  recordAnswer,
  validateQuiz,
  createFallbackQuiz
};
