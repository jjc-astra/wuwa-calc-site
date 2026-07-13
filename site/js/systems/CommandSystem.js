// =========================================
//   COMMAND PATTERN SYSTEM
// =========================================

class UndoManager {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
        this.onChangeCallback = null;
        this.isExecuting = false; 
    }

    // --- NEW: Helper to safely find the container and dispatch the event once ---
    _dispatchStructureChange(command) {
        let container = null;
        if (command.container) container = command.container;
        else if (command.commands) {
            const c = command.commands.find(cmd => cmd.container);
            if (c) container = c.container;
        }
        if (container) container.dispatchEvent(new CustomEvent('row-structure-change'));
    }

    execute(command) {
        if (this.isExecuting) return;
        this.isExecuting = true; 
        try {
            command.execute();
        } finally {
            this.isExecuting = false;
        }
        this.undoStack.push(command);
        this.redoStack = []; 
        this.notify();
        
        // --- FIXED: Fire DOM reflows exactly ONCE at the very end of the batch! ---
        this._dispatchStructureChange(command);
        if (typeof RotationUtils !== 'undefined') RotationUtils.runSimulation();
    }

    undo() {
        if (this.undoStack.length === 0) return;
        this.isExecuting = true;
        let command;
        try {
            command = this.undoStack.pop();
            command.undo();
            this.redoStack.push(command);
        } finally {
            this.isExecuting = false;
        }
        this.notify();
        
        if (command) this._dispatchStructureChange(command);
        if (typeof RotationUtils !== 'undefined') RotationUtils.runSimulation();
    }

    redo() {
        if (this.redoStack.length === 0) return;
        this.isExecuting = true;
        let command;
        try {
            command = this.redoStack.pop();
            command.execute();
            this.undoStack.push(command);
        } finally {
            this.isExecuting = false;
        }
        this.notify();
        
        if (command) this._dispatchStructureChange(command);
        if (typeof RotationUtils !== 'undefined') RotationUtils.runSimulation();
    }

    notify() {
        if (this.onChangeCallback) {
            this.onChangeCallback(this.undoStack.length > 0, this.redoStack.length > 0);
        }
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.notify();
    }
}

// 1. ADD ROW COMMAND
class AddRowCommand {
    constructor(container, rowElement, index = -1) {
        this.container = container;
        this.rowElement = rowElement; 
        this.insertedIndex = index;
    }

    execute() {
        if (!this.rowElement) return;

        // 1. Physical DOM Insertion
        if (this.insertedIndex >= 0 && this.insertedIndex < this.container.children.length) {
            this.container.insertBefore(this.rowElement, this.container.children[this.insertedIndex]);
            // Sync with memory array at correct target slot
            RotationState.insertRow(this.rowElement, this.insertedIndex);
        } else {
            this.container.appendChild(this.rowElement);
            // Append at the end
            RotationState.insertRow(this.rowElement);
            this.insertedIndex = this.container.children.length - 1;
        }

        // 2. Re-index row indicators (#1, #2, #3...)
        // --- FIXED: Changed reindexRows to updateIndices ---
        RotationUtils.updateIndices(this.container);
        
        // 3. Recalculate timeline metrics
        RotationState.recalculateState();
    }

    undo() {
        if (!this.rowElement) return;

        // 1. Cleanly pull the row out of the global state array tracking loops
        RotationState.removeRow(this.rowElement);

        // 2. Remove the physical element safely from the live DOM viewport
        this.rowElement.remove();

        // 3. Force remaining rows to update their visual index columns
        // --- FIXED: Changed reindexRows to updateIndices ---
        RotationUtils.updateIndices(this.container);

        // 4. Force the state engine to run a lookahead calculation sweep
        RotationState.recalculateState();
    }
}

// 2. DELETE ROWS COMMAND
class DeleteRowsCommand {
    constructor(container, rows) {
        this.container = container;
        // --- CORRECT APPROACH: Hold the exact memory reference! ---
        this.rowsData = rows.map(row => {
            const stateData = RotationState.getData(row);
            return {
                el: row,
                stateObject: stateData, // Capture the real object, no cloning!
                index: RotationState.data.indexOf(stateData)
            };
        }).filter(d => d.index !== -1);
        
        this.rowsData.sort((a, b) => b.index - a.index);
    }
    execute() {
        this.rowsData.forEach(d => {
            RotationState.removeRow(d.el); // Let engine clean up array/links
            d.el.remove(); // Detach DOM
        });
    }
    undo() {
        [...this.rowsData].reverse().forEach(d => {
            d.el.classList.remove('selected');
            const cb = d.el.querySelector('.row-select-check');
            if (cb) cb.checked = false;

            // 1. DOM Insertion
            if (d.index < this.container.children.length) {
                this.container.insertBefore(d.el, this.container.children[d.index]);
            } else {
                this.container.appendChild(d.el);
            }
            
            // 2. Memory Insertion (Inject the exact object back!)
            RotationState.data.splice(d.index, 0, d.stateObject);
            if (RotationState.domMap) RotationState.domMap.set(d.el, d.stateObject);
        });
        
        // 3. Rebuild timeline links globally
        RotationState._buildLinkedList();
    }
}

