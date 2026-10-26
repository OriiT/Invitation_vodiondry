// Budget du mariage : postes de dépense (forfaits et montants par personne), nombre de personnes et totaux.
// Montants en Ariary, nombres entiers. Le nombre de personnes vient de la liste d'invités (trois scénarios)
// plus les personnes « hors liste » (réglage budget_extra_people).

import { seatsOf, type GuestRow } from './db';

export type BudgetKind = 'forfait' | 'par_personne';
export const BUDGET_KINDS: BudgetKind[] = ['forfait', 'par_personne'];
export const KIND_LABEL: Record<BudgetKind, string> = { forfait: 'Forfait', par_personne: 'Par personne' };

export const LABEL_MAX = 100;
export const DETAIL_MAX = 300;
/** Montant maximal accepté (mille milliards d'Ariary : garde-fou contre une faute de frappe). */
export const AMOUNT_MAX = 1e12;
/** Personnes hors liste d'invités : nombre entier de 0 à EXTRA_PEOPLE_MAX. */
export const EXTRA_PEOPLE_MAX = 500;

export interface BudgetItem {
  id: number;
  label: string;
  detail: string;
  kind: BudgetKind;
  amount: number;
  sort_order: number;
  created_at: string;
}

export interface BudgetInput {
  label: string;
  detail: string;
  kind: BudgetKind;
  amount: number;
}

// ---------------------------------------------------------------- base de données

const ITEM_COLUMNS = 'id, label, detail, kind, amount, sort_order, created_at';

