// Gabarit commun des pages d'administration (rendu serveur, hono/jsx : tout texte interpolé est échappé).

import { raw } from 'hono/html';
import type { Child, FC } from 'hono/jsx';

export type NavKey = 'guests' | 'reminders' | 'import' | 'tables' | 'budget' | 'settings';

const NAV: { key: NavKey; href: string; label: string }[] = [
  { key: 'guests', href: '/admin', label: 'Invités' },
  { key: 'reminders', href: '/admin/relances', label: 'Relances' },
  { key: 'tables', href: '/admin/tables', label: 'Plan de table' },
  { key: 'budget', href: '/admin/budget', label: 'Budget' },
  { key: 'import', href: '/admin/import', label: 'Import / export' },
  { key: 'settings', href: '/admin/settings', label: 'Réglages' },
];

export interface LayoutProps {
  title: string;
  /** Onglet actif ; absent pour les pages hors navigation (connexion, impression). */
  active?: NavKey;
  /** Jeton CSRF de la session (absent sur la page de connexion). */
  csrf?: string;
  /** Message affiché en haut de page. */
  flash?: { kind: 'ok' | 'err'; text: string } | null;
  /** Scripts supplémentaires (chemins /vd/…), exécutés dans l'ordre. Jamais de script en ligne : CSP « script-src 'self' ». */
  scripts?: string[];
  /**
   * Feuilles de style supplémentaires : chemins /vd/…, ou URL externe autorisée par la CSP de la route
   * (ex. polices Google des marque-tables, voir CARDS_CSP).
   */
  styles?: string[];
  /** Mise en page « impression » : sans barre de navigation. */
  bare?: boolean;
  children?: Child;
}

/** Doctype HTML5 : texte fixe, jamais de données (sans lui, le navigateur passe en mode « quirks »). */
const DOCTYPE = raw('<!doctype html>');

export const Layout: FC<LayoutProps> = ({ title, active, csrf, flash, scripts = [], styles = [], bare, children }) => (
  <>
    {DOCTYPE}
    <html lang="fr">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="theme-color" content="#6B4E36" />
        {csrf ? <meta name="csrf-token" content={csrf} /> : null}
        <title>{`${title} · Vodiondry`}</title>
        <link rel="stylesheet" href="/vd/admin.css" />
        {styles.map((href) => (
          <link rel="stylesheet" href={href} />
        ))}
      </head>
      <body class={bare ? 'bare' : ''}>
        {bare ? null : (
          <header class="topbar">
            <div class="wrap topbar-in">
              <a class="brand" href="/admin">
                Vodiondry <span>Orimbato &amp; Rojo</span>
              </a>
              {csrf ? (
                <form method="post" action="/admin/logout" class="logout">
                  <input type="hidden" name="_csrf" value={csrf} />
                  <button type="submit" class="btn btn-ghost btn-sm">
                    Déconnexion
                  </button>
                </form>
              ) : null}
            </div>
            {csrf ? (
              <nav class="wrap nav" aria-label="Navigation">
                {NAV.map((n) => (
                  <a href={n.href} class={n.key === active ? 'active' : ''} aria-current={n.key === active ? 'page' : undefined}>
                    {n.label}
                  </a>
                ))}
              </nav>
            ) : null}
          </header>
        )}
        <main class={bare ? 'print-wrap' : 'wrap main'}>
          {flash ? (
            <p class={`flash flash-${flash.kind}`} role={flash.kind === 'err' ? 'alert' : 'status'}>
              {flash.text}
            </p>
          ) : null}
          {children}
        </main>
        <script src="/vd/admin.js" defer></script>
        {scripts.map((s) => (
          <script src={s} defer></script>
        ))}
      </body>
    </html>
  </>
);

/** Champ caché CSRF à placer dans chaque formulaire POST. */
export const Csrf: FC<{ token: string }> = ({ token }) => <input type="hidden" name="_csrf" value={token} />;
