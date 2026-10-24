// Import de la liste des invités (XLSX ou CSV) — partagé entre l'administration et « npm run import ».
//
// Formats acceptés :
//  1. Celui de la feuille « Invités » : colonnes A/B = côté Rojo (Nom, Nombre), C/D = côté Orimbato
//     (Nom, Nombre), lignes 1–2 = en-têtes.
//  2. Celui de l'export CSV de l'administration (une ligne par invité, colonnes Nom, Côté, Nombre prévu…).

import { straightApostrophes, type Side } from './db';
import { isXlsx, readXlsx, type Cell, type Grid } from './xlsx';

export interface ImportRow {
  name: string;
  side: Side;
  expected_count: number;
  phone: string | null;
  notes: string;
  /** Nom tel qu'il figurait dans le fichier. */
  original: string;
}

export interface IgnoredRow {
  name: string;
  side: Side | null;
  reason: string;
}

export interface ImportParse {
  rows: ImportRow[];
  ignored: IgnoredRow[];
  warnings: string[];
  format: 'feuille' | 'liste';
}

/** Lignes qui ne sont pas des invités à relancer (comparaison sans casse ni accents). */
export const IGNORED_NAMES = ['famille inconnue', 'mpikabary', 'orimbato'];

/** Forme de recherche : sans accents, casse ni espaces en trop, apostrophes typographiques ramenées à « ' ». */
export function fold(s: string): string {
  return straightApostrophes(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Nettoie un nom : espaces, « ? » final, mention « + zaza » (enfants), mots collés en « camelCase »,
 * majuscule initiale. Ex. « koto? » → « Koto », « Soa+ zaza » → « Soa », « tanteLala » → « Tante Lala ».
 * `splitWords: false` garde les mots collés tels quels (noms saisis dans l'administration, ex. « McKoto »).
 */
export function cleanName(raw: string, { splitWords = true }: { splitWords?: boolean } = {}): { name: string; withChildren: boolean } {
  let s = raw.replace(/\s+/g, ' ').trim();
  let withChildren = false;
  if (/\s*\+\s*zaza\s*$/i.test(s)) {
    withChildren = true;
    s = s.replace(/\s*\+\s*zaza\s*$/i, '');
  }
  s = s.replace(/[\s?]+$/g, '').replace(/^[\s?]+/g, '');
  // « tanteLala » → « tante Lala » (minuscule suivie d'une majuscule, sans espace).
  if (splitWords) s = s.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2');
  if (s) s = s.charAt(0).toLocaleUpperCase('fr') + s.slice(1);
  return { name: s, withChildren };
}

function cellText(c: Cell | undefined): string {
  if (c === null || c === undefined) return '';
  return String(c).replace(/\s+/g, ' ').trim();
}

/** Texte d'une cellule en gardant ses retours à la ligne (notes sur plusieurs lignes). */
function multilineText(c: Cell | undefined): string {
  if (c === null || c === undefined) return '';
  return String(c).replace(/\r\n?/g, '\n').trim();
}

/** Retire l'apostrophe que l'export CSV ajoute devant les valeurs commençant par = + - @ (voir csvCell). */
export function unescapeFormula(s: string): string {
  return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
}

function parseCount(c: Cell | undefined): number | null {
  if (c === null || c === undefined || c === '') return null;
  const n = typeof c === 'number' ? c : Number(String(c).replace(',', '.').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function parseSide(s: string): Side | null {
  const f = fold(s);
  if (f.startsWith('rojo')) return 'rojo';
  if (f.startsWith('orimbato')) return 'orimbato';
  return null;
}

class Collector {
  rows: ImportRow[] = [];
  ignored: IgnoredRow[] = [];
  warnings: string[] = [];
  private seen = new Set<string>();

  /** `splitWords` : voir cleanName (désactivé pour l'export de l'administration, dont les noms sont déjà propres). */
  constructor(private readonly splitWords = true) {}

  add(rawName: string, side: Side, count: Cell | undefined, extra: { phone?: string; notes?: string; line: number }) {
    const original = rawName.replace(/\s+/g, ' ').trim();
    if (!original) return;
    if (IGNORED_NAMES.includes(fold(original))) {
      this.ignored.push({ name: original, side, reason: 'ligne ignorée (pas un invité à relancer)' });
      return;
    }
    const { name, withChildren } = cleanName(original, { splitWords: this.splitWords });
    if (!name) {
      this.ignored.push({ name: original, side, reason: 'nom vide après nettoyage' });
      return;
    }
    const key = fold(name);
    if (this.seen.has(key)) {
      this.ignored.push({ name, side, reason: 'nom en double dans le fichier' });
      return;
    }
    this.seen.add(key);
    let n = parseCount(count);
    if (n === null) {
      this.warnings.push(`Ligne ${extra.line} : nombre de personnes manquant ou invalide pour « ${name} » → 1`);
      n = 1;
    } else if (n === 0) {
      this.warnings.push(`Ligne ${extra.line} : « ${name} » est prévu pour 0 personne`);
    } else if (n > 50) {
      this.warnings.push(`Ligne ${extra.line} : nombre de personnes trop grand pour « ${name} » (${n}) → 50`);
      n = 50;
    }
    const notes: string[] = [];
    if (extra.notes) notes.push(extra.notes);
    if (name !== original && !extra.notes) {
      notes.push(`Nom d'origine dans le fichier : « ${original} »${withChildren ? ' (avec enfants)' : ''}`);
    }
    this.rows.push({ name, side, expected_count: n, phone: extra.phone?.trim() || null, notes: notes.join(' — '), original });
  }
}

/** Format « feuille Invités » : A/B = Rojo, C/D = Orimbato ; les données commencent après la ligne « Nom ». */
function parseSheetLayout(grid: Grid): ImportParse {
  const col = new Collector();
  let start = 2;
  const headerIdx = grid.findIndex((r, i) => i < 10 && fold(cellText(r?.[0])) === 'nom');
  if (headerIdx >= 0) start = headerIdx + 1;
  // Colonne Rojo d'abord, puis colonne Orimbato (l'ordre du fichier est conservé dans chaque côté).
  for (const [side, iName] of [['rojo', 0], ['orimbato', 2]] as const) {
    for (let i = start; i < grid.length; i++) {
      const r = grid[i] ?? [];
      const name = cellText(r[iName]);
      if (name) col.add(name, side, r[iName + 1], { line: i + 1 });
    }
  }
  return { rows: col.rows, ignored: col.ignored, warnings: col.warnings, format: 'feuille' };
}

/** Format « liste » (export CSV) : une ligne par invité, colonnes repérées par leur en-tête. */
function parseListLayout(grid: Grid, headerIdx: number): ImportParse {
  const col = new Collector(false);
  const header = (grid[headerIdx] ?? []).map((c) => fold(cellText(c)));
  const find = (...names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const iName = find('nom');
  const iSide = find('cote');
  const iCount = find('nombre prevu', 'nombre', 'personnes');
  const iPhone = find('telephone', 'tel');
  const iNotes = find('notes', 'note');
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const name = unescapeFormula(cellText(r[iName]));
    if (!name) continue;
    const side = parseSide(cellText(r[iSide]));
    if (!side) {
      col.ignored.push({ name, side: null, reason: `côté inconnu « ${cellText(r[iSide])} » (Rojo ou Orimbato attendu)` });
      continue;
    }
    col.add(name, side, iCount >= 0 ? r[iCount] : null, {
      line: i + 1,
      phone: iPhone >= 0 ? unescapeFormula(cellText(r[iPhone])) : undefined,
      notes: iNotes >= 0 ? unescapeFormula(multilineText(r[iNotes])) : undefined,
    });
  }
  return { rows: col.rows, ignored: col.ignored, warnings: col.warnings, format: 'liste' };
}

/**
 * En-tête du format « liste » : « Nom » et « Côté » parmi les 6 premières colonnes. L'en-tête de la feuille
 * « Invités » (Nom, Nombre, Nom, Nombre) n'en est jamais un, même si « Côté » est écrit plus loin sur la ligne.
 */
function isListHeader(r: Cell[] | undefined): boolean {
  const cells = (r ?? []).slice(0, 6).map((c) => fold(cellText(c)));
  if (cells[0] === 'nom' && cells[2] === 'nom') return false;
  return cells.includes('nom') && cells.includes('cote');
}

export function parseGrid(grid: Grid): ImportParse {
  const listHeader = grid.findIndex((r, i) => i < 10 && isListHeader(r));
  return listHeader >= 0 ? parseListLayout(grid, listHeader) : parseSheetLayout(grid);
}

// ---------------------------------------------------------------- CSV

function detectDelimiter(text: string): string {
  const firstLines = text.split(/\r?\n/).slice(0, 5).join('\n');
  let best = ',';
  let bestCount = -1;
  for (const d of [';', ',', '\t']) {
    let n = 0;
    let q = false;
    for (const ch of firstLines) {
      if (ch === '"') q = !q;
      else if (!q && ch === d) n++;
    }
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

/** Analyse CSV (RFC 4180 : guillemets, guillemets doublés, retours à la ligne dans les champs). */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const d = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Échappe une valeur pour un CSV séparé par des points-virgules (Excel en français). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  // Neutralise les formules (injection CSV dans Excel).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- point d'entrée

/** Lit un fichier XLSX ou CSV (feuille « Invités » si présente). */
export function parseGuestFile(data: Uint8Array): ImportParse & { sheet?: string } {
  if (isXlsx(data)) {
    const { name, grid } = readXlsx(data, ['Invités', 'Invites']);
    return { ...parseGrid(grid), sheet: name };
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(data);
  } catch {
    text = new TextDecoder('windows-1252').decode(data);
  }
  return parseGrid(parseCsv(text));
}
