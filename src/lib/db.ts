// Accès aux données : invités (avec leur dernière réponse, leurs ouvertures et leur table), réponses, ouvertures.

import { generateCode } from './codes';

export type Side = 'rojo' | 'orimbato';
export type Answer = 'oui' | 'non';
export type Status = Answer | 'none';

export const SIDES: Side[] = ['rojo', 'orimbato'];
export const SIDE_LABEL: Record<Side, string> = { rojo: 'Rojo', orimbato: 'Orimbato' };

export interface GuestRow {
  id: number;
  code: string;
  name: string;
  side: Side;
  expected_count: number;
  phone: string | null;
  notes: string;
  table_id: number | null;
  created_at: string;
  table_name: string | null;
  /** Dernière réponse (null : pas encore répondu). */
  answer: Answer | null;
  confirmed_count: number | null;
  message: string | null;
  answered_at: string | null;
  first_opened_at: string | null;
  last_opened_at: string | null;
  open_count: number;
}

export interface GuestInput {
  name: string;
  side: Side;
  expected_count: number;
  phone?: string | null;
  notes?: string;
}

// Ouvertures lues par sous-requêtes corrélées (index idx_opens_guest) : seules les lignes de l'invité concerné sont
// lues, jamais toute la table (l'offre gratuite de D1 limite le nombre de lignes lues par jour).
export const GUEST_SELECT = `
SELECT g.id, g.code, g.name, g.side, g.expected_count, g.phone, g.notes, g.table_id, g.created_at,
       t.name AS table_name,
       r.answer, r.count AS confirmed_count, r.message, r.answered_at,
       (SELECT opened_at FROM opens WHERE guest_id = g.id ORDER BY id LIMIT 1) AS first_opened_at,
       (SELECT opened_at FROM opens WHERE guest_id = g.id ORDER BY id DESC LIMIT 1) AS last_opened_at,
       (SELECT COUNT(*) FROM opens WHERE guest_id = g.id) AS open_count
FROM guests g
LEFT JOIN tables t ON t.id = g.table_id
LEFT JOIN responses r ON r.id = (SELECT MAX(id) FROM responses WHERE guest_id = g.id)`;

export function statusOf(g: Pick<GuestRow, 'answer'>): Status {
  return g.answer ?? 'none';
}

/** Places occupées par un invité : nombre confirmé s'il a dit oui, nombre prévu s'il n'a pas répondu, 0 s'il a dit non. */
export function seatsOf(g: Pick<GuestRow, 'answer' | 'confirmed_count' | 'expected_count'>): number {
  if (g.answer === 'oui') return g.confirmed_count ?? 0;
  if (g.answer === 'non') return 0;
  return g.expected_count;
}

export async function listGuests(db: D1Database): Promise<GuestRow[]> {
  const { results } = await db.prepare(`${GUEST_SELECT} ORDER BY g.side DESC, g.id ASC`).all<GuestRow>();
  return results;
}

export async function getGuest(db: D1Database, id: number): Promise<GuestRow | null> {
  return db.prepare(`${GUEST_SELECT} WHERE g.id = ?1`).bind(id).first<GuestRow>();
}

export async function getGuestByCode(db: D1Database, code: string): Promise<GuestRow | null> {
  return db.prepare(`${GUEST_SELECT} WHERE g.code = ?1`).bind(code).first<GuestRow>();
}

/**
 * Clé de comparaison des noms d'invités : espaces normalisés, sans tenir compte de la casse, lettres accentuées
 * comprises (« HÉLÈNE » = « Hélène » ; SQLite « COLLATE NOCASE » ne gère que les lettres sans accent).
 */
export function nameKey(name: string): string {
  return straightApostrophes(name.normalize('NFC')).replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr');
}

/**
 * Apostrophes typographiques (’ ‘ ʼ ` ´) → apostrophe droite « ' » : l'iPhone tape « ’ » par défaut,
 * Excel garde souvent « ' » ; « d’Antsirabe » et « d'Antsirabe » doivent être le même nom.
 */
export function straightApostrophes(s: string): string {
  return s.replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'");
}

