// Page « Plan de table » : résumé, ajout de tables, invités à placer, une carte par table.
// Fonctionne sans JavaScript (formulaires) ; /vd/tables.js ajoute le glisser-déposer (SortableJS).

import type { FC } from 'hono/jsx';
import { SIDE_LABEL, SIDES, seatsOf, type GuestRow, type Side } from '../lib/db';
import {
  overText,
  SORT_ORDER_MAX,
  TABLE_CAPACITY_MAX,
  TABLE_NAME_MAX,
  type Plan,
  type PlanTable,
  type TableRow,
} from '../lib/tables';
import { fold } from '../lib/import';
import { plural } from './guests-ui';
import { Csrf, Layout } from './layout';

export interface TableFormValues {
  name: string;
  capacity: string;
  sort_order: string;
}

/** Formulaire à rouvrir avec les valeurs saisies (erreur de validation). */
export type FormState =
  | { kind: 'create'; values: TableFormValues; error: string }
  | { kind: 'edit'; id: number; values: TableFormValues; error: string };

export interface PoolFilter {
  side: Side | '';
  q: string;
}

export interface PlanPageProps {
  csrf: string;
  plan: Plan;
  published: boolean;
  flash: { kind: 'ok' | 'err'; text: string } | null;
  /** Avertissement de dépassement après un placement (formulaire sans JavaScript). */
  warning: string | null;
  form?: FormState;
  filter: PoolFilter;
}

function matchesFilter(g: GuestRow, f: PoolFilter): boolean {
  if (f.side && g.side !== f.side) return false;
  return !f.q || fold(g.name).includes(fold(f.q));
}

function meterWidth(seats: number, capacity: number): string {
  const pct = capacity > 0 ? Math.min(100, Math.round((seats / capacity) * 100)) : seats > 0 ? 100 : 0;
  return `width:${pct}%`;
}

/** Nom proposé pour une nouvelle table : « Table N » (premier numéro libre). */
export function suggestTableName(tables: TableRow[]): string {
  const used = new Set(tables.map((t) => t.name.trim().toLowerCase()));
  let n = tables.length + 1;
  while (used.has(`table ${n}`)) n++;
  return `Table ${n}`;
}

/** « 2 tables dépassent leur capacité : A, B. » (même texte que /vd/tables.js). */
export function overSummary(names: string[]): string {
  if (!names.length) return '';
  const head = names.length > 1 ? `${names.length} tables dépassent leur capacité` : '1 table dépasse sa capacité';
  return `${head} : ${names.join(', ')}.`;
}

export function nextOrderOf(tables: TableRow[]): number {
  return Math.min(SORT_ORDER_MAX, tables.reduce((m, t) => Math.max(m, t.sort_order), 0) + 1);
}

// ---------------------------------------------------------------- invité (pastille déplaçable)

