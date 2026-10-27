// Budget : postes du fichier Excel (migration 0003), trois scénarios, ajout / modification / suppression,
// personnes hors liste, validation, échappement, export CSV, accès.

import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AMOUNT_MAX,
  computeBudget,
  formatAr,
  groupDigits,
  parseAmount,
  peopleCounts,
  type BudgetItem,
} from '../src/lib/budget';
import { createGuests, listGuests, recordResponse, type GuestInput } from '../src/lib/db';
import { parseCsv } from '../src/lib/import';
import { getSettings, setSettings } from '../src/lib/settings';
import { BASE, adminGet, adminPost, call, login, type AdminSession } from './helpers';

const MIGRATION = '0003_budget.sql';

function migrationQueries(): string[] {
  const m = env.TEST_MIGRATIONS.find((x) => x.name === MIGRATION);
  expect(m, MIGRATION).toBeTruthy();
  return m!.queries;
}

/** Remet la table budget_items dans l'état de la migration (vraies données du fichier Excel). */
async function reseed(): Promise<void> {
  const inserts = migrationQueries().filter((q) => /INSERT\s+INTO\s+budget_items/i.test(q));
  expect(inserts.length).toBeGreaterThan(0);
  await env.DB.batch([env.DB.prepare('DELETE FROM budget_items'), ...inserts.map((q) => env.DB.prepare(q))]);
}

async function items(): Promise<BudgetItem[]> {
  const { results } = await env.DB.prepare('SELECT * FROM budget_items ORDER BY sort_order, id').all<BudgetItem>();
  return results;
}

async function itemByLabel(label: string): Promise<BudgetItem> {
  const it = (await items()).find((x) => x.label === label);
  expect(it, label).toBeTruthy();
  return it!;
}

/** Invités fictifs dont les nombres prévus font 76 personnes, comme la liste du fichier Excel. */
async function seedGuests76(): Promise<void> {
  const inputs: GuestInput[] = [
    { name: 'Tante Lala', side: 'rojo', expected_count: 3 },
    { name: 'Famille Rabe', side: 'orimbato', expected_count: 4 },
    { name: 'Soa', side: 'rojo', expected_count: 1 },
  ];
  for (let i = 1; i <= 17; i++) inputs.push({ name: `Famille Koto ${i}`, side: i % 2 ? 'rojo' : 'orimbato', expected_count: 4 });
  await createGuests(env.DB, inputs);
  const total = (await env.DB.prepare('SELECT SUM(expected_count) AS n FROM guests').first<{ n: number }>())!.n;
  expect(total).toBe(76);
}

async function guestId(name: string): Promise<number> {
  return (await env.DB.prepare('SELECT id FROM guests WHERE name = ?1').bind(name).first<{ id: number }>())!.id;
}

async function page(s: AdminSession, path = '/admin/budget'): Promise<string> {
  const res = await adminGet(s, path);
  expect(res.status, path).toBe(200);
  return res.text();
}

/** Total affiché dans la tuile d'un scénario. */
function tileTotal(html: string, key: 'prevu' | 'estimation' | 'confirme'): string {
  const m = new RegExp(`data-total="${key}">([^<]*)<`).exec(html);
  expect(m, key).toBeTruthy();
  return m![1];
}

beforeEach(async () => {
  await reseed();
  // test/setup.ts vide la table settings avant chaque test : valeur du fichier Excel posée explicitement.
  await setSettings(env.DB, { budget_extra_people: '7' });
});

