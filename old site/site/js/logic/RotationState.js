// ==========================================================================
//   ROTATION STATE (Pure Data Store & Linkage Manager)
// ==========================================================================
const BASE_ROW_TEMPLATE = {
    unit: "", action: "", timing: "Auto", offset: 0, dmg: 0,
    moveName: "", castTypes: [], dmgTypes: [], 
    timeStart: 0, gameTimeStart: 0, waitTime: 0,
    baseDuration: 0, duration: 0, gameTimePassed: 0, freezeTime: 0, 
    totalRealTimeCost: 0, totalGameTimeCost: 0,
    damageTimeframe: { start: 0, end: 0 }, allowedHits: Infinity,
    hp: {}, enemyHp: null, enemyMaxHp: null, energy: {}, concerto: {}, enemyTune: 0, enemyMaxTune: null, stance: "Grounded",
    trackers: {}, activeBuffs: {}, timeScales: {}, 
    unitCombos: {}, cooldowns: {}, damageInstances: [], _pendingHits: [],
    errorMsg: null, warningMsg: null, availableTimings: []
};

const RotationState = {
    startEnergy: true,
    startConcerto: false,
    data: [],
    domMap: new WeakMap(),

    // Seamless proxies so external readers accessing RotationState match TimelineEngine
    get isRecalculating() { return TimelineEngine.isRecalculating; },
    set isRecalculating(v) { TimelineEngine.isRecalculating = v; },

    get damageQueue() { return TimelineEngine.damageQueue; },
    set damageQueue(v) { TimelineEngine.damageQueue = v; },

    get currentGlobalGameTime() { return TimelineEngine.currentGlobalGameTime; },
    set currentGlobalGameTime(v) { TimelineEngine.currentGlobalGameTime = v; },

    get currentGlobalRealTime() { return TimelineEngine.currentGlobalRealTime; },
    set currentGlobalRealTime(v) { TimelineEngine.currentGlobalRealTime = v; },

    insertRow: (domRow, index = -1) => {
        const data = structuredClone(BASE_ROW_TEMPLATE);
        data.domRef = domRow; 
        RotationState.domMap.set(domRow, data); 

        if (index >= 0 && index <= RotationState.data.length) {
            RotationState.data.splice(index, 0, data);
        } else {
            RotationState.data.push(data);
        }

        RotationState._buildLinkedList();
        return data;
    },

    removeRow: (domRow) => {
        const index = RotationState.data.findIndex(d => d.domRef === domRow);
        if (index > -1) {
            RotationState.data.splice(index, 1);
            RotationState.domMap.delete(domRow);
            RotationState._buildLinkedList();
        }
    },

    moveRow: (oldIndex, newIndex) => {
        if (oldIndex < 0 || oldIndex >= RotationState.data.length || newIndex < 0 || newIndex >= RotationState.data.length) return;
        const [movedRow] = RotationState.data.splice(oldIndex, 1);
        RotationState.data.splice(newIndex, 0, movedRow);
        RotationState._buildLinkedList();
    },

    _buildLinkedList: () => {
        const arr = RotationState.data;
        for (let i = 0; i < arr.length; i++) {
            arr[i].prevRow = i > 0 ? arr[i - 1] : null;
            arr[i].nextRow = i < arr.length - 1 ? arr[i + 1] : null;
            arr[i].arrayIndex = i; 
        }
    },

    getData: (domRow) => RotationState.domMap.get(domRow),

    updateField: (domRow, field, value) => {
        const data = RotationState.domMap.get(domRow);
        if (data) { data[field] = value; return true; }
        return false;
    },

    getActiveRows: () => RotationState.data.slice(0, -1),
    getOrderedRows: () => RotationState.data,

    _getDefaultData: () => structuredClone(BASE_ROW_TEMPLATE),

    recalculateState: function() {
        return TimelineEngine.recalculateState();
    }
};

window.RotationState = RotationState;