// Pages d'invitation : « / » (générique) et « /i/:code » (personnalisée).
// Le fichier public/index.html du site reste intact : la personnalisation est injectée à la volée.

import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env';
import { readSession } from '../lib/auth';
import { normalizeCode } from '../lib/codes';
import { getGuestByCode, recordOpen } from '../lib/db';
import { getSettings } from '../lib/settings';
import { publicState } from './api';
import { injectInvitation, type InvitationData } from '../lib/inject';

const guest = new Hono<AppEnv>();

let templateCache: string | null = null;

/** HTML d'origine du site (public/index.html), lu une fois par instance. */
async function template(c: Context<AppEnv>): Promise<string> {
  if (templateCache) return templateCache;
  const res = await c.env.ASSETS.fetch(new Request(new URL('/', c.req.url)));
  if (!res.ok) throw new Error(`Gabarit d'invitation introuvable (${res.status})`);
  const html = await res.text();
  templateCache = html;
  return html;
}

/** Robots d'aperçu de lien (WhatsApp, Facebook…) : leur visite ne compte pas comme une ouverture. */
const BOT_UA =
  /bot|crawl|spider|slurp|preview|whatsapp|facebookexternalhit|facebot|telegram|twitter|discord|slack|skype|linkedin|embedly|pinterest|vkshare|w3c_validator|headless|lighthouse|curl|wget|python|okhttp|go-http|java\//i;

export function isBot(ua: string): boolean {
  return !ua || BOT_UA.test(ua);
}

function page(c: Context<AppEnv>, html: string, status: 200 | 404 = 200) {
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  return c.html(html, status);
}

guest.get('/', async (c) => {
  const data: InvitationData = { mode: 'generic' };
  return page(c, injectInvitation(await template(c), data));
});

guest.get('/i/:code', async (c) => {
  const code = normalizeCode(c.req.param('code'));
  const g = code ? await getGuestByCode(c.env.DB, code) : null;
  if (!g) {
    return page(c, injectInvitation(await template(c), { mode: 'generic', invalidCode: true }), 404);
  }
  const ua = c.req.header('user-agent') ?? '';
  // Ni les robots d'aperçu ni les mariés (session admin) ne comptent comme une ouverture.
  if (!isBot(ua) && !(await readSession(c))) {
    const p = recordOpen(c.env.DB, g.id, ua);
    try {
      c.executionCtx.waitUntil(p);
    } catch {
      await p;
    }
  }
  const settings = await getSettings(c.env.DB);
  const data: InvitationData = { mode: 'guest', code: g.code, ...publicState(g, settings) };
  return page(c, injectInvitation(await template(c), data));
});

// Ancienne forme éventuelle « /i/:code/ » → forme canonique.
guest.get('/i/:code/', (c) => c.redirect(`/i/${encodeURIComponent(c.req.param('code'))}`, 301));

export default guest;
