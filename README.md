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

1. [Sur votre PC : installer et essayer en local](#1-sur-votre-pc--installer-et-essayer-en-local) (≈ 15 minutes)
2. [Mise en ligne sur Cloudflare](#2-mise-en-ligne-sur-cloudflare) (≈ 20 minutes, une seule fois)
3. [Utilisation au quotidien](#3-utilisation-au-quotidien)
4. [Tout supprimer après le 19 décembre](#4-tout-supprimer-après-le-19-décembre)
5. [En cas de problème](#5-en-cas-de-problème)
6. [Questions fréquentes](#6-questions-fréquentes) (Node.js, proxys d’entreprise, Madagascar, nom de domaine)
7. [Pour les curieux : fonctionnement](#7-pour-les-curieux--fonctionnement)

---

## 1. Sur votre PC : installer et essayer en local

Cette partie installe le projet sur votre ordinateur et le fait tourner **uniquement chez vous**
(rien n’est encore en ligne). C’est aussi depuis ce PC que vous mettrez le site en ligne à la partie 2.

### Étape A1 — Installer Node.js (l’outil qui lance les commandes)

1. Allez sur <https://nodejs.org> et téléchargez la version **LTS** (« Long Term Support »,
   la version stable et maintenue avec les correctifs de sécurité). Évitez la version « Current ».
2. Installez-la (suivant, suivant… en gardant les choix proposés).
3. Vérifiez : ouvrez un terminal (voir A3) et tapez `node -v`. Il doit afficher `v22…` ou plus récent.

> Node.js ne sert que **sur votre PC**, pour lancer les outils de Cloudflare. Il ne tourne pas sur le
> site en ligne. Voir [Questions fréquentes](#6-questions-fréquentes).

### Étape A2 — Récupérer le projet

Sur GitHub (<https://github.com/OriiT/Invitation_vodiondry>), bouton vert **Code → Download ZIP**,
puis décompressez le fichier dans un dossier facile à retrouver (par exemple `Documents\vodiondry`).
Copiez aussi `Budget_reception_5.xlsx` dans ce dossier.

### Étape A3 — Ouvrir un terminal dans le dossier du projet

- **Windows** : ouvrez le dossier dans l’Explorateur, cliquez dans la barre d’adresse, tapez `cmd` puis Entrée.
- **Mac** : clic droit sur le dossier → *Services* → *Nouveau terminal au dossier*
  (ou ouvrez *Terminal*, tapez `cd ` puis glissez le dossier dans la fenêtre, Entrée).

Toutes les commandes se tapent dans ce terminal, **une par une**, suivies de Entrée.

### Étape A4 — Installer les outils du projet (une seule fois, 1 à 2 minutes)

```
npm install
```

### Étape A5 — Lancer le site sur votre PC

```
npm run dev
```

Attendez la ligne `Ready on http://localhost:8787`, puis ouvrez dans votre navigateur :

- <http://localhost:8787> : l’invitation générique ;
- <http://localhost:8787/admin> : l’administration (mot de passe local : **`admin-local`**).

### Étape A6 — Essayer avec la vraie liste (en local)

Laissez le premier terminal ouvert, ouvrez-en un **second** dans le même dossier (A3), puis :

```
npm run import -- Budget_reception_5.xlsx --local
```

Rechargez <http://localhost:8787/admin> : 33 invités, 76 personnes. Cliquez **Voir** sur un invité pour
voir son invitation personnelle, répondez « Oui », regardez le tableau se mettre à jour.
Cette base locale est un **brouillon** : elle est indépendante de celle qui sera en ligne.

Pour arrêter le site local : dans le premier terminal, **Ctrl + C**.

---

## 2. Mise en ligne sur Cloudflare

Toujours depuis le terminal ouvert dans le dossier du projet.

### Étape B1 — Créer un compte Cloudflare gratuit

1. Allez sur <https://dash.cloudflare.com/sign-up>, créez un compte (e-mail + mot de passe), validez l’e-mail.
2. Dans le tableau de bord Cloudflare, ouvrez **Workers & Pages** (menu de gauche, parfois sous *Compute*).
   Si Cloudflare vous propose de **choisir un sous-domaine `workers.dev`**, choisissez un nom court
   (par exemple `orimbato-rojo`) : votre adresse finale sera `https://vodiondry.orimbato-rojo.workers.dev`.
   Sinon, ce choix vous sera proposé à l’étape B6.

Le plan gratuit suffit très largement (100 000 visites par jour).

### Étape B2 — Relier l’ordinateur à votre compte Cloudflare

```
npx wrangler login
```

Une page s’ouvre dans le navigateur : cliquez sur **Allow / Autoriser**. Le terminal affiche
« Successfully logged in ».

### Étape B3 — Créer la base de données

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

### Étape B4 — Créer les tables de la base

```
npx wrangler d1 migrations apply vodiondry --remote
```

Répondez **y** (oui) à la question. Le terminal affiche `0001_init.sql ✅` puis `0002_former_names.sql ✅`.

### Étape B5 — Choisir le mot de passe de l’administration

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

### Étape B6 — Mettre le site en ligne

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

### Étape B7 — Importer la liste des invités (en ligne)

**Le plus simple — depuis l’administration :**

1. Ouvrez `https://vodiondry.<votre-compte>.workers.dev/admin` et connectez-vous.
2. Onglet **Import / export** → choisissez `Budget_reception_5.xlsx` → **Importer**.
3. Le résultat s’affiche : invités ajoutés, lignes ignorées, remarques.

**Ou depuis le terminal** (sans `--local`, c’est la base en ligne qui est remplie) :

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

### Étape B8 — Vérifier avant d’envoyer les invitations

1. Dans `/admin`, cliquez **Voir** sur un invité : son prénom apparaît sur la carte « Réponse ».
2. Envoyez-vous à vous-même un **WhatsApp** de test, ouvrez le lien sur votre téléphone
   (en 4G, pas en Wi-Fi) et répondez « Oui » : le tableau passe à 1 « Oui ».
3. Fiche de cet invité → **Saisir la réponse** pour remettre la bonne réponse, ou **Régénérer le code**.

C’est en ligne. 🎉

### Étape B9 (facultative) — Votre propre nom de domaine

Voir [Questions fréquentes → un nom de domaine à soi](#un-nom-de-domaine-à-soi-facultatif-environ-10--par-an).

---

## 3. Utilisation au quotidien

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

## 4. Tout supprimer après le 19 décembre

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
4. (Facultatif) Désinstallez Node.js de votre PC et supprimez le dossier du projet.

Sans passer par le terminal, c’est aussi possible dans le tableau de bord Cloudflare :
*Workers & Pages → vodiondry → Settings → Delete*, puis *Storage & Databases → D1 → vodiondry → Delete*.

---

## 5. En cas de problème

| Message / situation | Solution |
|---|---|
| `npm` ou `npx` « n’est pas reconnu » | Node.js n’est pas installé : voir <https://nodejs.org>, puis rouvrez le terminal. |
| `Not logged in` / `Authentication error` | `npx wrangler login` |
| `database_id … 00000000…` ou `Couldn't find a D1 DB` | L’identifiant de l’étape B3 n’est pas collé dans `wrangler.toml`. |
| `no such table: guests` | Étape B4 oubliée : `npx wrangler d1 migrations apply vodiondry --remote` |
| La page de connexion dit que les secrets ne sont pas configurés | Étape B5 : `ADMIN_PASSWORD` et `SESSION_SECRET` (au moins 16 caractères). |
| Mot de passe de l’administration oublié (après l’avoir changé dans Réglages) | `npx wrangler d1 execute vodiondry --remote --command "DELETE FROM settings WHERE key = 'admin_password_hash'"` → le mot de passe redevient celui de l’étape B5 (`npx wrangler secret put ADMIN_PASSWORD` pour en choisir un autre). |
| « Trop de tentatives » | Protection contre les abus : attendez 15 minutes. |
| Un invité dit que son lien « n’est plus valide » | Son code a été régénéré : renvoyez-lui le nouveau lien depuis sa fiche. |
| Modifier le site après coup | Refaites `npm run deploy` (les données sont conservées). |
| Un invité n’arrive pas à ouvrir le lien depuis le réseau de son entreprise | Qu’il l’ouvre sur son téléphone en 4G ; voir aussi [Questions fréquentes](#6-questions-fréquentes). |

---

## 6. Questions fréquentes

### Pourquoi Node.js ? Pourquoi pas Nuxt ?

- **Le site en ligne n’utilise pas Node.js.** Il tourne chez Cloudflare (Workers), sur leur propre
  moteur, mis à jour et protégé par Cloudflare. Rien de Node.js n’est exposé sur Internet.
- **Node.js ne sert que sur votre PC**, quelques minutes, pour lancer `wrangler` (l’outil officiel de
  Cloudflare pour publier un site, qui est lui-même un programme Node.js), `npm install` et les tests.
  `npm run dev` n’écoute que sur votre propre ordinateur (`localhost`).
- **Nuxt ne supprimerait pas Node.js** : Nuxt est un framework Vue qui a lui aussi besoin de Node.js
  pour être développé et construit, et Cloudflare demande de toute façon `wrangler`. Nuxt ajouterait
  surtout beaucoup de code (un framework complet côté navigateur), alors que le cahier des charges
  demandait Hono, du HTML rendu côté serveur et pas de framework lourd.
- **Sécurité** : installez la version **LTS** de Node.js depuis <https://nodejs.org> et acceptez ses mises
  à jour (les correctifs de sécurité sont publiés pour les versions LTS). Côté projet, `npm audit`
  ne signale **aucune vulnérabilité** (outils de développement compris) au moment de la livraison ;
  le code publié en ligne n’utilise que deux petites bibliothèques (Hono et fflate).
  Après le 19 décembre, vous pouvez désinstaller Node.js (partie 4).

### Le lien sera-t-il accessible partout, y compris à Madagascar ?

Oui. Cloudflare sert le site depuis plus de 300 villes, dont **Antananarivo** : un invité à Madagascar
est servi au plus près. Le site est léger (≈ 1,2 Mo d’images et de vidéo, mis en cache), en HTTPS,
et fonctionne en 3G/4G (Telma, Orange, Airtel) comme en Wi-Fi.

### Et derrière le proxy d’une entreprise ?

La plupart des réseaux d’entreprise laissent passer les sites Cloudflare (une grande partie du web
passe par Cloudflare). **Mais** certains filtres d’entreprise bloquent par précaution toutes les adresses
en `….workers.dev`, parce que ces adresses gratuites sont parfois utilisées pour des arnaques.
Deux parades :

1. l’invité ouvre le lien **sur son téléphone en 4G** (c’est le cas de la grande majorité : le lien arrive
   par WhatsApp) ;
2. vous utilisez **votre propre nom de domaine** (ci-dessous) : une adresse comme
   `orimbato-rojo.com/i/…` inspire confiance et est beaucoup plus rarement bloquée.

### Un nom de domaine à soi (facultatif, environ 10 € par an)

1. Tableau de bord Cloudflare → **Domain Registration → Register Domains** : achetez par exemple
   `orimbato-rojo.com` (prix coûtant, ≈ 10 € par an ; c’est le seul élément payant).
2. **Workers & Pages → vodiondry → Settings → Domains & Routes → Add → Custom domain** :
   saisissez `orimbato-rojo.com` (ou `invitation.orimbato-rojo.com`), validez. Le certificat HTTPS est
   créé automatiquement en quelques minutes.
3. Ouvrez désormais l’administration à `https://orimbato-rojo.com/admin` : les liens copiés et les
   messages WhatsApp utilisent automatiquement l’adresse depuis laquelle vous êtes connecté.
4. (Facultatif) Dans le même écran, désactivez l’adresse `workers.dev`.

Faites ce choix **avant** d’envoyer les invitations : les liens déjà envoyés gardent l’ancienne adresse
(elle continue de fonctionner tant que vous ne la désactivez pas).

---

## 7. Pour les curieux : fonctionnement

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

### Tests

Tests automatiques (API, réponses, administration, plan de table, import) et vérification des types :

```
npm test
npm run typecheck
```
