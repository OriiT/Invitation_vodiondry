// Import / export de la liste des invités : formulaire d'envoi et page de résultat.

import type { FC } from 'hono/jsx';
import type { IgnoredRow, ImportRow } from '../lib/import';
import { plural, SideBadge } from './guests-ui';
import { Csrf, Layout } from './layout';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

type Flash = { kind: 'ok' | 'err'; text: string } | null | undefined;

const UploadForm: FC<{ csrf: string }> = ({ csrf }) => (
  <form method="post" action="/admin/import" enctype="multipart/form-data" class="form">
    <Csrf token={csrf} />
    <label class="field">
      <span>Fichier de la liste (.xlsx ou .csv)</span>
      <input type="file" name="file" accept=".xlsx,.csv" required />
      <span class="hint">2 Mo maximum.</span>
    </label>
    <div class="actions">
      <button type="submit" class="btn btn-primary">
        Importer
      </button>
    </div>
  </form>
);

export const ImportPage: FC<{ csrf: string; flash?: Flash; guestCount: number }> = ({ csrf, flash, guestCount }) => (
  <Layout title="Import / export" active="import" csrf={csrf} flash={flash}>
    <div class="page-head">
      <h1>Import / export</h1>
    </div>

    <section class="card">
      <h2>Importer la liste des invités</h2>
      <UploadForm csrf={csrf} />
    </section>

    <section class="card">
      <h2>Formats acceptés</h2>
      <h3>1. Le fichier Excel de la liste (feuille « Invités »)</h3>
      <p>
        Colonnes <strong>A et B</strong> : côté <strong>Rojo</strong> (nom, nombre de personnes) ; colonnes{' '}
        <strong>C et D</strong> : côté <strong>Orimbato</strong> (nom, nombre de personnes). Les lignes 1 et 2 sont des
        en-têtes. Un fichier CSV de même forme est aussi accepté.
      </p>
      <div class="sample-wrap">
        <table class="sample" aria-label="Exemple de feuille « Invités »">
          <thead>
            <tr>
              <th></th>
              <th>A</th>
              <th>B</th>
              <th>C</th>
              <th>D</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>1</th>
              <td colspan={2}>Rojo</td>
              <td colspan={2}>Orimbato</td>
            </tr>
            <tr>
              <th>2</th>
              <td>Nom</td>
              <td>Nombre</td>
              <td>Nom</td>
              <td>Nombre</td>
            </tr>
            <tr>
              <th>3</th>
              <td>Tante Lala</td>
              <td>3</td>
              <td>Famille Rabe</td>
              <td>4</td>
            </tr>
            <tr>
              <th>4</th>
              <td>Koto</td>
              <td>2</td>
              <td>Soa</td>
              <td>1</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>2. Le fichier CSV de l’export</h3>
      <p>
        Le fichier produit par « Exporter (CSV) » ci-dessous (colonnes Nom, Côté, Nombre prévu, Téléphone, Notes…) : vous
        pouvez le compléter dans Excel puis le réimporter.
      </p>
    </section>

    <section class="card">
      <h2>Règles appliquées</h2>
      <ul class="rules">
        <li>Les lignes « Famille inconnue », « Mpikabary » et « Orimbato » sont ignorées (ce ne sont pas des invités).</li>
        <li>
          Les noms sont nettoyés : espaces en trop, « ? » final, mention « + zaza » (notée dans les notes), mots collés
          séparés, majuscule initiale.
        </li>
        <li>Un nombre de personnes manquant vaut 1.</li>
        <li>
          Un nom déjà présent dans la liste n’est pas ajouté une deuxième fois, même si vous avez renommé l’invité
          depuis : vous pouvez réimporter le fichier sans risque de doublon (les invités existants ne sont pas modifiés).
        </li>
        <li>
          Un invité que vous avez supprimé est recréé s’il figure encore dans le fichier (pratique pour restaurer la
          liste depuis l’export) : la page de résultat le signale.
        </li>
      </ul>
    </section>

    <section class="card">
      <h2>Exporter</h2>
      <p class="muted">
        {`Liste actuelle : ${plural(guestCount, 'invité', 'invités')}. Le fichier CSV (séparateur « ; ») s’ouvre dans Excel et contient les liens, les ouvertures, les réponses et les tables.`}
      </p>
      <a class="btn" href="/admin/export.csv">
        Exporter (CSV)
      </a>
    </section>
  </Layout>
);

