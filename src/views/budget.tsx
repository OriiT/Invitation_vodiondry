// Page « Budget » : trois scénarios (prévu, estimation, confirmé), personnes hors liste, postes « par personne »
// et « forfaits », ajout et modification d'un poste. Aucun JavaScript propre à la page.

import type { FC } from 'hono/jsx';
import {
  DETAIL_MAX,
  EXTRA_PEOPLE_MAX,
  formatAr,
  itemTotal,
  LABEL_MAX,
  SCENARIO_LABEL,
  SCENARIOS,
  type BudgetItem,
  type BudgetTotals,
  type PeopleCounts,
  type ScenarioKey,
  type ScenarioTotal,
} from '../lib/budget';
import { plural } from './guests-ui';
import { Csrf, Layout } from './layout';

type Flash = { kind: 'ok' | 'err'; text: string } | null | undefined;

/** Valeurs du formulaire d'un poste telles que saisies (réaffichées en cas d'erreur). */
export interface BudgetFormValues {
  label: string;
  detail: string;
  kind: string;
  amount: string;
}

export type BudgetFormErrors = Partial<Record<keyof BudgetFormValues, string>>;

export const EMPTY_BUDGET_FORM: BudgetFormValues = { label: '', detail: '', kind: 'forfait', amount: '' };

const STYLES = ['/vd/budget.css'];

const FieldError: FC<{ text?: string }> = ({ text }) => (text ? <span class="field-error">{text}</span> : null);

/** « 83 pers. » */
function pers(n: number): string {
  return `${n} pers.`;
}

// ---------------------------------------------------------------- scénarios

function scenarioHint(k: ScenarioKey, p: PeopleCounts): string {
  switch (k) {
    case 'prevu':
      return `Liste d’invités (${p.listed}) + hors liste (${p.extra}).`;
    case 'estimation':
      return `« Oui » confirmés (${p.yes}) + sans réponse (${p.pending}) + hors liste (${p.extra}). Les « non » ne comptent pas.`;
    case 'confirme':
      return `« Oui » confirmés (${p.yes}) + hors liste (${p.extra}).`;
  }
}

const Tile: FC<{ k: ScenarioKey; s: ScenarioTotal; people: PeopleCounts }> = ({ k, s, people }) => {
  const main = k === 'estimation';
  return (
    <section class={`bg-tile${main ? ' is-main' : ''}`} aria-labelledby={`bg-${k}`}>
      <h2 class="bg-tile-t" id={`bg-${k}`}>
        <span>{SCENARIO_LABEL[k]}</span>
        {main ? <span class="badge bg-badge">Pour le traiteur</span> : null}
      </h2>
      <p class="bg-total" data-total={k}>
        {formatAr(s.total)}
      </p>
      <p class="bg-people">
        <b>{plural(s.people, 'personne', 'personnes')}</b> · {formatAr(s.perGuest)} / personne
      </p>
      <p class="hint">{scenarioHint(k, people)}</p>
    </section>
  );
};

// ---------------------------------------------------------------- postes

const ItemTitle: FC<{ item: BudgetItem }> = ({ item }) => (
  <div>
    <span class="bg-label">{item.label}</span>
    {item.detail ? <div class="sub small muted">{item.detail}</div> : null}
  </div>
);

const Amount: FC<{ n: number }> = ({ n }) => <span class={n === 0 ? 'muted' : undefined}>{formatAr(n)}</span>;

const ItemActions: FC<{ item: BudgetItem; csrf: string }> = ({ item, csrf }) => (
  <td class="cell-actions no-print" data-label="Actions">
    <div class="actions">
      <a class="btn btn-sm" href={`/admin/budget/${item.id}/edit`} aria-label={`Modifier « ${item.label} »`}>
        Modifier
      </a>
      <form method="post" action={`/admin/budget/${item.id}/delete`} data-confirm={`Supprimer « ${item.label} » du budget ?`}>
        <Csrf token={csrf} />
        <button type="submit" class="btn btn-sm btn-danger" aria-label={`Supprimer « ${item.label} »`}>
          Supprimer
        </button>
      </form>
    </div>
  </td>
);

