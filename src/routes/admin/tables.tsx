// Administration : plan de table (/admin/tables).
//   GET  /            plan : résumé, invités à placer, une carte par table
//   POST /            nouvelle table
//   POST /:id         modifier une table (nom, places, ordre)
//   POST /:id/delete  supprimer une table (ses invités redeviennent « non placés »)
//   POST /assign      placer / déplacer / retirer un invité (JSON ou formulaire)
//   GET  /print       plan imprimable (A4)
//   GET  /cards       marque-tables
//   GET  /export.csv  export CSV
// Session et jeton CSRF sont vérifiés en amont (routes/admin/index.tsx).

import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { getGuest, seatsOf, SIDE_LABEL, SIDES, type GuestRow, type Side } from '../../lib/db';
import { toCsv } from '../../lib/import';
import { formatDateTimeFr, getSettings, todayMadagascar } from '../../lib/settings';
import {
  createTable,
  deleteTable,
  findTableByName,
  getTable,
  loadPlan,
  nextSortOrder,
  overWarning,
  setGuestTable,
  SORT_ORDER_MAX,
  TABLE_CAPACITY_DEFAULT,
  TABLE_CAPACITY_MAX,
  TABLE_NAME_MAX,
  tableSummary,
  updateTable,
  type TableInput,
  type TableRow,
} from '../../lib/tables';
import { PlanPage, type FormState, type PoolFilter, type TableFormValues } from '../../views/tables-plan';
import { CardsPage, PrintPage, type CardFormat } from '../../views/tables-print';

const app = new Hono<AppEnv>();
type Ctx = Context<AppEnv>;

/** CSP propre aux marque-tables : polices de l'invitation (Google Fonts) en plus des règles de l'administration. */
export const CARDS_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'";

const OK_MESSAGES: Record<string, string> = {
  created: 'Table ajoutée.',
  updated: 'Table enregistrée.',
  deleted: 'Table supprimée. Ses invités sont de nouveau « non placés ».',
  assigned: 'Invité placé.',
  unassigned: 'Invité retiré de sa table.',
};

type Flash = { kind: 'ok' | 'err'; text: string } | null;

// ---------------------------------------------------------------- rendu de la page

interface RenderOptions {
  status?: 200 | 400 | 404;
  flash?: Flash;
  warning?: string | null;
  form?: FormState;
}

