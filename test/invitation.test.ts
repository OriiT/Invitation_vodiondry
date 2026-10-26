import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ANCHORS } from '../src/lib/inject';
import { call, makeGuest } from './helpers';

/** Empreinte SHA-256 de public/index.html tel que livré dans vodiondry-site.zip. */
const SITE_INDEX_SHA256 = '941fa2ed9e44cabada26a44936e935e72e5c458f3d89b27ed7d77d374c90ac81';

async function sha256(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('site d’invitation intégré tel quel', () => {
  it('public/index.html est identique au fichier du zip', async () => {
    const res = await env.ASSETS.fetch(new Request('https://vodiondry.test/'));
    expect(res.status).toBe(200);
    expect(await sha256(await res.arrayBuffer())).toBe(SITE_INDEX_SHA256);
  });

  it('les points d’ancrage de la personnalisation existent dans le site', async () => {
    const html = await (await env.ASSETS.fetch(new Request('https://vodiondry.test/'))).text();
    for (const a of Object.values(ANCHORS)) expect(html).toContain(a);
    expect(html).toContain('id="rsvpYes"');
    expect(html).toContain('id="rsvpNo"');
  });

  it('les médias de l’enveloppe sont servis (Workers Static Assets)', async () => {
    for (const [path, type] of [['/a/env.mp4', 'video/mp4'], ['/a/env.webm', 'video/webm'], ['/a/s3.webp', 'image/webp']]) {
      const res = await env.ASSETS.fetch(new Request(`https://vodiondry.test${path}`));
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type'), path).toContain(type);
    }
  });

  it('les données de l’invité sont injectées avant le script d’origine (le prénom est animé lettre à lettre)', async () => {
    const g = await makeGuest({ name: 'Tante Lala', expected_count: 3 });
    const html = await (await call(`/i/${g.code}`, { headers: { 'user-agent': 'Mozilla/5.0' } })).text();
    const data = html.indexOf('window.VODIONDRY=');
    const rsvpJs = html.indexOf('<script src="/vd/rsvp.js"></script>');
    const site = html.indexOf('const RSVP = {');
    expect(data).toBeGreaterThan(0);
    expect(rsvpJs).toBeGreaterThan(data);
    expect(site).toBeGreaterThan(rsvpJs);
    expect(html).toContain('<link rel="stylesheet" href="/vd/rsvp.css">');
    expect(html).toContain('"expected":3');
  });

  it('page générique « / » : mode générique, sans compter d’ouverture', async () => {
    const res = await call('/', { headers: { 'user-agent': 'Mozilla/5.0' } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('"mode":"generic"');
    expect(html).not.toContain('"code"');
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM opens').first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('une visite des mariés connectés ne compte pas comme une ouverture', async () => {
    const { login } = await import('./helpers');
    const s = await login();
    const g = await makeGuest();
    await call(`/i/${g.code}`, { headers: { cookie: s.cookie, 'user-agent': 'Mozilla/5.0' } });
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM opens WHERE guest_id = ?').bind(g.id).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('publie « Votre table » seulement si le plan est publié et la réponse est oui', async () => {
    const g = await makeGuest({ expected_count: 2 });
    const t = await env.DB.prepare("INSERT INTO tables (name, capacity) VALUES ('Ravinala', 8) RETURNING id").first<{ id: number }>();
    await env.DB.prepare('UPDATE guests SET table_id = ? WHERE id = ?').bind(t!.id, g.id).run();
    await env.DB.prepare("INSERT INTO responses (guest_id, answer, count) VALUES (?, 'oui', 2)").bind(g.id).run();
    const page = async () => (await call(`/i/${g.code}`, { headers: { 'user-agent': 'Mozilla/5.0' } })).text();
    expect(await page()).toContain('"table":null');
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('publish_tables', '1')").run();
    expect(await page()).toContain('"table":"Ravinala"');
  });
});
