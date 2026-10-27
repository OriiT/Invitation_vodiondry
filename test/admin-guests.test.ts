import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { getGuest, waNumber } from '../src/lib/db';
import { parseCsv } from '../src/lib/import';
import { setSettings } from '../src/lib/settings';
import { BASE, adminGet, adminPost, call, login, makeGuest, rsvp, type AdminSession } from './helpers';

const CODE_RE = /^[0-9a-hjkmnp-tv-z]{8}$/;

/** Valeur d'une tuile de totaux (« 3 » pour « Personnes confirmées »…). */
function stat(html: string, label: string): number | null {
  const re = new RegExp(`<span class="stat-v">(\\d+)</span><span class="stat-l">${label}</span>`);
  const m = re.exec(html);
  return m ? Number(m[1]) : null;
}

async function html(s: AdminSession, path: string): Promise<string> {
  const res = await adminGet(s, path);
  expect(res.status).toBe(200);
  return res.text();
}

async function guestCount(): Promise<number> {
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM guests').first<{ n: number }>())!.n;
}

async function allGuests() {
  const { results } = await env.DB.prepare(
    'SELECT name, side, expected_count, phone, notes FROM guests ORDER BY name',
  ).all<{ name: string; side: string; expected_count: number; phone: string | null; notes: string }>();
  return results;
}

/** Envoi d'un fichier au formulaire d'import (multipart, jeton CSRF dans le corps). */
async function importFile(s: AdminSession, content: string | Uint8Array, filename = 'invites.csv'): Promise<Response> {
  const fd = new FormData();
  fd.append('_csrf', s.csrf);
  fd.append('file', new File([content], filename, { type: filename.endsWith('.csv') ? 'text/csv' : 'application/octet-stream' }));
  return call('/admin/import', { method: 'POST', headers: { cookie: s.cookie, origin: BASE }, body: fd });
}

const SHEET_CSV = [
  'Rojo;;Orimbato;',
  'Nom;Nombre;Nom;Nombre',
  'Tante Lala;3;Famille Rabe;4',
  'Koto;2;Soa;1',
  'Famille inconnue;5;Mpikabary;2',
  ';;Orimbato;1',
].join('\r\n');

describe('ajout d’un invité', () => {
  it('crée l’invité avec un code personnel et redirige vers sa fiche', async () => {
    const s = await login();
    const res = await adminPost(s, '/admin/guests', {
      name: '  Tante   Lala ',
      side: 'orimbato',
      expected_count: '3',
      phone: '034 00 000 01',
      notes: 'Vient avec les enfants',
    });
    expect(res.status).toBe(303);
    const row = await env.DB.prepare('SELECT * FROM guests').first<any>();
    expect(row).toMatchObject({
      name: 'Tante Lala',
      side: 'orimbato',
      expected_count: 3,
      phone: '034 00 000 01',
      notes: 'Vient avec les enfants',
    });
    expect(row.code).toMatch(CODE_RE);
    expect(res.headers.get('location')).toBe(`/admin/guests/${row.id}/edit?ok=created`);
    const page = await html(s, res.headers.get('location')!);
    expect(page).toContain('Invité ajouté');
    expect(page).toContain(`value="${BASE}/i/${row.code}"`);
  });

  it('nombre prévu par défaut : 1 ; téléphone et notes facultatifs', async () => {
    const s = await login();
    const res = await adminPost(s, '/admin/guests', { name: 'Koto', side: 'rojo', expected_count: '', phone: '', notes: '' });
    expect(res.status).toBe(303);
    expect(await env.DB.prepare('SELECT expected_count, phone, notes FROM guests').first()).toEqual({
      expected_count: 1,
      phone: null,
      notes: '',
    });
  });

  it('refuse un formulaire invalide (400) sans rien enregistrer et réaffiche les valeurs', async () => {
    const s = await login();
    const ok = { name: 'Koto', side: 'rojo', expected_count: '2', phone: '', notes: '' };
    const bad = [
      { ...ok, name: '' },
      { ...ok, name: '    ' },
      { ...ok, name: 'x'.repeat(101) },
      { ...ok, side: 'autre' },
      { ...ok, side: '' },
      { ...ok, expected_count: '-1' },
      { ...ok, expected_count: '51' },
      { ...ok, expected_count: '2.5' },
      { ...ok, expected_count: 'deux' },
      { ...ok, phone: '0'.repeat(31) },
      { ...ok, notes: 'n'.repeat(501) },
    ];
    for (const form of bad) {
      const res = await adminPost(s, '/admin/guests', form);
      expect(res.status, JSON.stringify(form).slice(0, 80)).toBe(400);
      const page = await res.text();
      expect(page).toContain('flash-err');
    }
    expect(await guestCount()).toBe(0);
    const page = await (await adminPost(s, '/admin/guests', { ...ok, side: 'autre', notes: 'Note gardée' })).text();
    expect(page).toContain('value="Koto"');
    expect(page).toContain('Note gardée');
    expect(page).toContain('Choisissez le côté');
  });

  it('refuse un nom déjà présent (sans tenir compte de la casse)', async () => {
    const s = await login();
    const existing = await makeGuest({ name: 'Famille Rabe' });
    const res = await adminPost(s, '/admin/guests', { name: 'famille rabe', side: 'rojo', expected_count: '2' });
    expect(res.status).toBe(400);
    const page = await res.text();
    expect(page).toContain('existe déjà');
    expect(page).toContain(`/admin/guests/${existing.id}/edit`);
    expect(await guestCount()).toBe(1);
  });
});