function readFilter(c: Ctx): PoolFilter {
  const side = c.req.query('side') ?? '';
  const q = (c.req.query('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return { side: (SIDES as string[]).includes(side) ? (side as Side) : '', q };
}

async function renderPlan(c: Ctx, opts: RenderOptions = {}) {
  const [plan, settings] = await Promise.all([loadPlan(c.env.DB), getSettings(c.env.DB)]);
  let warning = opts.warning ?? null;
  if (warning === null) {
    // Retour d'un placement par formulaire : avertissement recalculé à partir de l'état actuel.
    const overId = Number(c.req.query('over'));
    const t = Number.isInteger(overId) ? plan.tables.find((x) => x.id === overId) : undefined;
    if (t) warning = overWarning(t);
  }
  let flash = opts.flash ?? null;
  if (!flash && !opts.form) {
    const ok = c.req.query('ok');
    if (ok && OK_MESSAGES[ok]) flash = { kind: 'ok', text: OK_MESSAGES[ok] };
  }
  return c.html(
    <PlanPage
      csrf={c.get('csrf')}
      plan={plan}
      published={settings.publish_tables === '1'}
      flash={flash}
      warning={warning}
      form={opts.form}
      filter={readFilter(c)}
    />,
    opts.status ?? 200,
  );
}

// ---------------------------------------------------------------- validation

function field(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === 'string' ? v : '';
}

function parseInteger(s: string): number | null {
  const t = s.trim();
  return /^-?\d{1,6}$/.test(t) ? Number(t) : null;
}

/** Lit et valide le formulaire d'une table ; `current` = table modifiée (null : création). */
async function readTableForm(
  db: D1Database,
  body: Record<string, unknown>,
  current: TableRow | null,
): Promise<{ values: TableFormValues; input?: TableInput; error?: string }> {
  const values: TableFormValues = {
    name: field(body, 'name'),
    capacity: field(body, 'capacity'),
    sort_order: field(body, 'sort_order'),
  };
  const name = values.name.replace(/\s+/g, ' ').trim();
  if (!name) return { values, error: 'Indiquez le nom de la table.' };
  if ([...name].length > TABLE_NAME_MAX) {
    return { values, error: `Le nom de la table ne doit pas dépasser ${TABLE_NAME_MAX} caractères.` };
  }

  const capacity = values.capacity.trim() === '' && !current ? TABLE_CAPACITY_DEFAULT : parseInteger(values.capacity);
  if (capacity === null || capacity < 0 || capacity > TABLE_CAPACITY_MAX) {
    return { values, error: `Le nombre de places doit être un nombre entier entre 0 et ${TABLE_CAPACITY_MAX}.` };
  }

  let sortOrder: number | null;
  if (values.sort_order.trim() === '') sortOrder = current ? current.sort_order : await nextSortOrder(db);
  else sortOrder = parseInteger(values.sort_order);
  if (sortOrder === null || Math.abs(sortOrder) > SORT_ORDER_MAX) {
    return { values, error: `L’ordre doit être un nombre entier entre -${SORT_ORDER_MAX} et ${SORT_ORDER_MAX}.` };
  }

  const twin = await findTableByName(db, name, current?.id ?? null);
  if (twin) return { values, error: `Une table s’appelle déjà « ${twin.name} ». Choisissez un autre nom.` };

  return { values, input: { name, capacity, sort_order: sortOrder } };
}

// ---------------------------------------------------------------- plan

app.get('/', (c) => renderPlan(c));

app.post('/', async (c) => {
  const body = await c.req.parseBody();
  const res = await readTableForm(c.env.DB, body, null);
  if (!res.input) {
    return renderPlan(c, {
      status: 400,
      flash: { kind: 'err', text: res.error! },
      form: { kind: 'create', values: res.values, error: res.error! },
    });
  }
  const t = await createTable(c.env.DB, res.input);
  return c.redirect(`/admin/tables?ok=created#table-${t.id}`, 303);
});

const TABLE_NOT_FOUND: Flash = { kind: 'err', text: 'Cette table n’existe plus (déjà supprimée ?).' };

app.post('/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'));
  const current = await getTable(c.env.DB, id);
  if (!current) return renderPlan(c, { status: 404, flash: TABLE_NOT_FOUND });
  const body = await c.req.parseBody();
  const res = await readTableForm(c.env.DB, body, current);
  if (!res.input) {
    return renderPlan(c, {
      status: 400,
      flash: { kind: 'err', text: `« ${current.name} » : ${res.error!}` },
      form: { kind: 'edit', id, values: res.values, error: res.error! },
    });
  }
  await updateTable(c.env.DB, id, res.input);
  return c.redirect(`/admin/tables?ok=updated#table-${id}`, 303);
});

app.post('/:id{[0-9]+}/delete', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await getTable(c.env.DB, id))) return renderPlan(c, { status: 404, flash: TABLE_NOT_FOUND });
  await deleteTable(c.env.DB, id);
  return c.redirect('/admin/tables?ok=deleted', 303);
});

// ---------------------------------------------------------------- placement d'un invité

/** Identifiant positif (nombre ou chaîne de chiffres), sinon null. */
function parseId(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? v : null;
  if (typeof v === 'string' && /^\d{1,15}$/.test(v.trim())) {
    const n = Number(v.trim());
    return n > 0 ? n : null;
  }
  return null;
}

