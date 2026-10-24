import JSZip from 'jszip';
import type { AudioSegment } from '../types';
import { DEFAULT_PASSAGE_PAUSE, buildPassages } from '../components/review/passages.ts';

/**
 * The script as a Word document: one table row per passage, the original's
 * lines run together as a paragraph on the left, the dub's on the right. The
 * passages are the Script view's, so the file reads like its Paragraph layout.
 * Nothing is rewritten: each side is the cues' own text, joined by spaces.
 */

export interface ScriptDocxRow {
  source: string;
  target: string;
  start: number;
  end: number;
}

export interface ScriptDocxOptions {
  title: string;
  sourceLanguage: string;
  targetLanguage: string;
  rows: ScriptDocxRow[];
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The passages as table rows; a passage with no words on either side is left out. */
export const scriptDocxRows = (
  segments: AudioSegment[],
  sourceOf: (seg: AudioSegment) => string,
  targetOf: (seg: AudioSegment) => string,
  pause: number = DEFAULT_PASSAGE_PAUSE
): ScriptDocxRow[] =>
  buildPassages(segments, pause)
    .map(({ cues }) => ({
      source: cues.map((seg) => oneLine(sourceOf(seg))).filter(Boolean).join(' '),
      target: cues.map((seg) => oneLine(targetOf(seg))).filter(Boolean).join(' '),
      start: cues[0].startTime,
      end: cues[cues.length - 1].endTime,
    }))
    .filter((row) => row.source || row.target);

const xml = (text: string) =>
  text
    // Characters XML 1.0 cannot hold would make Word refuse the file.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

// Nirmala UI ships with Windows and covers every Indic script; Word falls back on its own elsewhere.
const FONTS = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Nirmala UI" w:eastAsia="Calibri"/>';

/** A run of text; sizes are in half-points. */
const run = (text: string, { size = 22, bold = false, color }: { size?: number; bold?: boolean; color?: string } = {}) =>
  `<w:r><w:rPr>${FONTS}${bold ? '<w:b/><w:bCs/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;

const para = (runs: string, after = 0, line = 300) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="${after}" w:line="${line}" w:lineRule="auto"/></w:pPr>${runs}</w:p>`;

// A4 with 2 cm margins: 11906 − 2 × 1134 twips of text width, split evenly.
const COL = 4819;

const cell = (content: string, shade?: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="${COL}" w:type="dxa"/>${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}</w:tcPr>${content}</w:tc>`;

const BORDER = 'w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"';

export const scriptDocumentXml = ({ title, sourceLanguage, targetLanguage, rows }: ScriptDocxOptions) => {
  const left = sourceLanguage || 'Original';
  const right = targetLanguage || 'Dub';
  const header =
    '<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' +
    cell(para(run(left, { bold: true, size: 22 })), 'EDEDED') +
    cell(para(run(right, { bold: true, size: 22 })), 'EDEDED') +
    '</w:tr>';
  const body = rows
    .map(
      (row) =>
        '<w:tr>' +
        cell(para(run(`${clock(row.start)} – ${clock(row.end)}`, { size: 16, color: '808080' }), 40) + para(run(row.source))) +
        cell(para(run(' ', { size: 16 }), 40) + para(run(row.target))) +
        '</w:tr>'
    )
    .join('');
  const table =
    // Word refuses the file when tblPr's children are out of the schema's order.
    `<w:tbl><w:tblPr><w:tblW w:w="${COL * 2}" w:type="dxa"/>` +
    `<w:tblBorders><w:top ${BORDER}/><w:left ${BORDER}/><w:bottom ${BORDER}/><w:right ${BORDER}/><w:insideH ${BORDER}/><w:insideV ${BORDER}/></w:tblBorders>` +
    '<w:tblLayout w:type="fixed"/>' +
    '<w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="140" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tblCellMar>' +
    `</w:tblPr><w:tblGrid><w:gridCol w:w="${COL}"/><w:gridCol w:w="${COL}"/></w:tblGrid>${header}${body}</w:tbl>`;
  const passages = `${rows.length} ${rows.length === 1 ? 'passage' : 'passages'}`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    para(run(title, { bold: true, size: 32 }), 80) +
    para(run(`${left} → ${right} · ${passages}`, { size: 18, color: '808080' }), 240) +
    table +
    // Word needs a paragraph after a table, and the page set up here.
    para('') +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>'
  );
};

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
  '</Types>';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>` +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  `<Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/>` +
  '</Relationships>';

const DOCUMENT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  `<Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>` +
  `<Relationship Id="rId2" Type="${REL}/settings" Target="settings.xml"/>` +
  '</Relationships>';

// Viewers that do not fall back on their own defaults (some previews show a blank page) need these.
const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  `<w:docDefaults><w:rPrDefault><w:rPr>${FONTS}<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:bidi="hi-IN"/></w:rPr></w:rPrDefault>` +
  '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>' +
  '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
  '</w:styles>';

const SETTINGS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>';

const coreProps = (title: string) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
  `<dc:title>${xml(title)}</dc:title><dc:creator>Dhvani</dc:creator>` +
  `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created>` +
  '</cp:coreProperties>';

const APP_PROPS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Dhvani</Application></Properties>';

/** The .docx file's bytes. */
export const buildScriptDocx = async (options: ScriptDocxOptions): Promise<Uint8Array> => {
  // No folder entries: Word never writes them, and some readers stop at one.
  const zip = new JSZip();
  const add = (path: string, text: string) => zip.file(path, text, { createFolders: false });
  add('[Content_Types].xml', CONTENT_TYPES);
  add('_rels/.rels', ROOT_RELS);
  add('docProps/core.xml', coreProps(options.title));
  add('docProps/app.xml', APP_PROPS);
  add('word/document.xml', scriptDocumentXml(options));
  add('word/_rels/document.xml.rels', DOCUMENT_RELS);
  add('word/styles.xml', STYLES);
  add('word/settings.xml', SETTINGS);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
};

export const scriptDocxFileName = (targetLanguage: string) =>
  `dhvani_${(targetLanguage || 'dub').toLowerCase().replace(/\s+/g, '_')}_script.docx`;
