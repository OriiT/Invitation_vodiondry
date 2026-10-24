// Enregistrement en base d'une liste importée (idempotent : un nom déjà connu, même sous un ancien nom, n'est pas dupliqué).

import { createGuests, nameKey } from './db';
import type { ImportRow } from './import';

export interface ImportOutcome {
  added: ImportRow[];
  /** Déjà dans la liste (sous ce nom, ou sous un ancien nom avant un renommage dans l'administration). */
  skipped: ImportRow[];
  /**
   * Parmi les ajoutés : invités qui avaient été supprimés dans l'administration. Ils sont recréés (réimporter
   * l'export après avoir tout supprimé restaure la liste), mais signalés sur la page de résultat.
   */
  restored: ImportRow[];
}

/**
 * Noms connus : invités actuels et anciens noms (table former_names). `kind` : 'guest' (invité actuel),
 * 'renamed' (ancien nom d'un invité renommé), 'deleted' (invité supprimé).
 */
export const KNOWN_NAMES_SQL = `SELECT name, 'guest' AS kind FROM guests
UNION ALL
SELECT name, CASE deleted WHEN 1 THEN 'deleted' ELSE 'renamed' END AS kind FROM former_names`;

export interface KnownName {
  name: string;
  kind: 'guest' | 'renamed' | 'deleted';
}

export interface NameIndex {
  /** Invités présents (nom actuel ou ancien nom). */
  present: Set<string>;
  /** Invités supprimés (et pas revenus depuis sous le même nom). */
  removed: Set<string>;
}

export function buildNameIndex(names: KnownName[]): NameIndex {
  const present = new Set<string>();
  const removed = new Set<string>();
  for (const n of names) (n.kind === 'deleted' ? removed : present).add(nameKey(n.name));
  for (const k of present) removed.delete(k);
  return { present, removed };
}

export async function readNameIndex(db: D1Database): Promise<NameIndex> {
  const { results } = await db.prepare(KNOWN_NAMES_SQL).all<KnownName>();
  return buildNameIndex(results);
}

/**
 * Un invité du fichier est « déjà connu » si son nom nettoyé OU son nom tel qu'écrit dans le fichier
 * existe déjà (casse ignorée). Le second cas couvre la réimportation de l'export : un nom saisi à la main
 * dans l'administration (ex. « Soa + zaza ») ne doit pas revenir en double sous sa forme nettoyée.
 */
export function isKnown(known: { has(key: string): boolean }, row: Pick<ImportRow, 'name' | 'original'>): boolean {
  return known.has(nameKey(row.name)) || known.has(nameKey(row.original));
}

/** Répartit les lignes du fichier : à ajouter ou déjà présentes. Un nom répété dans le fichier n'est ajouté qu'une fois. */
export function classifyRows(index: NameIndex, rows: ImportRow[]): ImportOutcome {
  const out: ImportOutcome = { added: [], skipped: [], restored: [] };
  const present = new Set(index.present);
  for (const row of rows) {
    if (isKnown(present, row)) {
      out.skipped.push(row);
      continue;
    }
    out.added.push(row);
    if (isKnown(index.removed, row)) out.restored.push(row);
    present.add(nameKey(row.name));
    present.add(nameKey(row.original));
  }
  return out;
}

/** Importe les lignes : 1 requête D1 pour les noms connus + 1 par lot de 100 nouveaux invités. */
export async function importRows(db: D1Database, rows: ImportRow[]): Promise<ImportOutcome> {
  const out = classifyRows(await readNameIndex(db), rows);
  if (out.added.length) await createGuests(db, out.added);
  return out;
}
