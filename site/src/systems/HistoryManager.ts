// Undo/redo stacks are persisted (see useRotationStore's partialize) and some commands
// (MoveRowsCommand) carry a full rows-array snapshot -- unbounded growth over a long editing
// session can exceed localStorage's quota and start throwing on every subsequent action.
import { makeBlankRow } from '../logic/rotationRows';

const MAX_HISTORY_SIZE = 50;

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
  | { type: 'setRepeatBlockStart'; groupId: string; newIndex: number | null; prevIndex: number | null; initialCount: number }
  | { type: 'setRepeatBlockEnd'; groupId: string; newIndex: number | null; prevIndex: number | null }
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

  private pushUndo(command: Command) {
    this.undoStack.push(command);
    if (this.undoStack.length > MAX_HISTORY_SIZE) this.undoStack.shift();
  }

  execute(command: Command) {
    if (this.isExecuting) return;
    this.isExecuting = true;
    try {
      command.execute();
    } finally {
      this.isExecuting = false;
    }
    this.pushUndo(command);
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
        this.pushUndo(command);
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
  // Also trims on load, independent of pushUndo's cap -- a persisted stack longer than
  // MAX_HISTORY_SIZE shouldn't have to wait for the next action to shrink back under quota.
  restoreStacks(undoStack: Command[], redoStack: Command[]) {
    this.undoStack = undoStack.slice(-MAX_HISTORY_SIZE);
    this.redoStack = redoStack.slice(-MAX_HISTORY_SIZE);
    this.notify();
  }
}

// Holds the getRows/setRows/onComplete triple shared by every row-array-mutating command below.
abstract class BaseRowsCommand implements Command {
  protected getRows: () => any[];
  protected setRows: (rows: any[]) => void;
  protected onComplete?: (...args: any[]) => void;

  constructor(getRows: () => any[], setRows: (rows: any[]) => void, onComplete?: (...args: any[]) => void) {
    this.getRows = getRows;
    this.setRows = setRows;
    this.onComplete = onComplete;
  }

  abstract execute(): void;
  abstract undo(): void;
  abstract serialize(): SerializedCommand;
}

export class AddRowCommand extends BaseRowsCommand {
  private newRow: any;
  private insertedIndex: number;

  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    newRow: any,
    index: number = -1,
    onComplete?: () => void
  ) {
    super(getRows, setRows, onComplete);
    this.newRow = newRow;
    this.insertedIndex = index;
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

export class DeleteRowsCommand extends BaseRowsCommand {
  private deletedData: { row: any; index: number }[];

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
    super(getRows, setRows, onComplete);
    this.deletedData = deletedData;
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
      current = [makeBlankRow()];
    }
    this.setRows(current);
    this.onComplete?.();
  }

  undo() {
    const current = [...this.getRows()];
    // Guards against a restored row missing its id.
    [...this.deletedData].reverse().forEach(item => {
      const row = item.row.id ? item.row : { ...item.row, id: crypto.randomUUID() };
      if (item.index <= current.length) {
        current.splice(item.index, 0, row);
      } else {
        current.push(row);
      }
    });
    this.setRows(current);
    this.onComplete?.();
  }

  serialize(): SerializedCommand {
    return { type: 'delete', deletedData: this.deletedData };
  }
}

