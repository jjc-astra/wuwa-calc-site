// What pickers allow; the rest is greyed out.
import { DataLoader, type ImplementedContentKind } from './DataLoader';
import { useBuilderStore } from '../store/useBuilderStore';
import type { IconSelectOption } from '../components/common/IconSelect';

const NOT_IMPLEMENTED_TIP = 'Not yet implemented';

// Has mechanics in the data or the Builder.
export const isSelectableContent = (kind: ImplementedContentKind, name: string): boolean =>
  DataLoader.isContentImplemented(kind, name) || useBuilderStore.getState().hasChanges(name);

export const selectableOptions = (kind: ImplementedContentKind, names: string[]): IconSelectOption[] =>
  names.map(name => ({ value: name, disabled: !isSelectableContent(kind, name), disabledTooltip: NOT_IMPLEMENTED_TIP }));