// ---------------------------------------------------------------- résultat

export interface ImportResultProps {
  csrf: string;
  flash?: Flash;
  fileName: string;
  format: 'feuille' | 'liste';
  sheet?: string;
  added: ImportRow[];
  skipped: ImportRow[];
  restored: ImportRow[];
  ignored: IgnoredRow[];
  warnings: string[];
}

const RowList: FC<{ rows: ImportRow[] }> = ({ rows }) => (
  <ul class="plain-list">
    {rows.map((r) => (
      <li>
        <span class="pl-name">{r.name}</span>
        <span class="pl-meta">
          <SideBadge side={r.side} /> <span class="small muted nowrap">{plural(r.expected_count, 'pers.', 'pers.')}</span>
        </span>
      </li>
    ))}
  </ul>
);

export const ImportResultPage: FC<ImportResultProps> = ({
  csrf,
  flash,
  fileName,
  format,
  sheet,
  added,
  skipped,
  restored,
  ignored,
  warnings,
}) => (
  <Layout title="Résultat de l’import" active="import" csrf={csrf} flash={flash}>
    <div class="page-head">
      <h1>Résultat de l’import</h1>
      <div class="actions">
        <a class="btn btn-primary" href="/admin">
          Voir les invités
        </a>
        <a class="btn" href="/admin/import">
          Importer un autre fichier
        </a>
      </div>
    </div>
    <p class="small muted">
      {`Fichier « ${fileName} » — format ${
        format === 'feuille' ? `feuille « Invités » (colonnes Rojo / Orimbato)${sheet ? `, feuille lue : « ${sheet} »` : ''}` : 'liste (export CSV)'
      }.`}
    </p>
    <div class="stats stats-4">
      <div class="stat ok">
        <span class="stat-v">{added.length}</span>
        <span class="stat-l">Ajoutés</span>
      </div>
      <div class="stat">
        <span class="stat-v">{skipped.length}</span>
        <span class="stat-l">Déjà présents</span>
      </div>
      <div class="stat">
        <span class="stat-v">{ignored.length}</span>
        <span class="stat-l">Lignes ignorées</span>
      </div>
      <div class={`stat${warnings.length ? ' none' : ''}`}>
        <span class="stat-v">{warnings.length}</span>
        <span class="stat-l">Avertissements</span>
      </div>
    </div>

    {warnings.length ? (
      <section class="card">
        <h2>Avertissements</h2>
        <ul class="rules">
          {warnings.map((w) => (
            <li>{w}</li>
          ))}
        </ul>
      </section>
    ) : null}

    {restored.length ? (
      <section class="card">
        <h2>{`Invités supprimés puis réajoutés (${restored.length})`}</h2>
        <p class="flash flash-err" role="alert">
          Vous aviez supprimé ces invités dans l’administration, mais ils figurent encore dans le fichier : ils ont été
          recréés, avec un nouveau lien. S’ils ne doivent pas être invités, supprimez-les de nouveau (et retirez-les du
          fichier).
        </p>
        <RowList rows={restored} />
      </section>
    ) : null}

    <section class="card">
      <h2>{`Ajoutés (${added.length})`}</h2>
      {added.length ? <RowList rows={added} /> : <p class="muted">Aucun nouvel invité.</p>}
    </section>

    {skipped.length ? (
      <section class="card">
        <h2>{`Déjà présents (${skipped.length})`}</h2>
        <p class="hint">
          Ces noms figuraient déjà dans la liste (ou y figuraient avant d’être modifiés) : ils n’ont pas été ajoutés ni
          modifiés.
        </p>
        <RowList rows={skipped} />
      </section>
    ) : null}


    {ignored.length ? (
      <section class="card">
        <h2>{`Lignes ignorées (${ignored.length})`}</h2>
        <ul class="plain-list">
          {ignored.map((r) => (
            <li>
              <span class="pl-name">{r.name}</span>
              <span class="pl-meta">
                {r.side ? <SideBadge side={r.side} /> : null} <span class="small muted">{r.reason}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    ) : null}

    <p>
      <a class="btn btn-primary" href="/admin">
        Retour à la liste des invités
      </a>
    </p>
  </Layout>
);
