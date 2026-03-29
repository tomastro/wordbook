document.addEventListener("DOMContentLoaded", async () => {
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
    
    async function fetchAndDisplay(word, bypassCache) {
        loadingEl.hidden = false;
        resultEl.hidden = true;
        errorEl.hidden = true;
        regenerateBtn.hidden = true;
        addWordBtn.hidden = true; // wait for actual word

        try {
            if (!bypassCache) {
                const { gemini_cache = {} } = await chrome.storage.local.get("gemini_cache");
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
            const envRes = await fetch('.env');
            if (!envRes.ok) throw new Error("Could not find .env file. Please create it and add GEMINI_API_KEY.");
            const envText = await envRes.text();
            const match = envText.match(/GEMINI_API_KEY\s*=\s*(["']?)([^"'\n]+)\1/);
            const apiKey = match ? match[2] : null;
            
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
            const { gemini_cache = {} } = await chrome.storage.local.get("gemini_cache");
            gemini_cache[word] = parsed;
            await chrome.storage.local.set({ gemini_cache });

            displayResult(parsed.actualWord, parsed.content, parsed.isTypo, word);
            await setupAddWordBtn(parsed.actualWord);
            regenerateBtn.hidden = false;
            
        } catch (err) {
            loadingEl.hidden = true;
            errorEl.hidden = false;
            errorEl.textContent = `Error: ${err.message}`;
            regenerateBtn.hidden = false;
        }
    }

    async function setupAddWordBtn(actualWord) {
        addWordBtn.hidden = true; // reset
        const { words = [] } = await chrome.storage.local.get("words");
        const isNewWord = !words.some(w => w.word.toLowerCase() === actualWord.toLowerCase());
        
        // Remove old listeners by cloning the button
        const newBtn = addWordBtn.cloneNode(true);
        addWordBtn.parentNode.replaceChild(newBtn, addWordBtn);
        addWordBtn = newBtn;
        
        if (isNewWord) {
            newBtn.hidden = false;
            newBtn.disabled = false;
            newBtn.textContent = "+ Add to Wordbook";
            newBtn.addEventListener('click', async () => {
                newBtn.disabled = true;
                newBtn.textContent = "Adding...";
                await chrome.runtime.sendMessage({ 
                    type: "ADD_WORD", 
                    word: actualWord,
                    url: window.location.href,
                    domain: "Gemini Dic"
                });
                newBtn.textContent = "Added!";
                setTimeout(() => {
                    newBtn.hidden = true;
                }, 2000);
            });
        }
    }

    function displayResult(actualWord, text, isTypo, originalWord) {
        loadingEl.hidden = true;
        resultEl.hidden = false;
        
        if (isTypo && actualWord.toLowerCase() !== originalWord.toLowerCase()) {
            titleEl.innerHTML = `${actualWord} <span style="font-size:14px; color:#e74c3c;">(Auto-corrected from "${originalWord}")</span>`;
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