const GuestChip: FC<{ g: GuestRow; tables: PlanTable[]; csrf: string; hidden?: boolean }> = ({ g, tables, csrf, hidden }) => {
  const seats = seatsOf(g);
  const answered = g.answer === 'oui';
  return (
    <li
      class={`tp-chip side-${g.side}${hidden ? ' hidden' : ''}`}
      data-guest-id={g.id}
      data-seats={seats}
      data-side={g.side}
      data-name={g.name}
    >
      <div class="tp-chip-top">
        <span class="tp-grip" aria-hidden="true"></span>
        <span class="tp-name">{g.name}</span>
        <span class="tp-pers" title="Places occupées">
          {seats} pers.
        </span>
      </div>
      <div class="tp-chip-bottom">
        <span class={`badge ${answered ? 'badge-oui' : 'badge-none'}`}>{answered ? 'oui' : 'sans réponse'}</span>
        <span class="tp-sidename">{SIDE_LABEL[g.side]}</span>
        <form method="post" action="/admin/tables/assign" class="tp-move">
          <Csrf token={csrf} />
          <input type="hidden" name="guest_id" value={String(g.id)} />
          <label class="tp-move-l">
            <span class="tp-move-t" aria-hidden="true">
              Déplacer vers…
            </span>
            <select
              name="table_id"
              class="tp-select"
              aria-label={`Déplacer ${g.name} vers…`}
              data-current={g.table_id === null ? '' : String(g.table_id)}
            >
              <option value="" selected={g.table_id === null}>
                Non placé
              </option>
              {tables.map((t) => (
                <option value={String(t.id)} selected={g.table_id === t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" class="btn btn-sm tp-go">
            Déplacer
          </button>
        </form>
      </div>
    </li>
  );
};

// ---------------------------------------------------------------- formulaires de table

const TableFields: FC<{ values: TableFormValues; idPrefix: string }> = ({ values, idPrefix }) => (
  <div class="row">
    <label class="field grow" for={`${idPrefix}-name`}>
      <span>Nom de la table</span>
      <input
        type="text"
        id={`${idPrefix}-name`}
        name="name"
        required
        maxlength={TABLE_NAME_MAX}
        autocomplete="off"
        value={values.name}
      />
    </label>
    <label class="field tp-num" for={`${idPrefix}-capacity`}>
      <span>Places</span>
      <input
        type="number"
        id={`${idPrefix}-capacity`}
        name="capacity"
        min="0"
        max={TABLE_CAPACITY_MAX}
        step="1"
        inputmode="numeric"
        required
        value={values.capacity}
      />
    </label>
    <label class="field tp-num" for={`${idPrefix}-order`}>
      <span>Ordre</span>
      <input
        type="number"
        id={`${idPrefix}-order`}
        name="sort_order"
        min={-SORT_ORDER_MAX}
        max={SORT_ORDER_MAX}
        step="1"
        inputmode="numeric"
        value={values.sort_order}
      />
    </label>
  </div>
);

const CreateForm: FC<{ csrf: string; values: TableFormValues; error?: string; open: boolean }> = ({ csrf, values, error, open }) => (
  <details class="card tp-create" id="nouvelle-table" open={open}>
    <summary>
      <span class="tp-create-sum">+ Ajouter une table</span>
    </summary>
    <form method="post" action="/admin/tables" class="form tp-form">
      <Csrf token={csrf} />
      {error ? <p class="tp-form-err">{error}</p> : null}
      <TableFields values={values} idPrefix="new" />
      <p class="hint">
        L’ordre fixe la position de la table dans le plan, l’impression et les marque-tables (du plus petit au plus grand).
      </p>
      <div class="actions">
        <button type="submit" class="btn btn-primary">
          Ajouter la table
        </button>
      </div>
    </form>
  </details>
);

// ---------------------------------------------------------------- carte d'une table

const TableCard: FC<{ t: PlanTable; tables: PlanTable[]; csrf: string; form?: FormState }> = ({ t, tables, csrf, form }) => {
  const editing = form?.kind === 'edit' && form.id === t.id ? form : null;
  const values: TableFormValues = editing
    ? editing.values
    : { name: t.name, capacity: String(t.capacity), sort_order: String(t.sort_order) };
  return (
    <section
      class={`card tp-table${t.over ? ' is-over' : ''}`}
      id={`table-${t.id}`}
      data-table-id={t.id}
      data-capacity={t.capacity}
      data-seats={t.seats}
      aria-labelledby={`table-${t.id}-name`}
    >
      <header class="tp-head">
        <h2 class="tp-title" id={`table-${t.id}-name`}>
          {t.name}
        </h2>
        <span class="tp-count">
          <b class="tp-count-v">{t.seats}</b> / <span class="tp-count-c">{t.capacity}</span> places
        </span>
      </header>
      <div class="tp-meter" aria-hidden="true">
        <span style={meterWidth(t.seats, t.capacity)}></span>
      </div>
      <p class="alert tp-over" hidden={!t.over}>
        {t.over ? overText(t.over_by) : ''}
      </p>
      <ul class="tp-list" data-table-id={t.id} data-empty="Aucun invité. Glissez un invité ici ou choisissez cette table dans « Déplacer vers… ».">
        {t.guests.map((g) => (
          <GuestChip g={g} tables={tables} csrf={csrf} />
        ))}
      </ul>
      <details class="tp-edit" open={Boolean(editing)}>
        <summary>Modifier ou supprimer la table</summary>
        <form method="post" action={`/admin/tables/${t.id}`} class="form tp-form">
          <Csrf token={csrf} />
          {editing ? <p class="tp-form-err">{editing.error}</p> : null}
          <TableFields values={values} idPrefix={`t${t.id}`} />
          <div class="actions">
            <button type="submit" class="btn btn-primary btn-sm">
              Enregistrer
            </button>
          </div>
        </form>
        <form
          method="post"
          action={`/admin/tables/${t.id}/delete`}
          class="tp-del"
          data-confirm={`Supprimer la table « ${t.name} » ? ${
            t.guests.length ? `Ses ${plural(t.guests.length, 'invité', 'invités')} redeviendront « non placés ».` : ''
          }`.trim()}
        >
          <Csrf token={csrf} />
          <button type="submit" class="btn btn-danger btn-sm">
            Supprimer la table
          </button>
        </form>
      </details>
    </section>
  );
};

// ---------------------------------------------------------------- invités à placer

const Pool: FC<{ plan: Plan; csrf: string; filter: PoolFilter }> = ({ plan, csrf, filter }) => {
  const visible = plan.unplaced.filter((g) => matchesFilter(g, filter)).length;
  return (
    <section class="card tp-pool" id="non-places" aria-labelledby="non-places-title">
      <header class="tp-head">
        <h2 class="tp-title" id="non-places-title">
          Non placés
        </h2>
        <span class="tp-count" data-pool-count>
          {plural(plan.unplaced.length, 'invité', 'invités')} · {plural(plan.unplacedSeats, 'place', 'places')}
        </span>
      </header>
      <form method="get" action="/admin/tables#non-places" class="tp-filter" data-pool-filter role="search">
        <label class="tp-filter-q">
          <span class="sr-only">Rechercher un invité</span>
          <input type="search" name="q" value={filter.q} placeholder="Rechercher un nom…" autocomplete="off" maxlength={60} data-pool-search />
        </label>
        <label class="tp-filter-side">
          <span class="sr-only">Côté</span>
          <select name="side" data-pool-side>
            <option value="" selected={!filter.side}>
              Tous les côtés
            </option>
            {SIDES.map((s) => (
              <option value={s} selected={filter.side === s}>
                {`Côté ${SIDE_LABEL[s]}`}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" class="btn btn-sm tp-go">
          Filtrer
        </button>
      </form>
      <p class="muted small tp-noresult" data-pool-none hidden={!(plan.unplaced.length > 0 && visible === 0)}>
        Aucun invité non placé ne correspond à ce filtre.
      </p>
      <ul class="tp-list tp-pool-list" data-table-id="" data-empty="Tous les invités sont placés.">
        {plan.unplaced.map((g) => (
          <GuestChip g={g} tables={plan.tables} csrf={csrf} hidden={!matchesFilter(g, filter)} />
        ))}
      </ul>
      <p class="hint tp-pool-hint">Les invités ayant répondu « non » n’apparaissent pas dans le plan.</p>
    </section>
  );
};

// ---------------------------------------------------------------- page

export const PlanPage: FC<PlanPageProps> = ({ csrf, plan, published, flash, warning, form, filter }) => {
  const overTables = plan.tables.filter((t) => t.over);
  const createValues: TableFormValues =
    form?.kind === 'create'
      ? form.values
      : { name: suggestTableName(plan.tables), capacity: '10', sort_order: String(nextOrderOf(plan.tables)) };
  return (
    <Layout
      title="Plan de table"
      active="tables"
      csrf={csrf}
      flash={flash}
      scripts={['/vd/sortable.min.js', '/vd/tables.js']}
      styles={['/vd/tables.css']}
    >
      <div class="page-head">
        <h1>Plan de table</h1>
        <div class="actions">
          <a class="btn btn-sm" href="/admin/tables/print">
            Imprimer le plan
          </a>
          <a class="btn btn-sm" href="/admin/tables/cards">
            Marque-tables
          </a>
          <a class="btn btn-sm" href="/admin/tables/export.csv">
            Exporter (CSV)
          </a>
        </div>
      </div>

      {warning ? (
        <p class="alert tp-warn" role="alert">
          {warning}
        </p>
      ) : null}

      <div class="stats tp-stats">
        <div class="stat">
          <span class="stat-v">{plan.tables.length}</span>
          <span class="stat-l">{plan.tables.length > 1 ? 'Tables' : 'Table'}</span>
        </div>
        <div class="stat">
          <span class="stat-v">{plan.capacity}</span>
          <span class="stat-l">Places au total</span>
        </div>
        <div class="stat ok">
          <span class="stat-v" data-stat="placed">
            {plan.placedSeats}
          </span>
          <span class="stat-l">Places attribuées</span>
        </div>
        <div class="stat none">
          <span class="stat-v" data-stat="unplaced">
            {plan.unplacedSeats}
          </span>
          <span class="stat-l">Places à attribuer</span>
        </div>
      </div>

      <p class={`tp-pub ${published ? 'is-on' : ''}`}>
        <span class={`badge ${published ? 'badge-oui' : 'badge-none'}`}>{published ? 'Plan publié' : 'Plan non publié'}</span>
        <span>
          {published
            ? 'Publié : chaque invité voit sa table après sa réponse'
            : 'Non publié : les invités ne voient pas encore leur table'}
        </span>
        <a href="/admin/settings">Modifier dans les réglages</a>
      </p>

      <p class="alert tp-over-all" data-over-summary hidden={overTables.length === 0}>
        {overSummary(overTables.map((t) => t.name))}
      </p>

      <CreateForm
        csrf={csrf}
        values={createValues}
        error={form?.kind === 'create' ? form.error : undefined}
        open={plan.tables.length === 0 || form?.kind === 'create'}
      />

      <p class="hint tp-help">
        Glissez un invité d’une liste à l’autre (sur téléphone : appui long, puis glisser) ou utilisez son menu « Déplacer
        vers… ». Un invité sans réponse compte pour le nombre de personnes prévu, un « oui » pour le nombre confirmé. Une table
        peut dépasser sa capacité : elle est alors signalée.
      </p>

      <div class="tp-board" data-plan>
        <Pool plan={plan} csrf={csrf} filter={filter} />
        <div class="tp-tables">
          {plan.tables.length ? (
            plan.tables.map((t) => <TableCard t={t} tables={plan.tables} csrf={csrf} form={form} />)
          ) : (
            <section class="card tp-empty">
              <h2>Aucune table pour l’instant</h2>
              <p class="muted">Ajoutez vos tables avec le formulaire ci-dessus, puis placez-y les invités.</p>
            </section>
          )}
        </div>
      </div>

      <div id="tp-live" class="tp-live" role="status" aria-live="polite"></div>
    </Layout>
  );
};
