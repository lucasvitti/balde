// Mapear conhecimento bruto (G1) — text extraction from raw uploads, zero npm deps.
// docx/xlsx are ZIP containers (read with a minimal central-directory walker + zlib
// inflateRaw); PDF text comes from the poppler `pdftotext` CLI baked into the image
// (same pattern as git/duckdb: image-level tools, the app keeps zero runtime deps).
import { inflateRawSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Minimal ZIP reader: central directory → { name -> Buffer } for wanted entries.
function readZipEntries(buffer, wanted) {
  const out = new Map();
  // End of central directory record: scan back for signature 0x06054b50.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP inválido (sem EOCD).');
  const count = buffer.readUInt16LE(eocd + 10);
  let off = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(off) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(off + 10);
    const compSize = buffer.readUInt32LE(off + 20);
    const nameLen = buffer.readUInt16LE(off + 28);
    const extraLen = buffer.readUInt16LE(off + 30);
    const commentLen = buffer.readUInt16LE(off + 32);
    const localOff = buffer.readUInt32LE(off + 42);
    const name = buffer.toString('utf8', off + 46, off + 46 + nameLen);
    if (!wanted || wanted.includes(name)) {
      // Local header: sizes there may be zero (data descriptor) — trust the central record.
      const lNameLen = buffer.readUInt16LE(localOff + 26);
      const lExtraLen = buffer.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = buffer.subarray(dataStart, dataStart + compSize);
      out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const stripXml = (xml) =>
  String(xml)
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export function docxText(buffer) {
  const entries = readZipEntries(buffer, ['word/document.xml']);
  const doc = entries.get('word/document.xml');
  if (!doc) throw new Error('.docx sem word/document.xml');
  return stripXml(doc.toString('utf8'));
}

export function xlsxText(buffer) {
  // Basic: the shared-strings pool covers most textual content; enough for concept mining.
  const entries = readZipEntries(buffer, ['xl/sharedStrings.xml']);
  const ss = entries.get('xl/sharedStrings.xml');
  if (!ss) return '';
  const values = [...String(ss.toString('utf8')).matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]);
  return values.join('\n').trim();
}

export async function pdfText(filePath) {
  const bin = process.env.PDFTOTEXT_BIN || 'pdftotext';
  try {
    const { stdout } = await execFileAsync(bin, ['-layout', '-q', filePath, '-'], { maxBuffer: 16 * 1024 * 1024 });
    return String(stdout || '').trim();
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error('pdftotext indisponível neste ambiente.');
    throw new Error(`pdftotext falhou: ${error.message}`);
  }
}

export const INGEST_TEXT_EXTS = ['.md', '.txt', '.csv', '.tsv', '.json', '.yml', '.yaml'];
export const INGEST_DOC_EXTS = ['.pdf', '.docx', '.xlsx'];
export const INGEST_IMG_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];

// Dispatcher: returns { text } or throws. Plain-text formats read as UTF-8 (csv capped later
// by the caller's per-doc AI budget); images have no text in G1 (they surface as anexos).
export async function extractTextFor(name, filePath, buffer) {
  const ext = String(name).toLowerCase().slice(String(name).lastIndexOf('.'));
  if (INGEST_TEXT_EXTS.includes(ext)) return { text: buffer.toString('utf8') };
  if (ext === '.docx') return { text: docxText(buffer) };
  if (ext === '.xlsx') return { text: xlsxText(buffer) };
  if (ext === '.pdf') return { text: await pdfText(filePath) };
  if (INGEST_IMG_EXTS.includes(ext)) return { text: '', image: true };
  throw new Error(`Formato não suportado: ${ext}`);
}
