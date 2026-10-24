// Fabrique un petit classeur .xlsx en mémoire (fflate zipSync) pour les tests de l'import.
// Uniquement des données fictives.
//
//   buildXlsx([
//     { name: 'Budget', rows: [['Poste', 'Montant'], ['Salle', 1200]] },
//     { name: 'Invités', rows: [['ROJO', null, 'ORIMBATO'], ['Nom', 'Nombre', 'Nom', 'Nombre'], ['Tante Lala', 3]] },
//   ]);
//
// Types de cellules :
//   'texte'                         → chaîne partagée (xl/sharedStrings.xml, t="s"), dédoublonnée
//   42                              → nombre
//   true / false                    → booléen (t="b")
//   { inline: 'texte' }             → chaîne en ligne (t="inlineStr")
//   { rich: ['Famille ', 'Rabe'] }  → chaîne partagée en texte enrichi (plusieurs <r>), avec { phonetic } facultatif (<rPh>, ignoré à la lecture)
//   { formula: 'A1&B1', value: 'x' }→ résultat texte d'une formule (t="str")
//   { xml: '<t>Ren&#233;</t>' }     → chaîne partagée écrite telle quelle (XML brut du <si>)
//   null / undefined                → cellule absente

import { strToU8, zipSync } from 'fflate';

export type FixtureCell =
  | string
  | number
  | boolean
  | null
  | undefined
  | { inline: string }
  | { rich: string[]; phonetic?: string }
  | { formula: string; value: string }
  | { xml: string };

export interface FixtureSheet {
  name: string;
  rows: FixtureCell[][];
  /** false : cellules et lignes sans attribut r="A1" (position déduite de l'ordre). Par défaut : true. */
  refs?: boolean;
}

/** Échappe le texte pour XML (contenu et attributs). */
export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** 0 → A, 25 → Z, 26 → AA… */
export function colLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const T = (s: string) => `<t xml:space="preserve">${xmlEscape(s)}</t>`;

class SharedStrings {
  private items: string[] = [];
  private index = new Map<string, number>();
  private refs = 0;

  add(xml: string): number {
    this.refs++;
    let i = this.index.get(xml);
    if (i === undefined) {
      i = this.items.length;
      this.items.push(xml);
      this.index.set(xml, i);
    }
    return i;
  }

  toXml(): string {
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.refs}" uniqueCount="${this.items.length}">` +
      this.items.map((x) => `<si>${x}</si>`).join('') +
      '</sst>'
    );
  }
}

function cellXml(cell: FixtureCell, ref: string, ss: SharedStrings): string {
  const r = ref ? ` r="${ref}"` : '';
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'string') return `<c${r} t="s"><v>${ss.add(T(cell))}</v></c>`;
  if (typeof cell === 'number') return `<c${r}><v>${cell}</v></c>`;
  if (typeof cell === 'boolean') return `<c${r} t="b"><v>${cell ? 1 : 0}</v></c>`;
  if ('inline' in cell) return `<c${r} t="inlineStr"><is>${T(cell.inline)}</is></c>`;
  if ('rich' in cell) {
    const runs = cell.rich.map((part, i) => `<r>${i % 2 ? '<rPr><b/><sz val="11"/></rPr>' : '<rPr><sz val="11"/></rPr>'}${T(part)}</r>`);
    const ph = cell.phonetic ? `<rPh sb="0" eb="1">${T(cell.phonetic)}</rPh><phoneticPr fontId="1"/>` : '';
    return `<c${r} t="s"><v>${ss.add(runs.join('') + ph)}</v></c>`;
  }
  if ('xml' in cell) return `<c${r} t="s"><v>${ss.add(cell.xml)}</v></c>`;
  return `<c${r} t="str"><f>${xmlEscape(cell.formula)}</f><v>${xmlEscape(cell.value)}</v></c>`;
}

function sheetXml(sheet: FixtureSheet, ss: SharedStrings): string {
  const refs = sheet.refs !== false;
  const rows = sheet.rows
    .map((row, i) => {
      const cells = row.map((c, j) => cellXml(c, refs ? `${colLetter(j)}${i + 1}` : '', ss)).join('');
      if (refs && !cells) return ''; // ligne vide : absente du fichier, comme dans Excel
      return `<row${refs ? ` r="${i + 1}"` : ''}>${cells}</row>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheetData>${rows}</sheetData></worksheet>`
  );
}

/** Construit un fichier .xlsx (octets d'une archive ZIP) contenant les feuilles demandées, dans l'ordre. */
export function buildXlsx(sheets: FixtureSheet[]): Uint8Array {
  if (!sheets.length) throw new Error('Au moins une feuille');
  const ss = new SharedStrings();
  const files: Record<string, Uint8Array> = {};
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s, ss));
  });

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '</Types>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' +
    sheets.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>';

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    '</Relationships>';

  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
    'xl/sharedStrings.xml': strToU8(ss.toXml()),
    ...files,
  });
}
