// Limites de l'offre gratuite Cloudflare (requêtes et lignes D1) et abus d'un lien d'invitation.
// Données fictives uniquement.

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { GUEST_SELECT, recordOpen } from '../src/lib/db';
import { parseGuestFile } from '../src/lib/import';
import { importRows } from '../src/lib/import-db';
import { RSVP_CODE_LIMIT } from '../src/routes/api';
import { BASE, adminPost, call, callWith, countingDb, login, makeGuest, rsvp, uniqueIp, type AdminSession } from './helpers';

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Liste fictive au format « liste » (export CSV) : « Invité fictif 001 »… */
function fictionalCsv(n: number): string {
  const lines = ['Nom;Côté;Nombre prévu'];
  for (let i = 1; i <= n; i++) lines.push(`Invité fictif ${String(i).padStart(3, '0')};${i % 2 ? 'Rojo' : 'Orimbato'};${(i % 4) + 1}`);
  return lines.join('\r\n');
}

function importForm(s: AdminSession, content: string): RequestInit {
  const fd = new FormData();
  fd.append('_csrf', s.csrf);
  fd.append('file', new File([content], 'invites.csv', { type: 'text/csv' }));
  return { method: 'POST', headers: { cookie: s.cookie, origin: BASE }, body: fd };
}

async function guestCount(): Promise<number> {
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM guests').first<{ n: number }>())!.n;
}

describe('import : nombre de requêtes D1 (50 au plus par appel sur l’offre gratuite)', () => {
  it('importRows : 150 invités en quelques requêtes, codes tous différents', async () => {
    await makeGuest({ name: 'Invité fictif 007' }); // déjà présent
    const rows = parseGuestFile(utf8(fictionalCsv(150))).rows;
    rows.push({ ...rows[9] }); // même nom deux fois dans la liste : ajouté une seule fois
    const { db, count } = countingDb(env.DB);
    const out = await importRows(db, rows);
    expect(out.added).toHaveLength(149);
    expect(out.skipped.map((r) => r.name)).toEqual(['Invité fictif 007', 'Invité fictif 010']);
    expect(count()).toBeLessThanOrEqual(3); // noms connus + 2 lots
    expect(await guestCount()).toBe(150);
    const codes = await env.DB.prepare('SELECT COUNT(DISTINCT code) AS n FROM guests').first<{ n: number }>();
    expect(codes!.n).toBe(150);
  });

  it('POST /admin/import de 120 invités passe sous la limite de 50 requêtes et affiche le résultat', async () => {
    const s = await login();
    const { db, count } = countingDb(env.DB, 50);
    const res = await callWith({ DB: db }, '/admin/import', importForm(s, fictionalCsv(120)));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('120 invités ajoutés');
    expect(count()).toBeLessThanOrEqual(5);
    expect(await guestCount()).toBe(120);
  });

  it('une erreur de la base pendant l’import affiche un message clair (pas la page d’erreur générique)', async () => {
    const s = await login();
    const failing = { ...env.DB, prepare: env.DB.prepare.bind(env.DB), batch: async () => Promise.reject(new Error('D1_ERROR: panne')) };
    const res = await callWith({ DB: failing as unknown as D1Database }, '/admin/import', importForm(s, fictionalCsv(3)));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('L’import a été interrompu');
  });
});

describe('ouvertures du lien : pas d’inflation de la base', () => {
  it('des visites rapprochées comptent pour une seule ouverture', async () => {
    const g = await makeGuest();
    const ua = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' };
    for (let i = 0; i < 5; i++) expect((await call(`/i/${g.code}`, { headers: ua })).status).toBe(200);
    const n = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM opens WHERE guest_id = ?').bind(g.id).first<{ n: number }>())!.n;
    expect(await n()).toBe(1);
    // Une heure plus tard : nouvelle ouverture.
    await env.DB.prepare("UPDATE opens SET opened_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour') WHERE guest_id = ?").bind(g.id).run();
    await recordOpen(env.DB, g.id, 'Mozilla/5.0');
    expect(await n()).toBe(2);
  });

  it('lire un invité ne parcourt pas toutes les ouvertures des autres invités', async () => {
    const busy = await makeGuest({ name: 'Neny' });
    const other = await makeGuest({ name: 'Koto' });
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 3000)
       INSERT INTO opens (guest_id, ua) SELECT ?1, 'x' FROM n`,
    )
      .bind(busy.id)
      .run();
    const res = await env.DB.prepare(`${GUEST_SELECT} WHERE g.code = ?1`).bind(other.code).all<{ open_count: number }>();
    expect(res.results[0].open_count).toBe(0);
    expect(res.meta.rows_read).toBeLessThan(50);
    const b = await env.DB.prepare(`${GUEST_SELECT} WHERE g.code = ?1`).bind(busy.code).first<{ open_count: number }>();
    expect(b!.open_count).toBe(3000);
  });
});

describe('réponses : limite par invitation, quelle que soit l’adresse IP', () => {
  it(`au plus ${RSVP_CODE_LIMIT} réponses par heure pour un même lien`, async () => {
    const g = await makeGuest();
    const statuses: number[] = [];
    for (let i = 0; i <= RSVP_CODE_LIMIT; i++) statuses.push((await rsvp(g.code, { answer: 'oui', count: 1, message: 'x' }, uniqueIp())).status);
    expect(statuses.slice(0, RSVP_CODE_LIMIT).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // Une autre invitation n'est pas concernée.
    const other = await makeGuest({ name: 'Koto' });
    expect((await rsvp(other.code, { answer: 'non' }, uniqueIp())).status).toBe(200);
  });

  it('la fiche n’affiche que les 50 dernières réponses', async () => {
    const s = await login();
    const g = await makeGuest();
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 80)
       INSERT INTO responses (guest_id, answer, count) SELECT ?1, 'oui', 1 FROM n`,
    )
      .bind(g.id)
      .run();
    const res = await call(`/admin/guests/${g.id}/edit`, { headers: { cookie: s.cookie } });
    const html = await res.text();
    expect(html.match(/<td class="cell-title" data-label="Date">/g)).toHaveLength(50);
    // La saisie par les mariés reste possible.
    expect((await adminPost(s, `/admin/guests/${g.id}/response`, { answer: 'non', count: '', message: '' })).status).toBe(303);
  });
});
