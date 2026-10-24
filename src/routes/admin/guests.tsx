// Administration des invités : tableau de bord, ajout / modification / suppression, lien personnel,
// saisie de réponse, import / export, relances. Monté sur /admin (session + CSRF déjà vérifiés).

import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { weakAdminPassword } from '../../lib/auth';
import {
  computeTotals,
  createGuest,
  deleteGuest,
  findGuestByName,
  getGuest,
  guestLink,
  listGuests,
  recordResponse,
  regenerateCode,
  SIDE_LABEL,
  SIDES,
  updateGuest,
  waLink,
  type GuestInput,
  type GuestRow,
  type Side,
} from '../../lib/db';
import { fold, parseGuestFile, toCsv, type ImportParse } from '../../lib/import';
import { importRows } from '../../lib/import-db';
import {
  fillTemplate,
  formatDateFr,
  formatDateTimeFr,
  getSettings,
  isRsvpOpen,
  todayMadagascar,
  type Settings,
} from '../../lib/settings';
import { isXlsx } from '../../lib/xlsx';
import { DashboardPage, STATUS_FILTERS, type DashboardFilters, type StatusFilter } from '../../views/guests-dashboard';
import {
  EditGuestPage,
  MAX_EXPECTED,
  MAX_NAME,
  MAX_NOTES,
  MAX_PHONE,
  NewGuestPage,
  type GuestFormErrors,
  type GuestFormValues,
  type OpenRow,
  type ResponseFormErrors,
  type ResponseFormValues,
  type ResponseHistoryRow,
} from '../../views/guests-edit';
import { ImportPage, ImportResultPage, MAX_IMPORT_BYTES } from '../../views/guests-import';
import { RelancesPage } from '../../views/guests-relances';
import { NotFoundPage, plural } from '../../views/guests-ui';
import { MAX_COUNT, MAX_MESSAGE } from '../api';

const app = new Hono<AppEnv>();

type Ctx = Context<AppEnv>;
type Flash = { kind: 'ok' | 'err'; text: string } | null;
type FormBody = Record<string, string | File>;

/** Messages affichés après une redirection (?ok=…). */
const OK_MESSAGES = new Map<string, string>([
  ['created', 'Invité ajouté. Vous pouvez maintenant lui envoyer son lien personnel.'],
  ['updated', 'Modifications enregistrées.'],
  ['deleted', 'Invité supprimé.'],
  ['regenerated', 'Nouveau lien créé : l’ancien ne fonctionne plus. Pensez à envoyer le nouveau lien à l’invité.'],
  ['response', 'Réponse enregistrée.'],
]);

function okFlash(c: Ctx): Flash {
  const text = OK_MESSAGES.get(c.req.query('ok') ?? '');
  return text ? { kind: 'ok', text } : null;
}

function str(body: FormBody, key: string): string {
  const v = body[key];
  return typeof v === 'string' ? v : '';
}

function parseId(s: string | undefined): number | null {
  return s && /^[1-9]\d{0,9}$/.test(s) ? Number(s) : null;
}

function parseSide(s: string | undefined): Side | '' {
  return SIDES.includes(s as Side) ? (s as Side) : '';
}

function origin(c: Ctx): string {
  return new URL(c.req.url).origin;
}

/** Message WhatsApp (modèle d'invitation ou de relance) rempli pour un invité. */
function messageFor(template: string, g: Pick<GuestRow, 'name'>, link: string, settings: Settings): string {
  return fillTemplate(template, { nom: g.name, lien: link, date_limite: formatDateFr(settings.rsvp_deadline) });
}

function notFound(c: Ctx) {
  return c.html(<NotFoundPage csrf={c.get('csrf')} />, 404);
}

/** Message d'erreur global : l'erreur elle-même s'il n'y en a qu'une, sinon un résumé. */
function errorFlash(errors: Record<string, unknown>): Flash {
  const msgs = Object.entries(errors)
    .filter(([k, v]) => k !== 'duplicateId' && typeof v === 'string')
    .map(([, v]) => v as string);
  return {
    kind: 'err',
    text: msgs.length === 1 ? msgs[0] : 'Le formulaire contient des erreurs : vérifiez les champs signalés.',
  };
}

