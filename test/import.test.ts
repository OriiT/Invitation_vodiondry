// Tests de l'analyse des fichiers d'invités (src/lib/import.ts, src/lib/xlsx.ts) — données fictives uniquement.

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { listGuests } from '../src/lib/db';
import { cleanName, csvCell, fold, parseCsv, parseGrid, parseGuestFile, toCsv } from '../src/lib/import';
import { isXlsx, readXlsx } from '../src/lib/xlsx';
import { BASE, call, login, type AdminSession } from './helpers';
import { buildXlsx, colLetter, type FixtureCell, type FixtureSheet } from './xlsx-fixture';

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Feuille « Invités » fictive : A/B = Rojo, C/D = Orimbato, H/I = récapitulatif à ignorer. */
const INVITES_ROWS: FixtureCell[][] = [
  ['ROJO', null, 'ORIMBATO', null, null, null, null, 'Invités Rojo', 12],
  ['Nom', 'Nombre', 'Nom', 'Nombre', null, null, null, 'Invités Orimbato', 9],
  ['Tante Lala', 3, 'Famille Rabe', 4, null, null, null, 'Total invités', 21],
  ['lalaRabe', 2, 'koto?', 1, null, null, null, 'Poste', 'Quantité'],
  ['Bema+ zaza', 3, 'Soa + zaza  ', 2, null, null, null, 'Entrée', 21],
  ['Famille inconnue', 5, 'Mpikabary', 1],
  [{ rich: ['Famille ', 'Ravelo'], phonetic: 'ふりがな' }, 4, 'Orimbato', 1],
  [{ inline: 'Rakoto & Fils' }, 2, 'Hery', 0],
  [{ xml: '<t>Ren&#233; &amp; Vola &lt;3</t>' }, '2', 'Nivo', null],
  ['Fara', 'deux', 'tante lala ', 1],
  [null, null, 'Mamy', 99],
];

const BUDGET_SHEET: FixtureSheet = {
  name: 'Budget',
  rows: [
    ['Poste', 'Montant'],
    ['Salle', 1200],
    ['Nom', 'Côté'], // ne doit pas être lue : ce n'est pas la feuille « Invités »
  ],
};

function invitesXlsx(): Uint8Array {
  return buildXlsx([BUDGET_SHEET, { name: 'Invités', rows: INVITES_ROWS }, { name: 'Notes', rows: [['Rien ici']] }]);
}

describe('lecteur XLSX', () => {
  it('reconnaît une archive XLSX', () => {
    expect(isXlsx(invitesXlsx())).toBe(true);
    expect(isXlsx(utf8('Nom;Côté\r\n'))).toBe(false);
    expect(isXlsx(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });

  it('choisit la feuille préférée même si ce n’est pas la première, sinon la première', () => {
    const data = invitesXlsx();
    expect(readXlsx(data, ['Invités']).name).toBe('Invités');
    expect(readXlsx(data, ['invites']).name).toBe('Invités'); // sans casse ni accents
    expect(readXlsx(data).name).toBe('Budget');
    expect(readXlsx(data, ['Inexistante']).name).toBe('Budget');
  });

  it('lit chaînes partagées, texte enrichi, entités XML, chaînes en ligne, nombres, booléens et formules', () => {
    const data = buildXlsx([
      {
        name: 'Feuille1',
        rows: [
          ['Texte simple', 42, 3.5, true, false],
          [{ rich: ['Tante ', 'La', 'la'] }, { rich: ['Ko', 'to'], phonetic: 'コト' }, { inline: 'A & B <C> "D" \'E\'' }],
          [{ xml: '<r><t>Ren&#233;</t></r><r><t xml:space="preserve"> &amp; Soa&#x21;</t></r>' }, { formula: 'A1&"!"', value: 'Texte simple!' }],
          [],
          [null, null, null, 'D5'],
          ['Texte simple'], // chaîne partagée réutilisée
        ],
      },
    ]);
    const { grid } = readXlsx(data);
    expect(grid[0]).toEqual(['Texte simple', 42, 3.5, true, false]);
    expect(grid[1]).toEqual(['Tante Lala', 'Koto', 'A & B <C> "D" \'E\'']);
    expect(grid[2]).toEqual(['René & Soa!', 'Texte simple!']);
    expect(grid[3]).toEqual([]); // ligne absente du fichier
    expect(grid[4]).toEqual([null, null, null, 'D5']);
    expect(grid[5]).toEqual(['Texte simple']);
  });

  it('place les cellules sans référence r="A1" dans l’ordre', () => {
    const { grid } = readXlsx(buildXlsx([{ name: 'S', refs: false, rows: [['a', 1], ['b', 2, 'c']] }]));
    expect(grid).toEqual([
      ['a', 1],
      ['b', 2, 'c'],
    ]);
  });

  it('lit les colonnes au-delà de Z', () => {
    const row: FixtureCell[] = [];
    row[27] = 'AB';
    const { grid } = readXlsx(buildXlsx([{ name: 'S', rows: [row] }]));
    expect(colLetter(27)).toBe('AB');
    expect(grid[0][27]).toBe('AB');
  });

  it('refuse une archive qui n’est pas un classeur', () => {
    expect(() => readXlsx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]))).toThrow();
  });
});

