// Réglages stockés dans la table `settings` (clé → valeur texte), avec valeurs par défaut.

export const DEFAULT_SETTINGS = {
  /** Message WhatsApp d'envoi de l'invitation. Variables : {nom}, {lien}, {date_limite}. */
  whatsapp_template:
    "Tongasoa ! Voici votre invitation au vodiondry d'Orimbato & Rojo, samedi 19 décembre 2026 : {lien}. Merci de répondre directement sur la page.",
  /** Message WhatsApp de relance (invités sans réponse). Variables : {nom}, {lien}, {date_limite}. */
  whatsapp_reminder_template:
    "Bonjour {nom} ! Petit rappel pour le vodiondry d'Orimbato & Rojo, samedi 19 décembre 2026 : merci de nous répondre avant le {date_limite} sur votre invitation : {lien}",
  /** Dernier jour (inclus, heure de Madagascar) pour répondre ou modifier sa réponse. AAAA-MM-JJ. */
  rsvp_deadline: '2026-12-12',
  /** « 1 » : la page invité affiche « Votre table : … » après la réponse. */
  publish_tables: '0',
  /** Empreinte PBKDF2 du mot de passe admin choisi dans les réglages (vide : secret ADMIN_PASSWORD). */
  admin_password_hash: '',
  /** Incrémenté à chaque changement de mot de passe : invalide toutes les sessions existantes. */
  session_epoch: '0',
  /**
   * Budget : personnes présentes au repas mais absentes de la liste d'invités (les mariés, famille non listée,
   * mpikabary…), ajoutées au nombre de personnes des trois scénarios. Nombre entier de 0 à 500
   * (7 posé par migrations/0003_budget.sql, comme dans le fichier Excel).
   */
  budget_extra_people: '0',
};

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
export type Settings = Record<SettingKey, string>;

export async function getSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of results) {
    if (key in DEFAULT_SETTINGS) out[key as SettingKey] = value;
  }
  return out;
}

export async function setSettings(db: D1Database, values: Partial<Settings>): Promise<void> {
  const entries = Object.entries(values).filter(([k, v]) => k in DEFAULT_SETTINGS && typeof v === 'string');
  if (!entries.length) return;
  await db.batch(
    entries.map(([k, v]) =>
      db
        .prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .bind(k, v),
    ),
  );
}

/** Fuseau de l'événement (Madagascar, UTC+3, sans heure d'été). */
export const EVENT_TZ = 'Indian/Antananarivo';

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/** Fin (23:59:59.999, heure de Madagascar) du jour limite. */
export function deadlineEnd(date: string): Date {
  const d = isValidDate(date) ? date : DEFAULT_SETTINGS.rsvp_deadline;
  return new Date(`${d}T23:59:59.999+03:00`);
}

export function isRsvpOpen(settings: Pick<Settings, 'rsvp_deadline'>, now = new Date()): boolean {
  return now.getTime() <= deadlineEnd(settings.rsvp_deadline).getTime();
}

/** Date du jour à Madagascar (UTC+3, sans heure d'été) : AAAA-MM-JJ. */
export function todayMadagascar(now = new Date()): string {
  return new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

/** « 12/12/2026 » */
export function formatDateFr(date: string): string {
  if (!isValidDate(date)) return date;
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

/** « samedi 12 décembre » */
export function formatDateLongFr(date: string): string {
  if (!isValidDate(date)) return date;
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/** Date-heure ISO (UTC) → « 24/10/2026 18:05 » en heure de Madagascar. */
export function formatDateTimeFr(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: EVENT_TZ,
  })
    .format(d)
    .replace(',', '');
}

/** Remplit un modèle de message : {nom}, {lien}, {date_limite}. */
export function fillTemplate(template: string, vars: { nom: string; lien: string; date_limite: string }): string {
  return template.replace(/\{(nom|lien|date_limite)\}/g, (_, k: keyof typeof vars) => vars[k]);
}
