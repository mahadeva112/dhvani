import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildScriptDocx, scriptDocumentXml, scriptDocxRows } from './scriptDocx.ts';
import type { AudioSegment } from '../types';

const seg = (id: number, startTime: number, endTime: number, textSource: string, textTarget: string, speaker?: string): AudioSegment => ({
  id,
  startTime,
  endTime,
  duration: endTime - startTime,
  textSource,
  textTarget,
  speaker,
});

const script = () => [
  seg(1, 0, 2, 'The mind is a tool.', 'मन एक साधन है।'),
  seg(2, 2.3, 4, 'Use it\nwell.', 'इसका अच्छे से उपयोग करें।'),
  seg(3, 7, 9, 'After a long pause.', 'लंबे विराम के बाद।'),
  seg(4, 9.1, 10, '', ''),
];

const source = (s: AudioSegment) => s.textSource || '';
const target = (s: AudioSegment) => s.textTarget || '';

test('passages become paragraphs: every cue kept, in order, joined by spaces', () => {
  const rows = scriptDocxRows(script(), source, target, 1.2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, 'The mind is a tool. Use it well.');
  assert.equal(rows[0].target, 'मन एक साधन है। इसका अच्छे से उपयोग करें।');
  assert.equal(rows[1].source, 'After a long pause.');
  assert.deepEqual([rows[1].start, rows[1].end], [7, 10]);
});

test('a speaker change starts a new row', () => {
  const rows = scriptDocxRows([seg(1, 0, 1, 'A', 'अ', 'S1'), seg(2, 1.1, 2, 'B', 'ब', 'S2')], source, target);
  assert.equal(rows.length, 2);
});

/** A talk with a pause of 1.5 s after every cue: each cue is its own passage. */
const talk = (n: number, speakerAt?: number) =>
  Array.from({ length: n }, (_, i) =>
    seg(i + 1, i * 5, i * 5 + 3.5, i % 3 === 1 ? `Line ${i + 1} runs on` : `Line ${i + 1}.`, `पंक्ति ${i + 1}`, speakerAt !== undefined && i >= speakerAt ? 'S2' : 'S1')
  );

test('Long and Medium join passages into paragraphs of about a minute or 25 seconds', () => {
  const cues = talk(36); // three minutes
  const short = scriptDocxRows(cues, source, target, 1.2, 'short');
  const medium = scriptDocxRows(cues, source, target, 1.2, 'medium');
  const long = scriptDocxRows(cues, source, target, 1.2, 'long');
  assert.equal(short.length, 36);
  assert.ok(long.length >= 2 && long.length <= 4, `long: ${long.length}`);
  assert.ok(medium.length > long.length && medium.length < short.length, `medium: ${medium.length}`);
  // Every word kept, in order.
  const all = (rows: { source: string }[]) => rows.map((r) => r.source).join(' ');
  assert.equal(all(long), all(short));
  // A paragraph ends where a sentence ends.
  for (const row of long.slice(0, -1)) assert.match(row.source, /\.$/);
  for (const row of long) assert.ok(row.end - row.start < 125);
});

test('Full is the whole script in one row, each speaker turn a paragraph under their name', () => {
  const cues = talk(6, 3);
  const rows = scriptDocxRows(cues, source, target, 1.2, 'full');
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].start, rows[0].end], [0, 28.5]);
  assert.deepEqual(rows[0].turns!.map((t) => t.speaker), ['S1', 'S2']);
  assert.ok(rows[0].turns![1].source.startsWith('Line 4'));
  const doc = scriptDocumentXml({ title: 'T', sourceLanguage: 'English', targetLanguage: 'Hindi', rows });
  assert.equal([...doc.matchAll(/<w:tr>/g)].length, 2); // the header and the one row
  assert.ok(doc.includes('>S2: <') && doc.includes('पंक्ति 4'));
  // One speaker: no names, one paragraph.
  const solo = scriptDocxRows(talk(36), source, target, 1.2, 'full');
  assert.equal(solo.length, 1);
  assert.equal(solo[0].turns, undefined);
  assert.equal(solo[0].source.split(' ').length, scriptDocxRows(talk(36), source, target, 1.2, 'short').map((r) => r.source).join(' ').split(' ').length);
});

test('a new speaker starts a new paragraph at any size', () => {
  const rows = scriptDocxRows(talk(6, 3), source, target, 1.2, 'long');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].turns, undefined);
  assert.ok(rows[1].source.startsWith('Line 4'));
});

test('the document has the original on the left, the dub on the right, and escapes text', () => {
  const doc = scriptDocumentXml({
    title: 'Talk <1> & more',
    sourceLanguage: 'English',
    targetLanguage: 'Hindi',
    rows: [{ source: 'Left "side"', target: 'दायाँ', start: 0, end: 65 }],
  });
  assert.ok(doc.includes('Talk &lt;1&gt; &amp; more'));
  const cells = [...doc.matchAll(/<w:tc>(.*?)<\/w:tc>/g)].map((m) => m[1]);
  assert.equal(cells.length, 4);
  assert.ok(cells[0].includes('>English<') && cells[1].includes('>Hindi<'));
  assert.ok(cells[2].includes('Left &quot;side&quot;') && cells[2].includes('0:00 – 1:05'));
  assert.ok(cells[3].includes('दायाँ'));
  // Word will not open the file when the table's properties are out of the schema's order.
  const tblPr = doc.match(/<w:tblPr>(.*?)<\/w:tblPr>/)![1];
  const order = ['tblW', 'tblBorders', 'tblLayout', 'tblCellMar'].map((tag) => tblPr.indexOf(`<w:${tag}`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(order.every((i) => i >= 0));
});

test('the .docx is a zip with the parts Word needs', async () => {
  const bytes = await buildScriptDocx({ title: 'T', sourceLanguage: 'English', targetLanguage: 'Hindi', rows: scriptDocxRows(script(), source, target) });
  const zip = await JSZip.loadAsync(bytes);
  const parts = ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'docProps/app.xml', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/settings.xml'];
  for (const part of parts) assert.ok(zip.file(part), part);
  assert.deepEqual(Object.values(zip.files).filter((f) => f.dir), [], 'no folder entries');
});
