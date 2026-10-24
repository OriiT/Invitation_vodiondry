// Injection de la personnalisation dans le HTML d'origine de l'invitation (voir routes/guest.ts).
//
// Le fichier public/index.html n'est jamais modifié : on y ajoute seulement, à la volée,
//   - <base href="/"> (les chemins relatifs « a/… » restent valides sous /i/<code>),
//   - la feuille de style des éléments ajoutés (fenêtre de réponse),
//   - les données de l'invité et le script /vd/rsvp.js, placés JUSTE AVANT le script d'origine :
//     rsvp.js personnalise les textes avant que le script d'origine ne prépare l'animation
//     « lettre à lettre », puis intercepte les clics sur « Oui, je viens » / « Non ».

export interface InvitationData {
  mode: 'generic' | 'guest';
  invalidCode?: boolean;
  code?: string;
  name?: string;
  expected?: number;
  /** Nombre maximal de personnes à confirmer (nombre prévu, ou nombre déjà confirmé s'il est plus grand). */
  max?: number;
  response?: { answer: 'oui' | 'non'; count: number; message: string; answered_at: string | null } | null;
  open?: boolean;
  deadline?: string;
  table?: string | null;
}

/** Points d'ancrage dans public/index.html (vérifiés par les tests). */
export const ANCHORS = {
  head: '<head>',
  headEnd: '</head>',
  beforeSiteScript: '<div class="toast" id="toast" role="status"></div>',
} as const;

const SCRIPT_UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

/** JSON sûr à placer dans un <script> (pas de « </script> » ni de séparateurs de ligne JS). */
export function jsonForScript(v: unknown): string {
  return JSON.stringify(v).replace(SCRIPT_UNSAFE, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function insertAfter(html: string, anchor: string, insert: string): string | null {
  const i = html.indexOf(anchor);
  return i < 0 ? null : html.slice(0, i + anchor.length) + insert + html.slice(i + anchor.length);
}

function insertBefore(html: string, anchor: string, insert: string): string | null {
  const i = html.indexOf(anchor);
  return i < 0 ? null : html.slice(0, i) + insert + html.slice(i);
}

export function injectInvitation(html: string, data: InvitationData): string {
  const scripts = `\n<script>window.VODIONDRY=${jsonForScript(data)};</script>\n<script src="/vd/rsvp.js"></script>`;
  let out = insertAfter(html, ANCHORS.head, '\n<base href="/">') ?? html;
  out = insertBefore(out, ANCHORS.headEnd, '<meta name="robots" content="noindex, nofollow">\n<link rel="stylesheet" href="/vd/rsvp.css">\n') ?? out;
  // Repli (ne devrait pas arriver) : en fin de page, la personnalisation reste fonctionnelle sans l'animation.
  out = insertAfter(out, ANCHORS.beforeSiteScript, scripts) ?? out.replace('</body>', `${scripts}\n</body>`);
  return out;
}
