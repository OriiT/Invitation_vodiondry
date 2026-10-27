// Fiche invité : ajout, modification, lien personnel, saisie de réponse, historique, ouvertures.

import type { FC } from 'hono/jsx';
import { SIDE_LABEL, SIDES, type GuestRow } from '../lib/db';
import { formatDateTimeFr } from '../lib/settings';
import { AnswerBadge, confirmedText, OpenedInfo, plural, shortUa, SideBadge } from './guests-ui';
import { Csrf, Layout } from './layout';

export const MAX_NAME = 100;
export const MAX_PHONE = 30;
export const MAX_NOTES = 500;
export const MAX_EXPECTED = 50;

/** Valeurs du formulaire telles que saisies (réaffichées en cas d'erreur). */
export interface GuestFormValues {
  name: string;
  side: string;
  expected_count: string;
  phone: string;
  notes: string;
}

export interface GuestFormErrors {
  name?: string;
  side?: string;
  expected_count?: string;
  phone?: string;
  notes?: string;
  /** Fiche de l'invité portant déjà ce nom (lien « Voir sa fiche »). */
  duplicateId?: number;
}

export interface ResponseFormValues {
  answer: string;
  count: string;
  message: string;
}

export type ResponseFormErrors = Partial<Record<keyof ResponseFormValues, string>>;

export interface ResponseHistoryRow {
  id: number;
  answer: 'oui' | 'non';
  count: number;
  message: string;
  answered_at: string;
}

export interface OpenRow {
  opened_at: string;
  ua: string;
}

type Flash = { kind: 'ok' | 'err'; text: string } | null | undefined;

const FieldError: FC<{ text?: string }> = ({ text }) => (text ? <span class="field-error">{text}</span> : null);

const GuestFields: FC<{ v: GuestFormValues; e: GuestFormErrors }> = ({ v, e }) => (
  <>
    <label class="field">
      <span>Nom</span>
      <input
        type="text"
        name="name"
        value={v.name}
        required
        maxlength={MAX_NAME}
        autocomplete="off"
        placeholder="Ex. Famille Rabe"
        aria-invalid={e.name ? 'true' : undefined}
      />
      {e.name ? (
        <span class="field-error">
          {e.name}
          {e.duplicateId ? (
            <>
              {' '}
              <a href={`/admin/guests/${e.duplicateId}/edit`}>Voir sa fiche</a>
            </>
          ) : null}
        </span>
      ) : null}
    </label>
    <div class="row">
      <label class="field grow">
        <span>Côté</span>
        <select name="side" required aria-invalid={e.side ? 'true' : undefined}>
          {SIDES.map((s) => (
            <option value={s} selected={v.side === s}>
              {SIDE_LABEL[s]}
            </option>
          ))}
        </select>
        <FieldError text={e.side} />
      </label>
      <label class="field grow">
        <span>Nombre de personnes prévues</span>
        <input
          type="number"
          name="expected_count"
          value={v.expected_count}
          min={0}
          max={MAX_EXPECTED}
          step={1}
          inputmode="numeric"
          required
          aria-invalid={e.expected_count ? 'true' : undefined}
        />
        <FieldError text={e.expected_count} />
      </label>
    </div>
    <label class="field">
      <span>Téléphone (WhatsApp)</span>
      <input
        type="tel"
        name="phone"
        value={v.phone}
        maxlength={MAX_PHONE}
        autocomplete="off"
        placeholder="Ex. 034 00 000 00"
        aria-invalid={e.phone ? 'true' : undefined}
      />
      <FieldError text={e.phone} />
      <span class="hint">
        Facultatif. Les numéros malgaches (03x…) sont reconnus ; pour l’étranger, indiquez l’indicatif (+33…).
      </span>
    </label>
    <label class="field">
      <span>Notes</span>
      <textarea name="notes" maxlength={MAX_NOTES} rows={3} aria-invalid={e.notes ? 'true' : undefined}>
        {v.notes}
      </textarea>
      <FieldError text={e.notes} />
      <span class="hint">Facultatif, visible uniquement dans l’administration.</span>
    </label>
  </>
);

// ---------------------------------------------------------------- ajout