describe('budget : calculs', () => {
  it('reproduit le total « OPTION RETENUE » du fichier Excel : 83 personnes, 5 149 000 Ar, 62 036 Ar / personne', async () => {
    await seedGuests76();
    const people = peopleCounts(await listGuests(env.DB), 7);
    expect(people).toMatchObject({ listed: 76, extra: 7, prevu: 83, estimation: 83, confirme: 7 });
    const totals = computeBudget(await items(), people);
    expect(totals.forfaits).toBe(1_165_000);
    expect(totals.perPerson).toBe(48_000);
    expect(totals.scenarios.prevu).toEqual({ people: 83, total: 5_149_000, perGuest: 62_036 });

    const s = await login();
    const html = await page(s);
    expect(formatAr(5_149_000)).toBe('5 149 000 Ar');
    expect(tileTotal(html, 'prevu')).toBe('5 149 000 Ar');
    expect(html).toContain('83 personnes');
    expect(html).toContain('62 036 Ar / personne');
    expect(html).toContain('1 165 000 Ar');
    expect(html).toContain('48 000 Ar');
    // Postes de la migration, avec leurs détails.
    for (const text of ['Menu Parasoly 3', 'Location salle La Rizière', 'Fono tseza', 'Décoration salle', 'housses de chaises']) {
      expect(html).toContain(text);
    }
    expect(html).toContain('href="/vd/budget.css"');
    expect(html).toMatch(/<a href="\/admin\/budget" class="active" aria-current="page">Budget<\/a>/);
  });

  it('la migration pose 7 personnes hors liste sans écraser une valeur existante', async () => {
    const q = migrationQueries().find((x) => /budget_extra_people/.test(x))!;
    await env.DB.prepare('DELETE FROM settings').run();
    await env.DB.prepare(q).run();
    expect((await getSettings(env.DB)).budget_extra_people).toBe('7');
    await setSettings(env.DB, { budget_extra_people: '3' });
    await env.DB.prepare(q).run();
    expect((await getSettings(env.DB)).budget_extra_people).toBe('3');
  });

  it('trois scénarios : un « oui » compte son nombre confirmé, un « non » ne compte plus', async () => {
    await seedGuests76();
    await recordResponse(env.DB, await guestId('Tante Lala'), { answer: 'oui', count: 2, message: '' });
    await recordResponse(env.DB, await guestId('Famille Rabe'), { answer: 'non', count: 0, message: '' });
    const people = peopleCounts(await listGuests(env.DB), 7);
    // Prévu : 76 + 7 ; estimation : 76 − 3 + 2 − 4 + 7 ; confirmé : 2 + 7.
    expect(people).toMatchObject({ prevu: 83, estimation: 78, confirme: 9, yes: 2, pending: 69 });
    const t = computeBudget(await items(), people).scenarios;
    expect(t.estimation).toEqual({ people: 78, total: 4_909_000, perGuest: 62_936 });
    expect(t.confirme).toEqual({ people: 9, total: 1_597_000, perGuest: 177_444 });

    const html = await page(await login());
    expect(tileTotal(html, 'prevu')).toBe(formatAr(5_149_000));
    expect(tileTotal(html, 'estimation')).toBe(formatAr(4_909_000));
    expect(tileTotal(html, 'confirme')).toBe(formatAr(1_597_000));
    expect(html).toContain('78 personnes');
    expect(html).toContain('9 personnes');
    expect(html).toContain('« Oui » confirmés (2) + sans réponse (69) + hors liste (7)');
    // Menu 3 pour l'estimation : 45 000 × 78.
    expect(html).toContain(formatAr(45_000 * 78));
  });

  it('sans personne : coût par personne 0, pas de division par zéro', async () => {
    const t = computeBudget([{ kind: 'forfait', amount: 1000 }], { prevu: 0, estimation: 0, confirme: 0 });
    expect(t.scenarios.prevu).toEqual({ people: 0, total: 1000, perGuest: 0 });
    await setSettings(env.DB, { budget_extra_people: '0' });
    const html = await page(await login());
    expect(html).toContain('<b>0 personne</b> · 0\u00a0Ar / personne');
  });

  it('parseAmount : montants acceptés et refusés', () => {
    const ok: [string, number][] = [
      ['300000', 300_000],
      ['300 000', 300_000],
      ['300 000', 300_000],
      ['300 000', 300_000],
      ['300.000', 300_000],
      ['1.250.000', 1_250_000],
      ['300000 Ar', 300_000],
      ['300 000 Ar', 300_000],
      ['300 000 Ar', 300_000],
      ['  45 000  ', 45_000],
      ['400000ar', 400_000],
      ['0', 0],
      [String(AMOUNT_MAX), AMOUNT_MAX],
    ];
    for (const [input, n] of ok) expect(parseAmount(input), JSON.stringify(input)).toBe(n);
    for (const input of ['', '   ', 'Ar', '-5', '-300 000', '12,5', '12.50', '1.5', '300,000', 'abc', '4OO', '1e6', '+5', String(AMOUNT_MAX + 1), '99999999999999']) {
      expect(parseAmount(input), JSON.stringify(input)).toBeNull();
    }
    expect(groupDigits(400000, ' ')).toBe('400 000');
    expect(formatAr(0)).toBe('0 Ar');
    expect(formatAr(62036.4)).toBe('62 036 Ar');
  });
});

