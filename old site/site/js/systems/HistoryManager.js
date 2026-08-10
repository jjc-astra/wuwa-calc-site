// ==========================================================================
//   HISTORY MANAGER (Command Pattern & Undo/Redo Engine)
// ==========================================================================
class HistoryManager {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
        this.onChangeCallback = null;
        this.isExecuting = false;
    }

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

// --- COMMAND CLASSES ---

class AddRowCommand {
    constructor(container, rowElement, index = -1) {
        this.container = container;
        this.rowElement = rowElement;
        this.insertedIndex = index;
    }
    execute() {
        if (!this.rowElement) return;
        if (this.insertedIndex >= 0 && this.insertedIndex < this.container.children.length) {
            this.container.insertBefore(this.rowElement, this.container.children[this.insertedIndex]);
            RotationState.insertRow(this.rowElement, this.insertedIndex);
        } else {
            this.container.appendChild(this.rowElement);
            RotationState.insertRow(this.rowElement);
            this.insertedIndex = this.container.children.length - 1;
        }
        RotationUtils.updateIndices(this.container);
        TimelineEngine.recalculateState();
    }
    undo() {
        if (!this.rowElement) return;
        RotationState.removeRow(this.rowElement);
        this.rowElement.remove();
        RotationUtils.updateIndices(this.container);
        TimelineEngine.recalculateState();
    }
}

class DeleteRowsCommand {
    constructor(container, rows) {
        this.container = container;
        this.rowsData = rows.map(row => {
            const stateData = RotationState.getData(row);
            return {
                el: row,
                stateObject: stateData,
                index: RotationState.data.indexOf(stateData)
            };
        }).filter(d => d.index !== -1);
        this.rowsData.sort((a, b) => b.index - a.index);
    }
    execute() {
        this.rowsData.forEach(d => {
            RotationState.removeRow(d.el);
            d.el.remove();
        });
    }
    undo() {
        [...this.rowsData].reverse().forEach(d => {
            d.el.classList.remove('selected');
            const cb = d.el.querySelector('.row-select-check');
            if (cb) cb.checked = false;
            if (d.index < this.container.children.length) {
                this.container.insertBefore(d.el, this.container.children[d.index]);
            } else {
                this.container.appendChild(d.el);
            }
            RotationState.data.splice(d.index, 0, d.stateObject);
            if (RotationState.domMap) RotationState.domMap.set(d.el, d.stateObject);
        });
        RotationState._buildLinkedList();
    }
}

class EditValueCommand {
    constructor(element, oldValue, newValue) {
        this.element = element;
        this.oldValue = oldValue;
        this.newValue = newValue;
        const row = element.closest('.rotation-row');
        if (row) {
            const currentData = RotationState.getData(row);
            this.dataSnapshot = currentData ? { ...currentData } : null;
        }
    }
    execute() {
        if (this.element.classList.contains('move-select') && this.newValue && !Array.from(this.element.options).some(o => o.value === this.newValue)) {
            this.element.insertAdjacentHTML('beforeend', `<option value="${this.newValue}">${this.newValue}</option>`);
        }
        this.element.value = this.newValue;
        if (this.dataSnapshot) {
            const row = this.element.closest('.rotation-row');
            const stateData = RotationState.getData(row);
            if (stateData) {
                if (this.element.classList.contains('unit-select')) stateData.unit = this.newValue;
                if (this.element.classList.contains('move-select')) stateData.action = this.newValue;
                if (this.element.classList.contains('timing-select')) stateData.timing = this.newValue;
                if (this.element.classList.contains('offset-input')) {
                    stateData.offset = parseFloat(this.newValue) || 0;
                    stateData.manualOffset = parseFloat(this.newValue) || 0;
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

class MoveRowsCommand {
    constructor(container, rowsToMove, targetIndex) {
        this.container = container;
        this.rowsToMove = rowsToMove;
        this.originalIndices = rowsToMove.map(row => {
            const stateData = RotationState.getData(row);
            return { row: row, index: RotationState.data.indexOf(stateData) };
        }).filter(item => item.index !== -1);
        this.targetIndex = targetIndex;
    }
    execute() {
        const sortedToMove = [...this.originalIndices].sort((a, b) => b.index - a.index);
        const extractedData = [];
        sortedToMove.forEach(item => {
            const [removed] = RotationState.data.splice(item.index, 1);
            item.row.remove();
            extractedData.push({ row: item.row, data: removed });
        });
        extractedData.reverse();
        let adjustedTarget = this.targetIndex;
        sortedToMove.forEach(item => {
            if (item.index < this.targetIndex) adjustedTarget--;
        });
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
        const currentIndices = this.rowsToMove.map(row => {
            return { row: row, index: RotationState.data.findIndex(d => d.domRef === row) };
        }).filter(item => item.index !== -1).sort((a, b) => b.index - a.index);

        currentIndices.forEach(item => {
            const [removed] = RotationState.data.splice(item.index, 1);
            item.row.remove();
            extractedData.push({ row: item.row, data: removed });
        });
        extractedData.reverse();
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

// Global Singleton Instance
const history = new HistoryManager();
window.historyManager = history;
window.UndoManager = HistoryManager;