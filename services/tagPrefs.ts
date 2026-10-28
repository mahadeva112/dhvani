import { useEffect, useState } from 'react';
import { isTagName } from '../server/lib/lineTags.js';

/** A few tags saved under a name, to put on a line at once (Retake pro). */
export interface TagStyle {
  name: string;
  tags: string[];
}

/** Tags the user typed that are not in TAG_LIBRARY, and their saved styles: kept on this computer only. */
export interface TagPrefs {
  own: string[];
  styles: TagStyle[];
}

const KEY = 'dhvani.retakeTags';
const EMPTY: TagPrefs = { own: [], styles: [] };

const read = (): TagPrefs => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!saved || typeof saved !== 'object') return EMPTY;
    const own = Array.isArray(saved.own) ? saved.own.filter((t: unknown) => typeof t === 'string' && isTagName(t)).slice(0, 40) : [];
    const styles = Array.isArray(saved.styles)
      ? saved.styles
          .filter((s: any) => s && typeof s.name === 'string' && s.name.trim() && Array.isArray(s.tags))
          .map((s: any) => ({ name: s.name.trim().slice(0, 40), tags: s.tags.filter((t: unknown) => typeof t === 'string' && isTagName(t)).slice(0, 8) }))
          .filter((s: TagStyle) => s.tags.length > 0)
          .slice(0, 20)
      : [];
    return { own, styles };
  } catch {
    return EMPTY;
  }
};

/** The user's own tags and styles, shared by every retake window and saved as they change. */
export const useTagPrefs = () => {
  const [prefs, setPrefs] = useState<TagPrefs>(read);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {}
  }, [prefs]);
  const addOwn = (tag: string) => {
    const t = tag.trim().toLowerCase();
    if (!isTagName(t)) return;
    setPrefs((p) => (p.own.includes(t) ? p : { ...p, own: [t, ...p.own].slice(0, 40) }));
  };
  const removeOwn = (tag: string) => setPrefs((p) => ({ ...p, own: p.own.filter((t) => t !== tag) }));
  const saveStyle = (style: TagStyle) =>
    setPrefs((p) => ({ ...p, styles: [style, ...p.styles.filter((s) => s.name !== style.name)].slice(0, 20) }));
  const removeStyle = (name: string) => setPrefs((p) => ({ ...p, styles: p.styles.filter((s) => s.name !== name) }));
  return { prefs, addOwn, removeOwn, saveStyle, removeStyle };
};
