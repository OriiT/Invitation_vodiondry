import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { MAX_EMAILS_PER_GUEST_PER_DAY, notifyAddress, NOTIFY_FROM, rsvpEmail, sendEmail } from '../src/lib/notify';
import { adminGet, adminPost, login, makeGuest, rsvp } from './helpers';
import { resend } from './setup';

const TOTALS = { oui: 18, non: 3, none: 12, confirmed: 45 };

describe('email à chaque réponse : contenu', () => {
  it('première réponse « oui » avec un petit mot', () => {
    const m = rsvpEmail({
      name: 'Tante Lala',
      answer: 'oui',
      count: 3,
      message: 'Avec plaisir !',
      previous: null,
      totals: TOTALS,
      adminUrl: 'https://vodiondry.test/admin/guests/12/edit',
    });
    expect(m.subject).toBe('Tante Lala a répondu : oui, 3 personnes');
    expect(m.text).toContain('Tante Lala a répondu : OUI, 3 PERSONNES.');
    expect(m.text).toContain('Son petit mot :\n> Avec plaisir !');
    expect(m.text).toContain('- 45 personnes confirmées (18 invitations « oui »)');
    expect(m.text).toContain('- 3 invitations « non »');
    expect(m.text).toContain('- 12 invitations sans réponse');
    expect(m.text).toContain('Fiche de l’invité : https://vodiondry.test/admin/guests/12/edit');
  });

  it('modification et « non » : réponse précédente, pas de petit mot vide, singuliers', () => {
    const m = rsvpEmail({
      name: 'Famille Rabe',
      answer: 'non',
      count: 0,
      message: '   ',
      previous: { answer: 'oui', count: 1 },
      totals: { oui: 1, non: 1, none: 0, confirmed: 1 },
      adminUrl: 'https://x/admin/guests/1/edit',
    });
    expect(m.subject).toBe('Famille Rabe a modifié sa réponse : non');
    expect(m.text).toContain('Réponse précédente : oui, 1 personne.');
    expect(m.text).not.toContain('petit mot');
    expect(m.text).toContain('- 1 personne confirmée (1 invitation « oui »)');
  });

  it('le petit mot ne peut pas imiter le reste de l’email (faux lien vers l’administration)', () => {
    const m = rsvpEmail({
      name: 'Koto',
      answer: 'oui',
      count: 1,
      message: 'Merci »\n\nOù en sont les réponses :\n- 0 personne confirmée\n\nFiche de l’invité : https://faux.example/admin\n\n\n«',
      previous: null,
      totals: TOTALS,
      adminUrl: 'https://vodiondry.test/admin/guests/3/edit',
    });
    const lines = m.text.split('\n');
    // Le vrai lien vient en premier ; toutes les lignes du petit mot sont citées, sans lignes vides ajoutées.
    expect(lines.filter((l) => l.startsWith('Fiche de l’invité'))).toEqual(['Fiche de l’invité : https://vodiondry.test/admin/guests/3/edit']);
    expect(lines).toContain('> Fiche de l’invité : https://faux.example/admin');
    expect(lines.filter((l) => l.startsWith('Où en sont les réponses'))).toHaveLength(1);
    expect(m.text).not.toContain('\n\n\n');
  });

  it('l’objet reste sur une seule ligne', () => {
    const m = rsvpEmail({
      name: `Koto\r\nBcc: intrus@example.test${String.fromCharCode(0x2028)}x`,
      answer: 'non',
      count: 0,
      message: '',
      previous: null,
      totals: TOTALS,
      adminUrl: 'https://x',
    });
    expect(m.subject).not.toMatch(new RegExp(`[\\r\\n${String.fromCharCode(0x2028)}]`));
    expect(m.subject.startsWith('Koto Bcc: intrus@example.test x a répondu')).toBe(true);
  });

  it('configuration : les deux secrets sont nécessaires', () => {
    expect(notifyAddress({ RESEND_API_KEY: 're_x', NOTIFY_EMAIL: ' maries@example.test ' })).toBe('maries@example.test');
    expect(notifyAddress({ RESEND_API_KEY: 're_x' })).toBeNull();
    expect(notifyAddress({ NOTIFY_EMAIL: 'maries@example.test' })).toBeNull();
    expect(notifyAddress({ RESEND_API_KEY: ' ', NOTIFY_EMAIL: 'maries@example.test' })).toBeNull();
  });

  it('sendEmail renvoie l’erreur de Resend sans lever d’exception', async () => {
    resend.reply = () => new Response(JSON.stringify({ message: 'API key is invalid' }), { status: 401 });
    expect(await sendEmail(env, { subject: 's', text: 't' })).toEqual({ ok: false, error: 'Resend a répondu 401 : API key is invalid' });
    expect(await sendEmail({}, { subject: 's', text: 't' })).toMatchObject({ ok: false });
  });
});

