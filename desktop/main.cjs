const { app, BrowserWindow, ipcMain, safeStorage } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const {
  mergeWords,
  parseWordImport,
  chooseStudyWords,
  recordAnswer,
  validateQuiz,
  createFallbackQuiz
} = require("./lib/core.cjs");

const DEFAULT_SETTINGS = {
  provider: "openai-compatible",
  baseUrl: "http://127.0.0.1:3000/api",
  model: "",
  additionalParams: {}
};

function dataPath(name) {
  return path.join(app.getPath("userData"), name);
}

async function readJson(name, fallback) {
  try {
    return JSON.parse(await fs.readFile(dataPath(name), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return fallback;
  }
}

async function writeJson(name, value) {
  const target = dataPath(name);
  const temporary = `${target}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, target);
}

function cleanBaseUrl(value) {
  const url = new URL(String(value || "").trim());
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("API URL は http または https を指定してください。");
  return url.toString().replace(/\/$/, "");
}

function parseAdditionalParams(value) {
  const parsed = typeof value === "string" ? JSON.parse(value || "{}") : (value || {});
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("追加パラメータは JSON オブジェクトで指定してください。");
  return parsed;
}

async function readSettings() {
  return { ...DEFAULT_SETTINGS, ...await readJson("settings.json", {}) };
}

async function readApiKey() {
  try {
    const encoded = await fs.readFile(dataPath("api-key.bin"), "utf8");
    if (!encoded || !safeStorage.isEncryptionAvailable()) return "";
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return "";
  }
}

async function saveApiKey(apiKey) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("この環境では API キーを安全に保存できません。");
  const encrypted = safeStorage.encryptString(apiKey);
  await fs.writeFile(dataPath("api-key.bin"), encrypted.toString("base64"), { encoding: "utf8", mode: 0o600 });
}

function publicSettings(settings, hasApiKey) {
  return { ...settings, additionalParams: JSON.stringify(settings.additionalParams || {}, null, 2), hasApiKey };
}

async function loadState() {
  const [words, progress, settings, apiKey] = await Promise.all([
    readJson("words.json", []),
    readJson("progress.json", {}),
    readSettings(),
    readApiKey()
  ]);
  return { words, progress, settings: publicSettings(settings, Boolean(apiKey)) };
}

async function requestProvider(settings, apiKey, endpoint, init = {}) {
  if (settings.provider !== "openai-compatible") throw new Error("未対応の AI プロバイダーです。");
  const headers = { Accept: "application/json", ...(init.headers || {}) };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(`${cleanBaseUrl(settings.baseUrl)}${endpoint}`, { ...init, headers, signal: AbortSignal.timeout(45000) });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = payload?.detail || payload?.error?.message || payload?.message || "";
    } catch {}
    throw new Error(`AI API: HTTP ${response.status}${detail ? ` - ${String(detail).slice(0, 180)}` : ""}`);
  }
  return response.json();
}

function extractJson(text) {
  const value = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI が JSON を返しませんでした。");
  return JSON.parse(value.slice(start, end + 1));
}

async function generateAiQuiz(words, progress) {
  const settings = await readSettings();
  const apiKey = await readApiKey();
  if (!settings.model) throw new Error("設定画面でモデルを指定してください。");
  const totalAttempts = Object.values(progress).reduce((sum, item) => sum + (item.attempts || 0), 0);
  const modes = ["situation", "distinction", "misuse", "cloze"];
  const requestedMode = modes[totalAttempts % modes.length];
  const vocabulary = words.map(entry => ({ word: entry.word, meaning: entry.translated || "" }));
  const prompt = [
    "あなたは日本人向けの実践的な英単語トレーナーです。",
    `出題形式は ${requestedMode}。次の語彙だけを正解候補に使い、受動的な説明ではなく判断を求める4択問題を1問作ってください。`,
    "situation=日本語の状況から最適な英単語、distinction=似た語の使い分け、misuse=英文の誤用判定、cloze=自然な英文穴埋め。",
    "JSON以外は出力しないでください。スキーマ:",
    '{"mode":"situation|distinction|misuse|cloze","prompt":"問題文","options":["選択肢"],"answerIndex":0,"answerWord":"正解の学習語","explanation":"日本語の短い解説"}',
    `語彙: ${JSON.stringify(vocabulary)}`
  ].join("\n");
  const payload = {
    ...settings.additionalParams,
    model: settings.model,
    messages: [
      { role: "system", content: "Return one valid JSON object only." },
      { role: "user", content: prompt }
    ],
    temperature: settings.additionalParams?.temperature ?? 0.5
  };
  const data = await requestProvider(settings, apiKey, "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const content = data?.choices?.[0]?.message?.content;
  return validateQuiz(extractJson(content), words);
}

function createWindow() {
  const smokeTest = process.argv.includes("--smoke-test");
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 820,
    minHeight: 620,
    backgroundColor: "#f3f2ed",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.removeMenu();
  window.loadFile(path.join(__dirname, "renderer", "index.html"));
  if (smokeTest) {
    window.webContents.once("did-finish-load", async () => {
      const ready = await window.webContents.executeJavaScript("Boolean(window.wordbook && document.getElementById('studyView'))");
      await new Promise(resolve => setTimeout(resolve, 400));
      const image = await window.webContents.capturePage();
      const outputDirectory = path.join(__dirname, "out");
      await fs.mkdir(outputDirectory, { recursive: true });
      await fs.writeFile(path.join(outputDirectory, "smoke.png"), image.toPNG());
      process.stdout.write(ready ? "Wordbook desktop smoke test: ok\n" : "Wordbook desktop smoke test: failed\n");
      app.exit(ready ? 0 : 1);
    });
  } else {
    window.once("ready-to-show", () => window.show());
  }
}

app.whenReady().then(() => {
  ipcMain.handle("app:load", () => loadState());

  ipcMain.handle("words:import", async (_event, payload) => {
    const imported = parseWordImport(payload?.name, payload?.text);
    const existing = await readJson("words.json", []);
    const words = mergeWords(existing, imported);
    await writeJson("words.json", words);
    return { words, importedCount: words.length - existing.length, parsedCount: imported.length };
  });

  ipcMain.handle("settings:save", async (_event, input) => {
    const settings = {
      provider: "openai-compatible",
      baseUrl: cleanBaseUrl(input.baseUrl),
      model: String(input.model || "").trim(),
      additionalParams: parseAdditionalParams(input.additionalParams)
    };
    await writeJson("settings.json", settings);
    if (typeof input.apiKey === "string" && input.apiKey.length) await saveApiKey(input.apiKey);
    return publicSettings(settings, Boolean((await readApiKey())));
  });

  ipcMain.handle("provider:test", async (_event, input) => {
    const saved = await readSettings();
    const settings = {
      ...saved,
      baseUrl: cleanBaseUrl(input.baseUrl || saved.baseUrl),
      model: String(input.model || saved.model || "").trim(),
      additionalParams: parseAdditionalParams(input.additionalParams ?? saved.additionalParams)
    };
    const apiKey = input.apiKey || await readApiKey();
    const data = await requestProvider(settings, apiKey, "/models");
    const models = Array.isArray(data?.data) ? data.data.map(item => item.id).filter(Boolean) : [];
    return { ok: true, models, selectedAvailable: !settings.model || models.includes(settings.model) };
  });

  ipcMain.handle("quiz:generate", async () => {
    const [allWords, progress] = await Promise.all([readJson("words.json", []), readJson("progress.json", {})]);
    if (allWords.length < 2) throw new Error("まず CSV または JSON から2語以上を読み込んでください。");
    const words = chooseStudyWords(allWords, progress, 4);
    try {
      return { quiz: await generateAiQuiz(words, progress), providerUsed: true };
    } catch (error) {
      return { quiz: createFallbackQuiz(words), providerUsed: false, warning: error.message };
    }
  });

  ipcMain.handle("quiz:answer", async (_event, payload) => {
    const progress = await readJson("progress.json", {});
    const updated = recordAnswer(progress, String(payload.wordId), Boolean(payload.correct));
    await writeJson("progress.json", updated);
    return updated;
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
