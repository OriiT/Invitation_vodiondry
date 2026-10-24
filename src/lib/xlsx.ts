// Lecteur XLSX minimal (dézippage fflate + lecture XML), utilisable dans le Worker comme dans Node.
// Ne lit que les valeurs des cellules (texte, nombres, booléens) d'une feuille.

import { unzipSync, strFromU8 } from 'fflate';

export type Cell = string | number | boolean | null;
export type Grid = Cell[][];

const MAX_UNCOMPRESSED = 30 * 1024 * 1024;

export function isXlsx(data: Uint8Array): boolean {
  // Signature ZIP « PK\x03\x04 »
  return data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}

function decodeXml(s: string): string {
  return s
    .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, e: string) => {
      switch (e) {
        case 'lt': return '<';
        case 'gt': return '>';
        case 'amp': return '&';
        case 'quot': return '"';
        case 'apos': return "'";
      }
      const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = decodeXml(m[3] ?? m[4] ?? '');
  return out;
}

/** Texte d'un élément <si> / <is> : concatène les <t>, sauf ceux de la transcription phonétique <rPh>. */
function richText(xml: string): string {
  const noPh = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let s = '';
  for (const m of noPh.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) s += decodeXml(m[1] ?? '');
  return s;
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface XlsxSheet {
  name: string;
  grid: Grid;
}

/** Liste des feuilles du classeur (nom + chemin du XML). */
function sheetPaths(files: Record<string, Uint8Array>): { name: string; path: string }[] {
  const wb = files['xl/workbook.xml'];
  const rels = files['xl/_rels/workbook.xml.rels'];
  if (!wb || !rels) throw new Error('Fichier XLSX invalide (classeur introuvable)');
  const relMap = new Map<string, string>();
  for (const m of strFromU8(rels).matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (!a.Id || !a.Target) continue;
    const t = a.Target.replace(/\\/g, '/');
    relMap.set(a.Id, t.startsWith('/') ? t.slice(1) : `xl/${t}`);
  }
  const out: { name: string; path: string }[] = [];
  for (const m of strFromU8(wb).matchAll(/<sheet\b[^>]*>/g)) {
    const a = attrs(m[0]);
    const rid = a['r:id'] ?? Object.entries(a).find(([k]) => k.endsWith(':id'))?.[1];
    const path = rid ? relMap.get(rid) : undefined;
    if (a.name && path) out.push({ name: a.name, path: path.replace(/\/\.\//g, '/') });
  }
  return out;
}

/**
 * Lit une feuille d'un fichier XLSX. Par défaut la première feuille dont le nom correspond
 * (sans tenir compte de la casse ni des accents) à l'un des `preferred`, sinon la première feuille.
 */
export function readXlsx(data: Uint8Array, preferred: string[] = []): XlsxSheet {
  let total = 0;
  const files = unzipSync(data, {
    filter: (f) => {
      total += f.originalSize;
      if (total > MAX_UNCOMPRESSED) throw new Error('Fichier XLSX trop volumineux');
      return f.name.startsWith('xl/') && (f.name.endsWith('.xml') || f.name.endsWith('.rels'));
    },
  });
  const sheets = sheetPaths(files);
  if (!sheets.length) throw new Error('Aucune feuille trouvée dans le fichier XLSX');
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const wanted = preferred.map(fold);
  const sheet = sheets.find((s) => wanted.includes(fold(s.name))) ?? sheets[0];

  const shared: string[] = [];
  const ss = files['xl/sharedStrings.xml'];
  if (ss) for (const m of strFromU8(ss).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) shared.push(richText(m[1] ?? ''));

  const xml = files[sheet.path];
  if (!xml) throw new Error(`Feuille « ${sheet.name} » illisible`);
  const grid: Grid = [];
  for (const rm of strFromU8(xml).matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rAttr = attrs(rm[1]);
    const rowIdx = rAttr.r ? Number(rAttr.r) - 1 : grid.length;
    if (!Number.isInteger(rowIdx) || rowIdx < 0 || rowIdx > 100_000) continue;
    const row: Cell[] = [];
    let nextCol = 0;
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(cm[1]);
      const col = a.r ? colIndex(a.r) : nextCol;
      nextCol = col + 1;
      if (col > 200) continue;
      const inner = cm[2] ?? '';
      const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value: Cell = null;
      switch (a.t) {
        case 's':
          value = v !== undefined ? (shared[Number(v)] ?? null) : null;
          break;
        case 'inlineStr':
          value = richText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? '');
          break;
        case 'str':
        case 'e':
          value = v !== undefined ? decodeXml(v) : null;
          break;
        case 'b':
          value = v === '1';
          break;
        default:
          if (v !== undefined && v.trim() !== '') {
            const n = Number(v);
            value = Number.isFinite(n) ? n : decodeXml(v);
          }
      }
      row[col] = value;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
    grid[rowIdx] = row;
  }
  for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
  return { name: sheet.name, grid };
}
