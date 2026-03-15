document.addEventListener("DOMContentLoaded", async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const word = urlParams.get('word');
    
    const titleEl = document.getElementById('wordTitle');
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error');
    const resultEl = document.getElementById('result');
    const regenerateBtn = document.getElementById('regenerateBtn');
    
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

        try {
            if (!bypassCache) {
                const { gemini_cache = {} } = await chrome.storage.local.get("gemini_cache");
                if (gemini_cache[word]) {
                    displayResult(gemini_cache[word]);
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
            
            // Call Gemini API exactly with gemini-3-flash-preview as requested
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `Provide the meaning, synonyms, antonyms, and usage examples for the word: "${word}". Please clearly organize the response into sections.`
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

            // Save to cache
            const { gemini_cache = {} } = await chrome.storage.local.get("gemini_cache");
            gemini_cache[word] = resultText;
            await chrome.storage.local.set({ gemini_cache });

            displayResult(resultText);
            regenerateBtn.hidden = false;
            
        } catch (err) {
            loadingEl.hidden = true;
            errorEl.hidden = false;
            errorEl.textContent = `Error: ${err.message}`;
            regenerateBtn.hidden = false;
        }
    }

    function displayResult(text) {
        loadingEl.hidden = true;
        resultEl.hidden = false;
        
        // Use marked if available, fallback to basic escaping if it failed to load
        if (typeof marked !== 'undefined') {
            resultEl.innerHTML = marked.parse(text);
        } else {
            resultEl.textContent = text;
        }
    }
});
