// Email aux mariés quand un invité répond sur son invitation, envoyé par le service Resend (https://resend.com).
// Sans nom de domaine vérifié, Resend n'envoie qu'à l'adresse du compte Resend : NOTIFY_EMAIL doit être cette
// adresse. Sans les deux secrets (RESEND_API_KEY, NOTIFY_EMAIL), rien n'est envoyé.

import type { Env } from '../env';
import type { Answer, Totals } from './db';

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
/** Expéditeur de test fourni par Resend : utilisable sans nom de domaine, vers l'adresse du compte seulement. */
export const NOTIFY_FROM = 'Vodiondry <onboarding@resend.dev>';

type NotifyEnv = Pick<Env, 'RESEND_API_KEY' | 'NOTIFY_EMAIL'>;

/** Adresse qui reçoit les emails, ou null si les notifications ne sont pas configurées. */
export function notifyAddress(env: NotifyEnv): string | null {
  const to = (env.NOTIFY_EMAIL ?? '').trim();
  return (env.RESEND_API_KEY ?? '').trim() && to ? to : null;
}

export interface Mail {
  subject: string;
  text: string;
}

export interface RsvpNotice {
  name: string;
  answer: Answer;
  count: number;
  message: string;
  /** Réponse précédente de l'invité (null pour une première réponse). */
  previous: { answer: Answer; count: number } | null;
  totals: Pick<Totals, 'oui' | 'non' | 'none' | 'confirmed'>;
  /** Fiche de l'invité dans l'administration. */
  adminUrl: string;
}

const persons = (n: number) => `${n} ${n > 1 ? 'personnes' : 'personne'}`;
const answerText = (answer: Answer, count: number) => (answer === 'oui' ? `oui, ${persons(count)}` : 'non');
/** Sur une seule ligne (objet de l'email) : retours à la ligne et caractères de contrôle remplacés par une espace.
 * (U+2028/U+2029 construits par leur code : écrits tels quels, ils couperaient l'expression régulière.) */
const LINE_BREAKS = new RegExp(`[\\u0000-\\u001f\\u007f${String.fromCharCode(0x2028, 0x2029)}]+`, 'g');
const oneLine = (s: string) => s.replace(LINE_BREAKS, ' ').trim();

export function rsvpEmail(n: RsvpNotice): Mail {
  const name = oneLine(n.name);
  const now = answerText(n.answer, n.count);
  const verb = n.previous ? 'a modifié sa réponse' : 'a répondu';
  const t = n.totals;
  const lines = [`${name} ${verb} : ${now.toUpperCase()}.`];
  if (n.previous) lines.push(`Réponse précédente : ${answerText(n.previous.answer, n.previous.count)}.`);
  if (n.message.trim()) lines.push('', 'Son petit mot :', `« ${n.message.trim()} »`);
  lines.push(
    '',
    'Où en sont les réponses :',
    `- ${persons(t.confirmed)} confirmée${t.confirmed > 1 ? 's' : ''} (${t.oui} invitation${t.oui > 1 ? 's' : ''} « oui »)`,
    `- ${t.non} invitation${t.non > 1 ? 's' : ''} « non »`,
    `- ${t.none} invitation${t.none > 1 ? 's' : ''} sans réponse`,
    '',
    `Fiche de l’invité : ${n.adminUrl}`,
  );
  return { subject: `${name} ${verb} : ${now}`.slice(0, 200), text: lines.join('\n') };
}

/** Envoie un email à NOTIFY_EMAIL. Ne lève jamais d'exception : renvoie l'erreur en clair (affichée dans Réglages). */
export async function sendEmail(env: NotifyEnv, mail: Mail): Promise<{ ok: true } | { ok: false; error: string }> {
  const to = notifyAddress(env);
  if (!to) return { ok: false, error: 'les secrets RESEND_API_KEY et NOTIFY_EMAIL ne sont pas configurés' };
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${(env.RESEND_API_KEY ?? '').trim()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: NOTIFY_FROM, to: [to], subject: oneLine(mail.subject), text: mail.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    const detail = typeof body?.message === 'string' ? ` : ${body.message.slice(0, 300)}` : '';
    return { ok: false, error: `Resend a répondu ${res.status}${detail}` };
  } catch (e) {
    return { ok: false, error: `Resend injoignable (${e instanceof Error ? e.message : String(e)})` };
  }
}
