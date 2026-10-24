import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { exports, env } from 'cloudflare:workers';
import { expect } from 'vitest';
import { createGuest, type GuestInput, type GuestRow } from '../src/lib/db';

export const BASE = 'https://vodiondry.test';
export const ADMIN_PASSWORD = 'mot-de-passe-test';

let ipCounter = 0;
/** Adresse IP différente à chaque appel (la limitation de débit est en mémoire et partagée entre tests). */
export function uniqueIp(): string {
  ipCounter++;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

/** Appelle le Worker (sans suivre les redirections). */
export async function call(path: string, init: RequestInit = {}, ip?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', ip ?? uniqueIp());
  return exports.default.fetch(new Request(BASE + path, { ...init, headers, redirect: 'manual' }));
}

export interface AdminSession {
  cookie: string;
  csrf: string;
}

/** Se connecte à l'administration et récupère le cookie de session + le jeton CSRF. */
export async function login(password = ADMIN_PASSWORD): Promise<AdminSession> {
  const res = await call('/admin/login', {
    method: 'POST',
    headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password, next: '/admin' }).toString(),
  });
  expect(res.status).toBe(303);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const cookie = setCookie.split(';')[0];
  expect(cookie).toMatch(/^vd_session=/);
  const page = await call('/admin', { headers: { cookie } });
  expect(page.status).toBe(200);
  const html = await page.text();
  const csrf = /<meta name="csrf-token" content="([^"]+)"/.exec(html)?.[1];
  expect(csrf).toBeTruthy();
  return { cookie, csrf: csrf! };
}

/** POST d'un formulaire admin (avec jeton CSRF). */
export async function adminPost(s: AdminSession, path: string, form: Record<string, string> = {}): Promise<Response> {
  return call(path, {
    method: 'POST',
    headers: { cookie: s.cookie, origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: s.csrf, ...form }).toString(),
  });
}

/** Requête JSON admin (jeton CSRF en en-tête). */
export async function adminJson(s: AdminSession, path: string, body: unknown, method = 'POST'): Promise<Response> {
  return call(path, {
    method,
    headers: { cookie: s.cookie, origin: BASE, 'content-type': 'application/json', 'x-csrf-token': s.csrf },
    body: JSON.stringify(body),
  });
}

export async function adminGet(s: AdminSession, path: string): Promise<Response> {
  return call(path, { headers: { cookie: s.cookie } });
}

export async function makeGuest(input: Partial<GuestInput> = {}): Promise<GuestRow> {
  return createGuest(env.DB, { name: 'Neny', side: 'rojo', expected_count: 2, ...input });
}

export async function rsvp(code: string, body: unknown, ip?: string): Promise<Response> {
  return call(
    `/api/rsvp/${code}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    ip,
  );
}

/**
 * Base D1 qui compte les requêtes (first/all/run/raw, batch = 1) et refuse au-delà de `cap`, comme l'offre gratuite
 * de Cloudflare (50 requêtes D1 par appel du Worker) — Miniflare n'applique pas cette limite.
 */
export function countingDb(real: D1Database, cap = 50): { db: D1Database; count: () => number } {
  let n = 0;
  const realOf = new WeakMap<object, D1PreparedStatement>();
  const tick = () => {
    if (++n > cap) throw new Error('D1_ERROR: Too many API requests by single worker invocation.');
  };
  const wrap = (s: D1PreparedStatement): D1PreparedStatement => {
    const w = {
      bind: (...args: unknown[]) => wrap(s.bind(...args)),
      first: async (col?: string) => (tick(), col === undefined ? s.first() : s.first(col)),
      all: async () => (tick(), s.all()),
      run: async () => (tick(), s.run()),
      raw: async (o?: { columnNames?: boolean }) => (tick(), s.raw(o as { columnNames: true })),
    };
    realOf.set(w, s);
    return w as unknown as D1PreparedStatement;
  };
  const db = {
    prepare: (sql: string) => wrap(real.prepare(sql)),
    batch: async (stmts: D1PreparedStatement[]) => (tick(), real.batch(stmts.map((s) => realOf.get(s) ?? s))),
    exec: async (sql: string) => (tick(), real.exec(sql)),
  };
  return { db: db as unknown as D1Database, count: () => n };
}

/** Appelle l'application avec d'autres liaisons (ex. base D1 instrumentée, autre mot de passe). */
export async function callWith(bindings: Partial<Cloudflare.Env>, path: string, init: RequestInit = {}, ip?: string): Promise<Response> {
  const { default: app } = await import('../src/index');
  const headers = new Headers(init.headers);
  if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', ip ?? uniqueIp());
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(BASE + path, { ...init, headers, redirect: 'manual' }), { ...env, ...bindings }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
