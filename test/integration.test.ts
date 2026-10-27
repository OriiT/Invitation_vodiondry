// Vérifications transversales de l'administration : navigation, doctype, CSP, jeton CSRF dans chaque
// formulaire POST, aucun script en ligne ni attribut on*, échappement des noms sur toutes les pages.

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { adminGet, adminJson, adminPost, login, makeGuest, rsvp, type AdminSession } from './helpers';

const NAV_PAGES = ['/admin', '/admin/relances', '/admin/tables', '/admin/budget', '/admin/import', '/admin/settings'];

const HOSTILE = '<script>alert("x")</script> Koto & "Soa"';

interface Seeded {
  guestId: number;
  tableId: number;
  budgetItemId: number;
}

/** Quelques invités, une table, des réponses et un frais : chaque page a quelque chose à afficher. */
async function seed(s: AdminSession): Promise<Seeded> {
  const lala = await makeGuest({ name: 'Tante Lala', side: 'rojo', expected_count: 3, phone: '034 00 000 01', notes: 'Arrive la veille' });
  const rabe = await makeGuest({ name: 'Famille Rabe', side: 'orimbato', expected_count: 4 });
  const hostile = await makeGuest({ name: HOSTILE, side: 'orimbato', expected_count: 2, notes: '<b>gras</b>' });
  await makeGuest({ name: 'Soa', side: 'rojo', expected_count: 1 });
  expect((await rsvp(lala.code, { answer: 'oui', count: 2, message: '<i>Avec joie</i>' })).status).toBe(200);
  expect((await rsvp(rabe.code, { answer: 'non', count: 0, message: '' })).status).toBe(200);

  expect((await adminPost(s, '/admin/tables', { name: 'Table <1>', capacity: '2', sort_order: '1' })).status).toBe(303);
  const table = await env.DB.prepare('SELECT id FROM tables').first<{ id: number }>();
  const placed = await adminJson(s, '/admin/tables/assign', { guest_id: hostile.id, table_id: table!.id });
  expect(placed.status).toBe(200);

  const frais = { label: HOSTILE, detail: '<b>gras</b>', kind: 'forfait', amount: '400 000' };
  expect((await adminPost(s, '/admin/budget', frais)).status).toBe(303);
  const item = await env.DB.prepare('SELECT id FROM budget_items WHERE label = ?1').bind(HOSTILE).first<{ id: number }>();
  return { guestId: hostile.id, tableId: table!.id, budgetItemId: item!.id };
}

function scriptTags(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
}

/** Vérifie une page HTML de l'administration et renvoie son contenu. */
async function checkPage(s: AdminSession, path: string): Promise<string> {
  const res = await adminGet(s, path);
  expect(res.status, path).toBe(200);
  expect(res.headers.get('content-type'), path).toMatch(/^text\/html/);
  const csp = res.headers.get('content-security-policy') ?? '';
  expect(csp, path).toMatch(/script-src 'self'(;|$)/);
  expect(res.headers.get('cache-control'), path).toBe('no-store');
  const html = await res.text();

  expect(html.startsWith('<!doctype html>'), `${path} : doctype`).toBe(true);
  expect(html, path).toContain('<html lang="fr">');

  // Aucun script en ligne : chaque <script> a un src local et est vide.
  for (const tag of scriptTags(html)) expect(tag, path).toMatch(/^<script src="\/vd\/[a-z.-]+\.js"( defer(="")?)?>$/);
  expect(html, path).not.toMatch(/<script[^>]*>[^<]+<\/script>/i);
  // Aucun gestionnaire d'événement en attribut, aucun lien javascript:.
  expect(html, path).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
  expect(html, path).not.toMatch(/javascript:/i);

  // Chaque formulaire POST porte le jeton CSRF de la session.
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
  for (const [, attrs, body] of forms) {
    if (!/method="post"/i.test(attrs)) continue;
    expect(body, `${path} : ${attrs}`).toContain(`<input type="hidden" name="_csrf" value="${s.csrf}"/>`);
  }
  return html;
}

