import type { MechanicNode } from '../types';
import { CommonUtils } from './Common';
import { MECHANICS_NOTATION } from '../data/db';

export const BuilderUtils = {
  /**
   * Mirrors the old site's DOM-extraction step: strips default-valued optional
   * fields and coerces numeric-looking strings to numbers so the exported JSON
   * matches the hand-authored mechanics files.
   */
  cleanMechanicNode: (node: MechanicNode, activeChar: string | null): Record<string, any> => {
    const clean: Record<string, any> = { name: node.name };
    if (node.category) clean.category = node.category;
    if (node.provider && node.provider !== activeChar) clean.provider = node.provider;
    if (node.isPassive) clean.isPassive = true;
    if (node.isSwapInDefault) clean.isSwapInDefault = true;
    if (node.triggerRule) clean.triggerRule = node.triggerRule;
    if (node.castTypes && node.castTypes.length > 0) clean.castTypes = node.castTypes;
    if (node.dmgTypes && node.dmgTypes.length > 0) clean.dmgTypes = node.dmgTypes;

    if (node.castResources && Object.keys(node.castResources).length > 0) clean.castResources = node.castResources;
    if (node.hitResources && Object.keys(node.hitResources).length > 0) clean.hitResources = node.hitResources;
    if (node.cancelTimings && node.cancelTimings.length > 0) clean.cancelTimings = node.cancelTimings;
    if (node.effects && node.effects.length > 0) clean.effects = node.effects;
    if (node.hitMults && node.hitMults.length > 0) clean.hitMults = node.hitMults;
    if (node.scalar) clean.scalar = node.scalar;

    if (!node.isPassive) {
      if (node.input) clean.input = node.input;
      if (node.inputType && node.inputType !== 'Press') clean.inputType = node.inputType;
      if (node.stanceReq && node.stanceReq !== 'Any') clean.stanceReq = node.stanceReq;
      if (node.stanceResult && node.stanceResult !== 'Retain') clean.stanceResult = node.stanceResult;

      const stanceTime = node.stanceResult !== 'Retain' ? CommonUtils.parseMixed(node.stanceTime) : undefined;
      if (stanceTime !== undefined) clean.stanceTime = stanceTime;

      if (node.inputType === 'Release') {
        const cfg = node.holdConfig || {};
        const holdCfg: Record<string, any> = {};
        const d = MECHANICS_NOTATION.HOLD_DEFAULTS;
        if (cfg.cursorMode && cfg.cursorMode !== d.CURSOR_MODE) holdCfg.cursorMode = cfg.cursorMode;
        if (cfg.cursorSpeed !== undefined && cfg.cursorSpeed !== d.CURSOR_SPEED) holdCfg.cursorSpeed = cfg.cursorSpeed;
        if (cfg.maxCursorVal !== undefined && cfg.maxCursorVal !== d.MAX_CURSOR_VAL) holdCfg.maxCursorVal = cfg.maxCursorVal;
        if (cfg.retainCursor) holdCfg.retainCursor = true;
        const wCenter = cfg.windowCenter !== undefined ? String(cfg.windowCenter).trim() : '';
        if (wCenter && wCenter !== d.WINDOW_CENTER) holdCfg.windowCenter = wCenter;
        const wSize = cfg.windowSize !== undefined ? String(cfg.windowSize).trim() : '';
        if (wSize && wSize !== d.WINDOW_SIZE) holdCfg.windowSize = wSize;
        if (Object.keys(holdCfg).length > 0) clean.holdConfig = holdCfg;
      }

      const priority = CommonUtils.parseMixed(node.priority);
      if (priority !== undefined) clean.priority = priority;
      const comboWindow = CommonUtils.parseMixed(node.comboWindow);
      if (comboWindow !== undefined) clean.comboWindow = comboWindow;
      const actionDuration = CommonUtils.parseMixed(node.actionDuration);
      if (actionDuration !== undefined) clean.actionDuration = actionDuration;
      const cooldown = CommonUtils.parseMixed(node.cooldown);
      if (cooldown !== undefined) clean.cooldown = cooldown;
      const swapTiming = CommonUtils.parseMixed(node.swapTiming);
      if (swapTiming !== undefined) clean.swapTiming = swapTiming;
      const freezeTime = CommonUtils.parseMixed(node.freezeTime);
      if (freezeTime !== undefined) clean.freezeTime = freezeTime;

      const dmgStart = CommonUtils.parseMixed(node.damageTimeframe?.start);
      const dmgEnd = CommonUtils.parseMixed(node.damageTimeframe?.end);
      if (dmgStart !== undefined || dmgEnd !== undefined) {
        clean.damageTimeframe = {};
        if (dmgStart !== undefined) clean.damageTimeframe.start = dmgStart;
        if (dmgEnd !== undefined) clean.damageTimeframe.end = dmgEnd;
      }
    }

    return clean;
  },


  generateId: (provider: string, name: string): string => {
    const pageOwner = provider === 'Generic' ? 'System' : provider;
    return `${pageOwner}_${name.trim()}`;
  },

  guessCategory: (mechData: MechanicNode): string => {
    const casts = mechData.castTypes || [];
    if (casts.includes('Basic') || casts.includes('Heavy') || casts.includes('Dodge')) return 'Basic Attack';
    if (casts.includes('Skill')) return 'Resonance Skill';
    if (casts.includes('Liberation')) return 'Resonance Liberation';
    if (casts.includes('Intro')) return 'Intro';
    if (casts.includes('Outro')) return 'Outro';
    if (casts.includes('TuneBreak')) return 'Tune Break';
    return 'Inherent Skill';
  },

  syntaxHighlight: (str: string): string => {
    const escaped = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const highlighted = escaped.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|\/\/.*|\b[a-zA-Z_][a-zA-Z0-9_]*\s*:)/g,
      (match) => {
        let cls = 'syntax-number';
        if (/^"/.test(match)) cls = /:$/.test(match) ? 'syntax-key' : 'syntax-string';
        else if (/true|false/.test(match)) cls = 'syntax-boolean';
        else if (/^\/\//.test(match)) cls = 'syntax-comment';
        else if (/:$/.test(match)) cls = 'syntax-key';
        return `<span class="${cls}">${match}</span>`;
      }
    );

    return highlighted
      .split('\n')
      .map(line => {
        const indentCount = (line.match(/^\s*/) || [''])[0].length;
        return `<div class="code-line" style="--indent: ${indentCount}ch">${line || ' '}</div>`;
      })
      .join('');
  },

  formatJSONOutput: (
    activeChar: string | null,
    baseStats: Record<string, any>,
    mechanicsObj: Record<string, any>,
    isWeapon = false,
    mechFolder = 'characters'
  ) => {
    if (!activeChar) return { charJsonString: '', mechJsonString: '', highlightedHTML: '' };
    let charStr = '';
    let mechStr = '';
    let visualOutput = '';

    const hasBaseStats = Object.keys(baseStats).length > 0;
    const hasMechanics = Object.keys(mechanicsObj).length > 0;

    if (hasBaseStats) {
      const singleLineJson = JSON.stringify(baseStats)
        .replace(/,"/g, ', "')
        .replace(/":/g, '": ');
      charStr = `"${activeChar}": ${singleLineJson},`;
      const folder = isWeapon ? 'weapons' : 'characters';
      visualOutput += `// Update this object in data/db_${folder}.json\n${charStr}\n\n`;
    }

    if (hasMechanics) {
      const cleanedMechanics: Record<string, any> = {};
      Object.entries(mechanicsObj).forEach(([id, node]) => {
        cleanedMechanics[id] = BuilderUtils.cleanMechanicNode(node as MechanicNode, activeChar);
      });
      mechStr = JSON.stringify(cleanedMechanics, null, 2);
      mechStr = mechStr.replace(/\[\s+([^\[\]\{\}]*?)\s+\]/g, (_, inner) => {
        return '[' + inner.replace(/\s*\n\s*/g, ' ').trim() + ']';
      });

      visualOutput += `// Save this exact JSON to: data/mechanics/${mechFolder}/${activeChar.replace(/\s+/g, '_')}.json\n${mechStr}`;
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