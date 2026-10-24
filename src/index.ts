// Vodiondry d'Orimbato & Rojo — Worker Cloudflare (Hono).
//   /            invitation générique (sans lien personnel)
//   /i/:code     invitation personnalisée d'un invité
//   /api/rsvp/*  réponse Oui / Non
//   /admin/*     administration (invités, relances, plan de table, réglages)
// Les fichiers du site (public/) sont servis directement par Workers Static Assets.

import { Hono } from 'hono';
import type { AppEnv } from './env';
import admin from './routes/admin/index';
import api from './routes/api';
import guest from './routes/guest';

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
});

// « /admin/ », « /admin/tables/ »… (adresse tapée ou mise en favori avec un « / » final) → même page sans le « / »
// (les routes sont déclarées sans « / » final et Hono les distingue).
app.use('/admin/*', async (c, next) => {
  const url = new URL(c.req.url);
  if ((c.req.method === 'GET' || c.req.method === 'HEAD') && url.pathname.length > 1 && url.pathname.endsWith('/')) {
    return c.redirect(`${url.pathname.replace(/\/+$/, '')}${url.search}`, 301);
  }
  await next();
});

app.route('/api', api);
app.route('/admin', admin);
app.route('/', guest);

app.notFound((c) => c.text('Page introuvable', 404));
app.onError((err, c) => {
  console.error(err);
  return c.text('Une erreur est survenue. Réessayez dans un instant.', 500);
});

export default app;
