export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Mot de passe initial de l'administration (wrangler secret put ADMIN_PASSWORD). */
  ADMIN_PASSWORD?: string;
  /** Clé de signature des cookies de session (wrangler secret put SESSION_SECRET). */
  SESSION_SECRET?: string;
  /** Facultatif : clé API Resend, pour recevoir un email à chaque réponse d'un invité (voir src/lib/notify.ts). */
  RESEND_API_KEY?: string;
  /** Facultatif : adresse qui reçoit ces emails (celle du compte Resend). */
  NOTIFY_EMAIL?: string;
}

export interface Session {
  /** Identifiant aléatoire de la session (sert aussi à dériver le jeton CSRF). */
  sid: string;
  /** Expiration (ms depuis epoch). */
  exp: number;
  /** Époque des sessions : changer le mot de passe invalide toutes les sessions précédentes. */
  epoch: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    session: Session;
    csrf: string;
  };
};
