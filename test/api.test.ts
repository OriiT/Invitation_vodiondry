import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { getGuest } from '../src/lib/db';
import { setSettings } from '../src/lib/settings';
import { call, makeGuest, rsvp, uniqueIp } from './helpers';

describe('POST /api/rsvp/:code', () => {
  it('enregistre un « oui » avec le nombre de personnes et un message', async () => {
    const g = await makeGuest({ name: 'Tante Lala', expected_count: 3 });
    const res = await rsvp(g.code, { answer: 'oui', count: 3, message: 'Avec plaisir !' });
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.ok).toBe(true);
    expect(body.response).toMatchObject({ answer: 'oui', count: 3, message: 'Avec plaisir !' });
    const row = await getGuest(env.DB, g.id);
    expect(row).toMatchObject({ answer: 'oui', confirmed_count: 3, message: 'Avec plaisir !' });
  });

  it('permet de changer de réponse : la dernière fait foi, l’historique est conservé', async () => {
    const g = await makeGuest();
    expect((await rsvp(g.code, { answer: 'oui', count: 2 })).status).toBe(200);
    const res = await rsvp(g.code, { answer: 'non', count: 5, message: 'Désolé' });
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.response).toMatchObject({ answer: 'non', count: 0 });
    const row = await getGuest(env.DB, g.id);
    expect(row).toMatchObject({ answer: 'non', confirmed_count: 0 });
    const { results } = await env.DB.prepare('SELECT answer FROM responses WHERE guest_id = ? ORDER BY id').bind(g.id).all();
    expect(results.map((r: any) => r.answer)).toEqual(['oui', 'non']);
    // Et retour au « oui »
    expect((await rsvp(g.code, { answer: 'oui', count: 1 })).status).toBe(200);
    expect(await getGuest(env.DB, g.id)).toMatchObject({ answer: 'oui', confirmed_count: 1 });
  });

  it('accepte le code quelle que soit la casse', async () => {
    const g = await makeGuest();
    expect((await rsvp(g.code.toUpperCase(), { answer: 'non' })).status).toBe(200);
  });

  it('refuse un code inconnu ou mal formé', async () => {
    expect((await rsvp('zzzzzzzz', { answer: 'oui', count: 1 })).status).toBe(404);
    expect((await rsvp('../admin', { answer: 'oui', count: 1 })).status).toBe(404);
  });

  it('valide la réponse, le nombre et le message', async () => {
    const g = await makeGuest();
    expect((await rsvp(g.code, { answer: 'peut-être', count: 1 })).status).toBe(400);
    expect((await rsvp(g.code, { answer: 'oui', count: 0 })).status).toBe(400);
    expect((await rsvp(g.code, { answer: 'oui', count: 2.5 })).status).toBe(400);
    expect((await rsvp(g.code, { answer: 'oui', count: 999 })).status).toBe(400);
    expect((await rsvp(g.code, { answer: 'oui', count: 1, message: 'x'.repeat(1001) })).status).toBe(400);
    expect((await rsvp(g.code, { answer: 'oui', count: 1, message: 42 })).status).toBe(400);
    const notJson = await call(`/api/rsvp/${g.code}`, { method: 'POST', body: 'answer=oui', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(notJson.status).toBe(415);
    expect((await getGuest(env.DB, g.id))?.answer).toBeNull();
  });

  it('refuse les réponses après la date limite', async () => {
    const g = await makeGuest();
    await setSettings(env.DB, { rsvp_deadline: '2020-01-01' });
    const res = await rsvp(g.code, { answer: 'oui', count: 1 });
    expect(res.status).toBe(403);
    expect((await res.json<any>()).error).toBe('closed');
    expect((await getGuest(env.DB, g.id))?.answer).toBeNull();
  });

  it('un « non » libère la place attribuée dans le plan de table', async () => {
    const g = await makeGuest();
    const t = await env.DB.prepare("INSERT INTO tables (name, capacity) VALUES ('Table 1', 8) RETURNING id").first<{ id: number }>();
    await env.DB.prepare('UPDATE guests SET table_id = ? WHERE id = ?').bind(t!.id, g.id).run();
    await rsvp(g.code, { answer: 'non' });
    expect((await getGuest(env.DB, g.id))?.table_id).toBeNull();
  });

  it('limite le débit des réponses', async () => {
    const g = await makeGuest();
    const ip = uniqueIp();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await rsvp(g.code, { answer: 'oui', count: 1 }, ip)).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe('page invité', () => {
  it('enregistre l’ouverture du lien (date + user-agent), sauf pour les robots d’aperçu', async () => {
    const g = await makeGuest();
    const res = await call(`/i/${g.code}`, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' } });
    expect(res.status).toBe(200);
    await call(`/i/${g.code}`, { headers: { 'user-agent': 'WhatsApp/2.24.1 A' } });
    const { results } = await env.DB.prepare('SELECT ua, opened_at FROM opens WHERE guest_id = ?').bind(g.id).all<any>();
    expect(results).toHaveLength(1);
    expect(results[0].ua).toContain('iPhone');
    expect(results[0].opened_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('sert l’invitation personnalisée sans mise en cache ni indexation', async () => {
    const g = await makeGuest({ name: 'Neny' });
    const res = await call(`/i/${g.code}`, { headers: { 'user-agent': 'Mozilla/5.0' } });
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    const html = await res.text();
    expect(html).toContain('<base href="/">');
    expect(html).toContain('"name":"Neny"');
  });

  it('un code inconnu affiche l’invitation générique (404)', async () => {
    const res = await call('/i/abcdefgh', { headers: { 'user-agent': 'Mozilla/5.0' } });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('"mode":"generic"');
  });

  it('échappe le nom de l’invité dans le script injecté', async () => {
    const g = await makeGuest({ name: '</script><script>alert(1)</script>' });
    const html = await (await call(`/i/${g.code}`, { headers: { 'user-agent': 'Mozilla/5.0' } })).text();
    expect(html).not.toContain('</script><script>alert(1)');
  });
});

describe('nombre de personnes plafonné au nombre prévu', () => {
  it('refuse plus de personnes que prévu, accepte le maximum', async () => {
    const g = await makeGuest({ name: 'Famille Rabe', expected_count: 3 });
    const tooMany = await rsvp(g.code, { answer: 'oui', count: 4 });
    expect(tooMany.status).toBe(400);
    const body = await tooMany.json<any>();
    expect(body).toMatchObject({ error: 'invalid_count', max: 3 });
    expect(body.message).toContain('3 personnes');
    expect((await rsvp(g.code, { answer: 'oui', count: 3 })).status).toBe(200);
  });

  it('un invité prévu pour 0 personne peut quand même confirmer 1 personne', async () => {
    const g = await makeGuest({ name: 'Koto', expected_count: 0 });
    expect((await rsvp(g.code, { answer: 'oui', count: 2 })).status).toBe(400);
    expect((await rsvp(g.code, { answer: 'oui', count: 1 })).status).toBe(200);
  });
});

describe('réponse saisie par les mariés au-delà du nombre prévu', () => {
  it('l’invité peut modifier sa réponse sans perdre les places confirmées', async () => {
    const g = await makeGuest({ name: 'Famille Rabe', expected_count: 3 });
    await env.DB.prepare("INSERT INTO responses (guest_id, answer, count) VALUES (?, 'oui', 5)").bind(g.id).run();

    const state = await (await call(`/api/rsvp/${g.code}`)).json<any>();
    expect(state).toMatchObject({ expected: 3, max: 5, response: { answer: 'oui', count: 5 } });
    const page = await (await call(`/i/${g.code}`, { headers: { 'user-agent': 'Mozilla/5.0' } })).text();
    expect(page).toContain('"max":5');

    // Reconfirmer 5 (par exemple pour ajouter un message) est accepté ; 6 non.
    const tooMany = await rsvp(g.code, { answer: 'oui', count: 6 });
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json<any>()).toMatchObject({ error: 'invalid_count', max: 5 });
    const ok = await rsvp(g.code, { answer: 'oui', count: 5, message: 'Nous avons hâte !' });
    expect(ok.status).toBe(200);
    expect(await ok.json<any>()).toMatchObject({ max: 5, response: { count: 5, message: 'Nous avons hâte !' } });
    expect((await getGuest(env.DB, g.id))?.confirmed_count).toBe(5);

    // S'il choisit lui-même moins, le plafond redevient le nombre prévu.
    expect((await rsvp(g.code, { answer: 'oui', count: 2 })).status).toBe(200);
    expect((await rsvp(g.code, { answer: 'oui', count: 4 })).status).toBe(400);
  });
});