describe('nettoyage des noms', () => {
  it.each([
    ['lalaRabe', 'Lala Rabe', false],
    ['koto?', 'Koto', false],
    ['Bema+ zaza', 'Bema', true],
    ['Soa + zaza', 'Soa', true],
    ['Soa +ZAZA', 'Soa', true],
    ['  Tante   Lala  ', 'Tante Lala', false],
    ['? hery ?', 'Hery', false],
    ['élodie', 'Élodie', false],
    ['Famille Rabe', 'Famille Rabe', false],
  ])('« %s » → « %s »', (raw, name, withChildren) => {
    expect(cleanName(raw)).toEqual({ name, withChildren });
  });

  it('compare sans casse, accents ni espaces superflus', () => {
    expect(fold('  Famille   INCONNUE ')).toBe('famille inconnue');
    expect(fold('Élodie')).toBe('elodie');
  });
});

describe('import de la feuille « Invités » (XLSX)', () => {
  const parsed = () => parseGuestFile(invitesXlsx());

  it('lit la feuille « Invités » (pas la première) au format « feuille »', () => {
    const p = parsed();
    expect(p.sheet).toBe('Invités');
    expect(p.format).toBe('feuille');
  });

  it('extrait les invités par côté, noms nettoyés, sans les colonnes de récapitulatif', () => {
    const p = parsed();
    const rojo = p.rows.filter((r) => r.side === 'rojo').map((r) => [r.name, r.expected_count]);
    const orimbato = p.rows.filter((r) => r.side === 'orimbato').map((r) => [r.name, r.expected_count]);
    expect(rojo).toEqual([
      ['Tante Lala', 3],
      ['Lala Rabe', 2],
      ['Bema', 3],
      ['Famille Ravelo', 4],
      ['Rakoto & Fils', 2],
      ['René & Vola <3', 2],
      ['Fara', 1],
    ]);
    expect(orimbato).toEqual([
      ['Famille Rabe', 4],
      ['Koto', 1],
      ['Soa', 2],
      ['Hery', 0],
      ['Nivo', 1],
      ['Mamy', 50],
    ]);
    const names = p.rows.map((r) => r.name).join('|');
    for (const summary of ['Invités Rojo', 'Total invités', 'Poste', 'Entrée', 'Budget', 'Salle']) expect(names).not.toContain(summary);
  });

  it('garde le nom d’origine dans les notes quand il a été nettoyé', () => {
    const p = parsed();
    const byName = new Map(p.rows.map((r) => [r.name, r]));
    expect(byName.get('Koto')).toMatchObject({ original: 'koto?', notes: 'Nom d\'origine dans le fichier : « koto? »' });
    expect(byName.get('Bema')?.notes).toBe('Nom d\'origine dans le fichier : « Bema+ zaza » (avec enfants)');
    expect(byName.get('Soa')?.notes).toContain('(avec enfants)');
    expect(byName.get('Soa')?.original).toBe('Soa + zaza'); // espaces de fin retirés
    expect(byName.get('Tante Lala')?.notes).toBe('');
    expect(byName.get('Tante Lala')?.phone).toBeNull();
  });

  it('ignore « Famille inconnue », « Mpikabary », « Orimbato » et les doublons du fichier', () => {
    const p = parsed();
    expect(p.ignored.map((i) => [i.name, i.side])).toEqual([
      ['Famille inconnue', 'rojo'],
      ['Mpikabary', 'orimbato'],
      ['Orimbato', 'orimbato'],
      ['Tante lala', 'orimbato'],
    ]);
    expect(p.ignored[0].reason).toContain('pas un invité');
    expect(p.ignored[3].reason).toBe('nom en double dans le fichier');
    const names = p.rows.map((r) => fold(r.name));
    for (const n of ['famille inconnue', 'mpikabary', 'orimbato']) expect(names).not.toContain(n);
  });

  it('signale les nombres à 0, manquants, invalides ou trop grands', () => {
    const w = parsed().warnings;
    expect(w).toHaveLength(4);
    expect(w).toContain('Ligne 8 : « Hery » est prévu pour 0 personne');
    expect(w).toContain('Ligne 9 : nombre de personnes manquant ou invalide pour « Nivo » → 1');
    expect(w).toContain('Ligne 10 : nombre de personnes manquant ou invalide pour « Fara » → 1');
    expect(w).toContain('Ligne 11 : nombre de personnes trop grand pour « Mamy » (99) → 50');
  });

  it('les lignes d’en-tête ROJO / ORIMBATO et Nom / Nombre ne sont jamais des invités', () => {
    const p = parsed();
    const all = [...p.rows.map((r) => r.name), ...p.ignored.map((i) => i.name)].map(fold);
    expect(all).not.toContain('rojo');
    expect(all).not.toContain('nom');
    expect(all).not.toContain('nombre');
  });

  it('sans ligne « Nom », les données commencent à la ligne 3', () => {
    const p = parseGrid([['Rojo', null, 'Orimbato'], ['', '', '', ''], ['Koto', 2, 'Soa', 1]]);
    expect(p.rows.map((r) => [r.name, r.side, r.expected_count])).toEqual([
      ['Koto', 'rojo', 2],
      ['Soa', 'orimbato', 1],
    ]);
  });
});

