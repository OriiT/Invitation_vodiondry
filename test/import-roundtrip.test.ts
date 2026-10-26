// Export CSV → réimport, et comparaison des noms (src/lib/import.ts, src/lib/import-db.ts, findGuestByName).
// Données fictives uniquement.

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { findGuestByName, nameKey } from '../src/lib/db';
import { fold, parseGuestFile, unescapeFormula } from '../src/lib/import';
import { importRows } from '../src/lib/import-db';
import { BASE, adminGet, adminPost, call, login, makeGuest, type AdminSession } from './helpers';

const utf8 = (s: string) => new TextEncoder().encode(s);

async function importFile(s: AdminSession, content: string | Uint8Array, filename = 'invites.csv'): Promise<Response> {
  const fd = new FormData();
  fd.append('_csrf', s.csrf);
  fd.append('file', new File([content], filename, { type: 'text/csv' }));
  return call('/admin/import', { method: 'POST', headers: { cookie: s.cookie, origin: BASE }, body: fd });
}

async function allGuests() {
  const { results } = await env.DB.prepare('SELECT name, side, expected_count, phone, notes FROM guests ORDER BY name').all();
  return results;
}

async function guestCount(): Promise<number> {
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM guests').first<{ n: number }>())!.n;
}

describe('format « liste » : valeurs neutralisées par l’export', () => {
  it('unescapeFormula retire seulement l’apostrophe ajoutée devant = + - @', () => {
    expect(unescapeFormula("'+261 34 00 000 00")).toBe('+261 34 00 000 00');
    expect(unescapeFormula("'=1+1")).toBe('=1+1');
    expect(unescapeFormula("'-Koto")).toBe('-Koto');
    expect(unescapeFormula("'@Soa")).toBe('@Soa');
    expect(unescapeFormula("'Koto")).toBe("'Koto");
    expect(unescapeFormula("L'invité")).toBe("L'invité");
  });

  it('parseGuestFile rétablit nom, téléphone et notes (CSV comme XLSX passent par le même code)', () => {
    const csv = ['Nom;Côté;Nombre prévu;Téléphone;Notes', "'@Soa;Rojo;1;'+261 34 00 000 05;'=attention"].join('\r\n');
    const p = parseGuestFile(utf8(csv));
    expect(p.format).toBe('liste');
    expect(p.rows).toEqual([
      { name: '@Soa', side: 'rojo', expected_count: 1, phone: '+261 34 00 000 05', notes: '=attention', original: '@Soa' },
    ]);
  });

  it('garde les notes sur plusieurs lignes et les noms tels qu’ils ont été saisis (pas de découpage « McKoto »)', () => {
    const csv = ['Nom;Côté;Nombre prévu;Notes', 'McKoto;Orimbato;2;"Ligne 1\r\nLigne 2"'].join('\r\n');
    const p = parseGuestFile(utf8(csv));
    expect(p.rows).toEqual([
      { name: 'McKoto', side: 'orimbato', expected_count: 2, phone: null, notes: 'Ligne 1\nLigne 2', original: 'McKoto' },
    ]);
    // La feuille « Invités » garde son nettoyage habituel.
    const sheet = parseGuestFile(utf8('Rojo;;Orimbato;\r\nNom;Nombre;Nom;Nombre\r\ntanteLala;2;;\r\n'));
    expect(sheet.format).toBe('feuille');
    expect(sheet.rows[0].name).toBe('Tante Lala');
  });

  it('la feuille « Invités » reste reconnue même si « Côté » est écrit plus loin sur la ligne d’en-tête', () => {
    const csv = ['Rojo;;Orimbato;;;;', 'Nom;Nombre;Nom;Nombre;;Côté;Total', 'Tante Lala;3;Famille Rabe;4;;Rojo;3'].join('\r\n');
    const p = parseGuestFile(utf8(csv));
    expect(p.format).toBe('feuille');
    expect(p.rows.map((r) => [r.name, r.side, r.expected_count])).toEqual([
      ['Tante Lala', 'rojo', 3],
      ['Famille Rabe', 'orimbato', 4],
    ]);
  });
});

describe('comparaison des noms', () => {
  it('nameKey ignore la casse (lettres accentuées comprises) et les espaces en trop', () => {
    expect(nameKey('  HÉLÈNE   Rabe ')).toBe(nameKey('Hélène Rabe'));
    expect(nameKey('Hélène')).toBe(nameKey('Hélène')); // forme décomposée (NFD)
    expect(nameKey('Hélène')).not.toBe(nameKey('Helene'));
  });

  it('findGuestByName trouve « HÉLÈNE » quand « Hélène » existe', async () => {
    const g = await makeGuest({ name: 'Hélène' });
    expect(await findGuestByName(env.DB, 'HÉLÈNE')).toEqual({ id: g.id });
    expect(await findGuestByName(env.DB, ' hélène ')).toEqual({ id: g.id });
    expect(await findGuestByName(env.DB, 'Soa')).toBeNull();
  });

  it('l’ajout manuel refuse un doublon ne différant que par la casse accentuée', async () => {
    const s = await login();
    await makeGuest({ name: 'Élodie Rabe' });
    const res = await adminPost(s, '/admin/guests', { name: 'ÉLODIE RABE', side: 'rojo', expected_count: '1' });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('existe déjà');
    expect(await guestCount()).toBe(1);
  });

  it('importRows ne duplique ni un nom en majuscules accentuées ni un nom saisi avant nettoyage', async () => {
    await makeGuest({ name: 'Hélène' });
    await makeGuest({ name: 'Soa + zaza' }); // saisi tel quel dans l'administration
    const p = parseGuestFile(utf8('Nom;Côté;Nombre prévu\r\nHÉLÈNE;Rojo;1\r\nSoa + zaza;Rojo;3\r\nKoto;Orimbato;2\r\n'));
    expect(p.rows.map((r) => r.name)).toEqual(['HÉLÈNE', 'Soa', 'Koto']);
    const out = await importRows(env.DB, p.rows);
    expect(out.added.map((r) => r.name)).toEqual(['Koto']);
    expect(out.skipped.map((r) => r.name)).toEqual(['HÉLÈNE', 'Soa']);
    expect(await guestCount()).toBe(3);
  });
});