export const NewGuestPage: FC<{ csrf: string; v: GuestFormValues; e: GuestFormErrors; flash?: Flash }> = ({
  csrf,
  v,
  e,
  flash,
}) => (
  <Layout title="Ajouter un invité" active="guests" csrf={csrf} flash={flash}>
    <p class="back no-print">
      <a href="/admin">← Tous les invités</a>
    </p>
    <div class="page-head">
      <h1>Ajouter un invité</h1>
    </div>
    <section class="card narrow">
      <form method="post" action="/admin/guests" class="form">
        <Csrf token={csrf} />
        <GuestFields v={v} e={e} />
        <div class="actions">
          <button type="submit" class="btn btn-primary">
            Ajouter
          </button>
          <a class="btn btn-ghost" href="/admin">
            Annuler
          </a>
        </div>
        <p class="hint">Un lien personnel est créé automatiquement : vous pourrez le copier ou l’envoyer par WhatsApp.</p>
      </form>
    </section>
  </Layout>
);

// ---------------------------------------------------------------- modification

export interface EditGuestProps {
  csrf: string;
  flash?: Flash;
  g: GuestRow;
  link: string;
  wa: string;
  v: GuestFormValues;
  e: GuestFormErrors;
  rv: ResponseFormValues;
  re: ResponseFormErrors;
  history: ResponseHistoryRow[];
  opens: OpenRow[];
  rsvpOpen: boolean;
  /** Message affiché dans la carte « Saisir la réponse » (la page y défile après l'enregistrement). */
  responseFlash?: Flash;
}