describe('fiche d’un invité', () => {
  it('modifie un invité (le contrôle des doublons l’exclut lui-même)', async () => {
    const s = await login();
    const g = await makeGuest({ name: 'Koto', side: 'rojo', expected_count: 2 });
    const res = await adminPost(s, `/admin/guests/${g.id}`, {
      name: 'KOTO',
      side: 'orimbato',
      expected_count: '0',
      phone: '+261 34 00 000 02',
      notes: 'Arrive tard',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/admin/guests/${g.id}/edit?ok=updated`);
    expect(await getGuest(env.DB, g.id)).toMatchObject({
      name: 'KOTO',
      side: 'orimbato',
      expected_count: 0,
      phone: '+261 34 00 000 02',
      notes: 'Arrive tard',
      code: g.code,
    });
    expect(await html(s, res.headers.get('location')!)).toContain('Modifications enregistrées');
  });

  it('refuse de renommer un invité avec le nom d’un autre, ou des valeurs invalides', async () => {
    const s = await login();
    await makeGuest({ name: 'Soa' });
    const g = await makeGuest({ name: 'Koto' });
    const dup = await adminPost(s, `/admin/guests/${g.id}`, { name: 'Soa', side: 'rojo', expected_count: '2' });
    expect(dup.status).toBe(400);
    expect(await dup.text()).toContain('existe déjà');
    const bad = await adminPost(s, `/admin/guests/${g.id}`, { name: 'Koto', side: 'rojo', expected_count: '99' });
    expect(bad.status).toBe(400);
    expect(await getGuest(env.DB, g.id)).toMatchObject({ name: 'Koto', expected_count: 2 });
  });

  it('page 404 en français pour un invité inconnu', async () => {
    const s = await login();
    for (const path of ['/admin/guests/999999/edit', '/admin/guests/abc/edit']) {
      const res = await adminGet(s, path);
      expect(res.status).toBe(404);
      expect(await res.text()).toContain('Invité introuvable');
    }
    expect((await adminPost(s, '/admin/guests/999999', { name: 'Koto', side: 'rojo', expected_count: '1' })).status).toBe(404);
    expect((await adminPost(s, '/admin/guests/999999/delete')).status).toBe(404);
    expect((await adminPost(s, '/admin/guests/999999/regenerate')).status).toBe(404);
    expect((await adminPost(s, '/admin/guests/999999/opens/clear')).status).toBe(404);
    expect((await adminPost(s, '/admin/guests/999999/response', { answer: 'oui', count: '1' })).status).toBe(404);
    expect(await guestCount()).toBe(0);
  });

  it('supprime un invité avec ses réponses et ses ouvertures', async () => {
    const s = await login();
    const g = await makeGuest({ name: 'Tante Lala' });
    const other = await makeGuest({ name: 'Soa' });
    expect((await rsvp(g.code, { answer: 'oui', count: 2 })).status).toBe(200);
    expect((await call(`/i/${g.code}`, { headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14)' } })).status).toBe(200);
    expect((await rsvp(other.code, { answer: 'non' })).status).toBe(200);
    const count = async (table: string) =>
      (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE guest_id = ?`).bind(g.id).first<{ n: number }>())!.n;
    expect(await count('responses')).toBe(1);
    expect(await count('opens')).toBe(1);

    const res = await adminPost(s, `/admin/guests/${g.id}/delete`);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin?ok=deleted');
    expect(await getGuest(env.DB, g.id)).toBeNull();
    expect(await count('responses')).toBe(0);
    expect(await count('opens')).toBe(0);
    // Les autres invités ne sont pas touchés.
    expect(await getGuest(env.DB, other.id)).toMatchObject({ answer: 'non' });
    expect(await html(s, '/admin?ok=deleted')).toContain('Invité supprimé');
  });

  it('régénère le code : l’ancien lien ne fonctionne plus, le nouveau oui', async () => {
    const s = await login();
    const g = await makeGuest({ name: 'Koto' });
    const res = await adminPost(s, `/admin/guests/${g.id}/regenerate`);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/admin/guests/${g.id}/edit?ok=regenerated`);
    const updated = (await getGuest(env.DB, g.id))!;
    expect(updated.code).toMatch(CODE_RE);
    expect(updated.code).not.toBe(g.code);
    expect((await call(`/i/${g.code}`, { headers: { 'user-agent': 'Mozilla/5.0' } })).status).toBe(404);
    expect((await call(`/i/${updated.code}`, { headers: { 'user-agent': 'Mozilla/5.0' } })).status).toBe(200);
    const page = await html(s, res.headers.get('location')!);
    expect(page).toContain(`${BASE}/i/${updated.code}`);
    expect(page).toContain('data-confirm="L’ancien lien ne fonctionnera plus. Continuer ?"');
  });

  it('efface les ouvertures d’un lien ouvert par les mariés, sans toucher à la réponse ni aux autres invités', async () => {
    const s = await login();
    const g = await makeGuest({ name: 'Tante Lala', expected_count: 2 });
    const other = await makeGuest({ name: 'Soa' });
    const open = (code: string) => call(`/i/${code}`, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' } });
    expect((await open(g.code)).status).toBe(200);
    expect((await open(other.code)).status).toBe(200);
    expect((await rsvp(g.code, { answer: 'oui', count: 2 })).status).toBe(200);
    expect((await getGuest(env.DB, g.id))!.open_count).toBe(1);

    const before = await html(s, `/admin/guests/${g.id}/edit`);
    expect(before).toContain('Effacer les ouvertures');
    expect(before).toContain('data-confirm="Effacer les ouvertures du lien de « Tante Lala » ? « Lien ouvert » repassera à « Non ».');

    const res = await adminPost(s, `/admin/guests/${g.id}/opens/clear`);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/admin/guests/${g.id}/edit?ok=opens#ouvertures`);
    const after = (await getGuest(env.DB, g.id))!;
    expect(after.open_count).toBe(0);
    expect(after).toMatchObject({ answer: 'oui', confirmed_count: 2 });
    expect((await getGuest(env.DB, other.id))!.open_count).toBe(1);

    const page = await html(s, `/admin/guests/${g.id}/edit?ok=opens`);
    expect(page).toContain('Ouvertures effacées');
    expect(page).toContain('Le lien n’a pas encore été ouvert.');
    expect(page).not.toContain('Effacer les ouvertures</button>');
    // Sans jeton anti-CSRF : refusé, rien n'est effacé.
    expect((await open(other.code)).status).toBe(200);
    const noCsrf = await call(`/admin/guests/${other.id}/opens/clear`, {
      method: 'POST',
      headers: { cookie: s.cookie, origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    expect(noCsrf.status).toBe(403);
    expect((await getGuest(env.DB, other.id))!.open_count).toBeGreaterThan(0);
  });

  it('affiche le lien personnel, les ouvertures et l’historique des réponses', async () => {
    const s = await login();
    const g = await makeGuest({ name: 'Soa', phone: '034 12 345 67' });
    await call(`/i/${g.code}`, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1' } });
    // Une visite des mariés (session admin) n'est pas comptée.
    await call(`/i/${g.code}`, { headers: { 'user-agent': 'Mozilla/5.0', cookie: s.cookie } });
    await rsvp(g.code, { answer: 'oui', count: 2, message: 'Premier message' });
    await rsvp(g.code, { answer: 'non', message: 'Finalement non' });
    const page = await html(s, `/admin/guests/${g.id}/edit`);
    expect(page).toContain(`value="${BASE}/i/${g.code}"`);
    expect(page).toContain(`data-copy="${BASE}/i/${g.code}"`);
    expect(page).toContain('https://wa.me/261341234567?text=');
    expect(page).toContain('iPhone · Safari');
    expect(page).toContain('1 ouverture au total');
    expect(page).toContain('Premier message');
    expect(page).toContain('Finalement non');
    // L'historique est trié du plus récent au plus ancien.
    expect(page.indexOf('Finalement non')).toBeLessThan(page.indexOf('Premier message'));
  });
});

describe('réponse saisie par les mariés', () => {
  it('enregistre la réponse, même après la date limite, et l’ajoute à l’historique', async () => {
    const s = await login();
    await setSettings(env.DB, { rsvp_deadline: '2020-01-01' });
    const g = await makeGuest({ name: 'Tante Lala', expected_count: 4 });
    const res = await adminPost(s, `/admin/guests/${g.id}/response`, {
      answer: 'oui',
      count: '3',
      message: 'Répondu par téléphone',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(new RegExp(`^/admin/guests/${g.id}/edit\\?ok=response`));
    expect(await getGuest(env.DB, g.id)).toMatchObject({ answer: 'oui', confirmed_count: 3, message: 'Répondu par téléphone' });
    const page = await html(s, `/admin/guests/${g.id}/edit?ok=response`);
    expect(page).toContain('Réponse enregistrée');
    // Confirmation visible là où la page défile (#reponse), pas seulement tout en haut.
    expect(page).toMatch(/<section class="card" id="reponse"><h2>[^<]*<\/h2><p class="flash flash-ok" role="status">Réponse enregistrée\.<\/p>/);
    expect(page).toMatch(/<table class="data history-table">[\s\S]*Répondu par téléphone/);

    // Un « non » ne demande pas de nombre.
    expect((await adminPost(s, `/admin/guests/${g.id}/response`, { answer: 'non', count: '', message: '' })).status).toBe(303);
    expect(await getGuest(env.DB, g.id)).toMatchObject({ answer: 'non', confirmed_count: 0 });
    const { results } = await env.DB.prepare('SELECT answer FROM responses WHERE guest_id = ? ORDER BY id').bind(g.id).all();
    expect(results.map((r: any) => r.answer)).toEqual(['oui', 'non']);
  });

  it('valide la réponse, le nombre et le message', async () => {
    const s = await login();
    const g = await makeGuest();
    for (const form of [
      { answer: 'peut-être', count: '1' },
      { answer: '', count: '1' },
      { answer: 'oui', count: '0' },
      { answer: 'oui', count: '31' },
      { answer: 'oui', count: '' },
      { answer: 'oui', count: '1.5' },
      { answer: 'oui', count: '1', message: 'x'.repeat(1001) },
    ] as Record<string, string>[]) {
      const res = await adminPost(s, `/admin/guests/${g.id}/response`, form);
      expect(res.status, JSON.stringify(form).slice(0, 60)).toBe(400);
    }
    expect((await getGuest(env.DB, g.id))?.answer).toBeNull();
  });
});

describe('tableau de bord', () => {
  it('état vide : renvoie vers l’import et l’ajout', async () => {
    const s = await login();
    const page = await html(s, '/admin');
    expect(page).toContain('Aucun invité pour l’instant');
    expect(page).toContain('href="/admin/import"');
    expect(page).toContain('href="/admin/guests/new"');
  });

  it('affiche les totaux de tous les invités', async () => {
    const s = await login();
    const a = await makeGuest({ name: 'Tante Lala', side: 'rojo', expected_count: 3 });
    await makeGuest({ name: 'Famille Rabe', side: 'orimbato', expected_count: 4 });
    expect((await rsvp(a.code, { answer: 'oui', count: 3 })).status).toBe(200);
    const page = await html(s, '/admin');
    expect(stat(page, 'Invités')).toBe(2);
    expect(stat(page, 'Personnes attendues')).toBe(7);
    expect(stat(page, 'Oui')).toBe(1);
    expect(stat(page, 'Non')).toBe(0);
    expect(stat(page, 'Sans réponse')).toBe(1);
    expect(stat(page, 'Personnes confirmées')).toBe(3);
    expect(page).toContain('href="/admin/guests/new"');
    expect(page).toContain('href="/admin/export.csv"');
    expect(page).toContain(`href="/i/${a.code}"`);
    expect(page).toContain(`data-copy="${BASE}/i/${a.code}"`);
  });

  it('filtre par côté, par statut et par nom (sans casse ni accents)', async () => {
    const s = await login();
    const a = await makeGuest({ name: 'Tante Lala', side: 'rojo' });
    await makeGuest({ name: 'Famille Rabe', side: 'orimbato' });
    const c = await makeGuest({ name: 'Hélène Koto', side: 'orimbato' });
    await rsvp(a.code, { answer: 'oui', count: 1 });
    await rsvp(c.code, { answer: 'non' });

    let page = await html(s, '/admin?side=orimbato');
    expect(page).toContain('Famille Rabe');
    expect(page).toContain('Hélène Koto');
    expect(page).not.toContain('Tante Lala');
    expect(page).toContain('2 affichés sur 3');
    expect(stat(page, 'Invités')).toBe(3); // les totaux portent toujours sur tous les invités

    page = await html(s, '/admin?status=none');
    expect(page).toContain('Famille Rabe');
    expect(page).not.toContain('Tante Lala');
    expect(page).not.toContain('Hélène Koto');
    expect(page).toContain('1 affiché sur 3');

    page = await html(s, '/admin?status=oui');
    expect(page).toContain('Tante Lala');
    expect(page).not.toContain('Famille Rabe');

    page = await html(s, '/admin?q=HELENE');
    expect(page).toContain('Hélène Koto');
    expect(page).not.toContain('Famille Rabe');

    page = await html(s, '/admin?side=rojo&status=non');
    expect(page).toContain('Aucun invité ne correspond');

    // Lien jamais ouvert / ouvert sans réponse
    const b = (await env.DB.prepare("SELECT code FROM guests WHERE name = 'Famille Rabe'").first<{ code: string }>())!;
    await call(`/i/${b.code}`, { headers: { 'user-agent': 'Mozilla/5.0' } });
    page = await html(s, '/admin?status=opened');
    expect(page).toContain('Famille Rabe');
    expect(page).not.toContain('Tante Lala');
    page = await html(s, '/admin?status=unopened');
    expect(page).not.toContain('Famille Rabe');
    expect(page).toContain('Tante Lala');
  });

  it('échappe les noms des invités', async () => {
    const s = await login();
    const g = await makeGuest({ name: '<img src=x onerror=alert(1)>', notes: '"><script>alert(2)</script>' });
    for (const path of ['/admin', `/admin/guests/${g.id}/edit`, '/admin/relances']) {
      const page = await html(s, path);
      expect(page).not.toContain('<img src=x');
      expect(page).not.toContain('<script>alert');
      expect(page).toContain('&lt;img src=x onerror=alert(1)&gt;');
    }
  });

  it('le lien WhatsApp contient le lien personnel (encodé) et le numéro', async () => {
    const s = await login();
    const g = await makeGuest({ name: 'Koto', phone: '034 12 345 67' });
    const noPhone = await makeGuest({ name: 'Soa' });
    const page = await html(s, '/admin');
    expect(page).toContain(`https://wa.me/261341234567?text=`);
    expect(page).toContain(encodeURIComponent(`${BASE}/i/${g.code}`));
    expect(page).toContain(`https://wa.me/?text=`);
    expect(page).toContain(encodeURIComponent(`${BASE}/i/${noPhone.code}`));
    expect(page).toMatch(/class="btn btn-sm btn-wa" href="https:\/\/wa\.me\/[^"]*" target="_blank" rel="noopener"/);
  });
});

describe('import / export', () => {
  it('affiche le formulaire d’import', async () => {
    const s = await login();
    const page = await html(s, '/admin/import');
    expect(page).toContain('enctype="multipart/form-data"');
    expect(page).toContain('name="file"');
    expect(page).toContain('accept=".xlsx,.csv"');
    expect(page).toContain('href="/admin/export.csv"');
  });

  it('importe la feuille « Invités » (CSV ;) en ignorant les lignes spéciales, de façon idempotente', async () => {
    const s = await login();
    const res = await importFile(s, SHEET_CSV);
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(stat(page, 'Ajoutés')).toBe(4);
    expect(stat(page, 'Déjà présents')).toBe(0);
    expect(stat(page, 'Lignes ignorées')).toBe(3);
    expect(page).toContain('Famille inconnue');
    expect(page).toContain('Mpikabary');
    expect(await allGuests()).toEqual([
      { name: 'Famille Rabe', side: 'orimbato', expected_count: 4, phone: null, notes: '' },
      { name: 'Koto', side: 'rojo', expected_count: 2, phone: null, notes: '' },
      { name: 'Soa', side: 'orimbato', expected_count: 1, phone: null, notes: '' },
      { name: 'Tante Lala', side: 'rojo', expected_count: 3, phone: null, notes: '' },
    ]);
    const codes = await env.DB.prepare('SELECT code FROM guests').all<{ code: string }>();
    for (const r of codes.results) expect(r.code).toMatch(CODE_RE);

    const again = await importFile(s, SHEET_CSV);
    expect(again.status).toBe(200);
    const page2 = await again.text();
    expect(stat(page2, 'Ajoutés')).toBe(0);
    expect(stat(page2, 'Déjà présents')).toBe(4);
    expect(await guestCount()).toBe(4);
  });

  it('refuse un fichier vide, absent ou illisible (400)', async () => {
    const s = await login();
    expect((await importFile(s, '')).status).toBe(400);
    expect((await importFile(s, 'Rojo;;Orimbato;\r\nNom;Nombre;Nom;Nombre\r\n')).status).toBe(400);
    expect((await importFile(s, new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]), 'invites.xls')).status).toBe(400);
    expect((await importFile(s, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]), 'photo.png')).status).toBe(400);
    expect((await importFile(s, new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]), 'invites.xlsx')).status).toBe(400);
    const big = `Nom;Côté;Nombre prévu\r\nKoto;Rojo;2\r\n${'x'.repeat(2 * 1024 * 1024)}`;
    const tooBig = await importFile(s, big);
    expect(tooBig.status).toBe(400);
    expect(await tooBig.text()).toContain('2 Mo maximum');
    const noFile = await call('/admin/import', {
      method: 'POST',
      headers: { cookie: s.cookie, origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: s.csrf }).toString(),
    });
    expect(noFile.status).toBe(400);
    expect(await noFile.text()).toContain('flash-err');
    expect(await guestCount()).toBe(0);
  });

  it('exporte un CSV (BOM, « ; ») avec une ligne par invité', async () => {
    const s = await login();
    const a = await makeGuest({ name: 'Tante Lala', side: 'rojo', expected_count: 3, phone: '+261 34 00 000 03', notes: 'Végétarienne' });
    await makeGuest({ name: 'Famille Rabe', side: 'orimbato', expected_count: 4 });
    await rsvp(a.code, { answer: 'oui', count: 2, message: 'Avec joie;\n"à bientôt"' });
    const res = await adminGet(s, '/admin/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="invites-vodiondry-\d{4}-\d{2}-\d{2}\.csv"$/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    const rows = parseCsv(text).filter((r) => r.some((c) => c !== ''));
    expect(rows[0]).toEqual([
      'Nom',
      'Côté',
      'Nombre prévu',
      'Téléphone',
      'Notes',
      'Lien',
      'Code',
      'Lien ouvert',
      'Première ouverture',
      'Dernière ouverture',
      "Nombre d'ouvertures",
      'Réponse',
      'Nombre confirmé',
      'Message',
      'Date de réponse',
      'Table',
    ]);
    expect(rows).toHaveLength(3);
    const lala = rows.find((r) => r[0] === 'Tante Lala')!;
    expect(lala.slice(0, 8)).toEqual(['Tante Lala', 'Rojo', '3', "'+261 34 00 000 03", 'Végétarienne', `${BASE}/i/${a.code}`, a.code, 'Non']);
    expect(lala.slice(11, 14)).toEqual(['Oui', '2', 'Avec joie;\n"à bientôt"']);
    expect(lala[14]).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    const rabe = rows.find((r) => r[0] === 'Famille Rabe')!;
    expect([rabe[1], rabe[2], rabe[7], rabe[11], rabe[12]]).toEqual(['Orimbato', '4', 'Non', '', '']);
  });

  it('export → suppression de tous les invités → import : la liste est restaurée', async () => {
    const s = await login();
    await makeGuest({ name: 'Tante Lala', side: 'rojo', expected_count: 3, phone: '+261 34 00 000 03', notes: 'Végétarienne' });
    await makeGuest({ name: 'Famille Rabe', side: 'orimbato', expected_count: 4 });
    await makeGuest({ name: 'Koto', side: 'rojo', expected_count: 0, phone: '034 00 000 04' });
    await makeGuest({ name: 'Soa', side: 'orimbato', expected_count: 1, notes: 'Allergie; "noix" = attention' });
    const before = await allGuests();

    const csv = new Uint8Array(await (await adminGet(s, '/admin/export.csv')).arrayBuffer());
    const { results } = await env.DB.prepare('SELECT id FROM guests').all<{ id: number }>();
    for (const { id } of results) expect((await adminPost(s, `/admin/guests/${id}/delete`)).status).toBe(303);
    expect(await guestCount()).toBe(0);

    const res = await importFile(s, csv, 'invites-vodiondry.csv');
    expect(res.status).toBe(200);
    expect(stat(await res.text(), 'Ajoutés')).toBe(4);
    expect(await allGuests()).toEqual(before);
  });
});