describe('budget : ajouter, modifier, supprimer un frais', () => {
  it('ajoute un forfait « Photographe » 400 000 : chaque total augmente de 400 000', async () => {
    await seedGuests76();
    const s = await login();
    const res = await adminPost(s, '/admin/budget', { label: '  Photographe ', detail: 'acompte versé', kind: 'forfait', amount: '400 000' });
    expect(res.status).toBe(303);
    const it = await itemByLabel('Photographe');
    expect(it).toMatchObject({ kind: 'forfait', amount: 400_000, detail: 'acompte versé' });
    expect(it.sort_order).toBe(17);
    expect(res.headers.get('location')).toBe(`/admin/budget?ok=created#frais-${it.id}`);
    const html = await page(s, '/admin/budget?ok=created');
    expect(html).toContain('Poste ajouté.');
    expect(tileTotal(html, 'prevu')).toBe(formatAr(5_149_000 + 400_000));
    expect(tileTotal(html, 'confirme')).toBe(formatAr(1_165_000 + 400_000 + 48_000 * 7));
    expect(html).toContain(`id="frais-${it.id}"`);
  });

  it('ajoute un montant par personne : multiplié par le nombre de personnes', async () => {
    await seedGuests76();
    const s = await login();
    const res = await adminPost(s, '/admin/budget', { label: 'Boisson gazeuse', detail: '', kind: 'par_personne', amount: '2 000 Ar' });
    expect(res.status).toBe(303);
    expect(await itemByLabel('Boisson gazeuse')).toMatchObject({ kind: 'par_personne', amount: 2000 });
    const html = await page(s);
    expect(tileTotal(html, 'prevu')).toBe(formatAr(1_165_000 + 50_000 * 83));
    expect(html).toContain(formatAr(2000 * 83));
    expect(html).toContain(formatAr(50_000));
  });

  it('valide le formulaire d’ajout et réaffiche les valeurs saisies (400)', async () => {
    const s = await login();
    const before = (await items()).length;
    const forms: [Record<string, string>, string][] = [
      [{ label: '', kind: 'forfait', amount: '1000' }, 'Indiquez le nom du poste'],
      [{ label: 'x'.repeat(101), kind: 'forfait', amount: '1000' }, 'Nom du poste trop long'],
      [{ label: 'Fleurs', detail: 'y'.repeat(301), kind: 'forfait', amount: '1000' }, 'Détail trop long'],
      [{ label: 'Fleurs', kind: 'cadeau', amount: '1000' }, 'Choisissez le type'],
      [{ label: 'Fleurs', kind: 'forfait', amount: '' }, 'Indiquez le montant'],
      [{ label: 'Fleurs', kind: 'forfait', amount: '12,5' }, 'Montant invalide'],
      [{ label: 'Fleurs', kind: 'forfait', amount: '-100' }, 'Montant invalide'],
      [{ label: 'Fleurs', kind: 'forfait', amount: 'beaucoup' }, 'Montant invalide'],
    ];
    for (const [form, message] of forms) {
      const res = await adminPost(s, '/admin/budget', { detail: '', ...form });
      expect(res.status, JSON.stringify(form)).toBe(400);
      const html = await res.text();
      expect(html).toContain('flash-err');
      expect(html).toContain(message);
      expect(html).toContain('aria-invalid="true"');
      if (form.label) expect(html).toContain(`value="${form.label}"`);
      if (form.amount) expect(html).toContain(`value="${form.amount}"`);
    }
    expect((await items()).length).toBe(before);
  });

  it('modifie un frais (fiche préremplie, validation, enregistrement)', async () => {
    await seedGuests76();
    const s = await login();
    const menu = await itemByLabel('Menu Parasoly 3');
    const edit = await page(s, `/admin/budget/${menu.id}/edit`);
    expect(edit).toContain('Modifier le poste');
    expect(edit).toContain('value="Menu Parasoly 3"');
    expect(edit).toContain('value="45 000"');
    expect(edit).toMatch(/<option value="par_personne" selected="">/);
    expect(edit).toContain(`action="/admin/budget/${menu.id}/delete"`);
    expect(edit).toContain('Supprimer ce poste');

    const bad = await adminPost(s, `/admin/budget/${menu.id}`, { label: 'Menu Parasoly 4', detail: '', kind: 'par_personne', amount: '50,5' });
    expect(bad.status).toBe(400);
    const badHtml = await bad.text();
    expect(badHtml).toContain('Montant invalide');
    expect(badHtml).toContain('value="Menu Parasoly 4"');
    expect(badHtml).toContain('value="50,5"');
    expect((await itemByLabel('Menu Parasoly 3')).amount).toBe(45_000);

    const res = await adminPost(s, `/admin/budget/${menu.id}`, { label: 'Menu Parasoly 4', detail: 'nouveau devis', kind: 'par_personne', amount: '50 000' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/admin/budget?ok=updated#frais-${menu.id}`);
    expect(await itemByLabel('Menu Parasoly 4')).toMatchObject({ id: menu.id, amount: 50_000, detail: 'nouveau devis' });
    const html = await page(s, '/admin/budget?ok=updated');
    expect(html).toContain('Poste enregistré.');
    expect(tileTotal(html, 'prevu')).toBe(formatAr(1_165_000 + 53_000 * 83));

    // Un forfait peut devenir un montant par personne.
    const nappes = await itemByLabel('Nappes');
    expect((await adminPost(s, `/admin/budget/${nappes.id}`, { label: 'Nappes', detail: '', kind: 'par_personne', amount: '300' })).status).toBe(303);
    expect((await itemByLabel('Nappes')).kind).toBe('par_personne');
  });

  it('supprime un frais (avec confirmation)', async () => {
    await seedGuests76();
    const s = await login();
    const deco = await itemByLabel('Décoration salle');
    const html = await page(s);
    expect(html).toContain(`data-confirm="Supprimer « Décoration salle » du budget ?"`);
    const res = await adminPost(s, `/admin/budget/${deco.id}/delete`);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/budget?ok=deleted');
    expect((await items()).some((x) => x.id === deco.id)).toBe(false);
    const after = await page(s, '/admin/budget?ok=deleted');
    expect(after).toContain('Poste supprimé.');
    expect(tileTotal(after, 'prevu')).toBe(formatAr(5_149_000 - 750_000));
  });

  it('frais inconnu : page « introuvable » en français (404)', async () => {
    const s = await login();
    for (const res of [
      await adminGet(s, '/admin/budget/999999/edit'),
      await adminPost(s, '/admin/budget/999999', { label: 'X', kind: 'forfait', amount: '1' }),
      await adminPost(s, '/admin/budget/999999/delete'),
    ]) {
      expect(res.status).toBe(404);
      const html = await res.text();
      expect(html).toContain('Poste introuvable');
      expect(html).toContain('href="/admin/budget"');
    }
  });

  it('échappe le nom et le détail d’un frais', async () => {
    const s = await login();
    const hostile = '<script>alert(1)</script>';
    expect((await adminPost(s, '/admin/budget', { label: hostile, detail: '<b>gras</b>', kind: 'forfait', amount: '1000' })).status).toBe(303);
    const it = await itemByLabel(hostile);
    for (const path of ['/admin/budget', `/admin/budget/${it.id}/edit`]) {
      const html = await page(s, path);
      expect(html, path).not.toContain('<script>alert');
      expect(html, path).not.toContain('<b>gras</b>');
      expect(html, path).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    }
  });
});

describe('budget : personnes hors liste', () => {
  it('enregistre le nombre de personnes hors liste et recalcule les totaux', async () => {
    await seedGuests76();
    const s = await login();
    expect(await page(s)).toMatch(/name="extra_people" value="7"/);
    const res = await adminPost(s, '/admin/budget/personnes', { extra_people: ' 10 ' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/budget?ok=personnes');
    expect((await getSettings(env.DB)).budget_extra_people).toBe('10');
    const html = await page(s, '/admin/budget?ok=personnes');
    expect(html).toContain('Nombre de personnes hors liste enregistré.');
    expect(html).toContain('86 personnes');
    expect(tileTotal(html, 'prevu')).toBe(formatAr(1_165_000 + 48_000 * 86));
  });

  it('refuse un nombre invalide (400) sans rien changer', async () => {
    const s = await login();
    for (const value of ['', '-1', '501', 'sept', '2.5', '1000']) {
      const res = await adminPost(s, '/admin/budget/personnes', { extra_people: value });
      expect(res.status, value).toBe(400);
      const html = await res.text();
      expect(html).toContain('Nombre de personnes invalide (nombre entier de 0 à 500).');
      expect(html).toContain(`name="extra_people" value="${value}"`);
    }
    expect((await getSettings(env.DB)).budget_extra_people).toBe('7');
    expect((await adminPost(s, '/admin/budget/personnes', { extra_people: '0' })).status).toBe(303);
    expect((await getSettings(env.DB)).budget_extra_people).toBe('0');
  });
});

describe('budget : export CSV', () => {
  it('une ligne par frais puis les totaux des trois scénarios', async () => {
    await seedGuests76();
    await recordResponse(env.DB, await guestId('Tante Lala'), { answer: 'oui', count: 2, message: '' });
    await recordResponse(env.DB, await guestId('Famille Rabe'), { answer: 'non', count: 0, message: '' });
    const s = await login();
    const res = await adminGet(s, '/admin/budget/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="budget-vodiondry-${day}.csv"`);
    const rows = parseCsv(await res.text());
    expect(rows[0]).toEqual(['Poste', 'Détail', 'Type', 'Montant', 'Total prévu', 'Total estimation', 'Total confirmé']);
    const row = (label: string) => {
      const r = rows.find((x) => x[0] === label);
      expect(r, label).toBeTruthy();
      return r!;
    };
    expect(row('Menu Parasoly 3').slice(2)).toEqual(['Par personne', '45000', String(45_000 * 83), String(45_000 * 78), String(45_000 * 9)]);
    expect(row('Location salle La Rizière').slice(2)).toEqual(['Forfait', '300000', '300000', '300000', '300000']);
    expect(row('Sous-total forfaits').slice(3)).toEqual(['1165000', '1165000', '1165000', '1165000']);
    expect(row('Sous-total par personne').slice(3)).toEqual(['48000', String(48_000 * 83), String(48_000 * 78), String(48_000 * 9)]);
    expect(row('Nombre de personnes').slice(4)).toEqual(['83', '78', '9']);
    expect(row('Total').slice(4)).toEqual(['5149000', '4909000', '1597000']);
    expect(row('Coût par personne').slice(4)).toEqual(['62036', '62936', '177444']);
    // Les 10 postes de la migration, chacun une fois.
    expect(rows.filter((r) => r[2] === 'Forfait' || r[2] === 'Par personne').length).toBe(10 + 2);
  });
});

describe('budget : accès', () => {
  it('exige une session', async () => {
    const get = await call('/admin/budget');
    expect(get.status).toBe(302);
    expect(get.headers.get('location')).toBe('/admin/login?next=%2Fadmin%2Fbudget');
    expect((await call('/admin/budget/export.csv')).status).toBe(302);
    for (const path of ['/admin/budget', '/admin/budget/personnes']) {
      const post = await call(path, {
        method: 'POST',
        headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ label: 'Fleurs', kind: 'forfait', amount: '1000', extra_people: '3' }).toString(),
      });
      expect(post.status, path).toBe(401);
    }
    expect((await items()).some((x) => x.label === 'Fleurs')).toBe(false);
  });

  it('exige le jeton CSRF', async () => {
    const s = await login();
    const menu = await itemByLabel('Menu Parasoly 3');
    for (const [path, form] of [
      ['/admin/budget', { label: 'Fleurs', kind: 'forfait', amount: '1000' }],
      ['/admin/budget/personnes', { extra_people: '3' }],
      [`/admin/budget/${menu.id}/delete`, {}],
    ] as [string, Record<string, string>][]) {
      const res = await call(path, {
        method: 'POST',
        headers: { cookie: s.cookie, origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      });
      expect(res.status, path).toBe(403);
    }
    expect((await items()).some((x) => x.label === 'Fleurs')).toBe(false);
    expect((await getSettings(env.DB)).budget_extra_people).toBe('7');
    expect((await items()).some((x) => x.id === menu.id)).toBe(true);
  });
});