const PerPersonTable: FC<{ items: BudgetItem[]; totals: BudgetTotals; csrf: string }> = ({ items, totals, csrf }) => {
  const sc = totals.scenarios;
  const colLabel = (k: ScenarioKey) => `${SCENARIO_LABEL[k]} (${pers(sc[k].people)})`;
  return (
    <section class="bg-section" id="par-personne" aria-labelledby="par-personne-t">
      <h2 class="bg-section-t" id="par-personne-t">
        Par personne <span class="muted bg-section-sub">× nombre de personnes</span>
      </h2>
      <div class="table-wrap">
        <table class="data bg-table bg-table-pp">
          <thead>
            <tr>
              <th>Poste</th>
              <th class="num">Par personne</th>
              {SCENARIOS.map((k) => (
                <th class={`num${k === 'estimation' ? ' bg-col-main' : ''}`}>
                  {SCENARIO_LABEL[k]}
                  <span class="bg-th-sub">{pers(sc[k].people)}</span>
                </th>
              ))}
              <th class="no-print">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? (
              items.map((it) => (
                <tr id={`frais-${it.id}`}>
                  <td class="cell-title" data-label="Poste">
                    <ItemTitle item={it} />
                  </td>
                  <td class="num" data-label="Par personne">
                    <Amount n={it.amount} />
                  </td>
                  {SCENARIOS.map((k) => (
                    <td class={`num${k === 'estimation' ? ' bg-col-main' : ''}`} data-label={`Total ${colLabel(k).toLowerCase()}`}>
                      <Amount n={itemTotal(it, sc[k].people)} />
                    </td>
                  ))}
                  <ItemActions item={it} csrf={csrf} />
                </tr>
              ))
            ) : (
              <tr>
                <td colspan={6} data-label="" class="muted bg-empty">
                  Aucun montant par personne. Ajoutez-en un avec le formulaire « Ajouter un poste de dépense ».
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td class="cell-title" data-label="">
                Sous-total par personne
              </td>
              <td class="num" data-label="Par personne">
                {formatAr(totals.perPerson)}
              </td>
              {SCENARIOS.map((k) => (
                <td class={`num${k === 'estimation' ? ' bg-col-main' : ''}`} data-label={`Total ${colLabel(k).toLowerCase()}`}>
                  {formatAr(totals.perPerson * sc[k].people)}
                </td>
              ))}
              <td class="empty-m no-print" data-label=""></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
};

const ForfaitTable: FC<{ items: BudgetItem[]; totals: BudgetTotals; csrf: string }> = ({ items, totals, csrf }) => (
  <section class="bg-section" id="forfaits" aria-labelledby="forfaits-t">
    <h2 class="bg-section-t" id="forfaits-t">
      Forfaits <span class="muted bg-section-sub">montant fixe, quel que soit le nombre de personnes</span>
    </h2>
    <div class="table-wrap">
      <table class="data bg-table bg-table-ff">
        <thead>
          <tr>
            <th>Poste</th>
            <th class="num">Montant</th>
            <th class="no-print">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.length ? (
            items.map((it) => (
              <tr id={`frais-${it.id}`}>
                <td class="cell-title" data-label="Poste">
                  <ItemTitle item={it} />
                </td>
                <td class="num" data-label="Montant">
                  <Amount n={it.amount} />
                </td>
                <ItemActions item={it} csrf={csrf} />
              </tr>
            ))
          ) : (
            <tr>
              <td colspan={3} data-label="" class="muted bg-empty">
                Aucun forfait. Ajoutez-en un avec le formulaire « Ajouter un poste de dépense ».
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td class="cell-title" data-label="">
              Sous-total forfaits
            </td>
            <td class="num" data-label="Montant">
              {formatAr(totals.forfaits)}
            </td>
            <td class="empty-m no-print" data-label=""></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </section>
);

// ---------------------------------------------------------------- formulaire d'un poste

const BudgetFields: FC<{ v: BudgetFormValues; e: BudgetFormErrors; idPrefix: string }> = ({ v, e, idPrefix }) => (
  <>
    <label class="field" for={`${idPrefix}-label`}>
      <span>Poste</span>
      <input
        type="text"
        id={`${idPrefix}-label`}
        name="label"
        value={v.label}
        required
        maxlength={LABEL_MAX}
        autocomplete="off"
        placeholder="ex. Photographe"
        aria-invalid={e.label ? 'true' : undefined}
      />
      <FieldError text={e.label} />
    </label>
    <label class="field" for={`${idPrefix}-detail`}>
      <span>Détail (facultatif)</span>
      <textarea
        id={`${idPrefix}-detail`}
        name="detail"
        rows={3}
        maxlength={DETAIL_MAX}
        class="bg-detail"
        placeholder="ex. acompte versé, à confirmer…"
        aria-invalid={e.detail ? 'true' : undefined}
      >
        {v.detail}
      </textarea>
      <FieldError text={e.detail} />
    </label>
    <div class="row">
      <label class="field grow" for={`${idPrefix}-kind`}>
        <span>Type</span>
        <select id={`${idPrefix}-kind`} name="kind" required aria-invalid={e.kind ? 'true' : undefined}>
          <option value="forfait" selected={v.kind !== 'par_personne'}>
            Forfait (montant fixe)
          </option>
          <option value="par_personne" selected={v.kind === 'par_personne'}>
            Par personne
          </option>
        </select>
        <FieldError text={e.kind} />
      </label>
      <label class="field grow" for={`${idPrefix}-amount`}>
        <span>Montant en Ariary</span>
        <input
          type="text"
          id={`${idPrefix}-amount`}
          name="amount"
          value={v.amount}
          required
          inputmode="numeric"
          autocomplete="off"
          maxlength={30}
          placeholder="ex. 400 000"
          aria-invalid={e.amount ? 'true' : undefined}
        />
        <FieldError text={e.amount} />
      </label>
    </div>
    <p class="hint">
      Par personne : indiquez le prix pour une personne, il est multiplié par le nombre de personnes. Mettez 0 pour un
      poste compris dans un autre (ex. compris dans le menu).
    </p>
  </>
);

// ---------------------------------------------------------------- page

export interface BudgetPageProps {
  csrf: string;
  flash?: Flash;
  items: BudgetItem[];
  people: PeopleCounts;
  totals: BudgetTotals;
  /** Formulaire « Ajouter un poste de dépense » (valeurs réaffichées après une erreur). */
  v: BudgetFormValues;
  e: BudgetFormErrors;
  /** Champ « personnes hors liste » (valeur saisie et erreur éventuelle). */
  extraValue: string;
  extraError?: string;
}

export const BudgetPage: FC<BudgetPageProps> = ({ csrf, flash, items, people, totals, v, e, extraValue, extraError }) => {
  const perPerson = items.filter((it) => it.kind === 'par_personne');
  const forfaits = items.filter((it) => it.kind === 'forfait');
  return (
    <Layout title="Budget" active="budget" csrf={csrf} flash={flash} styles={STYLES}>
      <div class="page-head">
        <h1>Budget</h1>
        <div class="actions">
          <a class="btn btn-sm" href="/admin/budget/export.csv">
            Exporter (CSV)
          </a>
        </div>
      </div>
      <p class="muted bg-intro">
        Option retenue : grande salle de La Rizière et Grill Traiteur Parasoly (menu 3). Le nombre de personnes suit la liste
        d’invités et leurs réponses.
      </p>

      <div class="bg-tiles">
        {SCENARIOS.map((k) => (
          <Tile k={k} s={totals.scenarios[k]} people={people} />
        ))}
      </div>

      <p class="bg-formula">
        <b>Total</b> = forfaits ({formatAr(totals.forfaits)}) + montants par personne ({formatAr(totals.perPerson)}) × nombre de
        personnes.
      </p>

      <section class="card bg-extra" id="personnes" aria-labelledby="personnes-t">
        <h2 id="personnes-t">Personnes hors liste d’invités</h2>
        <form method="post" action="/admin/budget/personnes" class="bg-extra-form">
          <Csrf token={csrf} />
          <label class="field" for="extra-people">
            <span>Nombre de personnes</span>
            <input
              type="number"
              id="extra-people"
              name="extra_people"
              value={extraValue}
              min={0}
              max={EXTRA_PEOPLE_MAX}
              step={1}
              inputmode="numeric"
              required
              aria-invalid={extraError ? 'true' : undefined}
            />
          </label>
          <button type="submit" class="btn btn-primary">
            Enregistrer
          </button>
        </form>
        <FieldError text={extraError} />
        <p class="hint">
          Personnes présentes au repas mais absentes de la liste d’invités. Elles comptent dans les trois colonnes.
          Dans le fichier Excel : 83 = 76 invités de la liste + 7 (Orimbato, la famille non listée (5), le mpikabary) ;
          Rojo n’y figure pas : mettez 8 pour le compter.
        </p>
      </section>

      <PerPersonTable items={perPerson} totals={totals} csrf={csrf} />
      <ForfaitTable items={forfaits} totals={totals} csrf={csrf} />

      <section class="card narrow" id="ajouter" aria-labelledby="ajouter-t">
        <h2 id="ajouter-t">Ajouter un poste de dépense</h2>
        <form method="post" action="/admin/budget#ajouter" class="form">
          <Csrf token={csrf} />
          <BudgetFields v={v} e={e} idPrefix="new" />
          <div class="actions">
            <button type="submit" class="btn btn-primary">
              Ajouter
            </button>
          </div>
        </form>
      </section>
    </Layout>
  );
};

// ---------------------------------------------------------------- modification

export interface BudgetEditProps {
  csrf: string;
  flash?: Flash;
  item: BudgetItem;
  v: BudgetFormValues;
  e: BudgetFormErrors;
}

export const BudgetEditPage: FC<BudgetEditProps> = ({ csrf, flash, item, v, e }) => (
  <Layout title={`Poste : ${item.label}`} active="budget" csrf={csrf} flash={flash} styles={STYLES}>
    <p class="back no-print">
      <a href="/admin/budget">← Budget</a>
    </p>
    <div class="page-head">
      <h1 class="bg-edit-title">Modifier le poste</h1>
    </div>
    <section class="card narrow">
      <p class="muted small bg-edit-was">
        Actuellement : <b>{item.label}</b> ·{' '}
        {item.kind === 'forfait' ? `forfait de ${formatAr(item.amount)}` : `${formatAr(item.amount)} par personne`}
      </p>
      <form method="post" action={`/admin/budget/${item.id}`} class="form">
        <Csrf token={csrf} />
        <BudgetFields v={v} e={e} idPrefix="edit" />
        <div class="actions">
          <button type="submit" class="btn btn-primary">
            Enregistrer
          </button>
          <a class="btn btn-ghost" href={`/admin/budget#frais-${item.id}`}>
            Annuler
          </a>
        </div>
      </form>
    </section>
    <section class="card narrow danger-zone">
      <h2>Supprimer ce poste</h2>
      <p class="muted">« {item.label} » disparaîtra du budget et des totaux.</p>
      <form method="post" action={`/admin/budget/${item.id}/delete`} data-confirm={`Supprimer « ${item.label} » du budget ?`}>
        <Csrf token={csrf} />
        <button type="submit" class="btn btn-danger">
          Supprimer ce poste
        </button>
      </form>
    </section>
  </Layout>
);