describe('administration : cohérence de toutes les pages', () => {
  it('chaque lien de la navigation répond 200, avec doctype, CSP, CSRF et sans script en ligne', async () => {
    const s = await login();
    await seed(s);
    for (const path of NAV_PAGES) {
      const html = await checkPage(s, path);
      // La navigation complète est présente et l'onglet courant est marqué.
      for (const href of NAV_PAGES) expect(html, path).toContain(`href="${href}"`);
      expect(html, path).toMatch(/aria-current="page"/);
    }
  });

  it('les pages secondaires suivent les mêmes règles', async () => {
    const s = await login();
    const { guestId, budgetItemId } = await seed(s);
    for (const path of [
      '/admin/guests/new',
      `/admin/guests/${guestId}/edit`,
      '/admin/relances?side=rojo',
      '/admin/tables?side=orimbato&q=koto',
      '/admin?status=none&q=soa',
      '/admin/tables/print',
      `/admin/budget/${budgetItemId}/edit`,
    ]) {
      await checkPage(s, path);
    }
  });

  it('les pages sont aussi correctes avec une base vide', async () => {
    const s = await login();
    for (const path of [...NAV_PAGES, '/admin/tables/print']) await checkPage(s, path);
    const cards = await adminGet(s, '/admin/tables/cards');
    expect(cards.status).toBe(200);
    expect((await cards.text()).startsWith('<!doctype html>')).toBe(true);
  });

  it('les noms et textes saisis sont échappés sur toutes les pages', async () => {
    const s = await login();
    const { guestId, budgetItemId } = await seed(s);
    const pages = [
      '/admin',
      '/admin/relances',
      '/admin/tables',
      `/admin/guests/${guestId}/edit`,
      '/admin/tables/print',
      '/admin/tables/cards',
      '/admin/budget',
      `/admin/budget/${budgetItemId}/edit`,
    ];
    for (const path of pages) {
      const html = await (await adminGet(s, path)).text();
      expect(html, path).not.toContain('<script>alert');
      expect(html, path).not.toContain('<b>gras</b>');
      expect(html, path).not.toContain('<i>Avec joie</i>');
      expect(html, path).not.toContain('Table <1>');
    }
    const dashboard = await (await adminGet(s, '/admin')).text();
    expect(dashboard).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; Koto &amp; &quot;Soa&quot;');
    expect(dashboard).toContain('Table &lt;1&gt;');
  });

  it('les marque-tables ont leur propre CSP (polices Google), sans script en ligne', async () => {
    const s = await login();
    await seed(s);
    const res = await adminGet(s, '/admin/tables/cards');
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/script-src 'self';/);
    expect(csp).toContain('https://fonts.googleapis.com');
    const html = await res.text();
    for (const tag of scriptTags(html)) expect(tag).toMatch(/^<script src="\/vd\/[a-z.-]+\.js"/);
  });

  it('les exports CSV portent la date du jour à Madagascar dans leur nom', async () => {
    const s = await login();
    await seed(s);
    const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    for (const [path, prefix] of [
      ['/admin/export.csv', 'invites-vodiondry'],
      ['/admin/tables/export.csv', 'plan-de-table'],
      ['/admin/budget/export.csv', 'budget-vodiondry'],
    ]) {
      const res = await adminGet(s, path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-disposition'), path).toBe(`attachment; filename="${prefix}-${day}.csv"`);
      // BOM UTF-8 (Excel) : vérifié sur les octets, Response.text() le retire.
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect([...bytes.slice(0, 3)], path).toEqual([0xef, 0xbb, 0xbf]);
    }
  });

  it('sans session : chaque page de la navigation redirige vers la connexion', async () => {
    const { call } = await import('./helpers');
    for (const path of NAV_PAGES) {
      const res = await call(path);
      expect(res.status, path).toBe(302);
      expect(res.headers.get('location'), path).toBe(`/admin/login?next=${encodeURIComponent(path)}`);
    }
  });
});
