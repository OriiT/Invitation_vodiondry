// Import de la liste des invités (XLSX ou CSV) dans la base D1, depuis l'ordinateur.
//
//   npm run import -- <fichier.xlsx|fichier.csv> [--local] [--dry-run] [--db vodiondry] [--persist-to <dossier>]
//
// Par défaut, la cible est la base de PRODUCTION (D1 distante, « --remote ») ; « --local » vise la base
// locale de « npm run dev ». L'import est idempotent : un nom déjà présent (sans tenir compte de la casse)
// n'est jamais dupliqué. Wrangler est lancé directement avec Node (sans shell) : fonctionne aussi sous Windows.

import { generateCode } from '../src/lib/codes';
import { nameKey, SIDE_LABEL } from '../src/lib/db';
import { parseGuestFile, type ImportParse, type ImportRow } from '../src/lib/import';
import { buildNameIndex, classifyRows, KNOWN_NAMES_SQL, type KnownName } from '../src/lib/import-db';

// ---------------------------------------------------------------- modules Node
// Chargés dynamiquement : le projet (code du Worker) ne dépend pas de @types/node.

interface SpawnResult {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error?: Error;
}
interface NodeModules {
  cp: { spawnSync(command: string, args: readonly string[], options: Record<string, unknown>): SpawnResult };
  fs: {
    readFileSync(path: string): Uint8Array;
    writeFileSync(path: string, data: string, options: { encoding: 'utf8'; mode: number }): void;
    mkdtempSync(prefix: string): string;
    rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
    existsSync(path: string): boolean;
  };
  os: { tmpdir(): string };
  path: {
    resolve(...paths: string[]): string;
    join(...paths: string[]): string;
    dirname(path: string): string;
    basename(path: string): string;
  };
  module: { createRequire(url: string): { resolve(id: string): string } };
  url: { fileURLToPath(url: string | URL): string };
}

const load = (id: string): Promise<unknown> => import(id);
const [cp, fs, os, path, module, url] = await Promise.all(
  ['node:child_process', 'node:fs', 'node:os', 'node:path', 'node:module', 'node:url'].map(load),
);
const node = { cp, fs, os, path, module, url } as NodeModules;

// ---------------------------------------------------------------- affichage

const out = (s = '') => console.log(s);
const fail = (s: string) => console.error(`\n✖ ${s}`);
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

const USAGE = `Utilisation :
  npm run import -- <fichier.xlsx|fichier.csv> [options]

Options :
  --remote                 base de production sur Cloudflare (par défaut)
  --local                  base locale (celle de « npm run dev ») au lieu de la base de production
  --dry-run                affiche ce qui serait ajouté, sans rien écrire
  --db <nom>               nom de la base D1 (par défaut : vodiondry)
  --persist-to <dossier>   dossier de la base locale (avec --local uniquement)
  -h, --help               affiche cette aide

Exemples :
  npm run import -- liste.xlsx --dry-run      (vérifier sans rien écrire)
  npm run import -- liste.xlsx                (ajouter les invités en production)
  npm run import -- liste.xlsx --local        (ajouter les invités à la base locale)`;

class CliError extends Error {}

// ---------------------------------------------------------------- arguments

interface Options {
  file: string;
  local: boolean;
  dryRun: boolean;
  db: string;
  persistTo: string | null;
}

function parseArgs(argv: string[]): Options | null {
  const o: Options = { file: '', local: false, dryRun: false, db: 'vodiondry', persistTo: null };
  let remote = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
    const value = (): string => {
      const v = inline ?? argv[++i];
      if (v === undefined || v === '' || (inline === undefined && v.startsWith('--'))) throw new CliError(`L’option ${flag} attend une valeur.\n\n${USAGE}`);
      return v;
    };
    switch (flag) {
      case '-h':
      case '--help':
        return null;
      case '--local':
        o.local = true;
        break;
      case '--remote':
        remote = true;
        break;
      case '--dry-run':
        o.dryRun = true;
        break;
      case '--db':
        o.db = value();
        break;
      case '--persist-to':
        o.persistTo = value();
        break;
      default:
        if (a.startsWith('-')) throw new CliError(`Option inconnue : ${a}\n\n${USAGE}`);
        if (o.file) throw new CliError(`Un seul fichier à la fois (reçu « ${o.file} » et « ${a} »).`);
        o.file = a;
    }
  }
  if (!o.file) throw new CliError(`Indiquez le fichier à importer.\n\n${USAGE}`);
  if (o.local && remote) throw new CliError('Choisissez --local OU --remote, pas les deux.');
  if (o.persistTo && !o.local) throw new CliError('--persist-to ne s’utilise qu’avec --local (base locale).');
  if (!/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(o.db)) throw new CliError(`Nom de base invalide : « ${o.db} ».`);
  return o;
}