/** Noms de tous les invités, indexés par nameKey (quelques centaines de lignes au plus). */
export async function guestNameIndex(db: D1Database): Promise<Map<string, number>> {
  const { results } = await db.prepare('SELECT id, name FROM guests ORDER BY id').all<{ id: number; name: string }>();
  const index = new Map<string, number>();
  for (const r of results) if (!index.has(nameKey(r.name))) index.set(nameKey(r.name), r.id);
  return index;
}

/** Invité portant déjà ce nom (sans tenir compte de la casse ni des espaces en trop). */
export async function findGuestByName(db: D1Database, name: string): Promise<{ id: number } | null> {
  const id = (await guestNameIndex(db)).get(nameKey(name));
  return id === undefined ? null : { id };
}

function isUniqueCodeError(e: unknown): boolean {
  return e instanceof Error && /UNIQUE/i.test(e.message) && /code/i.test(e.message);
}

const INSERT_GUEST = 'INSERT INTO guests (code, name, side, expected_count, phone, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6)';

/** Crée un invité avec un code neuf (nouveau tirage en cas de collision). */
export async function createGuest(db: D1Database, input: GuestInput): Promise<GuestRow> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const row = await db
        .prepare(`${INSERT_GUEST} RETURNING id`)
        .bind(generateCode(), input.name, input.side, input.expected_count, input.phone || null, input.notes ?? '')
        .first<{ id: number }>();
      return (await getGuest(db, row!.id))!;
    } catch (e) {
      if (!isUniqueCodeError(e)) throw e;
    }
  }
  throw new Error('Impossible de générer un code unique');
}

/**
 * Invités insérés par lot (import) : une seule requête D1 par lot de CREATE_BATCH invités. L'offre gratuite de
 * Cloudflare limite à 50 le nombre de requêtes D1 par appel du Worker ; un invité = une requête dépasserait vite
 * cette limite. Chaque lot est une transaction : en cas de collision de code, il est annulé puis retenté avec
 * de nouveaux codes.
 */
export const CREATE_BATCH = 100;

export async function createGuests(db: D1Database, inputs: GuestInput[]): Promise<void> {
  for (let i = 0; i < inputs.length; i += CREATE_BATCH) {
    const chunk = inputs.slice(i, i + CREATE_BATCH);
    for (let attempt = 0; ; attempt++) {
      const codes = new Set<string>();
      while (codes.size < chunk.length) codes.add(generateCode());
      const list = [...codes];
      try {
        await db.batch(
          chunk.map((g, k) =>
            db.prepare(INSERT_GUEST).bind(list[k], g.name, g.side, g.expected_count, g.phone || null, g.notes ?? ''),
          ),
        );
        break;
      } catch (e) {
        if (!isUniqueCodeError(e) || attempt >= 4) throw e;
      }
    }
  }
}

/** Modifie un invité ; son ancien nom est conservé (former_names) pour que l'import ne le recrée pas. */
export async function updateGuest(db: D1Database, id: number, input: GuestInput): Promise<void> {
  await db.batch([
    db.prepare('INSERT INTO former_names (guest_id, name) SELECT id, name FROM guests WHERE id = ?1 AND name <> ?2').bind(id, input.name),
    db
      .prepare('UPDATE guests SET name = ?2, side = ?3, expected_count = ?4, phone = ?5, notes = ?6 WHERE id = ?1')
      .bind(id, input.name, input.side, input.expected_count, input.phone || null, input.notes ?? ''),
  ]);
}

/** Supprime un invité ; son nom (et ses anciens noms) restent connus : l'import signale s'il le recrée. */
export async function deleteGuest(db: D1Database, id: number): Promise<void> {
  // Les réponses et ouvertures sont supprimées en cascade (clés étrangères D1).
  await db.batch([
    db.prepare('UPDATE former_names SET deleted = 1 WHERE guest_id = ?1').bind(id),
    db.prepare('INSERT INTO former_names (guest_id, name, deleted) SELECT id, name, 1 FROM guests WHERE id = ?1').bind(id),
    db.prepare('DELETE FROM responses WHERE guest_id = ?1').bind(id),
    db.prepare('DELETE FROM opens WHERE guest_id = ?1').bind(id),
    db.prepare('DELETE FROM guests WHERE id = ?1').bind(id),
  ]);
}

