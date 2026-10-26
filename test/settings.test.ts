import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, getSettings, setSettings } from '../src/lib/settings';
import { ADMIN_PASSWORD, BASE, adminGet, adminPost, call, login, makeGuest, rsvp, uniqueIp, type AdminSession } from './helpers';

const FAR_FUTURE = '2099-06-30';

function settingsForm(over: Record<string, string> = {}): Record<string, string> {
  return {
    whatsapp_template: 'Bonjour {nom}, voici votre invitation : {lien}',
    whatsapp_reminder_template: 'Petit rappel {nom} : répondez avant le {date_limite} sur {lien}',
    rsvp_deadline: FAR_FUTURE,
    ...over,
  };
}

async function page(s: AdminSession, path = '/admin/settings'): Promise<string> {
  const res = await adminGet(s, path);
  expect(res.status).toBe(200);
  return res.text();
}

function sessionCookie(res: Response): string {
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  expect(cookie).toMatch(/^vd_session=./);
  return cookie;
}

/** POST du formulaire de mot de passe depuis une adresse IP donnée. */
function postPassword(s: AdminSession, form: Record<string, string>, ip = uniqueIp()): Promise<Response> {
  return call(
    '/admin/settings/password',
    {
      method: 'POST',
      headers: { cookie: s.cookie, origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: s.csrf, ...form }).toString(),
    },
    ip,
  );
}

async function loginStatus(password: string): Promise<number> {
  const res = await call('/admin/login', {
    method: 'POST',
    headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password }).toString(),
  });
  return res.status;
}

