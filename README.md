# Vodiondry d’Orimbato & Rojo — invitation, réponses et plan de table

Petite application web pour le **vodiondry du samedi 19 décembre 2026**
(10 h cérémonie à Ankofafa, Fianarantsoa — 13 h repas à l’Espace La Rizière, Antady).

- Chaque invité reçoit **son propre lien** (`https://vodiondry.<votre-compte>.workers.dev/i/k3m9x2pq`).
  Il ouvre l’invitation (l’enveloppe, la vidéo et les animations sont inchangées), avec son prénom
  dans la carte « Réponse » : *« Neny, nous attendons votre réponse. »*
- L’invité répond **Oui / Non** directement sur l’invitation (nombre de personnes, petit mot facultatif).
  Il peut modifier sa réponse jusqu’à la date limite (12/12/2026 par défaut, modifiable).
- Les mariés suivent tout depuis l’**administration** (`/admin`, protégée par mot de passe) :
  invités, réponses, relances WhatsApp, import/export, plan de table, marque-tables.
- Aucun compte n’est demandé aux invités. Hébergement **gratuit** chez Cloudflare.

---

## Sommaire

1. [Mise en ligne, pas à pas](#1-mise-en-ligne-pas-à-pas) (≈ 20 minutes, une seule fois)
2. [Utilisation au quotidien](#2-utilisation-au-quotidien)
3. [Tout supprimer après le 19 décembre](#3-tout-supprimer-après-le-19-décembre)
4. [En cas de problème](#4-en-cas-de-problème)
5. [Pour les curieux : fonctionnement et développement local](#5-pour-les-curieux--fonctionnement-et-développement-local)

---

## 1. Mise en ligne, pas à pas

### Ce qu’il faut avant de commencer

- Un ordinateur (Windows, Mac ou Linux) avec **Node.js** version 20 ou plus récente :
  téléchargez la version « LTS » sur <https://nodejs.org> et installez-la (suivant, suivant…).
- Le dossier de ce projet sur l’ordinateur : sur GitHub, bouton vert **Code → Download ZIP**,
  puis décompressez-le (ou `git clone …` si vous connaissez Git).
- Le fichier de la liste des invités `Budget_reception_5.xlsx`.

### Ouvrir un terminal dans le dossier du projet

- **Windows** : ouvrez le dossier dans l’Explorateur, cliquez dans la barre d’adresse, tapez `cmd` puis Entrée.
- **Mac** : clic droit sur le dossier → *Services* → *Nouveau terminal au dossier*
  (ou ouvrez *Terminal* et tapez `cd ` puis glissez le dossier dans la fenêtre, Entrée).

Toutes les commandes ci-dessous se tapent dans ce terminal, **une par une**, suivies de Entrée.

Installez d’abord les outils du projet (une seule fois, 1 à 2 minutes) :

```
npm install
```

### Étape 1 — Créer un compte Cloudflare gratuit

1. Allez sur <https://dash.cloudflare.com/sign-up>, créez un compte (e-mail + mot de passe), validez l’e-mail.
2. Dans le tableau de bord Cloudflare, ouvrez **Workers & Pages** (menu de gauche, parfois sous *Compute*).
   Si Cloudflare vous propose de **choisir un sous-domaine `workers.dev`**, choisissez un nom court
   (par exemple `orimbato-rojo`) : votre adresse finale sera `https://vodiondry.orimbato-rojo.workers.dev`.
   Sinon, ce choix vous sera proposé à l’étape 6.

Le plan gratuit suffit très largement (100 000 visites par jour).

### Étape 2 — Relier l’ordinateur à votre compte Cloudflare

```
npx wrangler login
```

Une page s’ouvre dans le navigateur : cliquez sur **Allow / Autoriser**. Le terminal affiche
« Successfully logged in ».

### Étape 3 — Créer la base de données

```
npx wrangler d1 create vodiondry
```

Le terminal affiche un bloc qui contient une ligne de ce genre :

```
database_id = "8c1f2a4e-1234-4abc-9def-0123456789ab"
```

1. Si Wrangler demande *« Would you like Wrangler to add it on your behalf? »*, répondez **n** (non).
2. Ouvrez le fichier **`wrangler.toml`** du projet avec un éditeur de texte (Bloc-notes, TextEdit…).
3. Remplacez `00000000-0000-0000-0000-000000000000` par **votre** identifiant (gardez les guillemets) :

   ```toml
   database_id = "8c1f2a4e-1234-4abc-9def-0123456789ab"
   ```

4. Enregistrez le fichier.

### Étape 4 — Créer les tables de la base

```
npx wrangler d1 migrations apply vodiondry --remote
```

Répondez **y** (oui) à la question. Le terminal affiche `0001_init.sql ✅` puis `0002_former_names.sql ✅`.

### Étape 5 — Choisir le mot de passe de l’administration

```
npx wrangler secret put ADMIN_PASSWORD
```

Tapez le mot de passe que vous utiliserez pour entrer dans `/admin` (au moins 10 caractères ;
rien ne s’affiche pendant la frappe, c’est normal), puis Entrée.
Si Wrangler demande s’il doit créer le Worker « vodiondry », répondez **y**.

Puis créez la clé secrète qui protège les sessions. Générez une longue chaîne au hasard :

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

copiez la ligne affichée, puis :

```
npx wrangler secret put SESSION_SECRET
```

et collez-la, Entrée. (Vous n’aurez jamais besoin de la retaper : inutile de la noter.)

> Ces deux secrets sont stockés chez Cloudflare, **jamais** dans les fichiers du projet.

### Étape 6 — Mettre le site en ligne

```
npm run deploy
```

(Répondez **y** si une confirmation est demandée ; si Cloudflare vous demande de choisir votre
sous-domaine `workers.dev`, choisissez-le maintenant.) À la fin, le terminal affiche l’adresse :

```
https://vodiondry.<votre-compte>.workers.dev
```

C’est l’**adresse finale**. Ouvrez-la : vous voyez l’invitation « générique »
(à la place des boutons : *« Demandez votre lien personnel aux mariés. »*).
L’administration est à `https://vodiondry.<votre-compte>.workers.dev/admin`.

### Étape 7 — Importer la liste des invités

**Le plus simple — depuis l’administration :**

1. Ouvrez `https://vodiondry.<votre-compte>.workers.dev/admin` et connectez-vous.
2. Onglet **Import / export** → choisissez `Budget_reception_5.xlsx` → **Importer**.
3. Le résultat s’affiche : invités ajoutés, lignes ignorées, remarques.

**Ou depuis le terminal** (copiez d’abord le fichier dans le dossier du projet) :

```
npm run import -- Budget_reception_5.xlsx --dry-run
npm run import -- Budget_reception_5.xlsx
```

La première commande montre ce qui serait importé, sans rien écrire ; la seconde importe pour de bon.

Dans les deux cas :

- la feuille **« Invités »** est lue : colonnes A/B = côté Rojo (Nom, Nombre), C/D = côté Orimbato
  (Nom, Nombre), lignes 1–2 = en-têtes ;
- les lignes « Famille inconnue », « Mpikabary » et « Orimbato » sont ignorées ;
- les noms sont nettoyés (exemples fictifs : « tanteLala » → « Tante Lala », « koto? » → « Koto »,
  « Soa+ zaza » → « Soa », « Soa + zaza » → « Soa ») ; le nom d’origine est gardé dans les notes ;
- chaque invité reçoit un code personnel de 8 caractères tiré au hasard ;
- l’import peut être relancé sans risque : **un nom déjà présent n’est jamais dupliqué**, même si
  vous avez renommé l’invité depuis dans l’administration ; un invité que vous avez **supprimé** mais
  qui figure encore dans le fichier est recréé (pratique pour restaurer la liste depuis l’export) et
  signalé sur la page de résultat.

Avec la liste actuelle : **33 invités, 76 personnes** (3 lignes ignorées).

> ⚠️ Le dépôt GitHub de ce projet est **public** : ne mettez jamais la liste des invités dedans
> (le fichier `.gitignore` empêche déjà d’y ajouter les fichiers `.xlsx`).

C’est en ligne. 🎉

---

## 2. Utilisation au quotidien

Tout se fait depuis `/admin`, aussi bien sur téléphone que sur ordinateur.

### Envoyer les invitations

Onglet **Invités** : pour chaque invité, le bouton vert **WhatsApp** ouvre WhatsApp avec le message
déjà rédigé :

> Tongasoa ! Voici votre invitation au vodiondry d'Orimbato & Rojo, samedi 19 décembre 2026 :
> https://vodiondry.…/i/xxxxxxxx. Merci de répondre directement sur la page.

Choisissez le contact et envoyez. Si vous avez saisi le numéro de téléphone de l’invité
(bouton **Modifier**), WhatsApp ouvre directement sa conversation. **Copier le lien** copie le lien
seul (pour un SMS, Messenger…). **Voir** ouvre l’invitation telle que l’invité la verra
(vos propres visites ne sont pas comptées comme des ouvertures).

### Suivre les réponses

- En haut : invités, personnes attendues, oui, non, sans réponse, personnes confirmées.
- Filtres par côté (Rojo / Orimbato) et par statut (oui, non, sans réponse, lien jamais ouvert…).
- Colonne **Lien ouvert** : si l’invité a ouvert son lien, et quand.
- Un invité peut confirmer **au plus le nombre de personnes prévu** pour lui dans la liste
  (modifiable dans sa fiche).
- Un invité a répondu par téléphone ? Fiche de l’invité → **Saisir la réponse à la place de l’invité**
  (possible même après la date limite).

### Relancer

Onglet **Relances** : la liste de ceux qui n’ont pas encore répondu (ceux qui n’ont jamais ouvert
leur lien en premier), avec un bouton WhatsApp et un message de rappel prérempli.

### Modifier un invité, régénérer un lien

Fiche de l’invité (**Modifier**) : nom, côté, nombre prévu, téléphone, notes, historique des réponses
et des ouvertures. **Régénérer le code** crée un nouveau lien et désactive l’ancien
(utile si un lien a été transféré par erreur). **Supprimer** efface l’invité et ses réponses.

### Exporter

Onglet **Import / export** → **Exporter (CSV)** : tout le tableau (s’ouvre dans Excel).
Ce fichier peut aussi être réimporté.

### Plan de table (pour plus tard)

Onglet **Plan de table** :

1. Créez les tables (nom, nombre de places, ordre).
2. Placez les invités qui ont répondu **oui** ou **pas encore répondu** : glissez-déposez leur
   étiquette dans une table, ou utilisez le menu **Déplacer vers…** (pratique sur téléphone).
3. Le compteur de chaque table indique les places occupées ; une alerte s’affiche si une table
   dépasse sa capacité.
4. **Imprimer le plan** et **Marque-tables** (nom de chaque table en grand, à imprimer et plier)
   ; **Exporter (CSV)** pour le traiteur.
5. Quand le plan est prêt : **Réglages → Publier le plan de table**. Chaque invité qui a répondu oui
   voit alors *« Votre table : … »* sur son invitation.

Si un invité répond finalement « non », il est retiré automatiquement de sa table.

### Réglages

Onglet **Réglages** : texte du message WhatsApp d’invitation et de relance (variables `{nom}`,
`{lien}`, `{date_limite}`), date limite de réponse, publication du plan de table,
changement du mot de passe de l’administration.

---

## 3. Tout supprimer après le 19 décembre

1. (Facultatif) Gardez un souvenir : **/admin → Import / export → Exporter (CSV)**.
2. Dans le terminal, dans le dossier du projet :

   ```
   npx wrangler delete
   ```

   → le site et l’administration ne sont plus accessibles (les secrets sont supprimés avec lui).
   Répondez **y** pour confirmer.

   ```
   npx wrangler d1 delete vodiondry
   ```

   → la base de données (invités, réponses, ouvertures, tables) est **définitivement** effacée.
   Répondez **y** pour confirmer.

3. (Facultatif) `npx wrangler logout` pour délier l’ordinateur de votre compte, et supprimez le compte
   Cloudflare depuis *My Profile → Delete account* si vous ne vous en servez plus.

Sans passer par le terminal, c’est aussi possible dans le tableau de bord Cloudflare :
*Workers & Pages → vodiondry → Settings → Delete*, puis *Storage & Databases → D1 → vodiondry → Delete*.

---

## 4. En cas de problème

| Message / situation | Solution |
|---|---|
| `npm` ou `npx` « n’est pas reconnu » | Node.js n’est pas installé : voir <https://nodejs.org>, puis rouvrez le terminal. |
| `Not logged in` / `Authentication error` | `npx wrangler login` |
| `database_id … 00000000…` ou `Couldn't find a D1 DB` | L’identifiant de l’étape 3 n’est pas collé dans `wrangler.toml`. |
| `no such table: guests` | Étape 4 oubliée : `npx wrangler d1 migrations apply vodiondry --remote` |
| La page de connexion dit que les secrets ne sont pas configurés | Étape 5 : `ADMIN_PASSWORD` et `SESSION_SECRET` (au moins 16 caractères). |
| Mot de passe de l’administration oublié (après l’avoir changé dans Réglages) | `npx wrangler d1 execute vodiondry --remote --command "DELETE FROM settings WHERE key = 'admin_password_hash'"` → le mot de passe redevient celui de l’étape 5 (`npx wrangler secret put ADMIN_PASSWORD` pour en choisir un autre). |
| « Trop de tentatives » | Protection contre les abus : attendez 15 minutes. |
| Un invité dit que son lien « n’est plus valide » | Son code a été régénéré : renvoyez-lui le nouveau lien depuis sa fiche. |
| Modifier le site après coup | Refaites `npm run deploy` (les données sont conservées). |

---

## 5. Pour les curieux : fonctionnement et développement local

### Architecture

- **Cloudflare Workers** (code dans `src/`, framework [Hono](https://hono.dev), TypeScript),
  **D1** (base SQLite) et **Workers Static Assets** (le dossier `public/`), le tout publié par un seul
  `wrangler deploy`.
- `public/index.html` et `public/a/` = le site d’invitation **tel que livré**, sans aucune modification
  (un test vérifie son empreinte). Pour un lien personnel, le Worker ajoute à la volée les données de
  l’invité et `public/vd/rsvp.js`, qui personnalise la phrase de la carte « Réponse » et ouvre la
  fenêtre de réponse quand on touche « Oui, je viens » / « Non ».
- Administration rendue côté serveur (`src/routes/admin/`, `src/views/`), un peu de JavaScript sans
  framework (`public/vd/admin.js`, `public/vd/tables.js` + SortableJS pour le glisser-déposer).
- Base de données : `migrations/0001_init.sql` — `guests`, `responses` (une ligne par réponse ou
  changement, la plus récente fait foi), `opens` (ouvertures du lien : date, navigateur ; des visites
  à moins de 30 minutes d’intervalle comptent pour une), `tables`, `settings` ;
  `migrations/0002_former_names.sql` — `former_names` (anciens noms des invités renommés et noms des
  invités supprimés, consultés par l’import).

| Adresse | Rôle |
|---|---|
| `/` | invitation générique (sans lien personnel) |
| `/i/<code>` | invitation personnelle (ouverture enregistrée, sauf robots d’aperçu WhatsApp et visites des mariés connectés) |
| `POST /api/rsvp/<code>` | réponse `{ "answer": "oui" \| "non", "count": 3, "message": "…" }` |
| `/admin` | administration (invités, relances, plan de table, import/export, réglages) |

### Sécurité

- Codes personnels : 8 caractères base32 tirés avec `crypto.getRandomValues` (≈ 10¹² possibilités).
- Administration : mot de passe (secret Cloudflare, ou empreinte PBKDF2 s’il a été changé dans
  Réglages), session dans un cookie signé HMAC `HttpOnly; Secure; SameSite=Lax`, jeton CSRF sur
  chaque formulaire, vérification de l’origine, Content-Security-Policy stricte, pages non indexées.
- Limitation de débit sur `/api/rsvp` (par adresse et par invitation) et sur la connexion ; HTML systématiquement échappé ;
  export CSV protégé contre les formules Excel.
- Données personnelles : uniquement les noms, nombres de personnes et téléphones saisis par vous,
  plus la date et le navigateur des ouvertures de lien.

### Développement local

```
npm install
npm run dev
```

Puis ouvrez <http://localhost:8787> (invitation) et <http://localhost:8787/admin>
(mot de passe local : `admin-local`, défini dans le fichier `.dev.vars` créé automatiquement).
La base locale est indépendante de celle en ligne. Pour y importer la liste :

```
npm run import -- Budget_reception_5.xlsx --local
```

Tests automatiques (API, réponses, administration, plan de table, import) et vérification des types :

```
npm test
npm run typecheck
```