// Sets several fields on a row as one atomic step (e.g. Simultaneous offset, which mirrors into
// both `offset` and `manualOffset`) -- undoes/redoes together so an intermediate recalc never sees
// just one field updated.
export class EditFieldsCommand extends BaseRowsCommand {
  protected index: number;
  private oldValues: Record<string, any>;
  private newValues: Record<string, any>;

  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    index: number,
    oldValues: Record<string, any>,
    newValues: Record<string, any>,
    onComplete?: () => void
  ) {
    super(getRows, setRows, onComplete);
    this.index = index;
    this.oldValues = oldValues;
    this.newValues = newValues;
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

// One field of EditFieldsCommand. Persists under its own type, so older saved history still revives.
export class EditValueCommand extends EditFieldsCommand {
  private field: string;
  private oldValue: any;
  private newValue: any;

  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    index: number,
    field: string,
    oldValue: any,
    newValue: any,
    onComplete?: () => void
  ) {
    super(getRows, setRows, index, { [field]: oldValue }, { [field]: newValue }, onComplete);
    this.field = field;
    this.oldValue = oldValue;
    this.newValue = newValue;
  }

  serialize(): SerializedCommand {
    return { type: 'editValue', index: this.index, field: this.field, oldValue: this.oldValue, newValue: this.newValue };
  }
}

// Moves a marker -- a flag or tag one row carries (loop start/end, a Hold Repeat block's start/end)
// -- from one row to another as one undoable step. Undo moves it back.
abstract class MoveMarkerCommand extends BaseRowsCommand {
  protected newIndex: number | null;
  protected prevIndex: number | null;

  // prevIndex is resolved by the caller (against the live rows) rather than derived here, so
  // the same constructor works for both a fresh action and reviving a persisted command.
  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    newIndex: number | null,
    prevIndex: number | null,
    onComplete?: () => void
  ) {
    super(getRows, setRows, onComplete);
    this.newIndex = newIndex;
    this.prevIndex = prevIndex;
  }

  // The row fields the marker occupies -- all of them come off the row it leaves.
  protected abstract markerFields(): readonly string[];
  // What a row looks like carrying the marker (`carried` is whatever travelled with it).
  protected abstract markerValues(carried: any): Record<string, any>;
  // What travels with the marker to its next row, read off the row it leaves (undefined: nothing).
  protected carriedFrom(_row: any): any {
    return undefined;
  }
  // Stands in for `carried` when the marker isn't coming off another row (a brand-new one).
  protected initialCarried(): any {
    return undefined;
  }

  private apply(clearIndex: number | null, setIndex: number | null) {
    const current = [...this.getRows()];
    let carried = this.initialCarried();
    if (clearIndex !== null && clearIndex >= 0 && clearIndex < current.length) {
      const row = current[clearIndex];
      const leaving = this.carriedFrom(row);
      if (leaving !== undefined) carried = leaving;
      const rest = { ...row };
      this.markerFields().forEach(field => delete rest[field]);
      current[clearIndex] = rest;
    }
    if (setIndex !== null && setIndex >= 0 && setIndex < current.length) {
      current[setIndex] = { ...current[setIndex], ...this.markerValues(carried) };
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

// Shared by SetLoopStartCommand/SetLoopEndCommand: a singleton boolean flag on one row.
abstract class SetRowFlagCommandBase extends MoveMarkerCommand {
  protected field: 'loopStartOverride' | 'loopEndOverride';

  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    field: 'loopStartOverride' | 'loopEndOverride',
    newIndex: number | null,
    prevIndex: number | null,
    onComplete?: () => void
  ) {
    super(getRows, setRows, newIndex, prevIndex, onComplete);
    this.field = field;
  }

  protected markerFields() {
    return [this.field];
  }

  protected markerValues() {
    return { [this.field]: true };
  }
}

// Only one row may carry `loopStartOverride` at a time. Moves the flag to `newIndex` in one
// atomic step -- pass `newIndex: null` to clear it (falls back to auto-detection).
export class SetLoopStartCommand extends SetRowFlagCommandBase {
  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    newIndex: number | null,
    prevIndex: number | null,
    onComplete?: () => void
  ) {
    super(getRows, setRows, 'loopStartOverride', newIndex, prevIndex, onComplete);
  }

  static findPrevIndex(rows: any[]): number | null {
    const idx = rows.findIndex(r => r.loopStartOverride === true);
    return idx === -1 ? null : idx;
  }

  serialize(): SerializedCommand {
    return { type: 'setLoopStart', newIndex: this.newIndex, prevIndex: this.prevIndex };
  }
}