// ---------------------------------------------------------------- validation

function readGuestForm(body: FormBody): GuestFormValues {
  return {
    name: str(body, 'name'),
    side: str(body, 'side'),
    expected_count: str(body, 'expected_count'),
    phone: str(body, 'phone'),
    notes: str(body, 'notes'),
  };
}

async function validateGuest(
  db: D1Database,
  v: GuestFormValues,
  selfId?: number,
): Promise<{ input: GuestInput | null; errors: GuestFormErrors }> {
  const errors: GuestFormErrors = {};
  const name = v.name.replace(/\s+/g, ' ').trim();
  if (!name) errors.name = 'Indiquez le nom de l’invité.';
  else if (name.length > MAX_NAME) errors.name = `Nom trop long (${MAX_NAME} caractères maximum).`;

  const side = parseSide(v.side);
  if (!side) errors.side = 'Choisissez le côté : Rojo ou Orimbato.';

  let count = 1;
  const rawCount = v.expected_count.trim();
  if (rawCount !== '') {
    if (!/^\d{1,3}$/.test(rawCount) || Number(rawCount) > MAX_EXPECTED) {
      errors.expected_count = `Nombre de personnes invalide (nombre entier de 0 à ${MAX_EXPECTED}).`;
    } else count = Number(rawCount);
  }

  const phone = v.phone.replace(/\s+/g, ' ').trim();
  if (phone.length > MAX_PHONE) errors.phone = `Numéro trop long (${MAX_PHONE} caractères maximum).`;

  const notes = v.notes.replace(/\r\n?/g, '\n').trim();
  if (notes.length > MAX_NOTES) errors.notes = `Notes trop longues (${MAX_NOTES} caractères maximum).`;

  if (!errors.name) {
    const dup = await findGuestByName(db, name);
    if (dup && dup.id !== selfId) {
      errors.name = `Un invité nommé « ${name} » existe déjà.`;
      errors.duplicateId = dup.id;
    }
  }
  if (Object.keys(errors).length || !side) return { input: null, errors };
  return { input: { name, side, expected_count: count, phone: phone || null, notes }, errors };
}

function validateResponse(v: ResponseFormValues): {
  value: { answer: 'oui' | 'non'; count: number; message: string } | null;
  errors: ResponseFormErrors;
} {
  const errors: ResponseFormErrors = {};
  const answer = v.answer === 'oui' || v.answer === 'non' ? v.answer : null;
  if (!answer) errors.answer = 'Choisissez « Oui » ou « Non ».';
  let count = 0;
  if (answer === 'oui') {
    const raw = v.count.trim();
    count = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
    if (!(count >= 1 && count <= MAX_COUNT)) errors.count = `Nombre de personnes invalide (entre 1 et ${MAX_COUNT}).`;
  }
  const message = v.message.replace(/\r\n?/g, '\n').trim();
  if (message.length > MAX_MESSAGE) errors.message = `Message trop long (${MAX_MESSAGE} caractères maximum).`;
  if (Object.keys(errors).length || !answer) return { value: null, errors };
  return { value: { answer, count, message }, errors };
}

// ---------------------------------------------------------------- tableau de bord

