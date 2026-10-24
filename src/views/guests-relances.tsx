// Relances : invités sans réponse, avec message WhatsApp de rappel prérempli.

import type { FC } from 'hono/jsx';
import type { GuestRow, Side } from '../lib/db';
import { formatDateFr, formatDateLongFr } from '../lib/settings';
import { Empty, OpenedInfo, plural, SideBadge } from './guests-ui';
import { Layout } from './layout';

export interface ReminderRow {
  g: GuestRow;
  link: string;
  /** Message de relance complet (modèle rempli). */
  text: string;
  /** Lien wa.me avec le message de relance. */
  wa: string;
}

export interface RelancesProps {
  csrf: string;
  rows: ReminderRow[];
  /** Nombre total d'invités sans réponse (tous côtés). */
  pending: number;
  /** Nombre total d'invités (tous côtés). */
  totalGuests: number;
  side: Side | '';
  deadline: string;
  rsvpOpen: boolean;
}

export const RelancesPage: FC<RelancesProps> = ({ csrf, rows, pending, totalGuests, side, deadline, rsvpOpen }) => {
  const neverOpened = rows.filter((r) => r.g.open_count === 0).length;
  const people = rows.reduce((n, r) => n + r.g.expected_count, 0);
  return (
    <Layout title="Relances" active="reminders" csrf={csrf}>
      <div class="page-head">
        <h1>Relances</h1>
      </div>
      {totalGuests === 0 ? (
        <Empty title="Aucun invité pour l’instant">
          <p class="muted">Importez d’abord la liste des invités.</p>
          <div class="actions center-actions">
            <a class="btn btn-primary" href="/admin/import">
              Importer la liste
            </a>
          </div>
        </Empty>
      ) : pending === 0 ? (
        <Empty title="Tout le monde a répondu">
          <p class="muted">Aucun invité à relancer : chaque invité a donné sa réponse. Misaotra !</p>
          <div class="actions center-actions">
            <a class="btn" href="/admin">
              Voir les invités
            </a>
          </div>
        </Empty>
      ) : (
        <>
          <div class="stats stats-3">
            <div class="stat none">
              <span class="stat-v">{rows.length}</span>
              <span class="stat-l">{rows.length > 1 ? 'Invités sans réponse' : 'Invité sans réponse'}</span>
            </div>
            <div class="stat">
              <span class="stat-v">{neverOpened}</span>
              <span class="stat-l">Lien jamais ouvert</span>
            </div>
            <div class="stat">
              <span class="stat-v">{people}</span>
              <span class="stat-l">Personnes prévues</span>
            </div>
          </div>
          <p>
            {`Date limite de réponse : `}
            <strong>{`${formatDateLongFr(deadline)} (${formatDateFr(deadline)})`}</strong>.
          </p>
          {rsvpOpen ? null : (
            <p class="alert">
              La date limite est passée : les invités ne peuvent plus répondre eux-mêmes. Vous pouvez saisir leur réponse
              depuis leur fiche (« Modifier ») ou repousser la date dans les Réglages.
            </p>
          )}
          <p class="hint">
            Le bouton WhatsApp ouvre la conversation avec le message de rappel prérempli (modifiable dans les{' '}
            <a href="/admin/settings">Réglages</a>). Les invités qui n’ont jamais ouvert leur lien sont en tête de liste.
          </p>
          <form method="get" action="/admin/relances" class="card filters no-print">
            <label class="field">
              <span>Côté</span>
              <select name="side" data-autosubmit="">
                <option value="" selected={side === ''}>
                  Tous
                </option>
                <option value="rojo" selected={side === 'rojo'}>
                  Rojo
                </option>
                <option value="orimbato" selected={side === 'orimbato'}>
                  Orimbato
                </option>
              </select>
            </label>
            <div class="actions">
              <button type="submit" class="btn">
                Filtrer
              </button>
            </div>
          </form>
          {side ? (
            <p class="small muted" role="status">
              {`${plural(rows.length, 'invité', 'invités')} sans réponse de ce côté, sur ${pending} au total`}
            </p>
          ) : null}
          {rows.length === 0 ? (
            <p class="card muted center">Personne à relancer de ce côté.</p>
          ) : (
            <div class="table-wrap">
              <table class="data reminders-table">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Côté</th>
                    <th class="num">Prévu</th>
                    <th>Lien ouvert</th>
                    <th class="no-print">Relancer</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ g, link, text, wa }) => (
                    <tr>
                      <td class="cell-title" data-label="Nom">
                        <div>
                          <a class="guest-name" href={`/admin/guests/${g.id}/edit`}>
                            {g.name}
                          </a>
                          {g.phone ? (
                            <div class="sub small muted">{g.phone}</div>
                          ) : (
                            <div class="sub small muted">Pas de numéro : choisissez le contact dans WhatsApp</div>
                          )}
                        </div>
                      </td>
                      <td data-label="Côté">
                        <SideBadge side={g.side} />
                      </td>
                      <td class="num" data-label="Prévu">
                        {g.expected_count}
                      </td>
                      <td data-label="Lien ouvert">
                        <OpenedInfo g={g} />
                      </td>
                      <td class="cell-actions no-print" data-label="Relancer">
                        <div class="actions">
                          <a class="btn btn-sm btn-wa" href={wa} target="_blank" rel="noopener">
                            WhatsApp
                          </a>
                          <button type="button" class="btn btn-sm" data-copy={text}>
                            Copier le message
                          </button>
                          <button type="button" class="btn btn-sm" data-copy={link}>
                            Copier le lien
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Layout>
  );
};
