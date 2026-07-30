// =========================================
//   BUILDER UTILS (Pure Logic & Formatters)
// =========================================

const BuilderUtils = {
    generateId: (prov, nm) => `${prov}_${nm.trim()}`,

    guessCategory: (mechData) => {
        const casts = mechData.castTypes || [];
        if (casts.includes("Basic") || casts.includes("Heavy") || casts.includes("Dodge")) return "Basic Attack";
        if (casts.includes("Skill")) return "Resonance Skill";
        if (casts.includes("Liberation")) return "Resonance Liberation";
        if (casts.includes("Intro")) return "Intro";
        if (casts.includes("Outro")) return "Outro";
        if (casts.includes("TuneBreak")) return "Tune Break";
        return "Inherent Skill"; 
    },

    syntaxHighlight: (str) => {
        str = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const highlighted = str.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|\/\/.*|\b[a-zA-Z_][a-zA-Z0-9_]*\s*:)/g, (match) => {
            let cls = 'syntax-number';
            if (/^"/.test(match)) cls = /:$/.test(match) ? 'syntax-key' : 'syntax-string';
            else if (/true|false/.test(match)) cls = 'syntax-boolean';
            else if (/^\/\//.test(match)) cls = 'syntax-comment';
            else if (/:$/.test(match)) cls = 'syntax-key'; 
            return `<span class="${cls}">${match}</span>`;
        });
        return highlighted.split('\n').map(line => {
            const indentCount = (line.match(/^\s*/) || [""])[0].length;
            return `<div class="code-line" style="--indent: ${indentCount}ch">${line || ' '}</div>`;
        }).join('');
    },

    // --- OPTIMIZED: Pure function that only formats data into strings. No DOM scraping allowed! ---
    formatJSONOutput: (activeChar, baseStats, mechanicsObj, isWeapon = false) => {
        if (!activeChar) return { charJsonString: "", mechJsonString: "", highlightedHTML: "" };

        let charStr = "";
        let mechStr = "";
        let visualOutput = "";
        
        const hasBaseStats = Object.keys(baseStats).length > 0;
        const hasMechanics = Object.keys(mechanicsObj).length > 0;
        
        if (hasBaseStats) {
            const singleLineJson = JSON.stringify(baseStats).replace(/,"/g, ', "').replace(/":/g, '": ');
            charStr = `"${activeChar}": ${singleLineJson},`;
            const folder = isWeapon ? 'weapons' : 'characters';
            visualOutput += `// Update this object in data/db_${folder}.json\n${charStr}\n\n`;
        }
        
        if (hasMechanics) {
            mechStr = JSON.stringify(mechanicsObj, null, 2); 
            
            // Compress inner arrays onto a single line for readability
            mechStr = mechStr.replace(/\[\s+([^\[\]\{\}]*?)\s+\]/g, (match, inner) => {
                return '[' + inner.replace(/\s*\n\s*/g, ' ').trim() + ']';
            });
            
            visualOutput += `// Save this exact JSON to: data/mechanics/[folder]/${activeChar.replace(/\s+/g, '_')}.json\n${mechStr}`;
        } else if (!hasBaseStats) {
            visualOutput += `// Add mechanic nodes to generate output!`;
        }

        return {
            charJsonString: charStr,
            mechJsonString: mechStr,
            highlightedHTML: BuilderUtils.syntaxHighlight(visualOutput)
        };
    }
};