describe('CSV', () => {
  it('détecte le séparateur « ; » ou « , » et gère guillemets, BOM et CRLF', () => {
    expect(parseCsv('﻿a;b;c\r\n1;"2;3";"dit ""oui"""\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2;3', 'dit "oui"'],
    ]);
    expect(parseCsv('a,b,c\n1,"2,3","ligne 1\nligne 2"\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2,3', 'ligne 1\nligne 2'],
    ]);
    expect(parseCsv('a\tb\r\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('x;y\r1;2\r')).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
    expect(parseCsv('')).toEqual([]);
  });

  it('lit la feuille « Invités » enregistrée en CSV (séparateur ; avec BOM et CRLF)', () => {
    const csv = '﻿ROJO;;ORIMBATO;\r\nNom;Nombre;Nom;Nombre\r\nTante Lala;3;Famille Rabe;4\r\nkoto?;1;Mpikabary;2\r\n"Soa + zaza";2;;\r\n';
    const p = parseGuestFile(utf8(csv));
    expect(p.format).toBe('feuille');
    expect(p.sheet).toBeUndefined();
    expect(p.rows.map((r) => [r.name, r.side, r.expected_count])).toEqual([
      ['Tante Lala', 'rojo', 3],
      ['Koto', 'rojo', 1],
      ['Soa', 'rojo', 2],
      ['Famille Rabe', 'orimbato', 4],
    ]);
    expect(p.ignored.map((i) => i.name)).toEqual(['Mpikabary']);
  });

  it('lit la même feuille en CSV séparé par des virgules', () => {
    const p = parseGuestFile(utf8('Rojo,,Orimbato,\nNom,Nombre,Nom,Nombre\n"Rabe, Koto",2,Soa,"1"\n'));
    expect(p.rows.map((r) => [r.name, r.side, r.expected_count])).toEqual([
      ['Rabe, Koto', 'rojo', 2],
      ['Soa', 'orimbato', 1],
    ]);
  });

  it('lit un CSV encodé en Windows-1252 (Excel ancien)', () => {
    // « Côté » et « Hélène » en Windows-1252 : ô = 0xF4, é = 0xE9
    const bytes = new Uint8Array([
      ...utf8('Nom;C'), 0xf4, ...utf8('t'), 0xe9, ...utf8(';Nombre pr'), 0xe9, ...utf8('vu\r\nH'), 0xe9, ...utf8('l'), 0xe8, ...utf8('ne;Rojo;2\r\n'),
    ]);
    const p = parseGuestFile(bytes);
    expect(p.format).toBe('liste');
    expect(p.rows.map((r) => [r.name, r.side, r.expected_count])).toEqual([['Hélène', 'rojo', 2]]);
  });

  it('lit le format « liste » (export de l’administration) : Nom;Côté;Nombre prévu;Téléphone;Notes', () => {
    const csv = [
      '﻿Nom;Côté;Nombre prévu;Téléphone;Notes;Lien;Code',
      'Tante Lala;Rojo;3;034 12 345 67;"Vient de Fianarantsoa; arrive la veille";https://exemple/i/x;x',
      'Famille Rabe;orimbato;4;;;;',
      'Koto;ORIMBATO;;+261 32 00 000 00;;;',
      'Inconnu;Les deux;2;;;;',
      'Mpikabary;Rojo;1;;;;',
      'tante lala;Orimbato;1;;;;',
      ';Rojo;1;;;;',
    ].join('\r\n');
    const p = parseGuestFile(utf8(csv));
    expect(p.format).toBe('liste');
    expect(p.rows).toEqual([
      {
        name: 'Tante Lala',
        side: 'rojo',
        expected_count: 3,
        phone: '034 12 345 67',
        notes: 'Vient de Fianarantsoa; arrive la veille',
        original: 'Tante Lala',
      },
      { name: 'Famille Rabe', side: 'orimbato', expected_count: 4, phone: null, notes: '', original: 'Famille Rabe' },
      { name: 'Koto', side: 'orimbato', expected_count: 1, phone: '+261 32 00 000 00', notes: '', original: 'Koto' },
    ]);
    expect(p.ignored.map((i) => [i.name, i.reason.split(' ')[0]])).toEqual([
      ['Inconnu', 'côté'],
      ['Mpikabary', 'ligne'],
      ['Tante lala', 'nom'],
    ]);
    expect(p.ignored[0].reason).toBe('côté inconnu « Les deux » (Rojo ou Orimbato attendu)');
    expect(p.warnings).toEqual(['Ligne 4 : nombre de personnes manquant ou invalide pour « Koto » → 1']);
  });

  it('csvCell neutralise les formules et protège ; " et retours à la ligne', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+261 34 00 000 00')).toBe("'+261 34 00 000 00");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell('@SOMME(A1:A2)')).toBe("'@SOMME(A1:A2)");
    expect(csvCell('=HYPERLINK("x";"y")')).toBe('"\'=HYPERLINK(""x"";""y"")"');
    expect(csvCell('Rabe; Koto')).toBe('"Rabe; Koto"');
    expect(csvCell('dit "oui"')).toBe('"dit ""oui"""');
    expect(csvCell('ligne 1\nligne 2')).toBe('"ligne 1\nligne 2"');
    expect(csvCell('Rabe, Koto')).toBe('Rabe, Koto');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(3)).toBe('3');
    expect(csvCell('Tante Lala')).toBe('Tante Lala');
  });

  it('toCsv : BOM, « ; », CRLF, relu à l’identique par parseCsv', () => {
    const rows = [
      ['Nom', 'Notes'],
      ['Tante Lala', 'Avec "Neny"; et Soa\nà la même table'],
    ];
    const csv = toCsv(rows);
    expect(csv.startsWith('﻿Nom;Notes\r\n')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(parseCsv(csv)).toEqual(rows);
  });
});

