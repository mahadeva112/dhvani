/**
 * Saves a file where the user picks, with the system's Save dialog when the
 * page can open one (the desktop app and Chromium can), else as a download.
 * Closing the dialog is a normal answer: it comes back as `cancelled`, and
 * nothing is written.
 */

export type SaveOutcome = { status: 'saved'; name: string; downloaded: boolean } | { status: 'cancelled' };

export interface SaveAs {
  /** "Subtitles", shown in the dialog's type list. */
  description: string;
  mime: string;
  /** ".srt" */
  extension: string;
}

type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{
  name: string;
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void>; abort?: () => Promise<void> }>;
  getFile?: () => Promise<Blob>;
}>;

/**
 * Claude's browser pane opens the Save dialog and makes the file, but never
 * writes to it: the file is left empty and Word opens a blank page. There the
 * file is downloaded instead.
 */
const pickerWrites = () => !/\bClaude\//.test((globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? '');

const download = (data: Blob, name: string) => {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/**
 * `data` can be made after the dialog opens: the dialog must open while the
 * click still counts, so a file that takes a moment to build is passed as a function.
 */
export const saveFileAs = async (data: Blob | (() => Promise<Blob>), suggestedName: string, as: SaveAs): Promise<SaveOutcome> => {
  const contents = () => (data instanceof Blob ? Promise.resolve(data) : data());
  const picker = (globalThis as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (typeof picker === 'function' && pickerWrites()) {
    let handle: Awaited<ReturnType<SavePicker>>;
    try {
      handle = await picker({ suggestedName, types: [{ description: as.description, accept: { [as.mime]: [as.extension] } }] });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (name === 'AbortError') return { status: 'cancelled' };
      // The page may not open the dialog here (no click to answer, or a policy): download instead.
      if (name !== 'SecurityError' && name !== 'NotAllowedError' && name !== 'TypeError') throw err;
      download(await contents(), suggestedName);
      return { status: 'saved', name: suggestedName, downloaded: true };
    }
    const blob = await contents();
    let writable: Awaited<ReturnType<Awaited<ReturnType<SavePicker>>['createWritable']>>;
    try {
      writable = await handle.createWritable();
    } catch (err) {
      // Some windows (an embedded browser, a policy) open the dialog but refuse to write
      // to the file picked, leaving it empty: download instead, so the file still arrives whole.
      const name = (err as { name?: string } | null)?.name;
      if (name !== 'SecurityError' && name !== 'NotAllowedError') throw err;
      download(blob, suggestedName);
      return { status: 'saved', name: suggestedName, downloaded: true };
    }
    try {
      await writable.write(blob);
      await writable.close();
    } catch (err) {
      await writable.abort?.().catch(() => {});
      throw err;
    }
    // A window that took the write but left the file empty: download it, so a whole copy arrives.
    const size = await handle.getFile?.().then((f) => f.size, () => null);
    if (size === 0 && blob.size > 0) {
      download(blob, suggestedName);
      return { status: 'saved', name: suggestedName, downloaded: true };
    }
    return { status: 'saved', name: handle.name, downloaded: false };
  }
  download(await contents(), suggestedName);
  return { status: 'saved', name: suggestedName, downloaded: true };
};