// ---------------------------------------------------------------- wrangler

/** URL de ce script (les types des Workers ne déclarent pas import.meta.url). */
const SCRIPT_URL = (import.meta as ImportMeta & { url: string }).url;
const ROOT = node.url.fileURLToPath(new URL('..', SCRIPT_URL));

function wranglerBin(): string {
  let pkgPath: string;
  try {
    pkgPath = node.module.createRequire(SCRIPT_URL).resolve('wrangler/package.json');
  } catch {
    throw new CliError('Wrangler n’est pas installé : lancez « npm install » dans le dossier du projet, puis recommencez.');
  }
  const pkg = JSON.parse(new TextDecoder().decode(node.fs.readFileSync(pkgPath))) as { bin?: string | Record<string, string> };
  const rel = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin?.wrangler ?? 'bin/wrangler.js');
  return node.path.join(node.path.dirname(pkgPath), rel);
}

const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

interface WranglerJsonError {
  text?: string;
  message?: string;
  notes?: { text?: string }[];
}

class WranglerError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
  }
}

/** Lance « wrangler d1 execute » (sans shell) et renvoie la sortie JSON. */
function d1Execute(o: Options, input: { command: string } | { file: string }): unknown {
  const args = [wranglerBin(), 'd1', 'execute', o.db, o.local ? '--local' : '--remote'];
  if (o.local && o.persistTo) args.push(`--persist-to=${node.path.resolve(o.persistTo)}`);
  if ('command' in input) args.push(`--command=${input.command}`);
  else args.push(`--file=${input.file}`, '--yes');
  args.push('--json');

  const r = node.cp.spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw new WranglerError('Impossible de lancer Wrangler.', r.error.message);

  const stdout = (r.stdout ?? '').trim();
  let json: unknown;
  const start = stdout.search(/[[{]/);
  if (start >= 0) {
    try {
      json = JSON.parse(stdout.slice(start));
    } catch {
      json = undefined;
    }
  }
  const jsonError = json && typeof json === 'object' && !Array.isArray(json) ? (json as { error?: WranglerJsonError }).error : undefined;
  if (r.status === 0 && json !== undefined && !jsonError) return json;

  const parts: string[] = [];
  if (jsonError) {
    const main = jsonError.text ?? jsonError.message;
    if (main) parts.push(main);
    for (const n of jsonError.notes ?? []) if (n.text) parts.push(n.text);
  }
  if (!parts.length) {
    const lines = stripAnsi(`${r.stderr ?? ''}\n${start < 0 ? stdout : ''}`)
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.trim() && !/Proxy environment variables detected/i.test(l));
    parts.push(...lines.slice(-15));
  }
  if (!parts.length) parts.push(r.signal ? `Wrangler interrompu (${r.signal}).` : `Wrangler s’est arrêté avec le code ${r.status}.`);
  throw new WranglerError('Wrangler a renvoyé une erreur.', parts.join('\n'));
}

/** Conseil en français selon l'erreur renvoyée par Wrangler. */
function hintFor(detail: string, o: Options): string | null {
  const migrate = `npx wrangler d1 migrations apply ${o.db} ${o.local ? '--local' : '--remote'}${o.local && o.persistTo ? ` --persist-to "${o.persistTo}"` : ''}`;
  if (/CLOUDFLARE_API_TOKEN|not logged in|wrangler login|logged in|authenticat|Invalid access token|\[code: 10000\]|\[code: 9109\]/i.test(detail)) {
    return 'Vous n’êtes pas connecté à Cloudflare : lancez « npx wrangler login », acceptez dans le navigateur, puis relancez l’import.';
  }
  if (/no such table/i.test(detail)) {
    return `La base ne contient pas encore les tables de l’application. Appliquez d’abord les migrations :\n    ${migrate}`;
  }
  if (/Couldn't find a D1 DB/i.test(detail)) {
    return `Aucune base « ${o.db} » dans wrangler.toml. Vérifiez l’option --db (nom de la base : database_name dans wrangler.toml).`;
  }
  if (/More than one account|account_id/i.test(detail)) {
    return 'Plusieurs comptes Cloudflare : ajoutez la ligne account_id = "…" en haut de wrangler.toml (identifiant affiché par « npx wrangler whoami »), puis relancez l’import.';
  }
  if (/fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|network/i.test(detail)) {
    return 'Problème de connexion à Internet : vérifiez la connexion puis relancez l’import.';
  }
  if (!o.local && /database|\[code: 7\d{3}\]|not found|invalid uuid/i.test(detail)) {
    return 'Vérifiez database_id dans wrangler.toml : il doit être l’identifiant affiché par « npx wrangler d1 list » (ou « npx wrangler d1 create vodiondry »).';
  }
  return null;
}

/** Identifiant de la base dans wrangler.toml : null s'il n'est pas renseigné (valeur d'exemple 0000…). */
function databaseIdIssue(db: string): string | null {
  const file = node.path.join(ROOT, 'wrangler.toml');
  if (!node.fs.existsSync(file)) return null; // configuration au format JSON : on laisse Wrangler vérifier
  const toml = new TextDecoder().decode(node.fs.readFileSync(file));
  for (const block of toml.split(/^\s*\[\[\s*d1_databases\s*\]\]\s*$/m).slice(1)) {
    const body = block.split(/^\s*\[/m)[0];
    const get = (k: string) => new RegExp(`^\\s*${k}\\s*=\\s*["']([^"']*)["']`, 'm').exec(body)?.[1];
    if (get('database_name') !== db && get('binding') !== db) continue;
    const id = (get('database_id') ?? '').trim();
    if (!id || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id)) {
      return [
        'L’identifiant de la base D1 n’est pas renseigné dans wrangler.toml (database_id = "00000000-…").',
        '  1. Affichez-le avec : npx wrangler d1 list   (ou créez la base : npx wrangler d1 create vodiondry)',
        '  2. Collez-le dans wrangler.toml, à la ligne database_id = "…"',
        '  3. Relancez l’import.',
      ].join('\n');
    }
    return null;
  }
  return null;
}

/** Noms connus de la base : invités actuels, anciens noms (renommés) et invités supprimés (voir import-db.ts). */
function readKnownNames(o: Options): KnownName[] {
  const json = d1Execute(o, { command: KNOWN_NAMES_SQL.replace(/\s+/g, ' ') });
  const first = Array.isArray(json) ? (json[0] as { results?: unknown; success?: boolean } | undefined) : undefined;
  if (!first || !Array.isArray(first.results)) {
    throw new WranglerError('Réponse inattendue de Wrangler.', JSON.stringify(json).slice(0, 500));
  }
  return first.results.map((r) => {
    const row = r as { name?: unknown; kind?: unknown };
    const kind = row.kind === 'deleted' || row.kind === 'renamed' ? row.kind : 'guest';
    return { name: String(row.name ?? ''), kind };
  });
}

function readExistingNames(o: Options): string[] {
  return readKnownNames(o)
    .filter((n) => n.kind === 'guest')
    .map((n) => n.name);
}

// ---------------------------------------------------------------- SQL

const sqlString = (s: string) => `'${s.replace(/\u0000/g, '').replace(/'/g, "''")}'`;

function insertSql(rows: ImportRow[]): string {
  const used = new Set<string>();
  const lines = ['-- Import des invités (généré par scripts/import.ts)'];
  for (const r of rows) {
    let code = generateCode();
    while (used.has(code)) code = generateCode();
    used.add(code);
    const name = sqlString(r.name);
    const count = Math.max(0, Math.trunc(r.expected_count) || 0);
    lines.push(
      `INSERT INTO guests (code, name, side, expected_count, phone, notes) ` +
        `SELECT ${sqlString(code)}, ${name}, ${sqlString(r.side)}, ${count}, ${r.phone ? sqlString(r.phone) : 'NULL'}, ${sqlString(r.notes)} ` +
        `WHERE NOT EXISTS (SELECT 1 FROM guests WHERE name = ${name} COLLATE NOCASE);`,
    );
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------- rapport

function pad(s: string, n: number): string {
  const len = [...s].length;
  return len >= n ? s : s + ' '.repeat(n - len);
}

function printParsed(p: ImportParse & { sheet?: string }) {
  const width = Math.min(36, Math.max(10, ...p.rows.map((r) => [...r.name].length)));
  for (const side of ['rojo', 'orimbato'] as const) {
    const rows = p.rows.filter((r) => r.side === side);
    const people = rows.reduce((n, r) => n + r.expected_count, 0);
    out();
    out(`Côté ${SIDE_LABEL[side]} : ${plural(rows.length, 'invité', 'invités')}, ${plural(people, 'personne', 'personnes')}`);
    if (!rows.length) out('   (aucun)');
    rows.forEach((r, i) => {
      const orig = r.original !== r.name ? `   (dans le fichier : « ${r.original} »)` : '';
      out(`  ${String(i + 1).padStart(3)}. ${pad(r.name, width)} ${String(r.expected_count).padStart(3)}${orig}`);
    });
  }
  if (p.ignored.length) {
    out();
    out(`Lignes ignorées (${p.ignored.length}) :`);
    for (const g of p.ignored) out(`   • ${g.name}${g.side ? ` (${SIDE_LABEL[g.side]})` : ''} — ${g.reason}`);
  }
  if (p.warnings.length) {
    out();
    out(`Avertissements (${p.warnings.length}) :`);
    for (const w of p.warnings) out(`   • ${w}`);
  }
  const people = p.rows.reduce((n, r) => n + r.expected_count, 0);
  out();
  out(`Total : ${plural(p.rows.length, 'invité', 'invités')}, ${plural(people, 'personne prévue', 'personnes prévues')}.`);
}

// ---------------------------------------------------------------- programme

function readGuestFile(file: string): ImportParse & { sheet?: string } {
  const abs = node.path.resolve(process.cwd(), file);
  if (!node.fs.existsSync(abs)) throw new CliError(`Fichier introuvable : ${abs}`);
  let data: Uint8Array;
  try {
    data = node.fs.readFileSync(abs);
  } catch (e) {
    throw new CliError(`Impossible de lire ${abs} : ${e instanceof Error ? e.message : String(e)}`);
  }
  const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase() ?? '';
  if (ext === 'xls' && !(data[0] === 0x50 && data[1] === 0x4b)) {
    throw new CliError('Ancien format Excel (.xls) non pris en charge : enregistrez le fichier au format .xlsx ou .csv.');
  }
  let parsed: ImportParse & { sheet?: string };
  try {
    parsed = parseGuestFile(new Uint8Array(data));
  } catch (e) {
    throw new CliError(`Fichier illisible : ${e instanceof Error ? e.message : String(e)}`);
  }
  return parsed;
}

function main(o: Options): number {
  const target = o.local
    ? `base LOCALE « ${o.db} »${o.persistTo ? ` (dossier ${node.path.resolve(o.persistTo)})` : ''}`
    : `base de PRODUCTION « ${o.db} » (Cloudflare D1)`;

  const parsed = readGuestFile(o.file);
  out(`Fichier : ${node.path.basename(o.file)}${parsed.sheet ? ` — feuille « ${parsed.sheet} »` : ''}`);
  out(`Format : ${parsed.format === 'feuille' ? 'feuille « Invités » (Rojo en A/B, Orimbato en C/D)' : 'liste (une ligne par invité)'}`);
  printParsed(parsed);
  if (!parsed.rows.length) {
    throw new CliError(
      'Aucun invité trouvé dans ce fichier. Vérifiez qu’il s’agit de la feuille « Invités » (colonnes A à D) ou d’un export CSV de l’administration.',
    );
  }

  out();
  out(`Cible : ${target}${o.dryRun ? ' — simulation (--dry-run) : rien ne sera écrit' : ''}`);

  // Invités déjà enregistrés
  let existing: KnownName[] | null = null;
  const idIssue = o.local ? null : databaseIdIssue(o.db);
  if (idIssue) {
    if (!o.dryRun) throw new CliError(idIssue);
    out(`\n⚠ ${idIssue}\n  Comparaison avec la base impossible : tous les invités du fichier sont comptés comme nouveaux.`);
  } else {
    out('Lecture des invités déjà enregistrés…');
    try {
      existing = readKnownNames(o);
      const n = existing.filter((k) => k.kind === 'guest').length;
      out(`→ ${plural(n, 'invité déjà enregistré', 'invités déjà enregistrés')}.`);
    } catch (e) {
      if (!(e instanceof WranglerError) || !o.dryRun) throw e;
      const hint = hintFor(e.detail, o);
      out(`\n⚠ Lecture de la base impossible :\n${indent(e.detail)}${hint ? `\n  ${hint}` : ''}`);
      out('  Tous les invités du fichier sont comptés comme nouveaux.');
    }
  }

  // Même règle que l'import de l'administration (src/lib/import-db.ts) : casse ignorée, nom nettoyé ou d'origine,
  // anciens noms des invités renommés ; un invité supprimé dans l'administration est recréé, mais signalé.
  const { added: toAdd, skipped: already, restored } = classifyRows(buildNameIndex(existing ?? []), parsed.rows);
  if (already.length) {
    out();
    out(`Déjà présents, non dupliqués (${already.length}) : ${already.map((r) => r.name).join(', ')}`);
  }
  if (restored.length) {
    out();
    out(
      `⚠ Supprimés dans l’administration mais encore dans le fichier : ${o.dryRun ? 'seraient recréés' : 'seront recréés'} ` +
        `(${restored.length}) : ${restored.map((r) => r.name).join(', ')}`,
    );
  }
  out();
  out(
    toAdd.length
      ? `${o.dryRun ? 'Seraient ajoutés' : 'À ajouter'} (${toAdd.length}) : ${toAdd.map((r) => r.name).join(', ')}`
      : 'Aucun nouvel invité : tous les noms sont déjà enregistrés.',
  );

  const ignored = parsed.ignored.length;
  if (o.dryRun) {
    out();
    out(
      `Simulation : ${plural(toAdd.length, 'invité serait ajouté', 'invités seraient ajoutés')}, ` +
        `${already.length} déjà présent(s) (non dupliqués), ${ignored} ligne(s) ignorée(s). Rien n’a été écrit.`,
    );
    out(`Pour importer pour de bon, relancez la même commande sans --dry-run.`);
    return 0;
  }

  let added = 0;
  if (toAdd.length) {
    const dir = node.fs.mkdtempSync(node.path.join(node.os.tmpdir(), 'vodiondry-import-'));
    const sqlFile = node.path.join(dir, 'import.sql');
    try {
      node.fs.writeFileSync(sqlFile, insertSql(toAdd), { encoding: 'utf8', mode: 0o600 });
      out();
      out(`Écriture de ${plural(toAdd.length, 'invité', 'invités')} dans la ${target}…`);
      d1Execute(o, { file: sqlFile });
    } finally {
      node.fs.rmSync(dir, { recursive: true, force: true });
    }
    // Vérification : relecture des noms enregistrés.
    let now: Set<string> | null = null;
    try {
      now = new Set(readExistingNames(o).map(nameKey));
    } catch (e) {
      if (!(e instanceof WranglerError)) throw e;
      out(`⚠ Écriture terminée, mais la vérification a échoué :\n${indent(e.detail)}\n  Contrôlez la liste dans l’administration.`);
    }
    const missing = now ? toAdd.filter((r) => !now.has(nameKey(r.name))) : [];
    added = toAdd.length - missing.length;
    if (missing.length) {
      fail(`${plural(missing.length, 'invité n’a pas été enregistré', 'invités n’ont pas été enregistrés')} : ${missing.map((r) => r.name).join(', ')}`);
    }
  }

  out();
  out(`✔ ${added} invité(s) ajouté(s), ${already.length} déjà présent(s) (non dupliqués), ${ignored} ligne(s) ignorée(s)`);
  out('Les liens personnels sont dans l’administration : /admin');
  if (o.local) out('(base locale : lancez « npm run dev » puis ouvrez http://localhost:8787/admin)');
  return added === toAdd.length ? 0 : 1;
}

function indent(s: string): string {
  return s
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}

function run(): number {
  let o: Options | null;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    fail(e.message);
    return 2;
  }
  if (!o) {
    out(USAGE);
    return 0;
  }
  try {
    return main(o);
  } catch (e) {
    if (e instanceof CliError) fail(e.message);
    else if (e instanceof WranglerError) {
      const hint = hintFor(e.detail, o);
      fail(`${e.message}\n${indent(e.detail)}${hint ? `\n\n→ ${hint}` : ''}`);
    } else fail(`Erreur inattendue : ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    return 1;
  }
}

process.exitCode = run();
