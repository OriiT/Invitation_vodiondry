// Administration : budget du mariage (/admin/budget).
//   GET  /             page : trois scénarios, personnes hors liste, postes par personne et forfaits
//   POST /             ajouter un frais
//   GET  /:id/edit     modifier un frais (formulaire)
//   POST /:id          enregistrer un frais
//   POST /:id/delete   supprimer un frais
//   POST /personnes    personnes hors liste d'invités (réglage budget_extra_people)
//   GET  /export.csv   export CSV
// Session et jeton CSRF sont vérifiés en amont (routes/admin/index.tsx).

import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import {
  BUDGET_KINDS,
  computeBudget,
  createBudgetItem,
  deleteBudgetItem,
  DETAIL_MAX,
  EXTRA_PEOPLE_MAX,
  extraPeopleOf,
  getBudgetItem,
  groupDigits,
  itemTotal,
  KIND_LABEL,
  LABEL_MAX,
  listBudgetItems,
  parseAmount,
  peopleCounts,
  SCENARIOS,
  updateBudgetItem,
  type BudgetInput,
  type BudgetItem,
  type BudgetKind,
} from '../../lib/budget';
import { listGuests } from '../../lib/db';
import { toCsv } from '../../lib/import';
import { getSettings, setSettings, todayMadagascar } from '../../lib/settings';
import { BudgetEditPage, BudgetPage, EMPTY_BUDGET_FORM, type BudgetFormErrors, type BudgetFormValues } from '../../views/budget';
import { NotFoundPage } from '../../views/guests-ui';

const app = new Hono<AppEnv>();
type Ctx = Context<AppEnv>;
type Flash = { kind: 'ok' | 'err'; text: string } | null;
type FormBody = Record<string, string | File>;

const OK_MESSAGES: Record<string, string> = {
  created: 'Frais ajouté.',
  updated: 'Frais enregistré.',
  deleted: 'Frais supprimé.',
  personnes: 'Nombre de personnes hors liste enregistré.',
};

function str(body: FormBody, key: string): string {
  const v = body[key];
  return typeof v === 'string' ? v : '';
}

function parseId(s: string | undefined): number | null {
  return s && /^[1-9]\d{0,9}$/.test(s) ? Number(s) : null;
}

function notFound(c: Ctx) {
  return c.html(
    <NotFoundPage
      csrf={c.get('csrf')}
      title="Frais introuvable"
      active="budget"
      text="Ce frais n’existe pas ou a été supprimé."
      backHref="/admin/budget"
      backLabel="Retour au budget"
    />,
    404,
  );
}

/** Message d'erreur global : l'erreur elle-même s'il n'y en a qu'une, sinon un résumé. */
function errorFlash(errors: BudgetFormErrors): Flash {
  const msgs = Object.values(errors).filter((v): v is string => typeof v === 'string');
  return { kind: 'err', text: msgs.length === 1 ? msgs[0] : 'Le formulaire contient des erreurs : vérifiez les champs signalés.' };
}

// ---------------------------------------------------------------- validation

function readBudgetForm(body: FormBody): BudgetFormValues {
  return { label: str(body, 'label'), detail: str(body, 'detail'), kind: str(body, 'kind'), amount: str(body, 'amount') };
}

function validateBudget(v: BudgetFormValues): { input: BudgetInput | null; errors: BudgetFormErrors } {
  const errors: BudgetFormErrors = {};
  const label = v.label.replace(/\s+/g, ' ').trim();
  if (!label) errors.label = 'Indiquez le nom du poste (ex. Photographe).';
  else if ([...label].length > LABEL_MAX) errors.label = `Nom du poste trop long (${LABEL_MAX} caractères maximum).`;

  const detail = v.detail.replace(/\s+/g, ' ').trim();
  if ([...detail].length > DETAIL_MAX) errors.detail = `Détail trop long (${DETAIL_MAX} caractères maximum).`;

  const kind = BUDGET_KINDS.includes(v.kind as BudgetKind) ? (v.kind as BudgetKind) : null;
  if (!kind) errors.kind = 'Choisissez le type : forfait (montant fixe) ou par personne.';

  const amount = parseAmount(v.amount);
  if (!v.amount.trim()) errors.amount = 'Indiquez le montant en Ariary (0 si le poste est compris ailleurs).';
  else if (amount === null) {
    errors.amount = 'Montant invalide : indiquez un nombre entier d’Ariary, sans virgule ni signe moins (ex. 400\u00a0000).';
  }

  if (Object.keys(errors).length || !kind || amount === null) return { input: null, errors };
  return { input: { label, detail, kind, amount }, errors };
}

function itemValues(item: BudgetItem): BudgetFormValues {
  return { label: item.label, detail: item.detail, kind: item.kind, amount: groupDigits(item.amount, ' ') };
}

// ---------------------------------------------------------------- données de la page

async function loadBudget(db: D1Database) {
  const [items, guests, settings] = await Promise.all([listBudgetItems(db), listGuests(db), getSettings(db)]);
  const extra = extraPeopleOf(settings.budget_extra_people);
  const people = peopleCounts(guests, extra);
  return { items, people, totals: computeBudget(items, people), extra };
}

interface RenderOptions {
  status?: 200 | 400;
  flash?: Flash;
  v?: BudgetFormValues;
  e?: BudgetFormErrors;
  extraValue?: string;
  extraError?: string;
}