export const EditGuestPage: FC<EditGuestProps> = ({ csrf, flash, g, link, wa, v, e, rv, re, history, opens, rsvpOpen, responseFlash }) => (
  <Layout title={g.name} active="guests" csrf={csrf} flash={flash}>
    <p class="back no-print">
      <a href="/admin">← Tous les invités</a>
    </p>
    <div class="page-head">
      <h1 class="guest-title">
        {g.name} <SideBadge side={g.side} />
      </h1>
    </div>

    <section class="card">
      <h2>Lien personnel</h2>
      <input type="text" class="link-input" value={link} readonly aria-label="Lien personnel" data-select-all="" />
      <div class="actions link-actions">
        <button type="button" class="btn btn-sm" data-copy={link}>
          Copier
        </button>
        <a class="btn btn-sm" href={`/i/${g.code}`} target="_blank" rel="noopener">
          Ouvrir
        </a>
        <a class="btn btn-sm btn-wa" href={wa} target="_blank" rel="noopener">
          WhatsApp
        </a>
      </div>
      <p class="hint">Vos propres visites (connecté à l’administration) ne comptent pas comme des ouvertures.</p>
      <dl class="kv">
        <dt>Lien ouvert</dt>
        <dd>
          <OpenedInfo g={g} />
        </dd>
        <dt>Réponse</dt>
        <dd>
          <AnswerBadge answer={g.answer} />
          {g.answered_at ? <span class="small muted"> {`le ${formatDateTimeFr(g.answered_at)}`}</span> : null}
        </dd>
        <dt>Prévu</dt>
        <dd>{plural(g.expected_count, 'personne', 'personnes')}</dd>
        <dt>Confirmés</dt>
        <dd>{g.answer === 'oui' ? plural(g.confirmed_count ?? 0, 'personne', 'personnes') : confirmedText(g)}</dd>
        {g.message ? (
          <>
            <dt>Message</dt>
            <dd class="msg">{g.message}</dd>
          </>
        ) : null}
        <dt>Table</dt>
        <dd>{g.table_name ?? <span class="muted">Pas encore placé</span>}</dd>
      </dl>
    </section>

    <section class="card">
      <h2>Fiche de l’invité</h2>
      <form method="post" action={`/admin/guests/${g.id}`} class="form">
        <Csrf token={csrf} />
        <GuestFields v={v} e={e} />
        <div class="actions">
          <button type="submit" class="btn btn-primary">
            Enregistrer
          </button>
        </div>
      </form>
    </section>

    <section class="card" id="reponse">
      <h2>Saisir la réponse à la place de l’invité</h2>
      {responseFlash ? (
        <p class={`flash flash-${responseFlash.kind}`} role="status">
          {responseFlash.text}
        </p>
      ) : null}
      <p class="hint">
        Par exemple si l’invité a répondu par téléphone. La nouvelle réponse remplace la précédente (l’historique est
        conservé).
        {rsvpOpen ? '' : ' La date limite est passée, mais vous pouvez toujours saisir une réponse ici.'}
      </p>
      <form method="post" action={`/admin/guests/${g.id}/response`} class="form" data-response-form="">
        <Csrf token={csrf} />
        <fieldset class="field choice">
          <legend class="label">Réponse</legend>
          <label class="check">
            <input type="radio" name="answer" value="oui" required checked={rv.answer === 'oui'} />
            Oui, présent(e)
          </label>
          <label class="check">
            <input type="radio" name="answer" value="non" checked={rv.answer === 'non'} />
            Non, ne pourra pas venir
          </label>
          <FieldError text={re.answer} />
        </fieldset>
        <label class="field" data-count-field="">
          <span>Nombre de personnes (si oui)</span>
          <input
            type="number"
            name="count"
            value={rv.count}
            min={1}
            max={30}
            step={1}
            inputmode="numeric"
            aria-invalid={re.count ? 'true' : undefined}
          />
          <FieldError text={re.count} />
        </label>
        <label class="field">
          <span>Message (facultatif)</span>
          <textarea name="message" maxlength={1000} rows={3} aria-invalid={re.message ? 'true' : undefined}>
            {rv.message}
          </textarea>
          <FieldError text={re.message} />
        </label>
        <div class="actions">
          <button type="submit" class="btn btn-primary">
            Enregistrer la réponse
          </button>
        </div>
      </form>
    </section>

    <section class="section">
      <h2>Historique des réponses</h2>
      {history.length === 0 ? (
        <p class="card muted">Aucune réponse pour l’instant.</p>
      ) : (
        <div class="table-wrap">
          <table class="data history-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Réponse</th>
                <th class="num">Personnes</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r, i) => (
                <tr>
                  <td class="cell-title" data-label="Date">
                    <span>
                      {formatDateTimeFr(r.answered_at)}
                      {i === 0 ? <span class="small muted"> (en vigueur)</span> : null}
                    </span>
                  </td>
                  <td data-label="Réponse">
                    <AnswerBadge answer={r.answer} />
                  </td>
                  <td class="num" data-label="Personnes">
                    {r.count}
                  </td>
                  <td data-label="Message" class={r.message ? undefined : 'empty-m'}>
                    {r.message ? <div class="msg">{r.message}</div> : <span class="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>

    <section class="section" id="ouvertures">
      <h2>Ouvertures du lien</h2>
      {g.open_count === 0 ? (
        <p class="card muted">Le lien n’a pas encore été ouvert.</p>
      ) : (
        <>
          <p class="small muted">
            {plural(g.open_count, 'ouverture', 'ouvertures')} au total
            {g.open_count > opens.length ? ` — les ${opens.length} dernières :` : ' :'}
          </p>
          <div class="table-wrap">
            <table class="data opens-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Appareil</th>
                </tr>
              </thead>
              <tbody>
                {opens.map((o) => (
                  <tr>
                    <td class="cell-title" data-label="Date">
                      {formatDateTimeFr(o.opened_at)}
                    </td>
                    <td data-label="Appareil">
                      <span title={o.ua}>{shortUa(o.ua)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="card no-print opens-clear">
            <p class="hint">
              C’est vous qui avez ouvert ce lien (par exemple depuis WhatsApp) ? Effacez ces ouvertures : « Lien ouvert »
              repassera à « Non ». La réponse de l’invité ne change pas.
            </p>
            <form
              method="post"
              action={`/admin/guests/${g.id}/opens/clear`}
              data-confirm={`Effacer les ouvertures du lien de « ${g.name} » ? « Lien ouvert » repassera à « Non ».`}
            >
              <Csrf token={csrf} />
              <button type="submit" class="btn">
                Effacer les ouvertures
              </button>
            </form>
          </div>
        </>
      )}
    </section>

    <section class="card danger-zone no-print">
      <h2>Lien et suppression</h2>
      <p class="hint">
        Régénérer le code crée un nouveau lien personnel : l’ancien cesse de fonctionner (utile si le lien a été transmis
        par erreur). Supprimer efface aussi les réponses et les ouvertures de l’invité.
      </p>
      <div class="actions">
        <form method="post" action={`/admin/guests/${g.id}/regenerate`} data-confirm="L’ancien lien ne fonctionnera plus. Continuer ?">
          <Csrf token={csrf} />
          <button type="submit" class="btn">
            Régénérer le code
          </button>
        </form>
        <form
          method="post"
          action={`/admin/guests/${g.id}/delete`}
          data-confirm={`Supprimer « ${g.name} » ? Ses réponses et ouvertures seront aussi supprimées.`}
        >
          <Csrf token={csrf} />
          <button type="submit" class="btn btn-danger">
            Supprimer
          </button>
        </form>
      </div>
    </section>
  </Layout>
);
