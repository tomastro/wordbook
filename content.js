if (window.location.protocol === 'chrome-extension:') {
    console.log("Word Collector: Exiting content script on extension page.");
} else {
    let storedWords = [];
    let wordRegex = null;


// Initialize styles and start observer
async function init() {
    const data = await chrome.storage.local.get("words");
    updateWordsList(data.words || []);
    
    // Initial highlight
    requestIdleCallback(() => highlightNodes(document.body));
    
    // Observe DOM for changes
    let mutationTimeout = null;
    let nodesToHighlight = new Set();
    
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        nodesToHighlight.add(node);
                    } else if (node.nodeType === Node.TEXT_NODE) {
                        if (node.parentNode) nodesToHighlight.add(node.parentNode);
                    }
                }
            } else if (mutation.type === 'characterData') {
                if (mutation.target.parentNode) nodesToHighlight.add(mutation.target.parentNode);
            }
        }
        
        if (nodesToHighlight.size > 0 && !mutationTimeout) {
            mutationTimeout = window.requestIdleCallback(() => {
                const nodes = Array.from(nodesToHighlight);
                nodesToHighlight.clear();
                mutationTimeout = null;
                
                for (const node of nodes) {
                    if (node && node.isConnected) {
                        highlightNodes(node);
                    }
                }
            });
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
    
    // Listen for new words added anywhere in the extension
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.words) {
            updateWordsList(changes.words.newValue || []);
            requestIdleCallback(() => highlightNodes(document.body));
        }
    });
}

function updateWordsList(words) {
    if (!words || words.length === 0) {
        wordRegex = null;
        return;
    }
    const sortedWords = [...words]
        .map(w => w.word.trim())
        .filter(w => w.length > 0)
        .sort((a, b) => b.length - a.length);
        
    if (sortedWords.length === 0) {
        wordRegex = null;
        return;
    }
    
    const escapedWords = sortedWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    wordRegex = new RegExp(`(?<=^|\\W)(${escapedWords.join('|')})(?=$|\\W)`, 'gi');
}

function highlightNodes(rootNode) {
    if (!wordRegex) return;

    // Skip certain tags where highlighting shouldn't happen
    const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'MARK', 'CODE', 'PRE', 'SVG', 'MATH']);
    
    const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.nodeValue;
            if (!text || !text.trim()) return;
            
            wordRegex.lastIndex = 0;
            if (wordRegex.test(text)) {
                const fragment = document.createDocumentFragment();
                let lastIndex = 0;
                let match;
                wordRegex.lastIndex = 0;
                
                while ((match = wordRegex.exec(text)) !== null) {
                    const before = text.substring(lastIndex, match.index);
                    if (before) fragment.appendChild(document.createTextNode(before));
                    
                    const mark = document.createElement('mark');
                    mark.className = 'wordbook-learned-word';
                    mark.textContent = match[0];
                    fragment.appendChild(mark);
                    
                    lastIndex = wordRegex.lastIndex;
                }
                
                const after = text.substring(lastIndex);
                if (after) fragment.appendChild(document.createTextNode(after));
                
                if (node.parentNode) {
                    node.parentNode.replaceChild(fragment, node);
                }
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (skipTags.has(node.nodeName.toUpperCase()) || 
                node.classList.contains('wordbook-learned-word') ||
                node.isContentEditable) {
                return;
            }
            // Create static array to avoid infinite loops when we replace nodes
            const children = Array.from(node.childNodes);
            for (const child of children) {
                walk(child);
            }
        }
    };

    walk(rootNode);
}

// Ensure requestIdleCallback fallback
window.requestIdleCallback = window.requestIdleCallback || function(cb) {
    const start = Date.now();
    return setTimeout(() => {
        cb({
            didTimeout: false,
            timeRemaining: () => Math.max(0, 50 - (Date.now() - start))
        });
    }, 1);
};

// Start
init();

}
