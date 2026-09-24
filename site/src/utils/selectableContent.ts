// Which characters / weapons / sets / echoes a picker lets you choose. Pickers list everything and
// grey out what can't be calculated yet, rather than hiding it.
import { DataLoader, type ImplementedContentKind } from './DataLoader';
import { useBuilderStore } from '../store/useBuilderStore';
import type { IconSelectOption } from '../components/common/IconSelect';

export const NOT_IMPLEMENTED_TIP = 'Not yet implemented';

// Has mechanics in the data repo, or was given some through the Mechanics Builder.
export const isSelectableContent = (kind: ImplementedContentKind, name: string): boolean =>
  DataLoader.isContentImplemented(kind, name) || useBuilderStore.getState().hasChanges(name);

export const selectableOptions = (kind: ImplementedContentKind, names: string[]): IconSelectOption[] =>
  names.map(name => ({ value: name, disabled: !isSelectableContent(kind, name), disabledTooltip: NOT_IMPLEMENTED_TIP }));
