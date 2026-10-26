// Administration : connexion, protection (session + CSRF), puis sous-sections.

import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import {
  csrfTokenFor,
  endSession,
  readSession,
  sameOrigin,
  secretsConfigured,
  startSession,
  verifyAdminPassword,
  verifyCsrf,
} from '../../lib/auth';
import { clientIp, rateLimit, releaseHit } from '../../lib/ratelimit';
import { Layout } from '../../views/layout';
import guests from './guests';
import settings from './settings';
import tables from './tables';

const admin = new Hono<AppEnv>();

export const ADMIN_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'";

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW = 15 * 60_000;

// En-têtes de sécurité de toutes les pages d'administration.
admin.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('X-Frame-Options', 'DENY');
  // Une route peut poser sa propre CSP (ex. marque-tables avec polices Google) : on ne l'écrase pas.
  if (!c.res.headers.has('Content-Security-Policy')) c.header('Content-Security-Policy', ADMIN_CSP);
});

/** Redirection interne sûre (évite les redirections ouvertes), sans « / » final (« /admin/ » → « /admin »). */
export function safeNext(next: string | undefined | null): string {
  if (!next || !next.startsWith('/admin') || next.startsWith('//')) return '/admin';
  const i = next.search(/[?#]/);
  const path = i < 0 ? next : next.slice(0, i);
  return `${path.replace(/\/+$/, '') || '/admin'}${i < 0 ? '' : next.slice(i)}`;
}

const LoginPage = (p: { next: string; error?: string }) => (
  <Layout title="Connexion" flash={p.error ? { kind: 'err', text: p.error } : null}>
    <section class="card login">
      <h1>Administration</h1>
      <p class="muted">Vodiondry d’Orimbato &amp; Rojo — 19 décembre 2026</p>
      <form method="post" action="/admin/login" class="form">
        <input type="hidden" name="next" value={p.next} />
        <label class="field">
          <span>Mot de passe</span>
          <input type="password" name="password" required autofocus autocomplete="current-password" />
        </label>
        <button type="submit" class="btn btn-primary">
          Se connecter
        </button>
      </form>
    </section>
  </Layout>
);

admin.get('/login', async (c) => {
  if (await readSession(c)) return c.redirect(safeNext(c.req.query('next')));
  const error = secretsConfigured(c.env)
    ? undefined
    : 'Les secrets ADMIN_PASSWORD et SESSION_SECRET (16 caractères minimum) ne sont pas configurés.';
  return c.html(<LoginPage next={safeNext(c.req.query('next'))} error={error} />);
});

admin.post('/login', async (c) => {
  const body = await c.req.parseBody();
  const next = safeNext(typeof body.next === 'string' ? body.next : null);
  if (!sameOrigin(c)) return c.html(<LoginPage next={next} error="Requête refusée." />, 403);
  const ipKey = `login:${clientIp(c.req.raw)}`;
  // La tentative est comptée AVANT la vérification (qui attend D1) : des essais envoyés en rafale ne peuvent pas
  // tous passer avant que les échecs soient enregistrés. Elle est rendue si le mot de passe est bon.
  const at = Date.now();
  if (!rateLimit(ipKey, LOGIN_LIMIT, LOGIN_WINDOW, at)) {
    return c.html(<LoginPage next={next} error="Trop de tentatives. Réessayez dans 15 minutes." />, 429);
  }
  const password = typeof body.password === 'string' ? body.password : '';
  if (!(await verifyAdminPassword(c.env, password))) {
    const error = secretsConfigured(c.env) ? 'Mot de passe incorrect.' : 'Les secrets ne sont pas configurés.';
    return c.html(<LoginPage next={next} error={error} />, 401);
  }
  releaseHit(ipKey, at);
  await startSession(c);
  return c.redirect(next, 303);
});

// --- Tout ce qui suit exige une session valide.
admin.use('*', async (c, next) => {
  const session = await readSession(c);
  if (!session) {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') {
      const url = new URL(c.req.url);
      return c.redirect(`/admin/login?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
    }
    return c.json({ ok: false, error: 'unauthorized', message: 'Session expirée : reconnectez-vous.' }, 401);
  }
  c.set('session', session);
  c.set('csrf', await csrfTokenFor(c.env.SESSION_SECRET!, session));
  await next();
});

// --- Protection CSRF de toutes les requêtes qui modifient des données.
admin.use('*', async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
  let token = c.req.header('x-csrf-token');
  if (!token) {
    const ct = (c.req.header('content-type') ?? '').toLowerCase();
    if (ct.startsWith('application/x-www-form-urlencoded') || ct.startsWith('multipart/form-data')) {
      const body = await c.req.parseBody(); // mis en cache par Hono : relisible par la route
      if (typeof body._csrf === 'string') token = body._csrf;
    }
  }
  if (!sameOrigin(c) || !(await verifyCsrf(c.env.SESSION_SECRET!, c.get('session'), token))) {
    return c.text('Jeton de sécurité invalide ou expiré. Rechargez la page et réessayez.', 403);
  }
  await next();
});

admin.post('/logout', (c) => {
  endSession(c);
  return c.redirect('/admin/login', 303);
});

admin.route('/tables', tables);
admin.route('/settings', settings);
admin.route('/', guests);

export default admin;
