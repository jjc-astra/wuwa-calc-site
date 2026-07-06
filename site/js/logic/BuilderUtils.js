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

    parseMultiplierString: (input) => {
        if (!input || input.trim() === '') return undefined;
        
        // 1. FIRST check if it is explicitly a stringified JSON array so it parses cleanly
        const trimmed = input.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try { 
                return JSON.parse(trimmed); 
            } catch(e) { 
                // Fall through if it's invalid JSON formatting
            }
        }
        
        // 2. NOW safely bypass single formulas or inline math expressions
        if (input.includes('@') || input.includes('?')) return input; 
        
        // 3. Keep original standard addition/multiplication splitting intact
        const parts = input.replace(/\s+/g, '').split('+');
        const result = [];
        
        parts.forEach(part => {
            let valStr = part;
            let count = 1;
            if (part.includes('*')) {
                const split = part.split('*');
                valStr = split[0]; count = parseInt(split[1]) || 1;
            }
            
            const valNum = parseFloat(valStr);
            if (!isNaN(valNum)) {
                for (let i = 0; i < count; i++) result.push(valStr);
            }
        });
        
        return result.length === 0 ? input : (result.length === 1 ? result[0] : result);
    },

    parseMixed: (val) => {
        if (!val || val.trim() === '') return undefined;
        if (val.includes('@') || /[+\-*/]/.test(val)) return val; 
        const num = parseFloat(val);
        return isNaN(num) ? val : num;
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