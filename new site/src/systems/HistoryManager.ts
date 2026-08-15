export interface Command {
  execute: () => void;
  undo: () => void;
}

// Rows carry live `prevRow`/`nextRow` back-references (attached by TimelineEngine for
// @Prev/@Next DSL lookups) that make a plain JSON.stringify throw on circular structure.
// Those links are always rebuilt by the next recalculate(), so it's safe to drop them here.
const cloneRowsSansLinks = (rows: any[]): any[] =>
  JSON.parse(JSON.stringify(rows, (key, value) => (key === 'prevRow' || key === 'nextRow' ? undefined : value)));

export class HistoryManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private isExecuting: boolean = false;
  private onChangeCallback?: (canUndo: boolean, canRedo: boolean) => void;

  constructor(onChangeCallback?: (canUndo: boolean, canRedo: boolean) => void) {
    this.onChangeCallback = onChangeCallback;
  }

  setOnChangeCallback(cb: (canUndo: boolean, canRedo: boolean) => void) {
    this.onChangeCallback = cb;
  }

  execute(command: Command) {
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
  }

  undo() {
    if (this.undoStack.length === 0 || this.isExecuting) return;
    this.isExecuting = true;
    try {
      const command = this.undoStack.pop();
      if (command) {
        command.undo();
        this.redoStack.push(command);
      }
    } finally {
      this.isExecuting = false;
    }
    this.notify();
  }

  redo() {
    if (this.redoStack.length === 0 || this.isExecuting) return;
    this.isExecuting = true;
    try {
      const command = this.redoStack.pop();
      if (command) {
        command.execute();
        this.undoStack.push(command);
      }
    } finally {
      this.isExecuting = false;
    }
    this.notify();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  notify() {
    if (this.onChangeCallback) {
      this.onChangeCallback(this.canUndo(), this.canRedo());
    }
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }
}

export class AddRowCommand implements Command {
  private getRows: () => any[];
  private setRows: (rows: any[]) => void;
  private newRow: any;
  private insertedIndex: number;
  private onComplete?: () => void;

  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    newRow: any,
    index: number = -1,
    onComplete?: () => void
  ) {
    this.getRows = getRows;
    this.setRows = setRows;
    this.newRow = newRow;
    this.insertedIndex = index;
    this.onComplete = onComplete;
  }

  execute() {
    const current = [...this.getRows()];
    if (this.insertedIndex >= 0 && this.insertedIndex < current.length) {
      current.splice(this.insertedIndex, 0, this.newRow);
    } else {
      current.push(this.newRow);
      this.insertedIndex = current.length - 1;
    }
    this.setRows(current);
    this.onComplete?.();
  }

  undo() {
    const current = [...this.getRows()];
    if (this.insertedIndex >= 0 && this.insertedIndex < current.length) {
      current.splice(this.insertedIndex, 1);
      this.setRows(current);
      this.onComplete?.();
    }
  }
}

export class DeleteRowsCommand implements Command {
  private getRows: () => any[];
  private setRows: (rows: any[]) => void;
  private deletedData: { row: any; index: number }[] = [];
  private onComplete?: () => void;

  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    indicesToDelete: number[],
    onComplete?: () => void
  ) {
    this.getRows = getRows;
    this.setRows = setRows;
    this.onComplete = onComplete;
    
    const current = this.getRows();
    this.deletedData = indicesToDelete
      .filter((idx: number) => idx >= 0 && idx < current.length)
      .map((idx: number) => ({ row: cloneRowsSansLinks([current[idx]])[0], index: idx }))
      .sort((a, b) => b.index - a.index);
  }

  execute() {
    let current = [...this.getRows()];
    this.deletedData.forEach(item => {
      current.splice(item.index, 1);
    });
    if (current.length === 0) {
      current = [{ unit: '', action: '', timing: 'Auto', offset: 0 }];
    }
    this.setRows(current);
    this.onComplete?.();
  }

  undo() {
    const current = [...this.getRows()];
    [...this.deletedData].reverse().forEach(item => {
      if (item.index <= current.length) {
        current.splice(item.index, 0, item.row);
      } else {
        current.push(item.row);
      }
    });
    this.setRows(current);
    this.onComplete?.();
  }
}

export class EditValueCommand implements Command {
  private getRows: () => any[];
  private setRows: (rows: any[]) => void;
  private index: number;
  private field: string;
  private oldValue: any;
  private newValue: any;
  private onComplete?: () => void;

  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    index: number,
    field: string,
    oldValue: any,
    newValue: any,
    onComplete?: () => void
  ) {
    this.getRows = getRows;
    this.setRows = setRows;
    this.index = index;
    this.field = field;
    this.oldValue = oldValue;
    this.newValue = newValue;
    this.onComplete = onComplete;
  }

  execute() {
    const current = [...this.getRows()];
    if (this.index >= 0 && this.index < current.length) {
      current[this.index] = { ...current[this.index], [this.field]: this.newValue };
      this.setRows(current);
      this.onComplete?.();
    }
  }

  undo() {
    const current = [...this.getRows()];
    if (this.index >= 0 && this.index < current.length) {
      current[this.index] = { ...current[this.index], [this.field]: this.oldValue };
      this.setRows(current);
      this.onComplete?.();
    }
  }
}