function readFilters(c: Ctx): DashboardFilters {
  const status = c.req.query('status') ?? '';
  return {
    side: parseSide(c.req.query('side')),
    status: STATUS_FILTERS.some((s) => s.value === status) ? (status as StatusFilter) : '',
    q: (c.req.query('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 100),
  };
}

function matches(g: GuestRow, f: DashboardFilters, foldedQ: string): boolean {
  if (f.side && g.side !== f.side) return false;
  switch (f.status) {
    case 'oui':
    case 'non':
      if (g.answer !== f.status) return false;
      break;
    case 'none':
      if (g.answer !== null) return false;
      break;
    case 'unopened':
      if (g.open_count > 0) return false;
      break;
    case 'opened':
      if (g.open_count === 0 || g.answer !== null) return false;
      break;
  }
  return !foldedQ || fold(g.name).includes(foldedQ);
}

app.get('/', async (c) => {
  const [all, settings] = await Promise.all([listGuests(c.env.DB), getSettings(c.env.DB)]);
  const filters = readFilters(c);
  const foldedQ = fold(filters.q);
  const base = origin(c);
  const rows = all
    .filter((g) => matches(g, filters, foldedQ))
    .map((g) => {
      const link = guestLink(base, g.code);
      return { g, link, wa: waLink(messageFor(settings.whatsapp_template, g, link, settings), g.phone) };
    });
  return c.html(
    <DashboardPage
      csrf={c.get('csrf')}
      flash={okFlash(c)}
      totals={computeTotals(all)}
      rows={rows}
      filters={filters}
      filtered={Boolean(filters.side || filters.status || filters.q)}
      weakPassword={weakAdminPassword(c.env, settings)}
    />,
  );
});

// ---------------------------------------------------------------- ajout

app.get('/guests', (c) => c.redirect('/admin', 302));

app.get('/guests/new', (c) => {
  const v: GuestFormValues = { name: '', side: parseSide(c.req.query('side')) || 'rojo', expected_count: '1', phone: '', notes: '' };
  return c.html(<NewGuestPage csrf={c.get('csrf')} v={v} e={{}} />);
});

app.post('/guests', async (c) => {
  const v = readGuestForm(await c.req.parseBody());
  const { input, errors } = await validateGuest(c.env.DB, v);
  if (!input) {
    return c.html(<NewGuestPage csrf={c.get('csrf')} v={v} e={errors} flash={errorFlash({ ...errors })} />, 400);
  }
  const g = await createGuest(c.env.DB, input);
  return c.redirect(`/admin/guests/${g.id}/edit?ok=created`, 303);
});

// ---------------------------------------------------------------- fiche

interface EditOptions {
  v?: GuestFormValues;
  e?: GuestFormErrors;
  rv?: ResponseFormValues;
  re?: ResponseFormErrors;
  flash?: Flash;
  status?: 200 | 400;
}

function guestValues(g: GuestRow): GuestFormValues {
  return { name: g.name, side: g.side, expected_count: String(g.expected_count), phone: g.phone ?? '', notes: g.notes };
}

function responseValues(g: GuestRow): ResponseFormValues {
  const count = g.answer === 'oui' && g.confirmed_count ? g.confirmed_count : Math.min(Math.max(g.expected_count, 1), MAX_COUNT);
  return { answer: g.answer ?? '', count: String(count), message: g.answer ? (g.message ?? '') : '' };
}

/** Réponses affichées dans l'historique de la fiche (les plus récentes). */
const HISTORY_LIMIT = 50;

async function renderEdit(c: Ctx, g: GuestRow, o: EditOptions = {}) {
  const db = c.env.DB;
  const [settings, history, opens] = await Promise.all([
    getSettings(db),
    db
      .prepare(`SELECT id, answer, count, message, answered_at FROM responses WHERE guest_id = ?1 ORDER BY id DESC LIMIT ${HISTORY_LIMIT}`)
      .bind(g.id)
      .all<ResponseHistoryRow>(),
    db.prepare('SELECT opened_at, ua FROM opens WHERE guest_id = ?1 ORDER BY id DESC LIMIT 20').bind(g.id).all<OpenRow>(),
  ]);
  const link = guestLink(origin(c), g.code);
  // « Réponse enregistrée » s'affiche dans la carte de la réponse, où la page défile (#reponse).
  const responseSaved = !o.flash && c.req.query('ok') === 'response';
  return c.html(
    <EditGuestPage
      csrf={c.get('csrf')}
      flash={o.flash ?? (responseSaved ? null : okFlash(c))}
      responseFlash={responseSaved ? okFlash(c) : null}
      g={g}
      link={link}
      wa={waLink(messageFor(settings.whatsapp_template, g, link, settings), g.phone)}
      v={o.v ?? guestValues(g)}
      e={o.e ?? {}}
      rv={o.rv ?? responseValues(g)}
      re={o.re ?? {}}
      history={history.results}
      opens={opens.results}
      rsvpOpen={isRsvpOpen(settings)}
    />,
    o.status ?? 200,
  );
}

async function loadGuest(c: Ctx): Promise<GuestRow | null> {
  const id = parseId(c.req.param('id'));
  return id ? getGuest(c.env.DB, id) : null;
}

app.get('/guests/:id/edit', async (c) => {
  const g = await loadGuest(c);
  return g ? renderEdit(c, g) : notFound(c);
});

app.get('/guests/:id', async (c) => {
  const g = await loadGuest(c);
  return g ? c.redirect(`/admin/guests/${g.id}/edit`, 302) : notFound(c);
});

app.post('/guests/:id', async (c) => {
  const g = await loadGuest(c);
  if (!g) return notFound(c);
  const v = readGuestForm(await c.req.parseBody());
  const { input, errors } = await validateGuest(c.env.DB, v, g.id);
  if (!input) return renderEdit(c, g, { v, e: errors, flash: errorFlash({ ...errors }), status: 400 });
  await updateGuest(c.env.DB, g.id, input);
  return c.redirect(`/admin/guests/${g.id}/edit?ok=updated`, 303);
});

app.post('/guests/:id/delete', async (c) => {
  const g = await loadGuest(c);
  if (!g) return notFound(c);
  await deleteGuest(c.env.DB, g.id);
  return c.redirect('/admin?ok=deleted', 303);
});

app.post('/guests/:id/regenerate', async (c) => {
  const g = await loadGuest(c);
  if (!g) return notFound(c);
  await regenerateCode(c.env.DB, g.id);
  return c.redirect(`/admin/guests/${g.id}/edit?ok=regenerated`, 303);
});

// Réponse saisie par les mariés (ex. invité qui a répondu par téléphone) : possible même après la date limite.
app.post('/guests/:id/response', async (c) => {
  const g = await loadGuest(c);
  if (!g) return notFound(c);
  const body = await c.req.parseBody();
  const rv: ResponseFormValues = { answer: str(body, 'answer'), count: str(body, 'count'), message: str(body, 'message') };
  const { value, errors } = validateResponse(rv);
  if (!value) return renderEdit(c, g, { rv, re: errors, flash: errorFlash({ ...errors }), status: 400 });
  await recordResponse(c.env.DB, g.id, value);
  return c.redirect(`/admin/guests/${g.id}/edit?ok=response#reponse`, 303);
});

// ---------------------------------------------------------------- import

async function guestCount(db: D1Database): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS n FROM guests').first<{ n: number }>())?.n ?? 0;
}

async function importError(c: Ctx, text: string) {
  return c.html(
    <ImportPage csrf={c.get('csrf')} flash={{ kind: 'err', text }} guestCount={await guestCount(c.env.DB)} />,
    400,
  );
}

app.get('/import', async (c) =>
  c.html(<ImportPage csrf={c.get('csrf')} flash={okFlash(c)} guestCount={await guestCount(c.env.DB)} />),
);

app.post('/import', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File) || file.size === 0) {
    return importError(c, 'Choisissez un fichier .xlsx ou .csv à importer.');
  }
  if (file.size > MAX_IMPORT_BYTES) return importError(c, 'Fichier trop volumineux (2 Mo maximum).');
  const data = new Uint8Array(await file.arrayBuffer());
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
  if (!isXlsx(data)) {
    if (ext === 'xls') {
      return importError(c, 'Ancien format Excel (.xls) non pris en charge : enregistrez le fichier au format .xlsx ou .csv.');
    }
    if (ext === 'xlsx') return importError(c, 'Fichier .xlsx illisible ou endommagé.');
    if ((ext && ext !== 'csv' && ext !== 'txt') || data.includes(0)) {
      return importError(c, 'Format non reconnu : choisissez un fichier .xlsx ou .csv.');
    }
  }
  let parsed: ImportParse & { sheet?: string };
  try {
    parsed = parseGuestFile(data);
  } catch (e) {
    return importError(c, `Fichier illisible${e instanceof Error && e.message ? ` : ${e.message}` : '.'}`);
  }
  if (!parsed.rows.length) {
    return importError(
      c,
      'Aucun invité trouvé dans ce fichier. Vérifiez qu’il s’agit de la feuille « Invités » (colonnes A à D) ou d’un export CSV.',
    );
  }
  let out: Awaited<ReturnType<typeof importRows>>;
  try {
    out = await importRows(c.env.DB, parsed.rows);
  } catch (e) {
    console.error(e);
    return importError(
      c,
      'L’import a été interrompu par une erreur de la base de données. Relancez-le : les invités déjà ajoutés ne seront pas ajoutés une deuxième fois.',
    );
  }
  const text = out.added.length
    ? `Import terminé : ${plural(out.added.length, 'invité ajouté', 'invités ajoutés')}.`
    : 'Import terminé : aucun nouvel invité, tous les noms étaient déjà dans la liste.';
  return c.html(
    <ImportResultPage
      csrf={c.get('csrf')}
      flash={{ kind: 'ok', text }}
      fileName={file.name || 'fichier'}
      format={parsed.format}
      sheet={parsed.sheet}
      added={out.added}
      skipped={out.skipped}
      restored={out.restored}
      ignored={parsed.ignored}
      warnings={parsed.warnings}
    />,
  );
});

