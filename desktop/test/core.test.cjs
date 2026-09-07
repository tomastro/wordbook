const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeWordKey,
  mergeWords,
  parseWordImport,
  recordAnswer,
  validateQuiz
} = require("../lib/core.cjs");

test("word keys match extension NFKC and case-insensitive behavior", () => {
  assert.equal(normalizeWordKey(" Ｔｅｓｔ "), "test");
});

test("CSV exported by the extension is imported and deduplicated", () => {
  const csv = '\uFEFFWord,Translation,Domain,Timestamp\r\n"Acquire","獲得する","example.com","2026-09-01T00:00:00.000Z"\r\n"acquire","身につける","news.test","2026-09-02T00:00:00.000Z"\r\n';
  const words = parseWordImport("wordbook.csv", csv);
  assert.equal(words.length, 1);
  assert.equal(words[0].translated, "身につける");
  assert.match(words[0].domain, /example\.com/);
});

test("a practical 600-word export is accepted", () => {
  const rows = Array.from({ length: 600 }, (_, index) => `word-${index},意味${index},example.com,2026-09-01T00:00:00.000Z`);
  const words = parseWordImport("wordbook-600.csv", `Word,Translation,Domain,Timestamp\n${rows.join("\n")}`);
  assert.equal(words.length, 600);
});

test("merge preserves legacy word entry fields", () => {
  const words = mergeWords([], [{ id: "one", word: "nuance", translated: "微妙な差", timestamp: "2026-09-01T00:00:00Z", synced: true }]);
  assert.equal(words[0].id, "one");
  assert.equal(words[0].synced, true);
});

test("progress updates attempts and schedules a correct answer", () => {
  const progress = recordAnswer({}, "one", true);
  assert.equal(progress.one.attempts, 1);
  assert.equal(progress.one.correct, 1);
  assert.equal(progress.one.streak, 1);
  assert.ok(Date.parse(progress.one.dueAt) >= Date.now());
});

test("AI quiz must answer with one of the supplied words", () => {
  const words = [{ id: "one", word: "acquire" }, { id: "two", word: "obtain" }];
  const quiz = validateQuiz({ mode: "distinction", prompt: "p", options: ["acquire", "obtain"], answerIndex: 1, answerWord: "obtain", explanation: "e" }, words);
  assert.equal(quiz.wordId, "two");
  assert.throws(() => validateQuiz({ mode: "cloze", prompt: "p", options: ["x", "y"], answerIndex: 0, answerWord: "x" }, words));
});
