import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { saveFileAs } from './saveFile.ts';

const as = { description: 'Subtitles', mime: 'application/x-subrip', extension: '.srt' };
const g = globalThis as any;

afterEach(() => {
  delete g.showSaveFilePicker;
});

test('closing the Save dialog is a cancel, and nothing is written', async () => {
  let wrote = false;
  g.showSaveFilePicker = async () => {
    throw Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
  };
  const outcome = await saveFileAs(new Blob(['x']), 'talk.srt', as);
  assert.deepEqual(outcome, { status: 'cancelled' });
  assert.equal(wrote, false);
});

test('the file is written where the user picked, under the name they gave it', async () => {
  const written: string[] = [];
  let options: any;
  g.showSaveFilePicker = async (o: any) => {
    options = o;
    return {
      name: 'my talk.srt',
      createWritable: async () => ({
        write: async (b: Blob) => void written.push(await b.text()),
        close: async () => {},
      }),
    };
  };
  const outcome = await saveFileAs(new Blob(['১\n']), 'talk.srt', as);
  assert.deepEqual(outcome, { status: 'saved', name: 'my talk.srt', downloaded: false });
  assert.deepEqual(written, ['১\n']);
  assert.equal(options.suggestedName, 'talk.srt');
  assert.deepEqual(options.types[0].accept, { 'application/x-subrip': ['.srt'] });
});

test('a write that fails is reported, and the half-written file is dropped', async () => {
  let aborted = false;
  g.showSaveFilePicker = async () => ({
    name: 'talk.srt',
    createWritable: async () => ({
      write: async () => {
        throw Object.assign(new Error('No space left on the disk'), { name: 'QuotaExceededError' });
      },
      close: async () => {},
      abort: async () => void (aborted = true),
    }),
  });
  await assert.rejects(saveFileAs(new Blob(['x']), 'talk.srt', as), /No space left/);
  assert.equal(aborted, true);
});

test('a file built after the dialog opens is written whole', async () => {
  const order: string[] = [];
  let written: Blob | undefined;
  g.showSaveFilePicker = async () => {
    order.push('dialog');
    return { name: 'script.docx', createWritable: async () => ({ write: async (b: Blob) => void (written = b), close: async () => {} }) };
  };
  const outcome = await saveFileAs(async () => {
    order.push('build');
    return new Blob(['PK']);
  }, 'script.docx', as);
  assert.equal(outcome.status, 'saved');
  assert.deepEqual(order, ['dialog', 'build']);
  assert.equal(await written?.text(), 'PK');
});

test('a window that opens the dialog but will not write downloads the file instead', async () => {
  const downloaded: string[] = [];
  const doc = g.document;
  g.document = {
    createElement: () => ({ click() {} , set download(name: string) { downloaded.push(name); } }),
    body: { appendChild() {}, removeChild() {} },
  };
  g.showSaveFilePicker = async () => ({
    name: 'script.docx',
    createWritable: async () => {
      throw Object.assign(new Error('The request is not allowed by the user agent or the platform in the current context.'), { name: 'NotAllowedError' });
    },
  });
  try {
    const outcome = await saveFileAs(new Blob(['PK']), 'script.docx', as);
    assert.deepEqual(outcome, { status: 'saved', name: 'script.docx', downloaded: true });
    assert.deepEqual(downloaded, ['script.docx']);
  } finally {
    g.document = doc;
  }
});

const withDownloads = async (run: (downloaded: string[]) => Promise<void>) => {
  const downloaded: string[] = [];
  const doc = g.document;
  g.document = {
    createElement: () => ({ click() {}, set download(name: string) { downloaded.push(name); } }),
    body: { appendChild() {}, removeChild() {} },
  };
  try {
    await run(downloaded);
  } finally {
    g.document = doc;
  }
};

test('a write that leaves the picked file empty downloads the file instead', async () => {
  g.showSaveFilePicker = async () => ({
    name: 'script.docx',
    createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    getFile: async () => new Blob([]),
  });
  await withDownloads(async (downloaded) => {
    const outcome = await saveFileAs(new Blob(['PK']), 'script.docx', as);
    assert.deepEqual(outcome, { status: 'saved', name: 'script.docx', downloaded: true });
    assert.deepEqual(downloaded, ['script.docx']);
  });
});

test("Claude's browser pane never opens the Save dialog: the file is downloaded", async () => {
  let opened = false;
  g.showSaveFilePicker = async () => {
    opened = true;
    throw new Error('should not open');
  };
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 Claude/4.29.0 Chrome/152.0' }, configurable: true });
  try {
    await withDownloads(async (downloaded) => {
      const outcome = await saveFileAs(new Blob(['PK']), 'script.docx', as);
      assert.equal(outcome.status, 'saved');
      assert.deepEqual(downloaded, ['script.docx']);
    });
  } finally {
    if (nav) Object.defineProperty(globalThis, 'navigator', nav);
    else delete g.navigator;
  }
  assert.equal(opened, false);
});
