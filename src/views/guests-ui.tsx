// Petits composants partagés des pages « Invités » (tableau de bord, fiche, relances, import).

import type { Child, FC } from 'hono/jsx';
import { SIDE_LABEL, type Answer, type GuestRow, type Side } from '../lib/db';
import { formatDateTimeFr } from '../lib/settings';
import { Layout } from './layout';

/** « 1 invité », « 3 invités » (0 et 1 au singulier, comme en français). */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

export const SideBadge: FC<{ side: Side }> = ({ side }) => <span class={`badge badge-${side}`}>{SIDE_LABEL[side]}</span>;

export const AnswerBadge: FC<{ answer: Answer | null }> = ({ answer }) =>
  answer === 'oui' ? (
    <span class="badge badge-oui">Oui</span>
  ) : answer === 'non' ? (
    <span class="badge badge-non">Non</span>
  ) : (
    <span class="badge badge-none" title="Pas encore de réponse">
      —
    </span>
  );

/** « Oui · 24/10/2026 18:05 (3 fois) » ou « Non ». */
export const OpenedInfo: FC<{ g: Pick<GuestRow, 'open_count' | 'first_opened_at'> }> = ({ g }) =>
  g.open_count > 0 ? (
    <span class="opened">
      <span class="opened-yes">Oui</span>{' '}
      <span class="small muted nowrap">
        {formatDateTimeFr(g.first_opened_at)}
        {g.open_count > 1 ? ` (${g.open_count} fois)` : ''}
      </span>
    </span>
  ) : (
    <span class="muted">Non</span>
  );

/** Nombre de personnes confirmées : nombre si « oui », 0 si « non », tiret sinon. */
export function confirmedText(g: Pick<GuestRow, 'answer' | 'confirmed_count'>): string {
  if (g.answer === 'oui') return String(g.confirmed_count ?? 0);
  if (g.answer === 'non') return '0';
  return '—';
}

/**
 * Appareil d'une ouverture, en clair, à partir du user-agent : « iPhone · Safari », « Android · Chrome »…
 * (repli : début du user-agent).
 */
export function shortUa(ua: string): string {
  if (!ua) return 'Inconnu';
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  const browser = /FBAN|FBAV|FB_IAB/.test(ua)
    ? 'Facebook'
    : /Instagram/.test(ua)
      ? 'Instagram'
      : /Edg\//.test(ua)
        ? 'Edge'
        : /OPR\/|Opera/.test(ua)
          ? 'Opera'
          : /SamsungBrowser/.test(ua)
            ? 'Samsung Internet'
            : /Firefox|FxiOS/.test(ua)
              ? 'Firefox'
              : /Chrome|CriOS/.test(ua)
                ? 'Chrome'
                : /Safari/.test(ua)
                  ? 'Safari'
                  : null;
  if (device || browser) return [device, browser].filter(Boolean).join(' · ');
  return ua.length > 60 ? `${ua.slice(0, 57)}…` : ua;
}

/** Page « introuvable » de l'administration (404). */
export const NotFoundPage: FC<{ csrf: string; text?: string }> = ({ csrf, text }) => (
  <Layout title="Invité introuvable" active="guests" csrf={csrf}>
    <section class="card empty">
      <h1>Invité introuvable</h1>
      <p class="muted">{text ?? 'Cet invité n’existe pas ou a été supprimé.'}</p>
      <p>
        <a class="btn btn-primary" href="/admin">
          Retour à la liste des invités
        </a>
      </p>
    </section>
  </Layout>
);

/** Bloc « état vide » centré. */
export const Empty: FC<{ title: string; children?: Child }> = ({ title, children }) => (
  <section class="card empty">
    <h2>{title}</h2>
    {children}
  </section>
);
