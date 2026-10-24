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