// 3. EDIT VALUE COMMAND
class EditValueCommand {
    constructor(element, oldValue, newValue) {
        this.element = element; this.oldValue = oldValue; this.newValue = newValue;
        const row = element.closest('.rotation-row');
        if (row) {
            const currentData = RotationState.getData(row);
            this.dataSnapshot = currentData ? { ...currentData } : null; 
        }
    }
    execute() {
        // 1. Inject missing HTML options (The Paste Fix)
        // Required because the DOM will reject value assignments if the option doesn't exist yet!
        if (this.element.classList.contains('move-select') && this.newValue && !Array.from(this.element.options).some(o => o.value === this.newValue)) {
            this.element.insertAdjacentHTML('beforeend', `<option value="${this.newValue}">${this.newValue}</option>`);
        }

        this.element.value = this.newValue;

        // 2. Sync to Memory
        if (this.dataSnapshot) {
            const row = this.element.closest('.rotation-row');
            const stateData = RotationState.getData(row);
            if (stateData) {
                if (this.element.classList.contains('unit-select')) stateData.unit = this.newValue;
                if (this.element.classList.contains('move-select')) stateData.action = this.newValue;
                if (this.element.classList.contains('timing-select')) stateData.timing = this.newValue;
                
                // Explicitly map the offset input to the state memory as a float
                if (this.element.classList.contains('offset-input')) {
                    stateData.offset = parseFloat(this.newValue) || 0;
                    stateData.manualOffset = parseFloat(this.newValue) || 0; // <-- ADDED: Keep persistent copy for parallel math
                }
            }
        }
        this.triggerVisualUpdates(); 
    }
    undo() {
        this.element.value = this.oldValue;
        if (this.dataSnapshot) {
            const row = this.element.closest('.rotation-row');
            const newData = RotationState.getData(row);
            
            if (newData) {
                // --- FIXED: Replaced missing restoreSnapshot function with in-place assignment ---
                Object.keys(newData).forEach(key => delete newData[key]);
                Object.assign(newData, this.dataSnapshot);
                
                if (this.element.classList.contains('unit-select') || this.element.classList.contains('move-select')) {
                    RotationUtils.updateActionOptions(row, newData.unit, newData.action);
                    const moveSel = row.querySelector('.move-select');
                    if (moveSel && newData.action) moveSel.value = newData.action;
                }
            }
        }
        this.triggerVisualUpdates();
    }

    triggerVisualUpdates() {
        this.element.dispatchEvent(new Event('change', { bubbles: true }));
        this.element.dispatchEvent(new Event('input', { bubbles: true }));
        if (this.element.classList.contains('base-select')) CommonUtils.updatePlaceholderStyle(this.element); 
    }
}

// 4. COMPOSITE COMMAND
class CompositeCommand {
    constructor(commands) {
        this.commands = commands;
    }
    execute() {
        this.commands.forEach(cmd => cmd.execute());
    }
    undo() {
        [...this.commands].reverse().forEach(cmd => cmd.undo());
    }
}

// 5. MOVE ROWS COMMAND
class MoveRowsCommand {
    constructor(container, rowsToMove, targetIndex) {
        this.container = container;
        this.rowsToMove = rowsToMove;
        
        // Capture original state indices before moving
        this.originalIndices = rowsToMove.map(row => {
            const stateData = RotationState.getData(row);
            return { row: row, index: RotationState.data.indexOf(stateData) };
        }).filter(item => item.index !== -1);
        
        this.targetIndex = targetIndex;
    }

    execute() {
        // Sort original indices descending so we remove from back-to-front without shifting indices
        const sortedToMove = [...this.originalIndices].sort((a, b) => b.index - a.index);
        const extractedData = [];
        
        // Remove from State and explicitly DETACH FROM DOM so they don't mess up the live children index
        sortedToMove.forEach(item => {
            const [removed] = RotationState.data.splice(item.index, 1);
            item.row.remove(); // <-- THE FIX: Pull it out of the container completely!
            extractedData.push({ row: item.row, data: removed });
        });
        
        // Re-sort to sequential order for insertion
        extractedData.reverse();
        
        // Adjust target index based on how many items *before* it were removed
        let adjustedTarget = this.targetIndex;
        sortedToMove.forEach(item => {
            if (item.index < this.targetIndex) adjustedTarget--;
        });
        
        // Insert back into DOM and State at the adjusted target
        extractedData.forEach((item, i) => {
            const insertIdx = adjustedTarget + i;
            
            if (insertIdx >= this.container.children.length) {
                this.container.appendChild(item.row);
            } else {
                this.container.insertBefore(item.row, this.container.children[insertIdx]);
            }
            
            RotationState.data.splice(insertIdx, 0, item.data);
        });

        RotationState._buildLinkedList();
    }

    undo() {
        const extractedData = [];
        
        // Find their current indices and sort descending
        const currentIndices = this.rowsToMove.map(row => {
            return { row: row, index: RotationState.data.findIndex(d => d.domRef === row) };
        }).filter(item => item.index !== -1).sort((a, b) => b.index - a.index);
        
        // Pull them out of their moved positions
        currentIndices.forEach(item => {
            const [removed] = RotationState.data.splice(item.index, 1);
            item.row.remove(); // <-- THE FIX: Detach from DOM!
            extractedData.push({ row: item.row, data: removed });
        });
        
        extractedData.reverse();
        
        // Re-insert at original indices (ascending is safe here because we are putting them exactly back)
        const sortedOriginal = [...this.originalIndices].sort((a, b) => a.index - b.index);
        sortedOriginal.forEach((item, i) => {
            if (item.index >= this.container.children.length) {
                this.container.appendChild(item.row);
            } else {
                this.container.insertBefore(item.row, this.container.children[item.index]);
            }
            RotationState.data.splice(item.index, 0, extractedData[i].data);
        });

        RotationState._buildLinkedList();
    }
}


// Expose global instance
const history = new UndoManager();