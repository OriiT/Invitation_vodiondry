// Réglages : messages WhatsApp, date limite des réponses, publication du plan de table, mot de passe.
// Monté sur /admin/settings (session + CSRF déjà vérifiés par src/routes/admin/index.tsx).

import { Hono, type Context } from 'hono';
import type { FC } from 'hono/jsx';
import type { AppEnv } from '../../env';
import { changeAdminPassword, MIN_PASSWORD, startSession, verifyAdminPassword, weakAdminPassword } from '../../lib/auth';
import { guestLink } from '../../lib/db';
import { clientIp, rateLimit, releaseHit } from '../../lib/ratelimit';
import {
  DEFAULT_SETTINGS,
  fillTemplate,
  formatDateFr,
  formatDateLongFr,
  getSettings,
  isRsvpOpen,
  isValidDate,
  setSettings,
  type Settings,
} from '../../lib/settings';
import { Csrf, Layout } from '../../views/layout';

type Ctx = Context<AppEnv>;
type Flash = { kind: 'ok' | 'err'; text: string } | null;

const app = new Hono<AppEnv>();

export const MAX_TEMPLATE = 1000;
export { MIN_PASSWORD };
export const MAX_PASSWORD = 200;
const PW_LIMIT = 10;
const PW_WINDOW = 15 * 60_000;

/** Exemple utilisé pour l'aperçu des messages. */
const EXAMPLE_NAME = 'Tante Lala';
const EXAMPLE_CODE = 'exemple1';

/** Requête SQL qui ramène au mot de passe du secret ADMIN_PASSWORD (mot de passe oublié). */
const RESET_PASSWORD_SQL = "DELETE FROM settings WHERE key = 'admin_password_hash';";

/** Même chose en ligne de commande (depuis le dossier du projet). */
const RESET_PASSWORD_COMMAND =
  `npx wrangler d1 execute vodiondry --remote --command "DELETE FROM settings WHERE key = 'admin_password_hash'"`;

const OK_MESSAGES: Record<string, string> = {
  saved: 'Réglages enregistrés.',
  reset: 'Les deux messages par défaut ont été rétablis.',
  password: 'Mot de passe changé. Tous les autres appareils ont été déconnectés.',
};

const TEMPLATE_KEYS = ['whatsapp_template', 'whatsapp_reminder_template'] as const;
type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Valeurs du formulaire des réglages (telles que saisies). */
interface FormValues {
  whatsapp_template: string;
  whatsapp_reminder_template: string;
  rsvp_deadline: string;
  publish_tables: boolean;
}

type FormErrors = Partial<Record<keyof FormValues, string>>;
type PasswordErrors = Partial<Record<'current_password' | 'new_password' | 'confirm_password', string>>;

function str(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === 'string' ? v : '';
}

function valuesFrom(s: Settings): FormValues {
  return {
    whatsapp_template: s.whatsapp_template,
    whatsapp_reminder_template: s.whatsapp_reminder_template,
    rsvp_deadline: s.rsvp_deadline,
    publish_tables: s.publish_tables === '1',
  };
}

function normalizeText(s: string): string {
  return s.replace(/\r\n?/g, '\n').trim();
}

function validateTemplate(text: string): string | undefined {
  if (!text) return 'Le message ne peut pas être vide.';
  if (text.length > MAX_TEMPLATE) return `Message trop long (${MAX_TEMPLATE} caractères maximum).`;
  if (!text.includes('{lien}')) return 'Le message doit contenir {lien} : c’est là que s’insère le lien personnel de l’invité.';
  const unknown = [...text.matchAll(/\{([^{}\s]{1,40})\}/g)].map((m) => m[1]).filter((k) => !['nom', 'lien', 'date_limite'].includes(k));
  if (unknown.length) {
    return `Variable inconnue : {${unknown[0]}}. Variables possibles : {nom}, {lien}, {date_limite}.`;
  }
  return undefined;
}

function validate(v: FormValues): FormErrors {
  const errors: FormErrors = {};
  for (const k of TEMPLATE_KEYS) {
    const e = validateTemplate(v[k]);
    if (e) errors[k] = e;
  }
  if (!isValidDate(v.rsvp_deadline)) errors.rsvp_deadline = 'Date invalide : choisissez un jour dans le calendrier (AAAA-MM-JJ).';
  return errors;
}

/** « samedi 12 décembre 2026 » */
function longDate(date: string): string {
  return `${formatDateLongFr(date)} ${date.slice(0, 4)}`;
}

/** Jour suivant (AAAA-MM-JJ). */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- affichage

const PREVIEW_STYLE =
  'white-space:pre-wrap;overflow-wrap:anywhere;background:#f3efe8;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:6px 0 0';

const FieldError: FC<{ text?: string }> = ({ text }) => (text ? <span class="field-error">{text}</span> : null);