app.post('/assign', async (c) => {
  const db = c.env.DB;
  const isJson = (c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json');

  const fail = (status: 400 | 404, error: string, message: string) =>
    isJson ? c.json({ ok: false, error, message }, status) : renderPlan(c, { status, flash: { kind: 'err', text: message } });

  let rawGuest: unknown;
  let rawTable: unknown;
  if (isJson) {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return fail(400, 'bad_request', 'Requête invalide.');
    }
    if (!body || typeof body !== 'object') return fail(400, 'bad_request', 'Requête invalide.');
    ({ guest_id: rawGuest, table_id: rawTable } = body as Record<string, unknown>);
  } else {
    const body = await c.req.parseBody();
    rawGuest = body.guest_id;
    rawTable = body.table_id;
  }

  const guestId = parseId(rawGuest);
  // table_id : null ou '' = retirer l'invité de sa table ; absent = requête invalide.
  const unplace = rawTable === null || rawTable === '';
  const tableId = unplace ? null : parseId(rawTable);
  if (guestId === null || (!unplace && tableId === null)) return fail(400, 'bad_request', 'Requête invalide.');

  const guest: GuestRow | null = await getGuest(db, guestId);
  if (!guest) return fail(404, 'not_found', 'Invité introuvable (supprimé entre-temps ?). Rechargez la page.');
  if (guest.answer === 'non') {
    return fail(400, 'declined', `« ${guest.name} » a répondu « non » : impossible de lui attribuer une table.`);
  }
  let table: TableRow | null = null;
  if (tableId !== null) {
    table = await getTable(db, tableId);
    if (!table) return fail(404, 'table_not_found', 'Cette table n’existe plus. Rechargez la page.');
  }

  const previousId = guest.table_id;
  await setGuestTable(db, guestId, tableId);

  const previousTable = previousId !== null && previousId !== tableId ? await getTable(db, previousId) : null;
  const [summary, previous] = await Promise.all([
    table ? tableSummary(db, table) : Promise.resolve(null),
    previousTable ? tableSummary(db, previousTable) : Promise.resolve(null),
  ]);
  const warning = summary ? overWarning(summary) : null;

  if (isJson) return c.json({ ok: true, guest_id: guestId, table: summary, previous, warning });

  const params = new URLSearchParams({ ok: tableId === null ? 'unassigned' : 'assigned' });
  if (summary?.over) params.set('over', String(summary.id));
  // Retour à la liste d'où venait l'invité, pour enchaîner les placements.
  const anchor = previousId !== null ? `table-${previousId}` : 'non-places';
  return c.redirect(`/admin/tables?${params}#${anchor}`, 303);
});

// ---------------------------------------------------------------- impression, marque-tables, export

app.get('/print', async (c) => {
  const plan = await loadPlan(c.env.DB);
  return c.html(<PrintPage plan={plan} generatedAt={formatDateTimeFr(new Date().toISOString())} />);
});

app.get('/cards', async (c) => {
  const plan = await loadPlan(c.env.DB);
  const format: CardFormat = c.req.query('format') === 'flat' ? 'flat' : 'tent';
  c.header('Content-Security-Policy', CARDS_CSP);
  return c.html(<CardsPage tables={plan.tables} format={format} />);
});

function answerLabel(g: GuestRow): string {
  return g.answer === 'oui' ? 'Oui' : 'Sans réponse';
}

app.get('/export.csv', async (c) => {
  const plan = await loadPlan(c.env.DB);
  const rows: unknown[][] = [['Table', 'Capacité', 'Places occupées', 'Invité', 'Côté', 'Personnes', 'Réponse']];
  for (const t of plan.tables) {
    for (const g of t.guests) rows.push([t.name, t.capacity, t.seats, g.name, SIDE_LABEL[g.side], seatsOf(g), answerLabel(g)]);
  }
  for (const g of plan.unplaced) rows.push(['Non placé', '', '', g.name, SIDE_LABEL[g.side], seatsOf(g), answerLabel(g)]);
  return c.body(toCsv(rows), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="plan-de-table-${todayMadagascar()}.csv"`,
  });
});

export default app;
