// Versions imprimables du plan de table : plan A4 et marque-tables (chevalets à plier ou cartes à découper).

import type { FC } from 'hono/jsx';
import { seatsOf, type GuestRow } from '../lib/db';
import { overText, type Plan, type TableRow } from '../lib/tables';
import { Layout } from './layout';
import { plural } from './guests-ui';

/** Polices de l'invitation (Google Fonts) : la route /cards autorise ces origines dans sa CSP. */
export const CARD_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Allura&family=Cardo:ital,wght@0,400;0,700;1,400&family=Cinzel:wght@400;700&display=swap';

export type CardFormat = 'tent' | 'flat';

const BackLink = () => (
  <a href="/admin/tables" class="btn btn-ghost btn-sm">
    ← Retour au plan
  </a>
);

const PrintButton = () => (
  <button type="button" class="btn btn-primary btn-sm" data-print>
    Imprimer
  </button>
);

const PrintGuests: FC<{ guests: GuestRow[] }> = ({ guests }) =>
  guests.length ? (
    <ol class="tpp-guests">
      {guests.map((g) => (
        <li>
          <span class="tpp-name">{g.name}</span>
          <span class="tpp-seats">× {seatsOf(g)}</span>
          {g.answer === 'oui' ? null : <span class="tpp-pending">sans réponse</span>}
        </li>
      ))}
    </ol>
  ) : (
    <p class="tpp-none">Aucun invité</p>
  );

// ---------------------------------------------------------------- plan imprimable

export const PrintPage: FC<{ plan: Plan; generatedAt: string }> = ({ plan, generatedAt }) => (
  <Layout title="Plan de table — impression" bare styles={['/vd/tables.css']}>
    <div class="tp-toolbar no-print">
      <BackLink />
      <PrintButton />
      <span class="hint">Format A4. Les tables ne sont jamais coupées entre deux pages.</span>
    </div>
    <article class="tpp">
      <header class="tpp-head">
        <h1>Plan de table — Vodiondry d’Orimbato &amp; Rojo — 19 décembre 2026</h1>
        <p class="tpp-meta">
          {plural(plan.tables.length, 'table', 'tables')} · {plan.placedSeats} / {plan.capacity} places attribuées
          {plan.unplacedSeats ? ` · ${plural(plan.unplacedSeats, 'place', 'places')} à attribuer` : ''} · état au {generatedAt}
        </p>
      </header>
      {plan.tables.length ? (
        <div class="tpp-grid">
          {plan.tables.map((t) => (
            <section class={`tpp-table${t.over ? ' is-over' : ''}`}>
              <h2>
                <span class="tpp-tname">{t.name}</span>
                <span class="tpp-count">
                  {t.seats} / {t.capacity} places
                </span>
              </h2>
              {t.over ? <p class="tpp-over">{overText(t.over_by)}</p> : null}
              <PrintGuests guests={t.guests} />
            </section>
          ))}
        </div>
      ) : (
        <p class="tpp-none">Aucune table pour l’instant.</p>
      )}
      {plan.unplaced.length ? (
        <section class="tpp-table tpp-unplaced">
          <h2>
            <span class="tpp-tname">Non placés</span>
            <span class="tpp-count">
              {plural(plan.unplaced.length, 'invité', 'invités')} · {plural(plan.unplacedSeats, 'place', 'places')}
            </span>
          </h2>
          <PrintGuests guests={plan.unplaced} />
        </section>
      ) : null}
    </article>
  </Layout>
);

// ---------------------------------------------------------------- marque-tables

/** Taille du nom selon sa longueur (le nom doit tenir sur la largeur de la carte). */
function sizeClass(text: string): string {
  const n = [...text].length;
  if (n <= 3) return 'tc-xl';
  if (n <= 8) return 'tc-l';
  if (n <= 14) return 'tc-m';
  if (n <= 24) return 'tc-s';
  return 'tc-xs';
}

const Face: FC<{ name: string; back?: boolean }> = ({ name, back }) => {
  // « Table 4 » → « Table » en écriture manuscrite, « 4 » en grandes capitales.
  const m = /^table\s+(.+)$/iu.exec(name.trim());
  const main = m ? m[1] : name;
  return (
    <div class={`tc-face${back ? ' tc-back' : ''}`} aria-hidden={back ? 'true' : undefined}>
      {m ? <span class="tc-script">Table</span> : null}
      <span class={`tc-name ${sizeClass(main)}`}>{main}</span>
      <span class="tc-rule" aria-hidden="true">
        <i></i>
      </span>
      <span class="tc-line">Vodiondry · Orimbato &amp; Rojo · 19.12.2026</span>
    </div>
  );
};

function pairs<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 2) out.push(items.slice(i, i + 2));
  return out;
}

export const CardsPage: FC<{ tables: TableRow[]; format: CardFormat }> = ({ tables, format }) => (
  <Layout title="Marque-tables" bare styles={[CARD_FONTS_URL, '/vd/tables.css']}>
    <div class="tp-toolbar no-print">
      <BackLink />
      <span class="tp-seg" role="group" aria-label="Format des marque-tables">
        <a
          href="/admin/tables/cards?format=tent"
          class={`btn btn-sm${format === 'tent' ? ' btn-primary' : ''}`}
          aria-current={format === 'tent' ? 'page' : undefined}
        >
          Chevalets à plier
        </a>
        <a
          href="/admin/tables/cards?format=flat"
          class={`btn btn-sm${format === 'flat' ? ' btn-primary' : ''}`}
          aria-current={format === 'flat' ? 'page' : undefined}
        >
          Cartes à découper
        </a>
      </span>
      {tables.length ? <PrintButton /> : null}
      <p class="hint tp-toolbar-hint">
        {format === 'tent'
          ? 'Deux chevalets par feuille A4 : découpez le long des tirets, puis pliez chaque carte en deux sur la ligne de pointillés. Le nom se lit des deux côtés.'
          : 'Deux cartes par feuille A4 : découpez le long des tirets.'}{' '}
        Imprimez à l’échelle 100 % (sans « ajuster à la page »), sans en-têtes ni pieds de page, de préférence sur papier épais.
      </p>
    </div>
    {tables.length ? (
      pairs(tables).map((pair) => (
        <div class="tc-sheet">
          {pair.map((t) => (
            <section class={`tc-card tc-${format}`} aria-label={t.name}>
              {format === 'tent' ? (
                <>
                  <Face name={t.name} back />
                  <div class="tc-fold" aria-hidden="true"></div>
                  <Face name={t.name} />
                </>
              ) : (
                <Face name={t.name} />
              )}
            </section>
          ))}
        </div>
      ))
    ) : (
      <p class="tpp-none">
        Aucune table pour l’instant. <a href="/admin/tables">Ajoutez des tables</a> pour imprimer leurs marque-tables.
      </p>
    )}
  </Layout>
);
