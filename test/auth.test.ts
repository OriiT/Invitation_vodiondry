import { describe, expect, it } from 'vitest';
import { ipBucket } from '../src/lib/ratelimit';
import { safeNext } from '../src/routes/admin/index';
import { ADMIN_PASSWORD, BASE, adminGet, adminPost, call, callWith, login, uniqueIp } from './helpers';

function loginRequest(password: string, ip: string, next = '/admin'): Promise<Response> {
  return call(
    '/admin/login',
    {
      method: 'POST',
      headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password, next }).toString(),
    },
    ip,
  );
}

describe('accès à l’administration', () => {
  it('redirige vers la connexion sans session', async () => {
    const res = await call('/admin');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/^\/admin\/login/);
  });

  it('refuse les modifications sans session', async () => {
    const res = await call('/admin/guests', {
      method: 'POST',
      headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'name=Intrus&side=rojo&expected_count=1',
    });
    expect(res.status).toBe(401);
  });

  it('refuse un mauvais mot de passe', async () => {
    const res = await call('/admin/login', {
      method: 'POST',
      headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=mauvais',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('accepte le bon mot de passe et pose un cookie HttpOnly; Secure; SameSite=Lax', async () => {
    const res = await call('/admin/login', {
      method: 'POST',
      headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=mot-de-passe-test',
    });
    expect(res.status).toBe(303);
    const c = res.headers.get('set-cookie') ?? '';
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/Secure/i);
    expect(c).toMatch(/SameSite=Lax/i);
  });

  it('refuse un cookie de session falsifié', async () => {
    const res = await call('/admin', { headers: { cookie: 'vd_session=eyJzaWQiOiJ4IiwiZXhwIjo5OTk5OTk5OTk5OTk5LCJlcG9jaCI6IjAifQ.AAAA' } });
    expect(res.status).toBe(302);
  });

  it('exige le jeton CSRF sur les formulaires', async () => {
    const s = await login();
    const res = await call('/admin/logout', {
      method: 'POST',
      headers: { cookie: s.cookie, origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    expect(res.status).toBe(403);
    const ok = await adminPost(s, '/admin/logout');
    expect(ok.status).toBe(303);
  });

  it('refuse une requête venant d’un autre site même avec le jeton', async () => {
    const s = await login();
    const res = await call('/admin/logout', {
      method: 'POST',
      headers: { cookie: s.cookie, origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: s.csrf }).toString(),
    });
    expect(res.status).toBe(403);
  });

  it('pages admin non mises en cache et non indexées', async () => {
    const s = await login();
    const res = await adminGet(s, '/admin');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
  });
});

describe('connexion : limitation des essais', () => {
  it('des essais envoyés en même temps ne dépassent pas la limite de 10', async () => {
    const ip = uniqueIp();
    const res = await Promise.all(Array.from({ length: 30 }, () => loginRequest('mauvais', ip)));
    const statuses = res.map((r) => r.status);
    expect(statuses.filter((st) => st === 401)).toHaveLength(10);
    expect(statuses.filter((st) => st === 429)).toHaveLength(20);
    // Même le bon mot de passe est refusé pendant le blocage.
    expect((await loginRequest(ADMIN_PASSWORD, ip)).status).toBe(429);
  });

  it('une connexion réussie ne consomme pas d’essai', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 9; i++) expect((await loginRequest('mauvais', ip)).status).toBe(401);
    for (let i = 0; i < 3; i++) expect((await loginRequest(ADMIN_PASSWORD, ip)).status).toBe(303);
    expect((await loginRequest('mauvais', ip)).status).toBe(401); // 10e échec
    expect((await loginRequest('mauvais', ip)).status).toBe(429);
  });

  it('IPv6 : toutes les adresses d’un même bloc /64 partagent la limite', async () => {
    for (let i = 1; i <= 10; i++) expect((await loginRequest('mauvais', `2001:db8:7:42::${i.toString(16)}`)).status).toBe(401);
    expect((await loginRequest('mauvais', '2001:db8:7:42:ffff:1:2:3')).status).toBe(429);
    expect((await loginRequest('mauvais', '2001:db8:7:43::1')).status).toBe(401);
  });

  it('ipBucket : préfixe /64 des adresses IPv6, IPv4 inchangée', () => {
    expect(ipBucket('2001:DB8:0007:42::a')).toBe('2001:db8:7:42::/64');
    expect(ipBucket('2001:db8:7:42:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:7:42::/64');
    expect(ipBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipBucket('::1')).toBe('0:0:0:0::/64');
    expect(ipBucket('203.0.113.7')).toBe('203.0.113.7');
    expect(ipBucket('::ffff:203.0.113.7')).toBe('::ffff:203.0.113.7');
    expect(ipBucket('local')).toBe('local');
  });
});

describe('mot de passe initial trop court', () => {
  async function sessionWith(password: string) {
    const res = await callWith({ ADMIN_PASSWORD: password }, '/admin/login', {
      method: 'POST',
      headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password, next: '/admin' }).toString(),
    });
    expect(res.status).toBe(303);
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  }

  it('l’administration avertit (tableau de bord et Réglages), pas la page de connexion', async () => {
    const cookie = await sessionWith('court');
    const dash = await (await callWith({ ADMIN_PASSWORD: 'court' }, '/admin', { headers: { cookie } })).text();
    expect(dash).toContain('moins de 10 caractères');
    expect(dash).toContain('href="/admin/settings#mot-de-passe"');
    const settings = await (await callWith({ ADMIN_PASSWORD: 'court' }, '/admin/settings', { headers: { cookie } })).text();
    expect(settings).toContain('Le mot de passe actuel fait moins de 10 caractères');
    const loginPage = await (await callWith({ ADMIN_PASSWORD: 'court' }, '/admin/login')).text();
    expect(loginPage).not.toContain('caractères');
  });

  it('pas d’avertissement avec un mot de passe assez long', async () => {
    const s = await login();
    expect(await (await adminGet(s, '/admin')).text()).not.toContain('moins de 10 caractères');
    expect(await (await adminGet(s, '/admin/settings')).text()).not.toContain('moins de 10 caractères');
  });
});

describe('adresses avec « / » final', () => {
  it('/admin/ et /admin/<page>/ redirigent vers la page sans « / »', async () => {
    const s = await login();
    for (const [from, to] of [
      ['/admin/', '/admin'],
      ['/admin/tables/', '/admin/tables'],
      ['/admin/settings/', '/admin/settings'],
      ['/admin/relances/?side=rojo', '/admin/relances?side=rojo'],
    ]) {
      const res = await call(from, { headers: { cookie: s.cookie } });
      expect(res.status, from).toBe(301);
      expect(res.headers.get('location'), from).toBe(to);
      expect((await adminGet(s, to)).status, to).toBe(200);
    }
  });

  it('après la connexion, « next=/admin/ » mène au tableau de bord', async () => {
    const res = await loginRequest(ADMIN_PASSWORD, uniqueIp(), '/admin/');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin');
    expect(safeNext('/admin/tables/?x=1#a')).toBe('/admin/tables?x=1#a');
    expect(safeNext('//evil.example/admin')).toBe('/admin');
    expect(safeNext('https://evil.example')).toBe('/admin');
  });
});
