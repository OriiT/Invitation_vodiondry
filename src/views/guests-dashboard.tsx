// Tableau de bord « Invités » : totaux, filtres, liste avec actions (copier le lien, WhatsApp, modifier, voir).

import type { FC } from 'hono/jsx';
import { MIN_PASSWORD } from '../lib/auth';
import type { GuestRow, Side, Totals } from '../lib/db';
import { AnswerBadge, confirmedText, Empty, OpenedInfo, plural, SideBadge } from './guests-ui';
import { Layout } from './layout';

export type StatusFilter = 'oui' | 'non' | 'none' | 'unopened' | 'opened';

export const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'oui', label: 'Oui' },
  { value: 'non', label: 'Non' },
  { value: 'none', label: 'Sans réponse' },
  { value: 'unopened', label: 'Lien jamais ouvert' },
  { value: 'opened', label: 'Ouvert sans réponse' },
];

export interface DashboardFilters {
  side: Side | '';
  status: StatusFilter | '';
  q: string;
}

export interface DashboardRow {
  g: GuestRow;
  /** Lien personnel complet. */
  link: string;
  /** Lien wa.me avec le message d'invitation prérempli. */
  wa: string;
}

export interface DashboardProps {
  csrf: string;
  flash?: { kind: 'ok' | 'err'; text: string } | null;
  totals: Totals;
  rows: DashboardRow[];
  filters: DashboardFilters;
  filtered: boolean;
  /** Mot de passe initial (secret ADMIN_PASSWORD) trop court : avertissement en haut de page. */
  weakPassword?: boolean;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export const StatTiles: FC<{ t: Totals }> = ({ t }) => (
  <div class="stats">
    <a class="stat" href="/admin">
      <span class="stat-v">{t.guests}</span>
      <span class="stat-l">Invités</span>
    </a>
    <div class="stat">
      <span class="stat-v">{t.expected}</span>
      <span class="stat-l">Personnes attendues</span>
    </div>
    <a class="stat ok" href="/admin?status=oui">
      <span class="stat-v">{t.oui}</span>
      <span class="stat-l">Oui</span>
    </a>
    <a class="stat no" href="/admin?status=non">
      <span class="stat-v">{t.non}</span>
      <span class="stat-l">Non</span>
    </a>
    <a class="stat none" href="/admin?status=none">
      <span class="stat-v">{t.none}</span>
      <span class="stat-l">Sans réponse</span>
    </a>
    <div class="stat ok">
      <span class="stat-v">{t.confirmed}</span>
      <span class="stat-l">Personnes confirmées</span>
    </div>
  </div>
);

const Filters: FC<{ f: DashboardFilters; filtered: boolean }> = ({ f, filtered }) => (
  <form method="get" action="/admin" class="card filters no-print" role="search">
    <label class="field">
      <span>Côté</span>
      <select name="side" data-autosubmit="">
        <option value="" selected={f.side === ''}>
          Tous
        </option>
        <option value="rojo" selected={f.side === 'rojo'}>
          Rojo
        </option>
        <option value="orimbato" selected={f.side === 'orimbato'}>
          Orimbato
        </option>
      </select>
    </label>
    <label class="field">
      <span>Statut</span>
      <select name="status" data-autosubmit="">
        <option value="" selected={f.status === ''}>
          Tous
        </option>
        {STATUS_FILTERS.map((s) => (
          <option value={s.value} selected={f.status === s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
    <label class="field grow">
      <span>Nom</span>
      <input type="search" name="q" value={f.q} placeholder="Rechercher un nom" autocomplete="off" />
    </label>
    <div class="actions">
      <button type="submit" class="btn">
        Filtrer
      </button>
      {filtered ? (
        <a class="btn btn-ghost" href="/admin">
          Réinitialiser
        </a>
      ) : null}
    </div>
  </form>
);

const GuestTable: FC<{ rows: DashboardRow[] }> = ({ rows }) => (
  <div class="table-wrap">
    <table class="data guests-table">
      <thead>
        <tr>
          <th>Nom</th>
          <th>Côté</th>
          <th class="num">Prévu</th>
          <th>Lien ouvert</th>
          <th>Réponse</th>
          <th class="num">Confirmés</th>
          <th>Message</th>
          <th>Table</th>
          <th class="no-print">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ g, link, wa }) => (
          <tr>
            <td class="cell-title" data-label="Nom">
              <div>
                <a class="guest-name" href={`/admin/guests/${g.id}/edit`}>
                  {g.name}
                </a>
                {g.phone ? <div class="sub small muted">{g.phone}</div> : null}
                {g.notes ? (
                  <div class="sub small muted" title={g.notes}>
                    {truncate(g.notes, 120)}
                  </div>
                ) : null}
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
            <td data-label="Réponse">
              <AnswerBadge answer={g.answer} />
            </td>
            <td class="num" data-label="Confirmés">
              {confirmedText(g)}
            </td>
            <td data-label="Message" class={g.message ? undefined : 'empty-m'}>
              {g.message ? <div class="msg">{g.message}</div> : null}
            </td>
            <td data-label="Table">{g.table_name ?? <span class="muted">—</span>}</td>
            <td class="cell-actions no-print" data-label="Actions">
              <div class="actions">
                <button type="button" class="btn btn-sm" data-copy={link}>
                  Copier le lien
                </button>
                <a class="btn btn-sm btn-wa" href={wa} target="_blank" rel="noopener">
                  WhatsApp
                </a>
                <a class="btn btn-sm" href={`/admin/guests/${g.id}/edit`}>
                  Modifier
                </a>
                <a
                  class="btn btn-sm btn-ghost"
                  href={`/i/${g.code}`}
                  target="_blank"
                  rel="noopener"
                  title="Ouvrir l’invitation (vos visites ne sont pas comptées)"
                >
                  Voir
                </a>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const DashboardPage: FC<DashboardProps> = ({ csrf, flash, totals, rows, filters, filtered, weakPassword }) => (
  <Layout title="Invités" active="guests" csrf={csrf} flash={flash}>
    {weakPassword ? (
      <p class="flash flash-err" role="alert">
        {`Le mot de passe de l’administration fait moins de ${MIN_PASSWORD} caractères : il est trop facile à deviner. `}
        <a href="/admin/settings#mot-de-passe">Choisissez-en un plus long dans Réglages</a>.
      </p>
    ) : null}
    <div class="page-head">
      <h1>Invités</h1>
      <div class="actions no-print">
        <a class="btn btn-primary" href={filters.side ? `/admin/guests/new?side=${filters.side}` : '/admin/guests/new'}>
          Ajouter un invité
        </a>
        <a class="btn" href="/admin/export.csv">
          Exporter (CSV)
        </a>
      </div>
    </div>
    {totals.guests === 0 ? (
      <Empty title="Aucun invité pour l’instant">
        <p class="muted">
          Importez la liste depuis le fichier Excel (feuille « Invités ») ou ajoutez les invités un par un. Chaque invité
          reçoit automatiquement son lien personnel.
        </p>
        <div class="actions center-actions">
          <a class="btn btn-primary" href="/admin/import">
            Importer la liste
          </a>
          <a class="btn" href="/admin/guests/new">
            Ajouter un invité
          </a>
        </div>
      </Empty>
    ) : (
      <>
        <StatTiles t={totals} />
        <p class="small muted">
          {`Liens ouverts : ${totals.opened} sur ${totals.guests}`}
          {totals.none > 0 ? (
            <>
              {' · '}
              <a href="/admin/relances">{`Relancer ${plural(totals.none, 'invité', 'invités')} sans réponse`}</a>
            </>
          ) : null}
        </p>
        <Filters f={filters} filtered={filtered} />
        {filtered ? (
          <p class="small muted" role="status">
            {`${rows.length} affiché${rows.length > 1 ? 's' : ''} sur ${totals.guests}`}
          </p>
        ) : null}
        {rows.length === 0 ? (
          <p class="card muted center">Aucun invité ne correspond à ces filtres.</p>
        ) : (
          <GuestTable rows={rows} />
        )}
      </>
    )}
  </Layout>
);