// Same shape as SetLoopStartCommand, targeting `loopEndOverride` -- marks the loop's last row
// when "Ending Rotation" is on. No auto-detected fallback like loop start: absent just means
// "no ending rotation" (loop runs to the end of the rows array).
export class SetLoopEndCommand extends SetRowFlagCommandBase {
  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    newIndex: number | null,
    prevIndex: number | null,
    onComplete?: () => void
  ) {
    super(getRows, setRows, 'loopEndOverride', newIndex, prevIndex, onComplete);
  }

  static findPrevIndex(rows: any[]): number | null {
    const idx = rows.findIndex(r => r.loopEndOverride === true);
    return idx === -1 ? null : idx;
  }

  serialize(): SerializedCommand {
    return { type: 'setLoopEnd', newIndex: this.newIndex, prevIndex: this.prevIndex };
  }
}

// Targets multi-instance Hold Repeat blocks by `groupId`, carrying existing `repeatCount` on drag moves while using `initialCount` solely on creation.
export class SetRepeatBlockStartCommand extends MoveMarkerCommand {
  private groupId: string;
  private initialCount: number;

  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    groupId: string,
    newIndex: number | null,
    prevIndex: number | null,
    initialCount: number,
    onComplete?: () => void
  ) {
    super(getRows, setRows, newIndex, prevIndex, onComplete);
    this.groupId = groupId;
    this.initialCount = initialCount;
  }

  static findIndexForGroup(rows: any[], groupId: string): number | null {
    const idx = rows.findIndex(r => r.repeatBlockStart === groupId);
    return idx === -1 ? null : idx;
  }

  protected markerFields() {
    return ['repeatBlockStart', 'repeatCount'];
  }

  protected carriedFrom(row: any) {
    return row.repeatCount;
  }

  protected initialCarried() {
    return this.initialCount;
  }

  protected markerValues(carriedCount: number) {
    return { repeatBlockStart: this.groupId, repeatCount: carriedCount };
  }

  serialize(): SerializedCommand {
    return { type: 'setRepeatBlockStart', groupId: this.groupId, newIndex: this.newIndex, prevIndex: this.prevIndex, initialCount: this.initialCount };
  }
}

// Same shape as SetRepeatBlockStartCommand, but what rides along is the Final Rep Timing override
// (carried with the end marker when it's dragged) rather than a count.
export class SetRepeatBlockEndCommand extends MoveMarkerCommand {
  private groupId: string;

  constructor(
    getRows: () => any[],
    setRows: (rows: any[]) => void,
    groupId: string,
    newIndex: number | null,
    prevIndex: number | null,
    onComplete?: () => void
  ) {
    super(getRows, setRows, newIndex, prevIndex, onComplete);
    this.groupId = groupId;
  }

  static findIndexForGroup(rows: any[], groupId: string): number | null {
    const idx = rows.findIndex(r => r.repeatBlockEnd === groupId);
    return idx === -1 ? null : idx;
  }

  protected markerFields() {
    return ['repeatBlockEnd', 'repeatFinalTiming'];
  }

  protected carriedFrom(row: any) {
    return row.repeatFinalTiming;
  }

  protected markerValues(carriedFinalTiming: string | undefined) {
    return { repeatBlockEnd: this.groupId, ...(carriedFinalTiming !== undefined && { repeatFinalTiming: carriedFinalTiming }) };
  }

  serialize(): SerializedCommand {
    return { type: 'setRepeatBlockEnd', groupId: this.groupId, newIndex: this.newIndex, prevIndex: this.prevIndex };
  }
}

export class MoveRowsCommand extends BaseRowsCommand {
  private indicesToMove: number[];
  private targetIndex: number;
  private previousRowsSnapshot: any[];

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
    super(getRows, setRows, onComplete);
    this.indicesToMove = indicesToMove;
    this.targetIndex = targetIndex;
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