const RsvpState: FC<{ settings: Settings }> = ({ settings }) => {
  const deadline = settings.rsvp_deadline;
  if (isRsvpOpen(settings)) {
    return (
      <p class="flash flash-ok" style="margin-bottom:14px">
        Les réponses sont ouvertes jusqu’au <strong>{longDate(deadline)}</strong> inclus (heure de Madagascar).
      </p>
    );
  }
  return (
    <p class="flash flash-err" style="margin-bottom:14px">
      Les réponses sont closes depuis le <strong>{longDate(nextDay(deadline))}</strong> (date limite : {longDate(deadline)}, heure
      de Madagascar). Les invités ne peuvent plus répondre ni changer leur réponse : choisissez une date plus tardive pour les
      rouvrir.
    </p>
  );
};

const TemplateField: FC<{
  name: TemplateKey;
  label: string;
  hint: string;
  value: string;
  error?: string;
  preview: string;
}> = ({ name, label, hint, value, error, preview }) => (
  <div class="field">
    <label class="label" for={`f-${name}`}>
      {label}
    </label>
    <textarea
      id={`f-${name}`}
      name={name}
      rows={5}
      maxlength={MAX_TEMPLATE}
      required
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={`h-${name}`}
    >
      {value}
    </textarea>
    <span class="hint" id={`h-${name}`}>
      {hint}
    </span>
    <FieldError text={error} />
    <div>
      <span class="label">Aperçu pour « {EXAMPLE_NAME} »</span>
      <p style={PREVIEW_STYLE}>{preview}</p>
    </div>
  </div>
);

interface PageProps {
  csrf: string;
  origin: string;
  settings: Settings;
  values: FormValues;
  errors?: FormErrors;
  pwErrors?: PasswordErrors;
  /** Message en haut de page. */
  flash?: Flash;
  /** Message affiché dans la carte « Mot de passe ». */
  pwFlash?: Flash;
  /** Mot de passe initial (secret ADMIN_PASSWORD) trop court : à changer. */
  weakPassword?: boolean;
}

