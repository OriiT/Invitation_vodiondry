import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach } from 'vitest';
import { RESEND_ENDPOINT } from '../src/lib/notify';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

/** Emails « envoyés » pendant le test en cours (requêtes vers Resend interceptées, jamais envoyées). */
export interface SentMail {
  authorization: string | null;
  body: { from: string; to: string[]; subject: string; text: string };
}
export const resend = {
  sent: [] as SentMail[],
  /** Réponse simulée de Resend pour le prochain envoi (succès par défaut). */
  reply: (): Response => new Response(JSON.stringify({ id: 'email-de-test' }), { status: 200 }),
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  if (req.url !== RESEND_ENDPOINT) return realFetch(input, init);
  resend.sent.push({ authorization: req.headers.get('authorization'), body: await req.json() });
  return resend.reply();
};

// Base vide avant chaque test.
beforeEach(async () => {
  resend.sent.length = 0;
  resend.reply = () => new Response(JSON.stringify({ id: 'email-de-test' }), { status: 200 });
  await env.DB.batch([
    env.DB.prepare('DELETE FROM responses'),
    env.DB.prepare('DELETE FROM opens'),
    env.DB.prepare('DELETE FROM guests'),
    env.DB.prepare('DELETE FROM tables'),
    env.DB.prepare('DELETE FROM settings'),
    env.DB.prepare('DELETE FROM former_names'),
    env.DB.prepare('DELETE FROM budget_items'),
  ]);
});