describe('export → réimport', () => {
  it('restaure exactement les invités, notes sur plusieurs lignes et téléphones « + » compris', async () => {
    const s = await login();
    await makeGuest({ name: 'Tante Lala', side: 'rojo', expected_count: 3, phone: '+261 34 00 000 03', notes: 'Arrive la veille\nChambre réservée' });
    await makeGuest({ name: 'McKoto', side: 'orimbato', expected_count: 2, notes: '=pas une formule' });
    await makeGuest({ name: 'Soa + zaza', side: 'rojo', expected_count: 1 });
    await makeGuest({ name: 'Famille Rabe', side: 'orimbato', expected_count: 4, notes: 'Allergie; "noix"' });
    const before = await allGuests();

    const csv = new Uint8Array(await (await adminGet(s, '/admin/export.csv')).arrayBuffer());

    // Réimport sur la liste existante : rien n'est ajouté.
    const same = await importFile(s, csv, 'invites-vodiondry.csv');
    expect(same.status).toBe(200);
    expect(await same.text()).toContain('aucun nouvel invité');
    expect(await allGuests()).toEqual(before);

    // Réimport sur une base vide : la liste revient à l'identique.
    await env.DB.prepare('DELETE FROM guests').run();
    const res = await importFile(s, csv, 'invites-vodiondry.csv');
    expect(res.status).toBe(200);
    const after = await allGuests();
    // « Soa + zaza » est nettoyé à l'import (règle documentée) ; tout le reste est identique.
    expect(after.filter((g) => g.name !== 'Soa')).toEqual(before.filter((g) => g.name !== 'Soa + zaza'));
    expect(after.find((g) => g.name === 'Soa')).toMatchObject({ side: 'rojo', expected_count: 1 });

    // Et un nouveau réimport n'ajoute toujours rien.
    await importFile(s, csv, 'invites-vodiondry.csv');
    expect(await guestCount()).toBe(4);
  });
});

describe('réimport après des modifications dans l’administration', () => {
  const SHEET = 'Nom;Côté;Nombre prévu\r\nKoto;Rojo;2\r\nSoa;Orimbato;1\r\nTante Lala;Rojo;3\r\n';

  it('un invité renommé n’est pas recréé', async () => {
    const s = await login();
    await importFile(s, SHEET);
    const koto = (await env.DB.prepare("SELECT id FROM guests WHERE name = 'Koto'").first<{ id: number }>())!;
    const renamed = await adminPost(s, `/admin/guests/${koto.id}`, { name: 'Koto Rabe', side: 'rojo', expected_count: '2' });
    expect(renamed.status).toBe(303);
    // Deuxième renommage : le premier nom reste connu.
    await adminPost(s, `/admin/guests/${koto.id}`, { name: 'Tonton Koto Rabe', side: 'rojo', expected_count: '2' });

    const res = await importFile(s, `${SHEET}Hery;Orimbato;2\r\n`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('1 invité ajouté');
    expect((await allGuests()).map((g) => g.name)).toEqual(['Hery', 'Soa', 'Tante Lala', 'Tonton Koto Rabe']);
  });

  it('un invité supprimé puis réimporté est signalé sur la page de résultat', async () => {
    const s = await login();
    await importFile(s, SHEET);
    const soa = (await env.DB.prepare("SELECT id FROM guests WHERE name = 'Soa'").first<{ id: number }>())!;
    expect((await adminPost(s, `/admin/guests/${soa.id}/delete`)).status).toBe(303);

    const res = await importFile(s, SHEET);
    const html = await res.text();
    expect(html).toContain('Invités supprimés puis réajoutés (1)');
    expect(html).toContain('1 invité ajouté');
    expect(await guestCount()).toBe(3);
    // Un import qui n'ajoute rien ne signale rien.
    expect(await (await importFile(s, SHEET)).text()).not.toContain('supprimés puis réajoutés');
  });
});

describe('apostrophes typographiques (iPhone : « ’ »)', () => {
  it('nameKey et fold confondent ’ et \'', () => {
    expect(nameKey('Tonton Hery d’Antsirabe')).toBe(nameKey("tonton hery d'antsirabe"));
    expect(fold('D‘Antsirabe')).toBe(fold("d'antsirabe"));
  });

  it('l’ajout refuse le doublon, la recherche le trouve, l’import ne le duplique pas', async () => {
    const s = await login();
    await makeGuest({ name: "Tonton Hery d'Antsirabe" });
    const dup = await adminPost(s, '/admin/guests', { name: 'Tonton Hery d’Antsirabe', side: 'rojo', expected_count: '1' });
    expect(dup.status).toBe(400);
    expect(await dup.text()).toContain('existe déjà');
    const search = await (await adminGet(s, `/admin?q=${encodeURIComponent('d’antsi')}`)).text();
    expect(search).toContain('Tonton Hery d&#39;Antsirabe');
    const p = parseGuestFile(utf8('Nom;Côté;Nombre prévu\r\nTonton Hery d’Antsirabe;Rojo;1\r\n'));
    expect((await importRows(env.DB, p.rows)).added).toHaveLength(0);
    expect(await guestCount()).toBe(1);
  });
});