describe('relances', () => {
  it('liste seulement les invités sans réponse, jamais ouverts en premier', async () => {
    const s = await login();
    await setSettings(env.DB, { whatsapp_reminder_template: 'Coucou {nom}, réponds avant le {date_limite} : {lien}' });
    const answered = await makeGuest({ name: 'Tante Lala' });
    const opened = await makeGuest({ name: 'Famille Rabe', phone: '034 12 345 67' });
    const never = await makeGuest({ name: 'Soa' });
    await rsvp(answered.code, { answer: 'oui', count: 2 });
    await call(`/i/${opened.code}`, { headers: { 'user-agent': 'Mozilla/5.0' } });

    const page = await html(s, '/admin/relances');
    expect(page).not.toContain('Tante Lala');
    expect(page).toContain('Famille Rabe');
    expect(page).toContain('Soa');
    expect(stat(page, 'Invités sans réponse')).toBe(2);
    expect(page.indexOf('>Soa<')).toBeLessThan(page.indexOf('>Famille Rabe<'));
    const text = `Coucou Famille Rabe, réponds avant le 12/12/2026 : ${BASE}/i/${opened.code}`;
    expect(page).toContain(`data-copy="${text}"`);
    expect(page).toContain(`https://wa.me/261341234567?text=${encodeURIComponent(text)}`);
    expect(page).toContain(`data-copy="${BASE}/i/${never.code}"`);

    const rojo = await html(s, '/admin/relances?side=orimbato');
    expect(rojo).toContain('Personne à relancer de ce côté');
  });

  it('message de félicitations quand tout le monde a répondu', async () => {
    const s = await login();
    const g = await makeGuest({ name: 'Koto' });
    await rsvp(g.code, { answer: 'non' });
    expect(await html(s, '/admin/relances')).toContain('Tout le monde a répondu');
  });
});