const SettingsPage: FC<PageProps> = ({ csrf, origin, settings, values, errors = {}, pwErrors = {}, flash, pwFlash, weakPassword }) => {
  const exampleVars = {
    nom: EXAMPLE_NAME,
    lien: guestLink(origin, EXAMPLE_CODE),
    date_limite: isValidDate(values.rsvp_deadline) ? formatDateFr(values.rsvp_deadline) : formatDateFr(settings.rsvp_deadline),
  };
  const customPassword = Boolean(settings.admin_password_hash);
  return (
    <Layout title="Réglages" active="settings" csrf={csrf} flash={flash}>
      <div class="page-head">
        <h1>Réglages</h1>
      </div>

      <form method="post" action="/admin/settings" class="narrow">
        <Csrf token={csrf} />

        <section class="card" id="reponses">
          <h2>Réponses des invités</h2>
          <RsvpState settings={settings} />
          <div class="form">
            <label class="field">
              <span>Date limite pour répondre</span>
              <input
                type="date"
                name="rsvp_deadline"
                value={values.rsvp_deadline}
                required
                aria-invalid={errors.rsvp_deadline ? 'true' : undefined}
              />
              <span class="hint">
                Jour inclus, heure de Madagascar. Après cette date, les invités ne peuvent plus répondre ni modifier leur réponse.
                Elle remplace {'{date_limite}'} dans les messages.
              </span>
              <FieldError text={errors.rsvp_deadline} />
            </label>
            <label class="check">
              <input type="checkbox" name="publish_tables" value="1" checked={values.publish_tables} />
              <span>Publier le plan de table : après sa réponse, chaque invité voit « Votre table : … »</span>
            </label>
            <p class="hint" style="margin:-6px 0 0">
              Seuls les invités qui ont répondu « oui » et qui sont placés à une table la voient. Laissez décoché tant que le plan
              n’est pas définitif.
            </p>
          </div>
        </section>

        <section class="card" id="messages">
          <h2>Messages WhatsApp</h2>
          <p class="muted small">Variables remplacées automatiquement pour chaque invité :</p>
          <ul class="rules small">
            <li>
              <code>{'{nom}'}</code> : le nom de l’invité (ex. « {EXAMPLE_NAME} ») ;
            </li>
            <li>
              <code>{'{lien}'}</code> : son lien personnel d’invitation — <strong>obligatoire</strong> ;
            </li>
            <li>
              <code>{'{date_limite}'}</code> : la date limite pour répondre (ex. « {exampleVars.date_limite} »).
            </li>
          </ul>
          <div class="form">
            <TemplateField
              name="whatsapp_template"
              label="Message d’invitation"
              hint="Envoyé avec le lien personnel depuis la fiche de chaque invité."
              value={values.whatsapp_template}
              error={errors.whatsapp_template}
              preview={fillTemplate(values.whatsapp_template, exampleVars)}
            />
            <TemplateField
              name="whatsapp_reminder_template"
              label="Message de relance"
              hint="Proposé dans « Relances » pour les invités qui n’ont pas encore répondu."
              value={values.whatsapp_reminder_template}
              error={errors.whatsapp_reminder_template}
              preview={fillTemplate(values.whatsapp_reminder_template, exampleVars)}
            />
            <p class="hint" style="margin:0">
              L’aperçu montre les textes tels qu’ils sont affichés sur cette page ; enregistrez pour mettre à jour les liens WhatsApp.
            </p>
          </div>
        </section>

        <div class="card actions" style="justify-content:space-between">
          <button type="submit" class="btn btn-primary">
            Enregistrer les réglages
          </button>
          <button
            type="submit"
            name="reset_templates"
            value="1"
            class="btn btn-ghost"
            formnovalidate
            data-confirm="Rétablir les deux messages par défaut ? Vos textes actuels seront remplacés (la date limite et le plan de table ne changent pas)."
          >
            Rétablir les messages par défaut
          </button>
        </div>
      </form>

      <section class="card narrow" id="mot-de-passe">
        <h2>Mot de passe de l’administration</h2>
        {pwFlash ? (
          <p class={`flash flash-${pwFlash.kind}`} role={pwFlash.kind === 'err' ? 'alert' : 'status'}>
            {pwFlash.text}
          </p>
        ) : weakPassword ? (
          <p class="flash flash-err" role="alert">
            {`Le mot de passe actuel fait moins de ${MIN_PASSWORD} caractères : il est trop facile à deviner. Choisissez-en un plus long ci-dessous.`}
          </p>
        ) : null}
        <p class="muted small">
          {customPassword
            ? 'Mot de passe actuel : celui choisi sur cette page.'
            : 'Mot de passe actuel : celui du secret ADMIN_PASSWORD (configuré avec Wrangler).'}{' '}
          Le changer déconnecte tous les autres appareils ; vous restez connecté sur celui-ci.
        </p>
        <form method="post" action="/admin/settings/password#mot-de-passe" class="form">
          <Csrf token={csrf} />
          <label class="field">
            <span>Mot de passe actuel</span>
            <input
              type="password"
              name="current_password"
              required
              autocomplete="current-password"
              aria-invalid={pwErrors.current_password ? 'true' : undefined}
            />
            <FieldError text={pwErrors.current_password} />
          </label>
          <label class="field">
            <span>Nouveau mot de passe</span>
            <input
              type="password"
              name="new_password"
              required
              minlength={MIN_PASSWORD}
              maxlength={MAX_PASSWORD}
              autocomplete="new-password"
              aria-invalid={pwErrors.new_password ? 'true' : undefined}
            />
            <span class="hint">{MIN_PASSWORD} caractères minimum. Une phrase facile à retenir fait un très bon mot de passe.</span>
            <FieldError text={pwErrors.new_password} />
          </label>
          <label class="field">
            <span>Confirmation du nouveau mot de passe</span>
            <input
              type="password"
              name="confirm_password"
              required
              minlength={MIN_PASSWORD}
              maxlength={MAX_PASSWORD}
              autocomplete="new-password"
              aria-invalid={pwErrors.confirm_password ? 'true' : undefined}
            />
            <FieldError text={pwErrors.confirm_password} />
          </label>
          <div class="actions">
            <button type="submit" class="btn btn-primary">
              Changer le mot de passe
            </button>
          </div>
        </form>
        <div class="hint" style="margin-top:14px">
          <p style="margin:0 0 6px">
            <strong>Mot de passe oublié ?</strong> Dans le tableau de bord Cloudflare (depuis un téléphone ou un ordinateur) :
            <em>Storage &amp; Databases → D1 → vodiondry → Console</em>, exécutez la requête ci-dessous. Le mot de passe redevient
            celui du secret ADMIN_PASSWORD (secret GitHub si la mise en ligne est automatique).
          </p>
          <pre style="white-space:pre-wrap;overflow-wrap:anywhere;background:#f3efe8;border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:0 0 8px;font-size:0.82rem">
            <code>{RESET_PASSWORD_SQL}</code>
          </pre>
          <button type="button" class="btn btn-sm" data-copy={RESET_PASSWORD_SQL}>
            Copier la requête
          </button>
          <p style="margin:10px 0 6px">En ligne de commande, depuis le dossier du projet :</p>
          <pre style="white-space:pre-wrap;overflow-wrap:anywhere;background:#f3efe8;border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:0 0 8px;font-size:0.82rem">
            <code>{RESET_PASSWORD_COMMAND}</code>
          </pre>
        </div>
      </section>
    </Layout>
  );
};

