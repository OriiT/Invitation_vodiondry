// Plan de table : tables, placement des invités, places occupées et dépassements de capacité.
//
// Seuls les invités ayant répondu « oui » ou n'ayant pas encore répondu peuvent être placés.
// Places occupées par un invité = seatsOf() : nombre confirmé (oui) ou nombre prévu (sans réponse).

import { listGuests, seatsOf, type Answer, type GuestRow } from './db';

export const TABLE_NAME_MAX = 60;
export const TABLE_CAPACITY_MAX = 200;
export const TABLE_CAPACITY_DEFAULT = 10;
/** Bornes de l'ordre d'affichage. */
export const SORT_ORDER_MAX = 9999;

export interface TableRow {
  id: number;
  name: string;
  capacity: number;
  sort_order: number;
}

export interface TableInput {
  name: string;
  capacity: number;
  sort_order: number;
}

/** État d'une table tel que le renvoie l'API de placement. */
export interface TableSummary {
  id: number;
  name: string;
  capacity: number;
  seats: number;
  over: boolean;
  over_by: number;
}

export interface PlanTable extends TableRow {
  /** Invités placés (hors « non »), par ordre alphabétique. */
  guests: GuestRow[];
  seats: number;
  over: boolean;
  over_by: number;
}

export interface Plan {
  tables: PlanTable[];
  /** Invités « oui » ou sans réponse qui n'ont pas encore de table. */
  unplaced: GuestRow[];
  capacity: number;
  placedSeats: number;
  unplacedSeats: number;
  placedGuests: number;
}

/** Un invité qui a répondu « non » ne peut pas être placé. */
export function isPlaceable(g: { answer: Answer | null }): boolean {
  return g.answer !== 'non';
}

export function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base', numeric: true });
}

export function summarize(t: Pick<TableRow, 'id' | 'name' | 'capacity'>, seats: number): TableSummary {
  const over_by = Math.max(0, seats - t.capacity);
  return { id: t.id, name: t.name, capacity: t.capacity, seats, over: over_by > 0, over_by };
}

/** « Capacité dépassée de 2 places » */
export function overText(overBy: number): string {
  return `Capacité dépassée de ${overBy} place${overBy > 1 ? 's' : ''}`;
}

/** « La table « X » dépasse sa capacité (12/10). » — null si la table n'est pas pleine au-delà de sa capacité. */
export function overWarning(t: TableSummary): string | null {
  return t.over ? `La table « ${t.name} » dépasse sa capacité (${t.seats}/${t.capacity}).` : null;
}

// ---------------------------------------------------------------- requêtes

export async function listTables(db: D1Database): Promise<TableRow[]> {
  const { results } = await db
    .prepare('SELECT id, name, capacity, sort_order FROM tables ORDER BY sort_order ASC, id ASC')
    .all<TableRow>();
  return results;
}

export async function getTable(db: D1Database, id: number): Promise<TableRow | null> {
  return db.prepare('SELECT id, name, capacity, sort_order FROM tables WHERE id = ?1').bind(id).first<TableRow>();
}

function nameKey(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr');
}

/** Autre table portant déjà ce nom (sans tenir compte de la casse, accents compris : « É » = « é »). */
export async function findTableByName(db: D1Database, name: string, exceptId: number | null = null): Promise<TableRow | null> {
  const key = nameKey(name);
  return (await listTables(db)).find((t) => t.id !== exceptId && nameKey(t.name) === key) ?? null;
}

/** Ordre d'affichage par défaut d'une nouvelle table : la dernière + 1. */
export async function nextSortOrder(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM tables').first<{ n: number }>();
  return Math.min(row?.n ?? 1, SORT_ORDER_MAX);
}

export async function createTable(db: D1Database, input: TableInput): Promise<TableRow> {
  const row = await db
    .prepare('INSERT INTO tables (name, capacity, sort_order) VALUES (?1, ?2, ?3) RETURNING id, name, capacity, sort_order')
    .bind(input.name, input.capacity, input.sort_order)
    .first<TableRow>();
  return row!;
}

export async function updateTable(db: D1Database, id: number, input: TableInput): Promise<void> {
  await db
    .prepare('UPDATE tables SET name = ?2, capacity = ?3, sort_order = ?4 WHERE id = ?1')
    .bind(id, input.name, input.capacity, input.sort_order)
    .run();
}

/** Supprime une table : ses invités redeviennent « non placés ». */
export async function deleteTable(db: D1Database, id: number): Promise<void> {
  await db.batch([
    db.prepare('UPDATE guests SET table_id = NULL WHERE table_id = ?1').bind(id),
    db.prepare('DELETE FROM tables WHERE id = ?1').bind(id),
  ]);
}

export async function setGuestTable(db: D1Database, guestId: number, tableId: number | null): Promise<void> {
  await db.prepare('UPDATE guests SET table_id = ?2 WHERE id = ?1').bind(guestId, tableId).run();
}

/** Places occupées d'une table (selon la dernière réponse de chaque invité placé). */
export async function tableSummary(db: D1Database, t: TableRow): Promise<TableSummary> {
  const { results } = await db
    .prepare(
      `SELECT g.expected_count, r.answer, r.count AS confirmed_count
       FROM guests g
       LEFT JOIN responses r ON r.id = (SELECT MAX(id) FROM responses WHERE guest_id = g.id)
       WHERE g.table_id = ?1`,
    )
    .bind(t.id)
    .all<{ expected_count: number; answer: Answer | null; confirmed_count: number | null }>();
  return summarize(t, results.reduce((sum, g) => sum + seatsOf(g), 0));
}

// ---------------------------------------------------------------- plan complet

export function buildPlan(tables: TableRow[], guests: GuestRow[]): Plan {
  const byTable = new Map<number, GuestRow[]>(tables.map((t) => [t.id, []]));
  const unplaced: GuestRow[] = [];
  for (const g of guests) {
    if (!isPlaceable(g)) continue;
    const list = g.table_id !== null ? byTable.get(g.table_id) : undefined;
    if (list) list.push(g);
    else unplaced.push(g);
  }
  const planTables: PlanTable[] = tables.map((t) => {
    const tg = byTable.get(t.id)!.sort(byName);
    const s = summarize(t, tg.reduce((sum, g) => sum + seatsOf(g), 0));
    return { ...t, guests: tg, seats: s.seats, over: s.over, over_by: s.over_by };
  });
  unplaced.sort(byName);
  return {
    tables: planTables,
    unplaced,
    capacity: planTables.reduce((sum, t) => sum + t.capacity, 0),
    placedSeats: planTables.reduce((sum, t) => sum + t.seats, 0),
    unplacedSeats: unplaced.reduce((sum, g) => sum + seatsOf(g), 0),
    placedGuests: planTables.reduce((sum, t) => sum + t.guests.length, 0),
  };
}

export async function loadPlan(db: D1Database): Promise<Plan> {
  const [tables, guests] = await Promise.all([listTables(db), listGuests(db)]);
  return buildPlan(tables, guests);
}
