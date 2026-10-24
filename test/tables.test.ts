import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { getGuest, recordResponse } from '../src/lib/db';
import { parseCsv } from '../src/lib/import';
import { setSettings } from '../src/lib/settings';
import { BASE, adminGet, adminJson, adminPost, call, login, makeGuest, type AdminSession } from './helpers';

interface TableDb {
  id: number;
  name: string;
  capacity: number;
  sort_order: number;
}

async function tables(): Promise<TableDb[]> {
  const { results } = await env.DB.prepare('SELECT id, name, capacity, sort_order FROM tables ORDER BY id').all<TableDb>();
  return results;
}

async function createTable(s: AdminSession, form: Record<string, string>): Promise<TableDb> {
  const res = await adminPost(s, '/admin/tables', form);
  expect(res.status).toBe(303);
  const all = await tables();
  return all[all.length - 1];
}

async function page(s: AdminSession, path = '/admin/tables'): Promise<string> {
  const res = await adminGet(s, path);
  expect(res.status).toBe(200);
  return res.text();
}

describe('plan de table : tables', () => {
  it('crée une table (ordre par défaut = dernier + 1, 10 places par défaut)', async () => {
    const s = await login();
    const res = await adminPost(s, '/admin/tables', { name: '  Table   des oncles ', capacity: '8', sort_order: '' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/admin\/tables\?ok=created/);
    await adminPost(s, '/admin/tables', { name: 'Table 2', capacity: '', sort_order: '' });
    const all = await tables();
    expect(all).toMatchObject([
      { name: 'Table des oncles', capacity: 8, sort_order: 1 },
      { name: 'Table 2', capacity: 10, sort_order: 2 },
    ]);
    const html = await page(s, '/admin/tables?ok=created');
    expect(html).toContain('Table ajoutée.');
    expect(html).toContain('Table des oncles');
    expect(html).toContain('/vd/sortable.min.js');
    expect(html).toContain('/vd/tables.js');
  });

  it('valide le formulaire et réaffiche les valeurs saisies (400)', async () => {
    const s = await login();
    const forms: Record<string, string>[] = [
      { name: '', capacity: '10' },
      { name: 'x'.repeat(61), capacity: '10' },
      { name: 'Table Soa', capacity: '201' },
      { name: 'Table Soa', capacity: '-1' },
      { name: 'Table Soa', capacity: 'dix' },
      { name: 'Table Soa', capacity: '4.5' },
      { name: 'Table Soa', capacity: '10', sort_order: 'premier' },
    ];
    for (const form of forms) {
      const res = await adminPost(s, '/admin/tables', form);
      expect(res.status, JSON.stringify(form)).toBe(400);
      const html = await res.text();
      expect(html).toContain('flash-err');
      if (form.name) expect(html).toContain(`value="${form.name}"`);
    }
    expect(await tables()).toHaveLength(0);
    await createTable(s, { name: 'Table Soa', capacity: '10' });
    const dup = await adminPost(s, '/admin/tables', { name: 'table soa', capacity: '6' });
    expect(dup.status).toBe(400);
    expect(await dup.text()).toContain('Une table s’appelle déjà');
  });

  it('renomme, change la capacité et réordonne', async () => {
    const s = await login();
    const a = await createTable(s, { name: 'Table Koto', capacity: '10' });
    const b = await createTable(s, { name: 'Table Lala', capacity: '10' });
    let html = await page(s);
    expect(html.indexOf('Table Koto')).toBeLessThan(html.indexOf('Table Lala'));

    const res = await adminPost(s, `/admin/tables/${a.id}`, { name: 'Table des témoins', capacity: '12', sort_order: '5' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/admin/tables?ok=updated#table-${a.id}`);
    expect((await tables()).find((t) => t.id === a.id)).toMatchObject({ name: 'Table des témoins', capacity: 12, sort_order: 5 });

    html = await page(s);
    expect(html).not.toContain('Table Koto');
    expect(html.indexOf(`id="table-${b.id}"`)).toBeGreaterThan(-1);
    expect(html.indexOf(`id="table-${b.id}"`)).toBeLessThan(html.indexOf(`id="table-${a.id}"`));

    // Ordre laissé vide : inchangé.
    expect((await adminPost(s, `/admin/tables/${b.id}`, { name: 'Table Lala', capacity: '9', sort_order: '' })).status).toBe(303);
    expect((await tables()).find((t) => t.id === b.id)).toMatchObject({ capacity: 9, sort_order: 2 });

    // Erreurs : nom en double, capacité invalide, table inconnue.
    const dup = await adminPost(s, `/admin/tables/${b.id}`, { name: 'TABLE DES TÉMOINS', capacity: '9', sort_order: '2' });
    expect(dup.status).toBe(400);
    const bad = await adminPost(s, `/admin/tables/${b.id}`, { name: 'Table Lala', capacity: '', sort_order: '2' });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('Le nombre de places doit être un nombre entier');
    expect((await adminPost(s, '/admin/tables/999999', { name: 'X', capacity: '1' })).status).toBe(404);
  });

  it('supprime une table : ses invités redeviennent non placés', async () => {
    const s = await login();
    const t = await createTable(s, { name: 'Table Rabe', capacity: '6' });
    const g = await makeGuest({ name: 'Famille Rabe', expected_count: 3 });
    expect((await adminJson(s, '/admin/tables/assign', { guest_id: g.id, table_id: t.id })).status).toBe(200);
    expect((await getGuest(env.DB, g.id))?.table_id).toBe(t.id);

    const res = await adminPost(s, `/admin/tables/${t.id}/delete`);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/tables?ok=deleted');
    expect(await tables()).toHaveLength(0);
    expect((await getGuest(env.DB, g.id))?.table_id).toBeNull();

    const html = await page(s, '/admin/tables?ok=deleted');
    expect(html).toContain('Table supprimée');
    expect(html).toContain('Famille Rabe'); // dans « Non placés »
    expect((await adminPost(s, `/admin/tables/${t.id}/delete`)).status).toBe(404);
  });
});

describe('plan de table : placement', () => {
  it('place, déplace et retire un invité en JSON', async () => {
    const s = await login();
    const t1 = await createTable(s, { name: 'Table 1', capacity: '8' });
    const t2 = await createTable(s, { name: 'Table 2', capacity: '8' });
    const g = await makeGuest({ name: 'Tante Lala', expected_count: 2 });

    let res = await adminJson(s, '/admin/tables/assign', { guest_id: g.id, table_id: t1.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      guest_id: g.id,
      table: { id: t1.id, name: 'Table 1', capacity: 8, seats: 2, over: false, over_by: 0 },
      previous: null,
      warning: null,
    });

    res = await adminJson(s, '/admin/tables/assign', { guest_id: String(g.id), table_id: String(t2.id) });
    expect(await res.json()).toMatchObject({
      ok: true,
      table: { id: t2.id, seats: 2 },
      previous: { id: t1.id, name: 'Table 1', seats: 0, over: false },
    });
    expect((await getGuest(env.DB, g.id))?.table_id).toBe(t2.id);

    res = await adminJson(s, '/admin/tables/assign', { guest_id: g.id, table_id: null });
    expect(await res.json()).toMatchObject({ ok: true, table: null, previous: { id: t2.id, seats: 0 }, warning: null });
    expect((await getGuest(env.DB, g.id))?.table_id).toBeNull();
  });

  it('place et retire un invité par formulaire (sans JavaScript)', async () => {
    const s = await login();
    const t = await createTable(s, { name: 'Table Soa', capacity: '8' });
    const g = await makeGuest({ name: 'Koto', expected_count: 1 });

    let res = await adminPost(s, '/admin/tables/assign', { guest_id: String(g.id), table_id: String(t.id) });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/tables?ok=assigned#non-places');
    expect((await getGuest(env.DB, g.id))?.table_id).toBe(t.id);

    res = await adminPost(s, '/admin/tables/assign', { guest_id: String(g.id), table_id: '' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/admin/tables?ok=unassigned#table-${t.id}`);
    expect((await getGuest(env.DB, g.id))?.table_id).toBeNull();

    const missing = await adminPost(s, '/admin/tables/assign', { guest_id: String(g.id), table_id: '999999' });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('Cette table n’existe plus');
  });

  it('rejette les requêtes invalides, invités et tables inconnus', async () => {
    const s = await login();
    const t = await createTable(s, { name: 'Table 1', capacity: '8' });
    const g = await makeGuest();
    const bad = await adminJson(s, '/admin/tables/assign', { guest_id: 'abc', table_id: t.id });
    expect(bad.status).toBe(400);
    expect((await adminJson(s, '/admin/tables/assign', { guest_id: g.id })).status).toBe(400);
    expect((await adminJson(s, '/admin/tables/assign', { guest_id: g.id, table_id: 1.5 })).status).toBe(400);
    const noGuest = await adminJson(s, '/admin/tables/assign', { guest_id: 999999, table_id: t.id });
    expect(noGuest.status).toBe(404);
    expect(await noGuest.json()).toMatchObject({ ok: false, error: 'not_found' });
    const noTable = await adminJson(s, '/admin/tables/assign', { guest_id: g.id, table_id: 999999 });
    expect(noTable.status).toBe(404);
    expect(await noTable.json()).toMatchObject({ ok: false, error: 'table_not_found' });
    expect((await getGuest(env.DB, g.id))?.table_id).toBeNull();
  });

  it('accepte un dépassement de capacité mais le signale', async () => {
    const s = await login();
    const t = await createTable(s, { name: 'Table 1', capacity: '10' });
    const a = await makeGuest({ name: 'Famille Rabe', expected_count: 8 });
    const b = await makeGuest({ name: 'Tante Lala', expected_count: 4 });
    await adminJson(s, '/admin/tables/assign', { guest_id: a.id, table_id: t.id });

    const res = await adminJson(s, '/admin/tables/assign', { guest_id: b.id, table_id: t.id });
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.ok).toBe(true);
    expect(body.table).toEqual({ id: t.id, name: 'Table 1', capacity: 10, seats: 12, over: true, over_by: 2 });
    expect(body.warning).toBe('La table « Table 1 » dépasse sa capacité (12/10).');
    expect((await getGuest(env.DB, b.id))?.table_id).toBe(t.id);

    const html = await page(s);
    expect(html).toContain('Capacité dépassée de 2 places');
    expect(html).toContain('tp-table is-over');
    expect(html).toContain('1 table dépasse sa capacité : Table 1.');

    // Par formulaire : redirection avec l'avertissement.
    await adminJson(s, '/admin/tables/assign', { guest_id: b.id, table_id: null });
    const form = await adminPost(s, '/admin/tables/assign', { guest_id: String(b.id), table_id: String(t.id) });
    expect(form.status).toBe(303);
    const location = form.headers.get('location')!;
    expect(location).toContain(`over=${t.id}`);
    const after = await page(s, location.split('#')[0]);
    expect(after).toContain('La table « Table 1 » dépasse sa capacité (12/10).');
  });

  it('un invité qui a répondu « non » ne peut pas être placé et n’apparaît pas', async () => {
    const s = await login();
    const t = await createTable(s, { name: 'Table 1', capacity: '8' });
    const g = await makeGuest({ name: 'Koto Absent', expected_count: 2 });
    await recordResponse(env.DB, g.id, { answer: 'non', count: 0, message: '' });

    const res = await adminJson(s, '/admin/tables/assign', { guest_id: g.id, table_id: t.id });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: 'declined' });
    expect((await getGuest(env.DB, g.id))?.table_id).toBeNull();

    const form = await adminPost(s, '/admin/tables/assign', { guest_id: String(g.id), table_id: String(t.id) });
    expect(form.status).toBe(400);

    const html = await page(s);
    expect(html).not.toContain('Koto Absent');
    expect(html).toContain('data-stat="unplaced">0<');
  });

  it('compte les places confirmées pour un « oui », les places prévues sans réponse', async () => {
    const s = await login();
    const t = await createTable(s, { name: 'Table 1', capacity: '10' });
    const oui = await makeGuest({ name: 'Famille Rabe', expected_count: 1 });
    const pending = await makeGuest({ name: 'Soa', expected_count: 4 });
    await recordResponse(env.DB, oui.id, { answer: 'oui', count: 3, message: '' });

    let body = await (await adminJson(s, '/admin/tables/assign', { guest_id: oui.id, table_id: t.id })).json<any>();
    expect(body.table.seats).toBe(3);
    body = await (await adminJson(s, '/admin/tables/assign', { guest_id: pending.id, table_id: t.id })).json<any>();
    expect(body.table.seats).toBe(7);

    const html = await page(s);
    expect(html).toContain(`data-table-id="${t.id}" data-capacity="10" data-seats="7"`);
    expect(html).toMatch(/<b class="tp-count-v">7<\/b> \/ <span class="tp-count-c">10<\/span> places/);
    expect(html).toContain('data-stat="placed">7<');
    expect(html).toContain('badge badge-oui');
    expect(html).toContain('sans réponse');

    // Un « non » ultérieur libère les places.
    await recordResponse(env.DB, pending.id, { answer: 'non', count: 0, message: '' });
    expect(await page(s)).toContain('data-stat="placed">3<');
  });

  it('affiche l’état de publication du plan', async () => {
    const s = await login();
    expect(await page(s)).toContain('Non publié');
    await setSettings(env.DB, { publish_tables: '1' });
    const html = await page(s);
    expect(html).toContain('Publié : chaque invité voit sa table après sa réponse');
    expect(html).toContain('href="/admin/settings"');
  });

  it('filtre les invités non placés par côté', async () => {
    const s = await login();
    await makeGuest({ name: 'Koto', side: 'rojo' });
    await makeGuest({ name: 'Soa', side: 'orimbato' });
    const html = await page(s, '/admin/tables?side=orimbato');
    expect(html).toMatch(/class="tp-chip side-rojo hidden"[^>]*data-name="Koto"/);
    expect(html).toMatch(/class="tp-chip side-orimbato"[^>]*data-name="Soa"/);
  });
});

describe('plan de table : impression, marque-tables, export', () => {
  it('plan imprimable : titre, tables, invités, non placés, noms échappés', async () => {
    const s = await login();
    const t = await createTable(s, { name: 'Table <b>VIP</b> & Co', capacity: '2' });
    const a = await makeGuest({ name: '<script>alert(1)</script>', expected_count: 3 });
    await makeGuest({ name: 'Soa', expected_count: 1 });
    await adminJson(s, '/admin/tables/assign', { guest_id: a.id, table_id: t.id });

    const html = await page(s, '/admin/tables/print');
    expect(html).toContain('Plan de table — Vodiondry d’Orimbato &amp; Rojo — 19 décembre 2026');
    expect(html).toContain('Table &lt;b&gt;VIP&lt;/b&gt; &amp; Co');
    expect(html).not.toContain('<b>VIP</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('3 / 2 places');
    expect(html).toContain('Capacité dépassée de 1 place');
    expect(html).toContain('Non placés');
    expect(html).toContain('Soa');
    expect(html).toContain('data-print');
    expect(html).toContain('class="bare"');

    // La page principale échappe aussi les noms.
    const main = await page(s);
    expect(main).not.toContain('<script>alert(1)');
    expect(main).not.toContain('<b>VIP</b>');
  });

  it('marque-tables : une carte par table, polices autorisées par la CSP, noms échappés', async () => {
    const s = await login();
    await createTable(s, { name: 'Table 1', capacity: '8' });
    await createTable(s, { name: '<i>Fianakaviana</i>', capacity: '8' });
    await createTable(s, { name: 'Table des amis', capacity: '8' });

    const res = await adminGet(s, '/admin/tables/cards');
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('https://fonts.googleapis.com');
    expect(csp).toContain('font-src');
    expect(csp).toContain('https://fonts.gstatic.com');
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    const html = await res.text();
    expect(html).toContain('https://fonts.googleapis.com/css2?family=Allura');
    expect(html).toContain('&lt;i&gt;Fianakaviana&lt;/i&gt;');
    expect(html).not.toContain('<i>Fianakaviana</i>');
    expect(html).toContain('Vodiondry · Orimbato &amp; Rojo · 19.12.2026');
    expect(html.match(/class="tc-card tc-tent"/g)).toHaveLength(3);
    expect(html.match(/class="tc-sheet"/g)).toHaveLength(2); // deux cartes par page A4

    const flat = await page(s, '/admin/tables/cards?format=flat');
    expect(flat.match(/class="tc-card tc-flat"/g)).toHaveLength(3);

    // Les autres pages gardent la CSP de l'administration.
    const main = await adminGet(s, '/admin/tables');
    expect(main.headers.get('content-security-policy')).not.toContain('fonts.googleapis.com');
  });

  it('export CSV : une ligne par invité placé, puis les non placés', async () => {
    const s = await login();
    const t2 = await createTable(s, { name: 'Table 2', capacity: '6', sort_order: '2' });
    const t1 = await createTable(s, { name: 'Table 1', capacity: '4', sort_order: '1' });
    const a = await makeGuest({ name: 'Tante Lala', side: 'rojo', expected_count: 2 });
    const b = await makeGuest({ name: 'Famille Rabe', side: 'orimbato', expected_count: 1 });
    const c = await makeGuest({ name: 'Soa', side: 'orimbato', expected_count: 3 });
    await makeGuest({ name: 'Koto', side: 'rojo', expected_count: 2 });
    const no = await makeGuest({ name: 'Neny', side: 'rojo', expected_count: 2 });
    await recordResponse(env.DB, b.id, { answer: 'oui', count: 2, message: '' });
    await recordResponse(env.DB, no.id, { answer: 'non', count: 0, message: '' });
    await adminJson(s, '/admin/tables/assign', { guest_id: a.id, table_id: t2.id });
    await adminJson(s, '/admin/tables/assign', { guest_id: b.id, table_id: t1.id });
    await adminJson(s, '/admin/tables/assign', { guest_id: c.id, table_id: t1.id });

    const res = await adminGet(s, '/admin/tables/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="plan-de-table-.*\.csv"/);
    const rows = parseCsv(await res.text());
    expect(rows).toEqual([
      ['Table', 'Capacité', 'Places occupées', 'Invité', 'Côté', 'Personnes', 'Réponse'],
      ['Table 1', '4', '5', 'Famille Rabe', 'Orimbato', '2', 'Oui'],
      ['Table 1', '4', '5', 'Soa', 'Orimbato', '3', 'Sans réponse'],
      ['Table 2', '6', '2', 'Tante Lala', 'Rojo', '2', 'Sans réponse'],
      ['Non placé', '', '', 'Koto', 'Rojo', '2', 'Sans réponse'],
    ]);
  });
});

describe('plan de table : accès', () => {
  it('exige une session', async () => {
    const res = await call('/admin/tables/assign', {
      method: 'POST',
      headers: { origin: BASE, 'content-type': 'application/json' },
      body: JSON.stringify({ guest_id: 1, table_id: null }),
    });
    expect(res.status).toBe(401);
    const get = await call('/admin/tables');
    expect(get.status).toBe(302);
    expect(get.headers.get('location')).toMatch(/^\/admin\/login\?next=%2Fadmin%2Ftables/);
    expect((await call('/admin/tables/cards')).status).toBe(302);
    expect((await call('/admin/tables/export.csv')).status).toBe(302);
  });

  it('exige le jeton CSRF pour placer un invité', async () => {
    const s = await login();
    const g = await makeGuest();
    const res = await call('/admin/tables/assign', {
      method: 'POST',
      headers: { cookie: s.cookie, origin: BASE, 'content-type': 'application/json' },
      body: JSON.stringify({ guest_id: g.id, table_id: null }),
    });
    expect(res.status).toBe(403);
  });
});
