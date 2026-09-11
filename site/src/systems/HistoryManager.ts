export interface Command {
  execute: () => void;
  undo: () => void;
  // Plain-data description of this command, for persisting the undo/redo stacks across a
  // reload (see useRotationStore's reviveCommand). Must round-trip through JSON.
  serialize: () => SerializedCommand;
}

export type SerializedCommand =
  | { type: 'add'; newRow: any; insertedIndex: number }
  | { type: 'delete'; deletedData: { row: any; index: number }[] }
  | { type: 'editValue'; index: number; field: string; oldValue: any; newValue: any }
  | { type: 'editFields'; index: number; oldValues: Record<string, any>; newValues: Record<string, any> }
  | { type: 'setLoopStart'; newIndex: number | null; prevIndex: number | null }
  | { type: 'setLoopEnd'; newIndex: number | null; prevIndex: number | null }
  | { type: 'move'; indicesToMove: number[]; targetIndex: number; previousRowsSnapshot: any[] }
  | {
      type: 'endingRotationFlags';
      oldValues: { endingRotationEnabled: boolean; endRotationStartsEarlier: boolean };
      newValues: { endingRotationEnabled: boolean; endRotationStartsEarlier: boolean };
    }
  | { type: 'composite'; commands: SerializedCommand[] };

// Rows carry live `prevRow`/`nextRow` back-refs (TimelineEngine's @Prev/@Next lookups) that
// break JSON.stringify on circular structure. Safe to drop -- recalculate() rebuilds them.
export const cloneRowsSansLinks = (rows: any[]): any[] =>
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

  serializeUndoStack(): SerializedCommand[] {
    return this.undoStack.map(c => c.serialize());
  }

  serializeRedoStack(): SerializedCommand[] {
    return this.redoStack.map(c => c.serialize());
  }

  // Sets the stacks directly from already-revived commands -- no execute()/undo() side effects,
  // since the rows/flags they describe are already the current (persisted) state. Used to
  // restore history across a reload; see useRotationStore's onRehydrateStorage.
  restoreStacks(undoStack: Command[], redoStack: Command[]) {
    this.undoStack = undoStack;
    this.redoStack = redoStack;
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

  serialize(): SerializedCommand {
    return { type: 'add', newRow: this.newRow, insertedIndex: this.insertedIndex };
  }
}

export class DeleteRowsCommand implements Command {
  private getRows: () => any[];
  private setRows: (rows: any[]) => void;
  private deletedData: { row: any; index: number }[];
  private onComplete?: () => void;

  // Takes the already-resolved deletedData (row snapshot + original index) rather than raw
  // indices, so the exact same constructor works both for a fresh delete (see
  // computeDeletedData, called against the live rows) and for reviving a persisted command
  // (deletedData read straight back from storage, since the rows it refers to may no longer
  // exist at those indices by the time of revival).
  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    deletedData: { row: any; index: number }[],
    onComplete?: () => void
  ) {
    this.getRows = getRows;
    this.setRows = setRows;
    this.deletedData = deletedData;
    this.onComplete = onComplete;
  }

  static computeDeletedData(rows: any[], indicesToDelete: number[]): { row: any; index: number }[] {
    return indicesToDelete
      .filter((idx: number) => idx >= 0 && idx < rows.length)
      .map((idx: number) => ({ row: cloneRowsSansLinks([rows[idx]])[0], index: idx }))
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

  serialize(): SerializedCommand {
    return { type: 'delete', deletedData: this.deletedData };
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

  serialize(): SerializedCommand {
    return { type: 'editValue', index: this.index, field: this.field, oldValue: this.oldValue, newValue: this.newValue };
  }
}

// Same as EditValueCommand but sets several fields on a row as one atomic step (e.g.
// Simultaneous offset, which mirrors into both `offset` and `manualOffset`) -- undoes/redoes
// together so an intermediate recalc never sees just one field updated.
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

  serialize(): SerializedCommand {
    return { type: 'editFields', index: this.index, oldValues: this.oldValues, newValues: this.newValues };
  }
}

// Only one row may carry `loopStartOverride` at a time. Moves the flag to `newIndex` in one
// atomic step -- pass `newIndex: null` to clear it (falls back to auto-detection).
export class SetLoopStartCommand implements Command {
  private getRows: () => any[];
  private setRows: (rows: any[]) => void;
  private newIndex: number | null;
  private prevIndex: number | null;
  private onComplete?: () => void;