export async function listBudgetItems(db: D1Database): Promise<BudgetItem[]> {
  const { results } = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM budget_items ORDER BY sort_order, id`).all<BudgetItem>();
  return results;
}

export async function getBudgetItem(db: D1Database, id: number): Promise<BudgetItem | null> {
  return db.prepare(`SELECT ${ITEM_COLUMNS} FROM budget_items WHERE id = ?1`).bind(id).first<BudgetItem>();
}

/** Ajoute un poste à la fin de la liste (ordre = dernier + 1). */
export async function createBudgetItem(db: D1Database, input: BudgetInput): Promise<BudgetItem> {
  const row = await db
    .prepare(
      `INSERT INTO budget_items (label, detail, kind, amount, sort_order)
       SELECT ?1, ?2, ?3, ?4, COALESCE(MAX(sort_order), 0) + 1 FROM budget_items
       RETURNING ${ITEM_COLUMNS}`,
    )
    .bind(input.label, input.detail, input.kind, input.amount)
    .first<BudgetItem>();
  return row!;
}

export async function updateBudgetItem(db: D1Database, id: number, input: BudgetInput): Promise<void> {
  await db
    .prepare('UPDATE budget_items SET label = ?2, detail = ?3, kind = ?4, amount = ?5 WHERE id = ?1')
    .bind(id, input.label, input.detail, input.kind, input.amount)
    .run();
}

export async function deleteBudgetItem(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM budget_items WHERE id = ?1').bind(id).run();
}

// ---------------------------------------------------------------- montants

/**
 * Montant saisi → nombre entier d'Ariary (≥ 0), ou null s'il est vide ou invalide.
 * Acceptés : « 300000 », « 300 000 » (espaces ordinaires, insécables ou fines), « 300.000 », « 300 000 Ar ».
 * Refusés : nombres négatifs, décimales (« 12,5 », « 12.50 »), texte, montants au-delà de AMOUNT_MAX.
 */
export function parseAmount(input: string): number | null {
  // \s couvre aussi les espaces insécables (U+00A0) et fines insécables (U+202F) des nombres copiés depuis Excel.
  let s = input.replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*(ar|ariary)\.?$/i, '');
  // Espaces entre les chiffres ignorés ; points acceptés seulement comme séparateurs de milliers (groupes de 3).
  s = s.replace(/(\d) (?=\d)/g, '$1');
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d{1,13}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n <= AMOUNT_MAX ? n : null;
}

/** Chiffres groupés par milliers : 5149000 → « 5 149 000 » (séparateur au choix). */
export function groupDigits(n: number, sep = ' '): string {
  const v = Math.round(n);
  const digits = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return v < 0 ? `-${digits}` : digits;
}

/**
 * Montant affiché à la française : « 5 149 000 Ar » (espaces fines insécables entre les milliers, comme
 * Intl.NumberFormat('fr-FR'), et espace insécable avant « Ar » : jamais coupé en fin de ligne).
 */
export function formatAr(n: number): string {
  return `${groupDigits(n)} Ar`;
}

// ---------------------------------------------------------------- personnes et totaux

export type ScenarioKey = 'prevu' | 'estimation' | 'confirme';
export const SCENARIOS: ScenarioKey[] = ['prevu', 'estimation', 'confirme'];
export const SCENARIO_LABEL: Record<ScenarioKey, string> = { prevu: 'Prévu', estimation: 'Estimation', confirme: 'Confirmé' };

export interface PeopleCounts {
  /** Personnes hors liste d'invités (réglage budget_extra_people). */
  extra: number;
  /** Liste d'invités : somme des nombres prévus. */
  listed: number;
  /** « Oui » : somme des nombres confirmés. */
  yes: number;
  /** Invités sans réponse : somme des nombres prévus. */
  pending: number;
  /** Liste d'invités (nombres prévus) + hors liste. */
  prevu: number;
  /** « Oui » confirmés + sans réponse (nombre prévu) + hors liste ; les « non » comptent 0. */
  estimation: number;
  /** « Oui » confirmés + hors liste. */
  confirme: number;
}

export function peopleCounts(guests: GuestRow[], extra: number): PeopleCounts {
  let listed = 0;
  let yes = 0;
  let pending = 0;
  let seats = 0;
  for (const g of guests) {
    listed += g.expected_count;
    seats += seatsOf(g);
    if (g.answer === 'oui') yes += g.confirmed_count ?? 0;
    else if (g.answer === null) pending += g.expected_count;
  }
  return { extra, listed, yes, pending, prevu: listed + extra, estimation: seats + extra, confirme: yes + extra };
}

/** Réglage budget_extra_people → nombre (0 si la valeur stockée est invalide). */
export function extraPeopleOf(value: string): number {
  const t = value.trim();
  return /^\d{1,3}$/.test(t) && Number(t) <= EXTRA_PEOPLE_MAX ? Number(t) : 0;
}

export interface ScenarioTotal {
  people: number;
  /** forfaits + montants par personne × people */
  total: number;
  /** Coût par personne, arrondi à l'Ariary (0 sans personne). */
  perGuest: number;
}

export interface BudgetTotals {
  /** Somme des forfaits. */
  forfaits: number;
  /** Somme des montants par personne. */
  perPerson: number;
  scenarios: Record<ScenarioKey, ScenarioTotal>;
}

export function computeBudget(items: Pick<BudgetItem, 'kind' | 'amount'>[], people: Record<ScenarioKey, number>): BudgetTotals {
  let forfaits = 0;
  let perPerson = 0;
  for (const it of items) {
    if (it.kind === 'forfait') forfaits += it.amount;
    else perPerson += it.amount;
  }
  const scenario = (n: number): ScenarioTotal => {
    const total = forfaits + perPerson * n;
    return { people: n, total, perGuest: n > 0 ? Math.round(total / n) : 0 };
  };
  return {
    forfaits,
    perPerson,
    scenarios: { prevu: scenario(people.prevu), estimation: scenario(people.estimation), confirme: scenario(people.confirme) },
  };
}

/** Total d'un poste pour un nombre de personnes : le montant pour un forfait, montant × personnes sinon. */
export function itemTotal(item: Pick<BudgetItem, 'kind' | 'amount'>, people: number): number {
  return item.kind === 'forfait' ? item.amount : item.amount * people;
}