async function render(c: Ctx, p: Partial<PageProps> & { status?: 200 | 400 | 429 } = {}) {
  const settings = p.settings ?? (await getSettings(c.env.DB));
  const ok = c.req.query('ok') ?? '';
  const okFlash: Flash = OK_MESSAGES[ok] ? { kind: 'ok', text: OK_MESSAGES[ok] } : null;
  // Le message « mot de passe changé » s'affiche dans la carte du mot de passe (la page y défile).
  const flash = p.flash ?? (ok === 'password' ? null : okFlash);
  const pwFlash = p.pwFlash ?? (ok === 'password' ? okFlash : null);
  return c.html(
    <SettingsPage
      csrf={c.get('csrf')}
      origin={new URL(c.req.url).origin}
      settings={settings}
      values={p.values ?? valuesFrom(settings)}
      errors={p.errors}
      pwErrors={p.pwErrors}
      flash={flash}
      pwFlash={pwFlash}
      weakPassword={weakAdminPassword(c.env, settings)}
    />,
    p.status ?? 200,
  );
}

// ---------------------------------------------------------------- routes

app.get('/', (c) => render(c));

app.post('/', async (c) => {
  const body = await c.req.parseBody();

  if (body.reset_templates !== undefined) {
    await setSettings(c.env.DB, {
      whatsapp_template: DEFAULT_SETTINGS.whatsapp_template,
      whatsapp_reminder_template: DEFAULT_SETTINGS.whatsapp_reminder_template,
    });
    return c.redirect('/admin/settings?ok=reset', 303);
  }

  const values: FormValues = {
    whatsapp_template: normalizeText(str(body, 'whatsapp_template')),
    whatsapp_reminder_template: normalizeText(str(body, 'whatsapp_reminder_template')),
    rsvp_deadline: str(body, 'rsvp_deadline').trim(),
    publish_tables: str(body, 'publish_tables') !== '',
  };
  const errors = validate(values);
  if (Object.keys(errors).length) {
    const n = Object.keys(errors).length;
    return render(c, {
      values,
      errors,
      status: 400,
      flash: { kind: 'err', text: n > 1 ? `${n} champs sont à corriger ci-dessous.` : 'Un champ est à corriger ci-dessous.' },
    });
  }
  await setSettings(c.env.DB, {
    whatsapp_template: values.whatsapp_template,
    whatsapp_reminder_template: values.whatsapp_reminder_template,
    rsvp_deadline: values.rsvp_deadline,
    publish_tables: values.publish_tables ? '1' : '0',
  });
  return c.redirect('/admin/settings?ok=saved', 303);
});

app.post('/password', async (c) => {
  const body = await c.req.parseBody();
  const current = str(body, 'current_password');
  const next = str(body, 'new_password');
  const confirm = str(body, 'confirm_password');
  const ipKey = `pwchange:${clientIp(c.req.raw)}`;

  // Tentative comptée avant la vérification (requêtes simultanées), rendue si le mot de passe actuel est bon.
  const at = Date.now();
  if (!rateLimit(ipKey, PW_LIMIT, PW_WINDOW, at)) {
    return render(c, {
      status: 429,
      pwFlash: { kind: 'err', text: 'Trop de tentatives avec un mauvais mot de passe. Réessayez dans 15 minutes.' },
    });
  }

  const errors: PasswordErrors = {};
  if (!current) {
    releaseHit(ipKey, at);
    errors.current_password = 'Saisissez le mot de passe actuel.';
  } else if (!(await verifyAdminPassword(c.env, current))) {
    errors.current_password = 'Mot de passe actuel incorrect.';
  } else releaseHit(ipKey, at);
  if (next.length < MIN_PASSWORD) errors.new_password = `Le nouveau mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`;
  else if (next.length > MAX_PASSWORD) errors.new_password = `Le nouveau mot de passe est trop long (${MAX_PASSWORD} caractères maximum).`;
  else if (!next.trim()) errors.new_password = 'Le nouveau mot de passe ne peut pas être composé uniquement d’espaces.';
  else if (next === current && !errors.current_password) errors.new_password = 'Le nouveau mot de passe doit être différent de l’actuel.';
  if (!errors.new_password && confirm !== next) errors.confirm_password = 'La confirmation ne correspond pas au nouveau mot de passe.';

  if (Object.keys(errors).length) {
    return render(c, {
      pwErrors: errors,
      status: 400,
      pwFlash: { kind: 'err', text: 'Mot de passe non changé : corrigez les champs indiqués.' },
    });
  }

  const epoch = await changeAdminPassword(c.env, next);
  // Nouvelle session pour cet appareil ; toutes les autres (ancienne époque) sont refusées.
  await startSession(c, epoch);
  return c.redirect('/admin/settings?ok=password#mot-de-passe', 303);
});

export default app;