// ---------------------------------------------------------------- export

export const EXPORT_HEADER = [
  'Nom',
  'Côté',
  'Nombre prévu',
  'Téléphone',
  'Notes',
  'Lien',
  'Code',
  'Lien ouvert',
  'Première ouverture',
  'Dernière ouverture',
  "Nombre d'ouvertures",
  'Réponse',
  'Nombre confirmé',
  'Message',
  'Date de réponse',
  'Table',
];

app.get('/export.csv', async (c) => {
  const guests = await listGuests(c.env.DB);
  const base = origin(c);
  const rows = guests.map((g) => [
    g.name,
    SIDE_LABEL[g.side],
    g.expected_count,
    g.phone ?? '',
    g.notes,
    guestLink(base, g.code),
    g.code,
    g.open_count > 0 ? 'Oui' : 'Non',
    formatDateTimeFr(g.first_opened_at),
    formatDateTimeFr(g.last_opened_at),
    g.open_count,
    g.answer === 'oui' ? 'Oui' : g.answer === 'non' ? 'Non' : '',
    g.answer === 'oui' ? (g.confirmed_count ?? 0) : g.answer === 'non' ? 0 : '',
    g.message ?? '',
    formatDateTimeFr(g.answered_at),
    g.table_name ?? '',
  ]);
  return c.body(toCsv([EXPORT_HEADER, ...rows]), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="invites-vodiondry-${todayMadagascar()}.csv"`,
  });
});

// ---------------------------------------------------------------- relances

app.get('/relances', async (c) => {
  const [all, settings] = await Promise.all([listGuests(c.env.DB), getSettings(c.env.DB)]);
  const side = parseSide(c.req.query('side'));
  const pending = all.filter((g) => g.answer === null);
  const base = origin(c);
  const rows = pending
    .filter((g) => !side || g.side === side)
    .sort(
      (a, b) =>
        Number(a.open_count > 0) - Number(b.open_count > 0) ||
        a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }) ||
        a.id - b.id,
    )
    .map((g) => {
      const link = guestLink(base, g.code);
      const text = messageFor(settings.whatsapp_reminder_template, g, link, settings);
      return { g, link, text, wa: waLink(text, g.phone) };
    });
  return c.html(
    <RelancesPage
      csrf={c.get('csrf')}
      rows={rows}
      pending={pending.length}
      totalGuests={all.length}
      side={side}
      deadline={settings.rsvp_deadline}
      rsvpOpen={isRsvpOpen(settings)}
    />,
  );
});

export default app;