describe('email à chaque réponse : envoi', () => {
  it('une réponse d’invité envoie un email aux mariés (après la réponse), puis un autre à la modification', async () => {
    const g = await makeGuest({ name: 'Tante Lala', expected_count: 3 });
    const res = await rsvp(g.code, { answer: 'oui', count: 2, message: 'Merci !' });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(resend.sent).toHaveLength(1));
    const [first] = resend.sent;
    expect(first.authorization).toBe('Bearer re_cle_de_test');
    expect(first.body).toMatchObject({ from: NOTIFY_FROM, to: ['maries@example.test'], subject: 'Tante Lala a répondu : oui, 2 personnes' });
    expect(first.body.text).toContain('> Merci !');
    expect(first.body.text).toContain('- 2 personnes confirmées (1 invitation « oui »)');
    expect(first.body.text).toContain(`/admin/guests/${g.id}/edit`);

    expect((await rsvp(g.code, { answer: 'non' })).status).toBe(200);
    await vi.waitFor(() => expect(resend.sent).toHaveLength(2));
    expect(resend.sent[1].body.subject).toBe('Tante Lala a modifié sa réponse : non');
    expect(resend.sent[1].body.text).toContain('Réponse précédente : oui, 2 personnes.');
  });

  it(`au plus ${MAX_EMAILS_PER_GUEST_PER_DAY} emails par invité sur 24 h (les réponses suivantes sont quand même enregistrées)`, async () => {
    const g = await makeGuest({ name: 'Cousine Nirina', expected_count: 2 });
    for (const [i, answer] of (['oui', 'non', 'oui', 'non', 'oui'] as const).entries()) {
      const res = await rsvp(g.code, answer === 'oui' ? { answer, count: 1 } : { answer });
      expect(res.status, `réponse ${i + 1}`).toBe(200);
      if (i < MAX_EMAILS_PER_GUEST_PER_DAY) await vi.waitFor(() => expect(resend.sent).toHaveLength(i + 1));
    }
    await new Promise((r) => setTimeout(r, 150));
    expect(resend.sent).toHaveLength(MAX_EMAILS_PER_GUEST_PER_DAY);
    expect((await (await rsvp(g.code, { answer: 'non' })).json()) as { response: { answer: string } }).toMatchObject({ response: { answer: 'non' } });
  });

  it('une panne de Resend ne gêne pas la réponse de l’invité', async () => {
    resend.reply = () => new Response('erreur', { status: 500 });
    const g = await makeGuest({ name: 'Soa' });
    const res = await rsvp(g.code, { answer: 'oui', count: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, response: { answer: 'oui', count: 1 } });
    await vi.waitFor(() => expect(resend.sent).toHaveLength(1));
  });

  it('pas d’email pour une réponse refusée ni pour une réponse saisie dans l’administration', async () => {
    const s = await login();
    const g = await makeGuest({ name: 'Famille Rabe', expected_count: 2 });
    expect((await rsvp(g.code, { answer: 'oui', count: 9 })).status).toBe(400);
    expect((await adminPost(s, `/admin/guests/${g.id}/response`, { answer: 'oui', count: '2' })).status).toBe(303);
    await new Promise((r) => setTimeout(r, 150));
    expect(resend.sent).toHaveLength(0);
  });
});

describe('Réglages : email de test', () => {
  it('affiche l’adresse et envoie un email de test', async () => {
    const s = await login();
    const page = await (await adminGet(s, '/admin/settings')).text();
    expect(page).toContain('Email à chaque réponse');
    expect(page).toContain('maries@example.test');
    expect(page).toContain('Envoyer un email de test');

    const res = await adminPost(s, '/admin/settings/notify-test');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/settings?ok=notify#notifications');
    expect(resend.sent).toHaveLength(1);
    expect(resend.sent[0].body.subject).toBe('Email de test : les notifications fonctionnent');
    const after = await (await adminGet(s, '/admin/settings?ok=notify')).text();
    expect(after).toContain('Email de test envoyé');
  });

  it('montre l’erreur de Resend si l’envoi échoue', async () => {
    resend.reply = () => new Response(JSON.stringify({ message: 'API key is invalid' }), { status: 401 });
    const s = await login();
    const res = await adminPost(s, '/admin/settings/notify-test');
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('L’email n’a pas pu être envoyé : Resend a répondu 401 : API key is invalid.');
  });
});