describe('import XLSX de bout en bout (POST /admin/import)', () => {
  async function upload(s: AdminSession, data: Uint8Array, name = 'liste-invites.xlsx'): Promise<Response> {
    const fd = new FormData();
    fd.set('_csrf', s.csrf);
    fd.set('file', new File([data], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    return call('/admin/import', { method: 'POST', headers: { cookie: s.cookie, origin: BASE }, body: fd });
  }

  it('ajoute les invités de la feuille « Invités », puis ne duplique rien au second import', async () => {
    const s = await login();
    const res = await upload(s, invitesXlsx());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Mpikabary'); // listé parmi les lignes ignorées
    expect(html).toContain('René &amp; Vola &lt;3'); // échappé
    expect(html).not.toContain('Vola <3');

    const guests = await listGuests(env.DB);
    expect(guests).toHaveLength(13);
    const byName = new Map(guests.map((g) => [g.name, g]));
    expect(byName.get('Tante Lala')).toMatchObject({ side: 'rojo', expected_count: 3 });
    expect(byName.get('Famille Rabe')).toMatchObject({ side: 'orimbato', expected_count: 4 });
    expect(byName.get('Koto')?.notes).toContain('koto?');
    expect(byName.get('René & Vola <3')).toMatchObject({ side: 'rojo', expected_count: 2 });
    for (const n of ['Famille inconnue', 'Mpikabary', 'Orimbato']) expect(byName.has(n)).toBe(false);
    expect(new Set(guests.map((g) => g.code)).size).toBe(13);
    for (const g of guests) expect(g.code).toMatch(/^[0-9a-z]{8}$/);

    const again = await upload(s, invitesXlsx());
    expect(again.status).toBe(200);
    expect(await listGuests(env.DB)).toHaveLength(13);
  });

  it('refuse l’import sans jeton CSRF', async () => {
    const s = await login();
    const fd = new FormData();
    fd.set('file', new File([invitesXlsx()], 'liste.xlsx'));
    const res = await call('/admin/import', { method: 'POST', headers: { cookie: s.cookie, origin: BASE }, body: fd });
    expect(res.status).toBe(403);
    expect(await listGuests(env.DB)).toHaveLength(0);
  });
});