/** Nouveau code pour un invité : l'ancien lien cesse de fonctionner. */
export async function regenerateCode(db: D1Database, id: number): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      await db.prepare('UPDATE guests SET code = ?2 WHERE id = ?1').bind(id, code).run();
      return code;
    } catch (e) {
      if (!isUniqueCodeError(e)) throw e;
    }
  }
  throw new Error('Impossible de générer un code unique');
}

/** Visites rapprochées d'un même lien comptées une seule fois (et nombre de lignes `opens` borné). */
export const OPEN_DEDUP_MINUTES = 30;

/** Enregistre une ouverture du lien, sauf si la précédente date de moins de OPEN_DEDUP_MINUTES minutes. */
export async function recordOpen(db: D1Database, guestId: number, ua: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO opens (guest_id, ua) SELECT ?1, ?2
       WHERE NOT EXISTS (
         SELECT 1 FROM opens
         WHERE id = (SELECT MAX(id) FROM opens WHERE guest_id = ?1)
           AND opened_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${OPEN_DEDUP_MINUTES} minutes')
       )`,
    )
    .bind(guestId, ua.slice(0, 400))
    .run();
}

/** Réponses enregistrées pour un invité ces `minutes` dernières minutes (au plus `limit` lignes lues). */
export async function recentResponseCount(db: D1Database, guestId: number, minutes: number, limit: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM (SELECT answered_at FROM responses WHERE guest_id = ?1 ORDER BY id DESC LIMIT ?2)
       WHERE answered_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?3)`,
    )
    .bind(guestId, limit, `-${minutes} minutes`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface ResponseInput {
  answer: Answer;
  count: number;
  message: string;
}

/**
 * Enregistre une réponse (nouvelle ligne : l'historique est conservé, la dernière fait foi).
 * Un « non » libère la place éventuellement attribuée dans le plan de table.
 */
export async function recordResponse(db: D1Database, guestId: number, r: ResponseInput): Promise<void> {
  const stmts = [
    db
      .prepare('INSERT INTO responses (guest_id, answer, count, message) VALUES (?1, ?2, ?3, ?4)')
      .bind(guestId, r.answer, r.answer === 'non' ? 0 : r.count, r.message),
  ];
  if (r.answer === 'non') stmts.push(db.prepare('UPDATE guests SET table_id = NULL WHERE id = ?1').bind(guestId));
  await db.batch(stmts);
}

export interface Totals {
  guests: number;
  expected: number;
  oui: number;
  non: number;
  none: number;
  confirmed: number;
  opened: number;
}

export function computeTotals(rows: GuestRow[]): Totals {
  const t: Totals = { guests: 0, expected: 0, oui: 0, non: 0, none: 0, confirmed: 0, opened: 0 };
  for (const g of rows) {
    t.guests++;
    t.expected += g.expected_count;
    if (g.open_count > 0) t.opened++;
    if (g.answer === 'oui') {
      t.oui++;
      t.confirmed += g.confirmed_count ?? 0;
    } else if (g.answer === 'non') t.non++;
    else t.none++;
  }
  return t;
}

/** URL publique du lien personnel. */
export function guestLink(origin: string, code: string): string {
  return `${origin}/i/${code}`;
}

/**
 * Numéro WhatsApp au format international sans « + » (wa.me) ; null si inexploitable.
 * Les numéros malgaches locaux (03x xx xxx xx, ou 3x xx xxx xx sans le 0) reçoivent l'indicatif 261.
 */
export function waNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (/^0\d{9}$/.test(d)) d = `261${d.slice(1)}`;
  // Mobile malgache dont Excel a retiré le 0 initial (0341234567 saisi dans une cellule « Standard » → 341234567).
  else if (/^3[2-9]\d{7}$/.test(d)) d = `261${d}`;
  d = d.replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** Lien wa.me avec message prérempli (vers le numéro s'il est connu, sinon choix du contact). */
export function waLink(text: string, phone?: string | null): string {
  const n = waNumber(phone);
  return `https://wa.me/${n ?? ''}?text=${encodeURIComponent(text)}`;
}