describe('réglages : affichage', () => {
  it('exige une session', async () => {
    const res = await call('/admin/settings');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/^\/admin\/login/);
    const post = await call('/admin/settings', {
      method: 'POST',
      headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(settingsForm()).toString(),
    });
    expect(post.status).toBe(401);
  });

  it('affiche les valeurs par défaut, les variables, les aperçus et l’état des réponses', async () => {
    const s = await login();
    await setSettings(env.DB, { rsvp_deadline: FAR_FUTURE });
    const html = await page(s);
    expect(html).toContain('name="whatsapp_template"');
    expect(html).toContain('name="whatsapp_reminder_template"');
    expect(html).toContain(`value="${FAR_FUTURE}"`);
    expect(html).toContain('type="date"');
    expect(html).toContain('name="reset_templates"');
    expect(html).toContain('<input type="hidden" name="_csrf"');
    for (const v of ['{nom}', '{lien}', '{date_limite}']) expect(html).toContain(v);
    expect(html).toContain('Publier le plan de table');
    expect(html).not.toMatch(/name="publish_tables"[^>]*checked/);
    // Aperçu : modèle par défaut rempli avec l'exemple
    expect(html).toContain(`${BASE}/i/exemple1`);
    expect(html).toContain('Bonjour Tante Lala !');
    expect(html).toContain('avant le 30/06/2099');
    expect(html).toContain('Les réponses sont ouvertes jusqu’au <strong>mardi 30 juin 2099</strong> inclus (heure de Madagascar)');
    // Commande de secours (mot de passe oublié) + bouton de copie
    expect(html).toContain('DELETE FROM settings WHERE key = &#39;admin_password_hash&#39;');
    expect(html).toContain('data-copy=');
    // Pas de script en ligne (CSP)
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it('indique que les réponses sont closes après la date limite', async () => {
    const s = await login();
    await setSettings(env.DB, { rsvp_deadline: '2020-01-01' });
    const html = await page(s);
    expect(html).toContain('Les réponses sont closes depuis le <strong>jeudi 2 janvier 2020</strong>');
    expect(html).toContain('mercredi 1 janvier 2020');
  });
});

describe('réglages : enregistrement', () => {
  it('enregistre les réglages et les réaffiche (texte échappé)', async () => {
    const s = await login();
    const form = settingsForm({
      whatsapp_template: 'Salama {nom} & famille <3 :\r\n{lien}',
      rsvp_deadline: '2099-12-01',
      publish_tables: '1',
    });
    const res = await adminPost(s, '/admin/settings', form);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/settings?ok=saved');

    const saved = await getSettings(env.DB);
    expect(saved.whatsapp_template).toBe('Salama {nom} & famille <3 :\n{lien}');
    expect(saved.whatsapp_reminder_template).toBe(form.whatsapp_reminder_template);
    expect(saved.rsvp_deadline).toBe('2099-12-01');
    expect(saved.publish_tables).toBe('1');

    const html = await page(s, '/admin/settings?ok=saved');
    expect(html).toContain('Réglages enregistrés.');
    expect(html).toContain('Salama {nom} &amp; famille &lt;3 :');
    expect(html).not.toContain('famille <3');
    expect(html).toContain('Salama Tante Lala &amp; famille');
    expect(html).toContain('value="2099-12-01"');
    expect(html).toMatch(/name="publish_tables"[^>]*checked/);

    // Case décochée : le plan de table n'est plus publié
    expect((await adminPost(s, '/admin/settings', settingsForm())).status).toBe(303);
    expect((await getSettings(env.DB)).publish_tables).toBe('0');
  });

  it('refuse une date invalide (400, rien n’est modifié, saisie conservée)', async () => {
    const s = await login();
    for (const rsvp_deadline of ['2026-02-30', '12/12/2026', '']) {
      const res = await adminPost(s, '/admin/settings', settingsForm({ rsvp_deadline, whatsapp_template: 'Texte gardé {lien}' }));
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain('Date invalide');
      expect(html).toContain('Texte gardé {lien}');
      expect(html).toContain('aria-invalid="true"');
    }
    expect(await getSettings(env.DB)).toEqual(DEFAULT_SETTINGS);
  });

  it('refuse un message sans {lien} ou avec une variable inconnue', async () => {
    const s = await login();
    const noLink = await adminPost(s, '/admin/settings', settingsForm({ whatsapp_template: 'Bonjour {nom}, venez nombreux !' }));
    expect(noLink.status).toBe(400);
    const html = await noLink.text();
    expect(html).toContain('doit contenir {lien}');
    expect(html).toContain('Bonjour {nom}, venez nombreux !');

    const noLinkReminder = await adminPost(s, '/admin/settings', settingsForm({ whatsapp_reminder_template: 'Rappel {nom}' }));
    expect(noLinkReminder.status).toBe(400);

    const unknown = await adminPost(s, '/admin/settings', settingsForm({ whatsapp_template: 'Bonjour {name} : {lien}' }));
    expect(unknown.status).toBe(400);
    expect(await unknown.text()).toContain('Variable inconnue : {name}');

    const empty = await adminPost(s, '/admin/settings', settingsForm({ whatsapp_template: '   ' }));
    expect(empty.status).toBe(400);

    expect(await getSettings(env.DB)).toEqual(DEFAULT_SETTINGS);
  });

  it('« Rétablir les messages par défaut » remet les deux textes d’origine, sans toucher au reste', async () => {
    const s = await login();
    expect((await adminPost(s, '/admin/settings', settingsForm({ publish_tables: '1' }))).status).toBe(303);
    expect((await getSettings(env.DB)).whatsapp_template).not.toBe(DEFAULT_SETTINGS.whatsapp_template);

    // Le formulaire envoie aussi les autres champs (éventuellement invalides) : ils sont ignorés.
    const res = await adminPost(
      s,
      '/admin/settings',
      settingsForm({ reset_templates: '1', whatsapp_template: 'sans lien', rsvp_deadline: 'n’importe quoi' }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/settings?ok=reset');
    const after = await getSettings(env.DB);
    expect(after.whatsapp_template).toBe(DEFAULT_SETTINGS.whatsapp_template);
    expect(after.whatsapp_reminder_template).toBe(DEFAULT_SETTINGS.whatsapp_reminder_template);
    expect(after.rsvp_deadline).toBe(FAR_FUTURE);
    expect(after.publish_tables).toBe('1');
    expect(await page(s, '/admin/settings?ok=reset')).toContain('Les deux messages par défaut ont été rétablis.');
  });

  it('refuse un enregistrement sans jeton CSRF', async () => {
    const s = await login();
    const res = await call('/admin/settings', {
      method: 'POST',
      headers: { cookie: s.cookie, origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(settingsForm({ whatsapp_template: 'Piège {lien}' })).toString(),
    });
    expect(res.status).toBe(403);
    expect((await getSettings(env.DB)).whatsapp_template).toBe(DEFAULT_SETTINGS.whatsapp_template);
  });
});

describe('réglages : effets sur la page invité', () => {
  it('date limite passée → réponses refusées (403 closed) ; date future → acceptées', async () => {
    const s = await login();
    const g = await makeGuest({ name: 'Koto' });

    expect((await adminPost(s, '/admin/settings', settingsForm({ rsvp_deadline: '2020-01-01' }))).status).toBe(303);
    const closed = await rsvp(g.code, { answer: 'oui', count: 1 });
    expect(closed.status).toBe(403);
    const body = await closed.json<any>();
    expect(body.error).toBe('closed');
    expect(body.open).toBe(false);

    expect((await adminPost(s, '/admin/settings', settingsForm({ rsvp_deadline: FAR_FUTURE }))).status).toBe(303);
    const open = await rsvp(g.code, { answer: 'oui', count: 1 });
    expect(open.status).toBe(200);
    expect((await open.json<any>()).open).toBe(true);
  });

  it('plan de table publié : la table n’est donnée qu’aux invités qui ont dit oui et sont placés', async () => {
    const s = await login();
    await setSettings(env.DB, { rsvp_deadline: FAR_FUTURE });
    const t = await env.DB.prepare("INSERT INTO tables (name, capacity) VALUES ('Table des Fleurs', 8) RETURNING id").first<{ id: number }>();
    const assign = (id: number) => env.DB.prepare('UPDATE guests SET table_id = ?1 WHERE id = ?2').bind(t!.id, id).run();

    const oui = await makeGuest({ name: 'Tante Lala' });
    const non = await makeGuest({ name: 'Famille Rabe' });
    const sansReponse = await makeGuest({ name: 'Koto' });
    const ouiNonPlace = await makeGuest({ name: 'Soa' });
    expect((await rsvp(oui.code, { answer: 'oui', count: 2 })).status).toBe(200);
    expect((await rsvp(non.code, { answer: 'non' })).status).toBe(200);
    expect((await rsvp(ouiNonPlace.code, { answer: 'oui', count: 1 })).status).toBe(200);
    for (const g of [oui, non, sansReponse]) await assign(g.id);

    const tableOf = async (code: string) => {
      const res = await call(`/api/rsvp/${code}`);
      expect(res.status).toBe(200);
      return (await res.json<any>()).table;
    };

    // Non publié : personne ne voit sa table
    for (const g of [oui, non, sansReponse, ouiNonPlace]) expect(await tableOf(g.code)).toBeNull();

    expect((await adminPost(s, '/admin/settings', settingsForm({ publish_tables: '1' }))).status).toBe(303);
    expect(await tableOf(oui.code)).toBe('Table des Fleurs');
    expect(await tableOf(non.code)).toBeNull();
    expect(await tableOf(sansReponse.code)).toBeNull();
    expect(await tableOf(ouiNonPlace.code)).toBeNull();

    // Dépublié
    expect((await adminPost(s, '/admin/settings', settingsForm())).status).toBe(303);
    expect(await tableOf(oui.code)).toBeNull();
  });
});

describe('réglages : mot de passe', () => {
  const NEW_PASSWORD = 'une phrase de passe 2026';

  it('refuse un mauvais mot de passe actuel (rien ne change)', async () => {
    const s = await login();
    const res = await postPassword(s, { current_password: 'mauvais', new_password: NEW_PASSWORD, confirm_password: NEW_PASSWORD });
    expect([400, 401]).toContain(res.status);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.text()).toContain('Mot de passe actuel incorrect.');
    const st = await getSettings(env.DB);
    expect(st.admin_password_hash).toBe('');
    expect(st.session_epoch).toBe('0');
    expect(await loginStatus(ADMIN_PASSWORD)).toBe(303);
    expect(await loginStatus(NEW_PASSWORD)).toBe(401);
    expect((await adminGet(s, '/admin/settings')).status).toBe(200);
  });

  it('valide le nouveau mot de passe (longueur, confirmation, différent de l’actuel)', async () => {
    const s = await login();
    const tooShort = await postPassword(s, { current_password: ADMIN_PASSWORD, new_password: 'court', confirm_password: 'court' });
    expect(tooShort.status).toBe(400);
    expect(await tooShort.text()).toContain('au moins 10 caractères');

    const mismatch = await postPassword(s, {
      current_password: ADMIN_PASSWORD,
      new_password: NEW_PASSWORD,
      confirm_password: `${NEW_PASSWORD}!`,
    });
    expect(mismatch.status).toBe(400);
    expect(await mismatch.text()).toContain('La confirmation ne correspond pas');

    const same = await postPassword(s, { current_password: ADMIN_PASSWORD, new_password: ADMIN_PASSWORD, confirm_password: ADMIN_PASSWORD });
    expect(same.status).toBe(400);

    expect((await getSettings(env.DB)).admin_password_hash).toBe('');
  });

  it('limite les essais du mot de passe actuel par adresse IP', async () => {
    const s = await login();
    const ip = uniqueIp();
    const form = { current_password: 'mauvais', new_password: NEW_PASSWORD, confirm_password: NEW_PASSWORD };
    for (let i = 0; i < 10; i++) expect((await postPassword(s, form, ip)).status).toBe(400);
    const blocked = await postPassword(s, { ...form, current_password: ADMIN_PASSWORD }, ip);
    expect(blocked.status).toBe(429);
    expect((await getSettings(env.DB)).admin_password_hash).toBe('');
    // Une autre adresse n'est pas bloquée
    expect((await postPassword(s, form, uniqueIp())).status).toBe(400);
  });

  it('des essais du mot de passe actuel envoyés en même temps ne dépassent pas la limite', async () => {
    const s = await login();
    const ip = uniqueIp();
    const form = { current_password: 'mauvais', new_password: NEW_PASSWORD, confirm_password: NEW_PASSWORD };
    const statuses = (await Promise.all(Array.from({ length: 30 }, () => postPassword(s, form, ip)))).map((r) => r.status);
    expect(statuses.filter((st) => st === 400)).toHaveLength(10);
    expect(statuses.filter((st) => st === 429)).toHaveLength(20);
    // Des erreurs sans mot de passe actuel erroné (ex. nouveau mot de passe trop court) ne comptent pas.
    const ip2 = uniqueIp();
    for (let i = 0; i < 12; i++) {
      expect((await postPassword(s, { current_password: ADMIN_PASSWORD, new_password: 'court', confirm_password: 'court' }, ip2)).status).toBe(400);
    }
  });

  it('change le mot de passe : les autres sessions sont fermées, celle-ci reste ouverte', async () => {
    const other = await login(); // session ouverte AVANT le changement (autre appareil)
    const s = await login();

    const res = await postPassword(s, { current_password: ADMIN_PASSWORD, new_password: NEW_PASSWORD, confirm_password: NEW_PASSWORD });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/settings?ok=password#mot-de-passe');
    const fresh = sessionCookie(res);
    expect(fresh).not.toBe(s.cookie);

    const st = await getSettings(env.DB);
    expect(st.admin_password_hash).toMatch(/^pbkdf2\$/);
    expect(st.session_epoch).toBe('1');

    // L'autre appareil est déconnecté (et l'ancien cookie de cet appareil aussi).
    for (const cookie of [other.cookie, s.cookie]) {
      const old = await call('/admin/settings', { headers: { cookie } });
      expect(old.status).toBe(302);
      expect(old.headers.get('location')).toMatch(/^\/admin\/login/);
    }
    const oldPost = await adminPost(other, '/admin/settings', settingsForm());
    expect(oldPost.status).toBe(401);

    // Cet appareil reste connecté avec le nouveau cookie.
    const ok = await call('/admin/settings?ok=password', { headers: { cookie: fresh } });
    expect(ok.status).toBe(200);
    const html = await ok.text();
    expect(html).toContain('Mot de passe changé.');
    expect(html).toContain('celui choisi sur cette page');
    const csrf = /<meta name="csrf-token" content="([^"]+)"/.exec(html)?.[1];
    expect(csrf).toBeTruthy();
    expect((await adminPost({ cookie: fresh, csrf: csrf! }, '/admin/settings', settingsForm())).status).toBe(303);

    // Ancien mot de passe refusé, nouveau accepté.
    expect(await loginStatus(ADMIN_PASSWORD)).toBe(401);
    const again = await login(NEW_PASSWORD);
    expect((await adminGet(again, '/admin/settings')).status).toBe(200);
  });
});
