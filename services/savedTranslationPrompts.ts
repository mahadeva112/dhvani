import { getPresetById, SAVED_PROMPT_ID_PREFIX } from './translationPromptPresets.ts';

/**
 * Translation prompts the user saved under their own names. They live on this
 * computer only, apart from the built-in styles, so an update that changes or
 * removes a built-in style never touches them.
 */
export interface SavedTranslationPrompt {
  id: string;
  name: string;
  prompt: string;
  savedAt: number;
}

const STORAGE_KEY = 'dhvani_saved_prompts';

/** A list read back from storage, keeping only entries that are whole. */
export const parseSavedPrompts = (raw: string | null | undefined): SavedTranslationPrompt[] => {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter(
      (item): item is SavedTranslationPrompt =>
        !!item &&
        typeof item.id === 'string' &&
        item.id.startsWith(SAVED_PROMPT_ID_PREFIX) &&
        typeof item.name === 'string' &&
        item.name.trim() !== '' &&
        typeof item.prompt === 'string'
    );
  } catch {
    return [];
  }
};

export const loadSavedPrompts = (): SavedTranslationPrompt[] => {
  try {
    return parseSavedPrompts(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
};

const storeSavedPrompts = (list: SavedTranslationPrompt[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {}
};

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/**
 * Saves a prompt under a name. A name already in the list (in any case) is
 * that prompt written again, so saving twice never leaves two of one name.
 */
export const upsertSavedPrompt = (
  list: SavedTranslationPrompt[],
  name: string,
  prompt: string,
  now = Date.now()
): { list: SavedTranslationPrompt[]; saved: SavedTranslationPrompt; replaced: boolean } => {
  const existing = list.find((item) => sameName(item.name, name));
  if (existing) {
    const saved = { ...existing, name: name.trim(), prompt, savedAt: now };
    return { list: list.map((item) => (item.id === existing.id ? saved : item)), saved, replaced: true };
  }
  const saved = { id: `${SAVED_PROMPT_ID_PREFIX}${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim(), prompt, savedAt: now };
  return { list: [...list, saved], saved, replaced: false };
};

export const saveNamedPrompt = (name: string, prompt: string) => {
  const result = upsertSavedPrompt(loadSavedPrompts(), name, prompt);
  storeSavedPrompts(result.list);
  return result;
};

/** Writes new text into a saved prompt, keeping its name. */
export const updateSavedPromptText = (id: string, prompt: string) => {
  const list = loadSavedPrompts().map((item) => (item.id === id ? { ...item, prompt, savedAt: Date.now() } : item));
  storeSavedPrompts(list);
  return list;
};

/** Renames a saved prompt; refused (null) when another one already has that name. */
export const renameSavedPrompt = (id: string, name: string): SavedTranslationPrompt[] | null => {
  const list = loadSavedPrompts();
  if (!name.trim() || list.some((item) => item.id !== id && sameName(item.name, name))) return null;
  const next = list.map((item) => (item.id === id ? { ...item, name: name.trim() } : item));
  storeSavedPrompts(next);
  return next;
};

export const deleteSavedPrompt = (id: string) => {
  const list = loadSavedPrompts().filter((item) => item.id !== id);
  storeSavedPrompts(list);
  return list;
};

/**
 * The name to show for a style choice: a saved prompt's own name, or the
 * built-in style's. A project made on another computer may name a saved
 * prompt this one does not have; its text still came with the project.
 */
export const promptStyleName = (presetId: string | null | undefined) => {
  if (presetId?.startsWith(SAVED_PROMPT_ID_PREFIX)) {
    return loadSavedPrompts().find((item) => item.id === presetId)?.name || 'Your saved prompt';
  }
  return getPresetById(presetId || '').name;
};