async function renderPage(c: Ctx, o: RenderOptions = {}) {
  const { items, people, totals, extra } = await loadBudget(c.env.DB);
  let flash = o.flash ?? null;
  if (!flash && !o.status) {
    const ok = c.req.query('ok');
    if (ok && OK_MESSAGES[ok]) flash = { kind: 'ok', text: OK_MESSAGES[ok] };
  }
  return c.html(
    <BudgetPage
      csrf={c.get('csrf')}
      flash={flash}
      items={items}
      people={people}
      totals={totals}
      v={o.v ?? EMPTY_BUDGET_FORM}
      e={o.e ?? {}}
      extraValue={o.extraValue ?? String(extra)}
      extraError={o.extraError}
    />,
    o.status ?? 200,
  );
}

// ---------------------------------------------------------------- page, ajout

app.get('/', (c) => renderPage(c));

app.post('/', async (c) => {
  const v = readBudgetForm(await c.req.parseBody());
  const { input, errors } = validateBudget(v);
  if (!input) return renderPage(c, { status: 400, flash: errorFlash(errors), v, e: errors });
  const item = await createBudgetItem(c.env.DB, input);
  return c.redirect(`/admin/budget?ok=created#frais-${item.id}`, 303);
});

// ---------------------------------------------------------------- personnes hors liste

app.post('/personnes', async (c) => {
  const raw = str(await c.req.parseBody(), 'extra_people').trim();
  if (!/^\d{1,3}$/.test(raw) || Number(raw) > EXTRA_PEOPLE_MAX) {
    const extraError = `Nombre de personnes invalide (nombre entier de 0 à ${EXTRA_PEOPLE_MAX}).`;
    return renderPage(c, { status: 400, flash: { kind: 'err', text: extraError }, extraValue: raw, extraError });
  }
  await setSettings(c.env.DB, { budget_extra_people: String(Number(raw)) });
  return c.redirect('/admin/budget?ok=personnes', 303);
});

// ---------------------------------------------------------------- modification, suppression

async function loadItem(c: Ctx): Promise<BudgetItem | null> {
  const id = parseId(c.req.param('id'));
  return id ? getBudgetItem(c.env.DB, id) : null;
}

app.get('/:id{[0-9]+}/edit', async (c) => {
  const item = await loadItem(c);
  if (!item) return notFound(c);
  return c.html(<BudgetEditPage csrf={c.get('csrf')} item={item} v={itemValues(item)} e={{}} />);
});

app.get('/:id{[0-9]+}', async (c) => {
  const item = await loadItem(c);
  return item ? c.redirect(`/admin/budget/${item.id}/edit`, 302) : notFound(c);
});

app.post('/:id{[0-9]+}', async (c) => {
  const item = await loadItem(c);
  if (!item) return notFound(c);
  const v = readBudgetForm(await c.req.parseBody());
  const { input, errors } = validateBudget(v);
  if (!input) {
    return c.html(<BudgetEditPage csrf={c.get('csrf')} flash={errorFlash(errors)} item={item} v={v} e={errors} />, 400);
  }
  await updateBudgetItem(c.env.DB, item.id, input);
  return c.redirect(`/admin/budget?ok=updated#frais-${item.id}`, 303);
});

app.post('/:id{[0-9]+}/delete', async (c) => {
  const item = await loadItem(c);
  if (!item) return notFound(c);
  await deleteBudgetItem(c.env.DB, item.id);
  return c.redirect(`/admin/budget?ok=deleted#${item.kind === 'forfait' ? 'forfaits' : 'par-personne'}`, 303);
});

// ---------------------------------------------------------------- export

export const BUDGET_EXPORT_HEADER = ['Poste', 'Détail', 'Type', 'Montant', 'Total prévu', 'Total estimation', 'Total confirmé'];

app.get('/export.csv', async (c) => {
  const { items, people, totals } = await loadBudget(c.env.DB);
  const sc = totals.scenarios;
  const ordered = [...items.filter((it) => it.kind === 'par_personne'), ...items.filter((it) => it.kind === 'forfait')];
  const rows: unknown[][] = [BUDGET_EXPORT_HEADER];
  for (const it of ordered) {
    rows.push([it.label, it.detail, KIND_LABEL[it.kind], it.amount, ...SCENARIOS.map((k) => itemTotal(it, sc[k].people))]);
  }
  rows.push([]);
  rows.push(['Sous-total par personne', '', 'Par personne', totals.perPerson, ...SCENARIOS.map((k) => totals.perPerson * sc[k].people)]);
  rows.push(['Sous-total forfaits', '', 'Forfait', totals.forfaits, ...SCENARIOS.map(() => totals.forfaits)]);
  rows.push(['Nombre de personnes', 'dont hors liste d’invités : ' + people.extra, '', '', ...SCENARIOS.map((k) => sc[k].people)]);
  rows.push(['Total', 'forfaits + par personne × nombre de personnes', '', '', ...SCENARIOS.map((k) => sc[k].total)]);
  rows.push(['Coût par personne', 'total ÷ nombre de personnes, arrondi', '', '', ...SCENARIOS.map((k) => sc[k].perGuest)]);
  return c.body(toCsv(rows), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="budget-vodiondry-${todayMadagascar()}.csv"`,
  });
});

export default app;