describe('accès sans session', () => {
  it('les pages redirigent vers la connexion, les envois sont refusés', async () => {
    const g = await makeGuest({ name: 'Koto' });
    for (const path of [
      '/admin',
      '/admin?status=none',
      '/admin/guests/new',
      `/admin/guests/${g.id}/edit`,
      '/admin/import',
      '/admin/export.csv',
      '/admin/relances',
    ]) {
      const res = await call(path);
      expect(res.status, path).toBe(302);
      expect(res.headers.get('location'), path).toMatch(/^\/admin\/login\?next=/);
    }
    for (const path of [
      `/admin/guests/${g.id}`,
      `/admin/guests/${g.id}/delete`,
      `/admin/guests/${g.id}/regenerate`,
      `/admin/guests/${g.id}/opens/clear`,
      '/admin/import',
    ]) {
      const res = await call(path, {
        method: 'POST',
        headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
        body: 'name=Intrus&side=rojo',
      });
      expect(res.status, path).toBe(401);
    }
    expect(await getGuest(env.DB, g.id)).toMatchObject({ name: 'Koto', code: g.code });
  });
});

describe('numéros WhatsApp', () => {
  it('ajoute l’indicatif 261 aux mobiles malgaches, y compris sans le 0 retiré par Excel', () => {
    expect(waNumber('034 12 345 67')).toBe('261341234567');
    expect(waNumber('0341234567')).toBe('261341234567');
    expect(waNumber('341234567')).toBe('261341234567');
    expect(waNumber('32 12 345 67')).toBe('261321234567');
    expect(waNumber('+261 34 12 345 67')).toBe('261341234567');
    expect(waNumber('+33 6 12 34 56 78')).toBe('33612345678');
    expect(waNumber('12345')).toBeNull();
  });
});
