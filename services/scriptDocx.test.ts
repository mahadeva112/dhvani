import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildScriptDocx, scriptDocumentXml, scriptDocxRows } from './scriptDocx.ts';
import { buildScriptParagraphs } from '../components/review/passages.ts';
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

/** A talk with a pause of 1.5 s after every cue. */
const talk = (n: number, speakerAt?: number) =>
  Array.from({ length: n }, (_, i) =>
    seg(i + 1, i * 5, i * 5 + 3.5, i % 3 === 1 ? `Line ${i + 1} runs on` : `Line ${i + 1}.`, `पंक्ति ${i + 1}`, speakerAt !== undefined && i >= speakerAt ? 'S2' : 'S1')
  );

test('a short script is one paragraph: every cue kept, in order, joined by spaces', () => {
  const rows = scriptDocxRows(script(), source, target);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'The mind is a tool. Use it well. After a long pause.');
  assert.equal(rows[0].target, 'मन एक साधन है। इसका अच्छे से उपयोग करें। लंबे विराम के बाद।');
  assert.deepEqual([rows[0].start, rows[0].end], [0, 10]);
});

test("the rows are the Script view's own paragraphs", () => {
  const cues = talk(120); // ten minutes
  const rows = scriptDocxRows(cues, source, target);
  const view = buildScriptParagraphs(cues, source);
  assert.ok(view.length > 1);
  assert.deepEqual(
    rows.map((r) => [r.start, r.end]),
    view.map((p) => [p.cues[0].startTime, p.cues[p.cues.length - 1].endTime])
  );
  // Every word kept, in order.
  assert.equal(rows.map((r) => r.source).join(' '), cues.map(source).join(' '));
});

test('a paragraph with two speakers puts each turn under their name', () => {
  const rows = scriptDocxRows(talk(6, 3), source, target);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].start, rows[0].end], [0, 28.5]);
  assert.deepEqual(rows[0].turns!.map((t) => t.speaker), ['S1', 'S2']);
  assert.ok(rows[0].turns![1].source.startsWith('Line 4'));
  const doc = scriptDocumentXml({ title: 'T', sourceLanguage: 'English', targetLanguage: 'Hindi', rows });
  assert.equal([...doc.matchAll(/<w:tr>/g)].length, 2); // the header and the one row
  assert.ok(doc.includes('>S2: <') && doc.includes('पंक्ति 4'));
  // One speaker: no names.
  assert.equal(scriptDocxRows(talk(6), source, target)[0].turns, undefined);
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
