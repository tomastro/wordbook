document.addEventListener("DOMContentLoaded", async () => {
    const isExtension = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
    const urlParams = new URLSearchParams(window.location.search);
    const word = urlParams.get('word');
    
    const titleEl = document.getElementById('wordTitle');
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error');
    const resultEl = document.getElementById('result');
    const regenerateBtn = document.getElementById('regenerateBtn');
    let addWordBtn = document.getElementById('addWordBtn');
    
    if (!word) {
        titleEl.textContent = 'No word provided.';
        loadingEl.hidden = true;
        return;
    }
    
    titleEl.textContent = word;
    document.title = `${word} - Gemini Dictionary`;
    
    regenerateBtn.addEventListener('click', async () => {
        await fetchAndDisplay(word, true);
    });

    await fetchAndDisplay(word, false);
    
    async function getCache() {
        if (isExtension) {
            const data = await chrome.storage.local.get("gemini_cache");
            return data.gemini_cache || {};
        } else {
            try {
                return JSON.parse(localStorage.getItem("gemini_cache") || "{}");
            } catch (e) {
                return {};
            }
        }
    }

    async function saveCache(cache) {
        if (isExtension) {
            await chrome.storage.local.set({ gemini_cache: cache });
        } else {
            localStorage.setItem("gemini_cache", JSON.stringify(cache));
        }
    }

    async function fetchAndDisplay(word, bypassCache) {
        document.querySelector('.app-main')?.setAttribute('aria-busy', 'true');
        loadingEl.hidden = false;
        loadingEl.style.display = 'flex';
        resultEl.hidden = true;
        errorEl.hidden = true;
        regenerateBtn.hidden = true;
        addWordBtn.hidden = true; // wait for actual word

        try {
            if (!bypassCache) {
                const gemini_cache = await getCache();
                if (gemini_cache[word]) {
                    const c = gemini_cache[word];
                    if (typeof c === 'string') {
                        displayResult(word, c, false, word);
                        await setupAddWordBtn(word);
                    } else {
                        displayResult(c.actualWord, c.content, c.isTypo, word);
                        await setupAddWordBtn(c.actualWord);
                    }
                    regenerateBtn.hidden = false;
                    return;
                }
            }

            // Fetch API key from .env file
            let apiKey = null;
            try {
                const envRes = await fetch('.env');
                if (envRes.ok) {
                    const envText = await envRes.text();
                    const match = envText.match(/GEMINI_API_KEY\s*=\s*(["']?)([^"'\n]+)\1/);
                    apiKey = match ? match[2] : null;
                }
            } catch (e) {
                console.log("Standalone preview mode: .env fetch skipped");
            }
            
            if (!apiKey && !isExtension) {
                // Standalone browser preview mock dictionary response
                await new Promise(r => setTimeout(r, 800));
                const mockContent = `## 📖 意味 (Definition)
**${word}** (名詞 / Noun)
> 偶然の幸運、思いがけない発見、探してもいなかった素晴らしいものを偶然見つける能力。

### 💡 例文 (Examples)
1. Finding this quiet coffee shop was pure **serendipity**.
   *(この静かなカフェを見つけたのは、まったくの偶然の幸運だった。)*
2. They met by **serendipity** in Paris.
   *(彼らはパリで偶然出会った。)*

### 🔗 類義語・対義語 (Synonyms & Antonyms)
- **類義語 (Synonyms)**: *chance, fluke, coincidence, good luck*
- **対義語 (Antonyms)**: *misfortune, bad luck, design, intention*`;

                const parsed = { actualWord: word, isTypo: false, content: mockContent };
                displayResult(parsed.actualWord, parsed.content, parsed.isTypo, word);
                await setupAddWordBtn(parsed.actualWord);
                regenerateBtn.hidden = false;
                return;
            }

            if (!apiKey) {
                throw new Error("GEMINI_API_KEY not found in .env file.");
            }
            
            // Call Gemini API with JSON response format
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    generationConfig: {
                        responseMimeType: "application/json"
                    },
                    contents: [{
                        parts: [{
                            text: `You are a dictionary. The user is looking up: "${word}".
Check if the word is misspelled or a typo.
Respond in JSON format with these exact keys:
{
  "isTypo": boolean,
  "actualWord": "string (the correct spelling, or original if correct)",
  "content": "string (markdown formatted meaning, synonyms, antonyms, and usage examples)"
}`
                        }]
                    }]
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error?.message || "Failed to fetch from Gemini API");
            }
            
            const data = await response.json();
            const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!resultText) {
                throw new Error("No response generated.");
            }

            let parsed;
            try {
                parsed = JSON.parse(resultText);
            } catch (e) {
                // fallback if model didn't obey JSON strictly
                parsed = { actualWord: word, isTypo: false, content: resultText };
            }

            // Save to cache
            const gemini_cache = await getCache();
            gemini_cache[word] = parsed;
            await saveCache(gemini_cache);

            displayResult(parsed.actualWord, parsed.content, parsed.isTypo, word);
            await setupAddWordBtn(parsed.actualWord);
            regenerateBtn.hidden = false;
            
        } catch (err) {
            loadingEl.hidden = true;
            loadingEl.style.display = 'none';
            errorEl.hidden = false;
            errorEl.textContent = `辞書情報を取得できませんでした: ${err.message}`;
            regenerateBtn.hidden = false;
        } finally {
            document.querySelector('.app-main')?.setAttribute('aria-busy', 'false');
        }
    }

    async function setupAddWordBtn(actualWord) {
        addWordBtn.hidden = true; // reset
        const isExtension = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
        let words = [];
        if (isExtension) {
            const data = await chrome.storage.local.get("words");
            words = data.words || [];
        }
        const isNewWord = !words.some(w => w.word.toLowerCase() === actualWord.toLowerCase());
        
        // Remove old listeners by cloning the button
        const newBtn = addWordBtn.cloneNode(true);
        addWordBtn.parentNode.replaceChild(newBtn, addWordBtn);
        addWordBtn = newBtn;
        
        if (isNewWord) {
            newBtn.hidden = false;
            newBtn.disabled = false;
            newBtn.querySelector("span").textContent = "単語帳に追加";
            newBtn.addEventListener('click', async () => {
                newBtn.disabled = true;
                const span = newBtn.querySelector("span");
                if (span) span.textContent = "追加中…";
                if (isExtension) {
                    await chrome.runtime.sendMessage({
                        type: "ADD_WORD",
                        word: actualWord,
                        url: window.location.href,
                        domain: "Gemini Dic"
                    });
                }
                if (span) span.textContent = "追加しました";
                setTimeout(() => {
                    newBtn.hidden = true;
                }, 2000);
            });
        }
    }

    function displayResult(actualWord, text, isTypo, originalWord) {
        loadingEl.hidden = true;
        loadingEl.style.display = 'none';
        resultEl.hidden = false;
        
        if (isTypo && actualWord.toLowerCase() !== originalWord.toLowerCase()) {
            titleEl.textContent = actualWord;
            const badge = document.createElement('span');
            badge.className = 'typo-badge';
            badge.textContent = `「${originalWord}」から自動修正`;
            titleEl.append(document.createElement('br'), badge);
            document.title = `${actualWord} (${originalWord}) - Gemini Dictionary`;
        } else {
            titleEl.textContent = actualWord;
            document.title = `${actualWord} - Gemini Dictionary`;
        }
        
        // Use marked if available, fallback to basic escaping if it failed to load
        if (typeof marked !== 'undefined') {
            resultEl.innerHTML = marked.parse(text);
        } else {
            resultEl.textContent = text;
        }
    }
});
