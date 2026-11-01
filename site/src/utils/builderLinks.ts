// Shortcuts into the Mechanics Builder: open an entity with its node search filled in.
import { DataLoader } from './DataLoader';
import { MechanicKey, SYSTEM_NAMESPACE } from './MechanicKey';
import { checkBuilderItemFreshness } from './dataFreshness';
import { useBuilderStore, mechFolderFor } from '../store/useBuilderStore';
import { goTo } from '../hooks/useRoute';
import { viewPath } from '../config/routes';
import { IMAGE_FOLDERS, type ImageFolder } from '../data/db';

/** An entity to open and what to search in it. */
export interface BuilderTarget {
  entity: string;
  search: string;
  // The mechanic to flash (a node name or key), e.g. the one that applied a buff.
  flash?: string;
}

/** The Builder library folder `entity` is listed in, or null if it isn't one. */
export function imageFolderOf(entity: string | undefined): ImageFolder | null {
  if (!entity) return null;
  if (entity === SYSTEM_NAMESPACE) return IMAGE_FOLDERS.SYSTEM;
  if (DataLoader.characterDB[entity]) return IMAGE_FOLDERS.CHARACTERS;
  if (DataLoader.weaponDB[entity]) return IMAGE_FOLDERS.WEAPONS;
  if (DataLoader.sonataSets.includes(entity)) return IMAGE_FOLDERS.ECHO_SETS;
  if (DataLoader.allMainEchoes.includes(entity)) return IMAGE_FOLDERS.ECHOES;
  return null;
}

/** A move key ("Suoming_Rift Cleaver"): its owner, searched by name. */
export function moveTarget(actionKey: string | undefined): BuilderTarget | null {
  if (!actionKey) return null;
  const { namespace, name } = MechanicKey.parse(actionKey);
  return imageFolderOf(namespace) && name ? { entity: namespace, search: name, flash: actionKey } : null;
}

/** An effect: the entity that defines it (owner, else its source's or name's namespace), searched by name; flashes its `source`. */
export function effectTarget(effect: { name?: string; source?: string; sourceOwner?: string }): BuilderTarget | null {
  if (!effect.name) return null;
  const candidates = [effect.sourceOwner, effect.source && MechanicKey.parse(effect.source).namespace, MechanicKey.parse(effect.name).namespace];
  const entity = candidates.find(c => imageFolderOf(c || undefined));
  if (!entity) return null;
  // Namespaced names ("Suoming_Deep Mind") are searched without the prefix.
  const prefix = MechanicKey.parse(effect.name).namespace;
  const search = imageFolderOf(prefix) ? MechanicKey.stripNamespace(effect.name, prefix) : effect.name;
  return { entity, search, flash: effect.source };
}

// `flash` as one of `mechanics`' keys: a key, a node name, or a name in `entity`.
function flashNodeId(entity: string, flash: string | undefined, mechanics: Record<string, { name?: string }>): string | null {
  if (!flash) return null;
  if (mechanics[flash]) return flash;
  const built = MechanicKey.build(entity, flash);
  if (mechanics[built]) return built;
  return Object.keys(mechanics).find(key => mechanics[key].name === flash) ?? null;
}

/** Tooltip line for elements that open their target on double-click. */
export const DETAILS_HINT_HTML = '<div class="tooltip-hint">Double-click for details</div>';

/** Opens `target.entity` in the Builder with `target.search` filled in. */
export async function openInBuilder({ entity, search, flash }: BuilderTarget): Promise<void> {
  const folder = imageFolderOf(entity);
  if (!folder) return;
  const rarity = DataLoader.characterDB[entity]?.rarity ?? DataLoader.weaponDB[entity]?.rarity ?? 5;
  const { setActiveChar, setMechanicSearch, flashNode } = useBuilderStore.getState();
  await checkBuilderItemFreshness(mechFolderFor(folder), entity);
  await setActiveChar(entity, folder, rarity);
  setMechanicSearch(search);
  flashNode(flashNodeId(entity, flash, useBuilderStore.getState().mechanics));
  goTo(viewPath('builder'));
}
