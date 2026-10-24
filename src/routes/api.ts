// API publique : réponse d'un invité (POST /api/rsvp/:code).

import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { normalizeCode } from '../lib/codes';
import { getGuestByCode, recentResponseCount, recordResponse, type GuestRow } from '../lib/db';
import { clientIp, rateLimit } from '../lib/ratelimit';
import { getSettings, isRsvpOpen, type Settings } from '../lib/settings';

export const MAX_COUNT = 30;

/** Nombre maximal de personnes qu'un invité peut confirmer : le nombre prévu (au moins 1, au plus MAX_COUNT). */
export function maxCount(expected: number): number {
  return Math.min(MAX_COUNT, Math.max(1, expected));
}

/**
 * Plafond pour un invité donné : le nombre prévu, ou le nombre déjà confirmé s'il est plus grand (réponse saisie
 * par les mariés au-delà du nombre prévu) — modifier sa réponse ne doit pas faire perdre ces places.
 */
export function guestMaxCount(g: Pick<GuestRow, 'expected_count' | 'answer' | 'confirmed_count'>): number {
  return maxCount(Math.max(g.expected_count, g.answer === 'oui' ? (g.confirmed_count ?? 0) : 0));
}
export const MAX_MESSAGE = 1000;

/** Réponses acceptées par invitation (toutes adresses IP confondues) sur une heure glissante. */
export const RSVP_CODE_LIMIT = 10;
const RSVP_CODE_WINDOW_MINUTES = 60;

const api = new Hono<AppEnv>();

api.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

/** État public de la réponse d'un invité, tel que l'affiche la page d'invitation. */
export function publicState(g: GuestRow, settings: Settings) {
  return {
    name: g.name,
    expected: g.expected_count,
    max: guestMaxCount(g),
    response: g.answer
      ? { answer: g.answer, count: g.confirmed_count ?? 0, message: g.message ?? '', answered_at: g.answered_at }
      : null,
    open: isRsvpOpen(settings),
    deadline: settings.rsvp_deadline,
    table: settings.publish_tables === '1' && g.answer === 'oui' && g.table_name ? g.table_name : null,
  };
}

api.get('/rsvp/:code', async (c) => {
  if (!rateLimit(`rsvp-get:ip:${clientIp(c.req.raw)}`, 120, 10 * 60_000)) {
    return c.json({ ok: false, error: 'rate_limited', message: 'Trop de tentatives. Réessayez dans quelques minutes.' }, 429);
  }
  const code = normalizeCode(c.req.param('code'));
  const guest = code ? await getGuestByCode(c.env.DB, code) : null;
  if (!guest) return c.json({ ok: false, error: 'not_found', message: 'Invitation introuvable.' }, 404);
  return c.json({ ok: true, ...publicState(guest, await getSettings(c.env.DB)) });
});

api.post('/rsvp/:code', async (c) => {
  const ip = clientIp(c.req.raw);
  const rawCode = c.req.param('code');
  // Limitation de débit : par adresse IP, et par IP + code.
  if (!rateLimit(`rsvp:ip:${ip}`, 30, 10 * 60_000) || !rateLimit(`rsvp:${ip}:${rawCode}`, 10, 10 * 60_000)) {
    return c.json({ ok: false, error: 'rate_limited', message: 'Trop de tentatives. Réessayez dans quelques minutes.' }, 429);
  }
  const code = normalizeCode(rawCode);
  const guest = code ? await getGuestByCode(c.env.DB, code) : null;
  if (!guest) return c.json({ ok: false, error: 'not_found', message: 'Invitation introuvable.' }, 404);

  if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return c.json({ ok: false, error: 'bad_request', message: 'Requête invalide.' }, 415);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'bad_request', message: 'Requête invalide.' }, 400);
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const answer = b.answer;
  if (answer !== 'oui' && answer !== 'non') {
    return c.json({ ok: false, error: 'invalid_answer', message: 'Réponse attendue : « oui » ou « non ».' }, 400);
  }
  let count = 0;
  if (answer === 'oui') {
    count = typeof b.count === 'string' ? Number(b.count) : (b.count as number);
    // Plafonné au nombre de personnes prévu pour cette invitation (au moins 1).
    const max = guestMaxCount(guest);
    if (!Number.isInteger(count) || count < 1 || count > max) {
      const message =
        Number.isInteger(count) && count > max
          ? `Votre invitation est prévue pour ${max === 1 ? '1 personne' : `${max} personnes au maximum`}.`
          : `Nombre de personnes invalide (entre 1 et ${max}).`;
      return c.json({ ok: false, error: 'invalid_count', message, max }, 400);
    }
  }
  if (b.message !== undefined && b.message !== null && typeof b.message !== 'string') {
    return c.json({ ok: false, error: 'invalid_message', message: 'Message invalide.' }, 400);
  }
  const message = ((b.message as string | undefined) ?? '').replace(/\r\n?/g, '\n').trim();
  if (message.length > MAX_MESSAGE) {
    return c.json({ ok: false, error: 'invalid_message', message: `Message trop long (${MAX_MESSAGE} caractères maximum).` }, 400);
  }

  const settings = await getSettings(c.env.DB);
  if (!isRsvpOpen(settings)) {
    return c.json(
      { ok: false, error: 'closed', message: 'Les réponses sont closes. Contactez directement les mariés.', ...publicState(guest, settings) },
      403,
    );
  }

  // Limite par invitation, indépendante de l'adresse IP (qui peut changer à chaque requête).
  if ((await recentResponseCount(c.env.DB, guest.id, RSVP_CODE_WINDOW_MINUTES, RSVP_CODE_LIMIT)) >= RSVP_CODE_LIMIT) {
    return c.json({ ok: false, error: 'rate_limited', message: 'Trop de réponses envoyées pour cette invitation. Réessayez plus tard.' }, 429);
  }

  await recordResponse(c.env.DB, guest.id, { answer, count, message });
  const updated = (await getGuestByCode(c.env.DB, guest.code))!;
  return c.json({ ok: true, ...publicState(updated, settings) });
});

export default api;
