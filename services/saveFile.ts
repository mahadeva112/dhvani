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
}) => Promise<{ name: string; createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void>; abort?: () => Promise<void> }> }>;

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

export const saveFileAs = async (data: Blob, suggestedName: string, as: SaveAs): Promise<SaveOutcome> => {
  const picker = (globalThis as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (typeof picker === 'function') {
    let handle: Awaited<ReturnType<SavePicker>>;
    try {
      handle = await picker({ suggestedName, types: [{ description: as.description, accept: { [as.mime]: [as.extension] } }] });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (name === 'AbortError') return { status: 'cancelled' };
      // The page may not open the dialog here (no click to answer, or a policy): download instead.
      if (name !== 'SecurityError' && name !== 'NotAllowedError' && name !== 'TypeError') throw err;
      download(data, suggestedName);
      return { status: 'saved', name: suggestedName, downloaded: true };
    }
    const writable = await handle.createWritable();
    try {
      await writable.write(data);
      await writable.close();
    } catch (err) {
      await writable.abort?.().catch(() => {});
      throw err;
    }
    return { status: 'saved', name: handle.name, downloaded: false };
  }
  download(data, suggestedName);
  return { status: 'saved', name: suggestedName, downloaded: true };
};