  // prevIndex is resolved by the caller (against the live rows) rather than derived here, so
  // the same constructor works for both a fresh action and reviving a persisted command.
  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    newIndex: number | null,
    prevIndex: number | null,
    onComplete?: () => void
  ) {
    this.getRows = getRows;
    this.setRows = setRows;
    this.newIndex = newIndex;
    this.prevIndex = prevIndex;
    this.onComplete = onComplete;
  }

  static findPrevIndex(rows: any[]): number | null {
    const idx = rows.findIndex(r => r.loopStartOverride === true);
    return idx === -1 ? null : idx;
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

  serialize(): SerializedCommand {
    return { type: 'setLoopStart', newIndex: this.newIndex, prevIndex: this.prevIndex };
  }
}

// Same shape as SetLoopStartCommand, targeting `loopEndOverride` -- marks the loop's last row
// when "Ending Rotation" is on. No auto-detected fallback like loop start: absent just means
// "no ending rotation" (loop runs to the end of the rows array).
export class SetLoopEndCommand implements Command {
  private getRows: () => any[];
  private setRows: (rows: any[]) => void;
  private newIndex: number | null;
  private prevIndex: number | null;
  private onComplete?: () => void;

  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    newIndex: number | null,
    prevIndex: number | null,
    onComplete?: () => void
  ) {
    this.getRows = getRows;
    this.setRows = setRows;
    this.newIndex = newIndex;
    this.prevIndex = prevIndex;
    this.onComplete = onComplete;
  }

  static findPrevIndex(rows: any[]): number | null {
    const idx = rows.findIndex(r => r.loopEndOverride === true);
    return idx === -1 ? null : idx;
  }

  private apply(clearIndex: number | null, setIndex: number | null) {
    const current = [...this.getRows()];
    if (clearIndex !== null && clearIndex >= 0 && clearIndex < current.length) {
      const { loopEndOverride, ...rest } = current[clearIndex];
      current[clearIndex] = rest;
    }
    if (setIndex !== null && setIndex >= 0 && setIndex < current.length) {
      current[setIndex] = { ...current[setIndex], loopEndOverride: true };
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

  serialize(): SerializedCommand {
    return { type: 'setLoopEnd', newIndex: this.newIndex, prevIndex: this.prevIndex };
  }
}

export class MoveRowsCommand implements Command {
  private getRows: () => any[];
  private setRows: (rows: any[]) => void;
  private indicesToMove: number[];
  private targetIndex: number;
  private previousRowsSnapshot: any[];
  private onComplete?: (newIndices?: number[]) => void;

  // previousRowsSnapshot is captured by the caller (against the live rows, before the move)
  // rather than derived here, so the same constructor works for both a fresh action and
  // reviving a persisted command.
  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    indicesToMove: number[],
    targetIndex: number,
    previousRowsSnapshot: any[],
    onComplete?: (newIndices?: number[]) => void
  ) {
    this.getRows = getRows;
    this.setRows = setRows;
    this.indicesToMove = indicesToMove;
    this.targetIndex = targetIndex;
    this.onComplete = onComplete;
    this.previousRowsSnapshot = previousRowsSnapshot;
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

  serialize(): SerializedCommand {
    return {
      type: 'move',
      indicesToMove: this.indicesToMove,
      targetIndex: this.targetIndex,
      previousRowsSnapshot: this.previousRowsSnapshot
    };
  }
}

// Flips endingRotationEnabled/endRotationStartsEarlier as one undo step -- shared by
// resetLoopEnd (bundled into a CompositeCommand alongside the row deletion/tag removal it
// accompanies) and any other all-or-nothing flag change.
export class SetEndingRotationFlagsCommand implements Command {
  private setFlags: (vals: { endingRotationEnabled: boolean; endRotationStartsEarlier: boolean }) => void;
  private oldValues: { endingRotationEnabled: boolean; endRotationStartsEarlier: boolean };
  private newValues: { endingRotationEnabled: boolean; endRotationStartsEarlier: boolean };

  constructor(
    setFlags: (vals: { endingRotationEnabled: boolean; endRotationStartsEarlier: boolean }) => void,
    oldValues: { endingRotationEnabled: boolean; endRotationStartsEarlier: boolean },
    newValues: { endingRotationEnabled: boolean; endRotationStartsEarlier: boolean }
  ) {
    this.setFlags = setFlags;
    this.oldValues = oldValues;
    this.newValues = newValues;
  }

  execute() {
    this.setFlags(this.newValues);
  }

  undo() {
    this.setFlags(this.oldValues);
  }

  serialize(): SerializedCommand {
    return { type: 'endingRotationFlags', oldValues: this.oldValues, newValues: this.newValues };
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

  serialize(): SerializedCommand {
    return { type: 'composite', commands: this.commands.map(c => c.serialize()) };
  }
}