// Same as EditValueCommand but sets several fields on a row as one atomic step, so a
// single edit (e.g. Simultaneous offset, which mirrors into both `offset` and
// `manualOffset`) undoes/redoes in one step and never leaves the fields transiently
// out of sync where an intermediate recalc could observe only one of them updated.
export class EditFieldsCommand implements Command {
  private getRows: () => any[];
  private setRows: (rows: any[]) => void;
  private index: number;
  private oldValues: Record<string, any>;
  private newValues: Record<string, any>;
  private onComplete?: () => void;

  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    index: number,
    oldValues: Record<string, any>,
    newValues: Record<string, any>,
    onComplete?: () => void
  ) {
    this.getRows = getRows;
    this.setRows = setRows;
    this.index = index;
    this.oldValues = oldValues;
    this.newValues = newValues;
    this.onComplete = onComplete;
  }

  execute() {
    const current = [...this.getRows()];
    if (this.index >= 0 && this.index < current.length) {
      current[this.index] = { ...current[this.index], ...this.newValues };
      this.setRows(current);
      this.onComplete?.();
    }
  }

  undo() {
    const current = [...this.getRows()];
    if (this.index >= 0 && this.index < current.length) {
      current[this.index] = { ...current[this.index], ...this.oldValues };
      this.setRows(current);
      this.onComplete?.();
    }
  }
}

// Only one row may carry `loopStartOverride` at a time. Moves the flag from wherever it
// currently sits (if anywhere) to `newIndex` in one atomic step -- pass `newIndex: null`
// to clear it entirely (falling back to auto-detection) without setting a new one.
export class SetLoopStartCommand implements Command {
  private getRows: () => any[];
  private setRows: (rows: any[]) => void;
  private newIndex: number | null;
  private prevIndex: number | null;
  private onComplete?: () => void;

  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    newIndex: number | null,
    onComplete?: () => void
  ) {
    this.getRows = getRows;
    this.setRows = setRows;
    this.newIndex = newIndex;
    this.prevIndex = this.getRows().findIndex(r => r.loopStartOverride === true);
    if (this.prevIndex === -1) this.prevIndex = null;
    this.onComplete = onComplete;
  }

  private apply(clearIndex: number | null, setIndex: number | null) {
    const current = [...this.getRows()];
    if (clearIndex !== null && clearIndex >= 0 && clearIndex < current.length) {
      const { loopStartOverride, ...rest } = current[clearIndex];
      current[clearIndex] = rest;
    }
    if (setIndex !== null && setIndex >= 0 && setIndex < current.length) {
      current[setIndex] = { ...current[setIndex], loopStartOverride: true };
    }
    this.setRows(current);
    this.onComplete?.();
  }

  execute() {
    this.apply(this.prevIndex, this.newIndex);
  }

  undo() {
    this.apply(this.newIndex, this.prevIndex);
  }
}

export class MoveRowsCommand implements Command {
  private getRows: () => any[];
  private setRows: (rows: any[]) => void;
  private indicesToMove: number[];
  private targetIndex: number;
  private previousRowsSnapshot: any[] = [];
  private onComplete?: (newIndices?: number[]) => void;

  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    indicesToMove: number[],
    targetIndex: number,
    onComplete?: (newIndices?: number[]) => void
  ) {
    this.getRows = getRows;
    this.setRows = setRows;
    this.indicesToMove = indicesToMove;
    this.targetIndex = targetIndex;
    this.onComplete = onComplete;
    this.previousRowsSnapshot = cloneRowsSansLinks(this.getRows());
  }

  execute() {
    const current = [...this.getRows()];
    const sortedIndices = [...this.indicesToMove].sort((a, b) => b - a);
    const movedItems: any[] = [];

    sortedIndices.forEach((idx: number) => {
      if (idx >= 0 && idx < current.length) {
        const [item] = current.splice(idx, 1);
        movedItems.push(item);
      }
    });
    movedItems.reverse();

    let adjustedTarget = this.targetIndex;
    sortedIndices.forEach((idx: number) => {
      if (idx < this.targetIndex) adjustedTarget--;
    });

    const newIndices: number[] = [];
    movedItems.forEach((item: any, i: number) => {
      const insertIdx = Math.max(0, Math.min(adjustedTarget + i, current.length));
      current.splice(insertIdx, 0, item);
      newIndices.push(insertIdx);
    });

    this.setRows(current);
    this.onComplete?.(newIndices);
  }

  undo() {
    this.setRows(cloneRowsSansLinks(this.previousRowsSnapshot));
    this.onComplete?.(undefined);
  }
}

export class CompositeCommand implements Command {
  private commands: Command[];

  constructor(commands: Command[]) {
    this.commands = commands;
  }

  execute() {
    this.commands.forEach(cmd => cmd.execute());
  }

  undo() {
    [...this.commands].reverse().forEach(cmd => cmd.undo());
  }
}