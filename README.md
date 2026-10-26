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

1. [Sur votre PC ou votre serveur : essai en local](#1-sur-votre-pc-ou-votre-serveur--essai-en-local) (Node.js ou Docker, facultatif)
2. [Mise en ligne sans serveur — recommandé](#2-mise-en-ligne-sans-serveur--recommandé) (≈ 20 minutes, tout dans le navigateur)
3. [Mise en ligne depuis un terminal — autre méthode](#3-mise-en-ligne-depuis-un-terminal--autre-méthode)
4. [Utilisation au quotidien](#4-utilisation-au-quotidien)
5. [Tout supprimer après le 19 décembre](#5-tout-supprimer-après-le-19-décembre)
6. [En cas de problème](#6-en-cas-de-problème)
7. [Questions fréquentes](#7-questions-fréquentes) (serveur en panne, Node.js, proxys d’entreprise, Madagascar, nom de domaine)
8. [Pour les curieux : fonctionnement](#8-pour-les-curieux--fonctionnement)

---

## 1. Sur votre PC ou votre serveur : essai en local

Cette partie installe le projet sur votre ordinateur (ou votre serveur), le relie au dépôt GitHub et
le fait tourner **uniquement chez vous**, pour l’essayer. Elle est **facultative** : la mise en ligne
sans serveur (partie 2) se fait entièrement dans le navigateur.

Deux façons de lancer l’essai : avec **Node.js** (étapes A1 à A8) ou avec **Docker**, sans installer
Node.js (étapes A1 à A5, puis [variante Docker](#variante-docker--sans-installer-nodejs)).

### Étape A1 — Installer les trois outils

| Outil | À quoi il sert | Où le télécharger |
|---|---|---|
| **Node.js** (version **LTS**) | lancer les outils de Cloudflare et le site en local | <https://nodejs.org> → bouton « LTS » |
| **Git** | récupérer le code depuis GitHub et envoyer vos modifications | <https://git-scm.com/downloads> |
| **GitHub CLI** (`gh`) — *inutile si Git est déjà connecté à GitHub sur ce PC* | relier l’ordinateur à votre compte GitHub, sans mot de passe à taper | <https://cli.github.com> |

Installez-les dans cet ordre (suivant, suivant… en gardant les choix proposés).
Sur Mac, si `git` manque, macOS propose d’installer les « outils de ligne de commande » : acceptez.

**Sur Linux (Ubuntu, Debian…)**, tout s’installe dans le terminal (Ctrl + Alt + T) :

```
sudo apt update
sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo apt install -y gh        # seulement si Git n’est pas déjà connecté à GitHub
```

(Le paquet `nodejs` d’Ubuntu est trop ancien : la ligne `deb.nodesource.com` installe Node.js 22,
la version minimale demandée par l’outil de Cloudflare. Si `sudo apt install -y gh` répond
« Unable to locate package gh », utilisez le dépôt officiel de GitHub CLI :)

```
sudo mkdir -p -m 755 /etc/apt/keyrings
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update && sudo apt install -y gh
```

> La commande GitHub s’appelle **`gh`** (et non `github`).

> Prenez la version **LTS** de Node.js (stable, avec les correctifs de sécurité), pas « Current ».
> Node.js ne sert que **sur votre PC** : il ne tourne pas sur le site en ligne
> (voir [Questions fréquentes](#7-questions-fréquentes)).

### Étape A2 — Ouvrir un terminal

- **Windows** : ouvrez le dossier **Documents** dans l’Explorateur, cliquez dans la barre d’adresse,
  tapez `cmd` puis Entrée.
- **Mac** : ouvrez l’application **Terminal**, tapez `cd ~/Documents` puis Entrée.
- **Linux** : ouvrez un terminal (Ctrl + Alt + T) : vous êtes dans votre dossier personnel, restez-y.
  Évitez `/opt` ou d’autres dossiers système : ils appartiennent à `root` et `npm install` échouerait
  (n’utilisez jamais `sudo npm`).

Toutes les commandes se tapent dans ce terminal, **une par une**, suivies de Entrée.
Vérifiez les installations (chaque commande doit afficher un numéro de version) :

```
node -v
git --version
gh --version
```

(`node -v` doit afficher `v22…` ou plus récent : l’outil de Cloudflare l’exige. Si une commande « n’est pas reconnue »,
fermez puis rouvrez le terminal ; sinon réinstallez l’outil.)

> **Git est déjà connecté à GitHub sur ce PC** (vous l’utilisez pour d’autres projets) ? Sautez les
> étapes A3 et A4 (GitHub CLI est alors inutile) et passez directement à l’étape A5.

### Étape A3 — Vous présenter à Git (une seule fois)

Git signe chaque modification avec un nom et une adresse e-mail. Mettez **votre** nom et l’e-mail de
votre compte GitHub :

```
git config --global user.name "Votre Prénom"
git config --global user.email "votre-email@exemple.com"
```

### Étape A4 — Relier l’ordinateur à votre compte GitHub (une seule fois)

```
gh auth login
```

Répondez aux questions avec les flèches du clavier puis Entrée :

1. *Where do you use GitHub?* → **GitHub.com**
2. *What is your preferred protocol for Git operations?* → **HTTPS**
3. *Authenticate Git with your GitHub credentials?* → **Yes**
4. *How would you like to authenticate GitHub CLI?* → **Login with a web browser**
5. Le terminal affiche un code à 8 caractères (ex. `A1B2-C3D4`) : appuyez sur Entrée, le navigateur
   s’ouvre sur GitHub ; connectez-vous, collez le code, cliquez **Authorize**.

Le terminal affiche « ✓ Logged in as … ». Vérifiez à tout moment avec `gh auth status`.
Git utilisera cette connexion : plus besoin de mot de passe pour envoyer vos modifications.

### Étape A5 — Récupérer le dépôt distant (cloner)

Toujours dans le terminal ouvert dans **Documents** :

```
git clone https://github.com/OriiT/Invitation_vodiondry.git
cd Invitation_vodiondry
```

Si vos autres projets utilisent **SSH** (`git remote -v` y affiche `git@github.com:…`), clonez de la
même façon : `git clone git@github.com:OriiT/Invitation_vodiondry.git`.

Un dossier `Invitation_vodiondry` est créé avec tout le projet, relié au dépôt GitHub.
Vérifiez le lien avec le dépôt distant :

```
git remote -v
git status
```

`git remote -v` affiche deux lignes `origin  https://github.com/OriiT/Invitation_vodiondry.git` ;
`git status` affiche « On branch main … up to date with 'origin/main' ».

> Tant que la pull request n’est pas fusionnée dans `main`, le code est sur une autre branche :
> tapez `git checkout claude/adoring-allen-s5ggsa` (une fois la fusion faite, restez sur `main`).

Copiez enfin `Budget_reception_5.xlsx` dans ce dossier `Invitation_vodiondry`. Il ne sera **jamais**
envoyé sur GitHub (le dépôt est public et le fichier `.gitignore` exclut les `.xlsx` : `git status`
ne le montre même pas).

**Pour rouvrir un terminal plus tard au bon endroit** : ouvrez le dossier `Invitation_vodiondry` dans
l’Explorateur et tapez `cmd` dans la barre d’adresse (Windows), ou `cd ~/Documents/Invitation_vodiondry`
dans Terminal (Mac), ou `cd ~/Invitation_vodiondry` (Linux).

> Sans Git, vous pouvez aussi faire **Code → Download ZIP** sur la page GitHub et décompresser :
> tout fonctionne, mais vous ne pourrez ni envoyer de modification ni récupérer les mises à jour
> avec `git pull`.

### Variante Docker — sans installer Node.js

À la place des étapes A6 à A8, si Docker et Docker Compose sont installés (par exemple sur un serveur
sans écran). Dans le dossier du projet :

```
docker compose up --build -d dev
docker compose logs -f dev
```

Attendez la ligne `Ready on http://0.0.0.0:8787` (puis **Ctrl + C** pour quitter l’affichage : le site
continue de tourner). Depuis un autre appareil du même réseau, ouvrez :

- `http://<adresse-du-serveur>:8787` : l’invitation (ex. `http://192.168.1.15:8787`) ;
- `http://<adresse-du-serveur>:8787/admin` : l’administration (mot de passe local : **`admin-local`**).

Pour essayer avec la vraie liste : **/admin → Import / export** → `Budget_reception_5.xlsx`.

| Action | Commande |
|---|---|
| Arrêter | `docker compose down` (les données d’essai restent dans un volume Docker) |
| Effacer les données d’essai | `docker compose down -v` |
| Après un `git pull` | `docker compose up --build -d dev` |
| Pare-feu Ubuntu qui bloque | `sudo ufw allow 8787/tcp` |

Commandes Cloudflare depuis Docker (facultatif, pour la partie 3) : copiez `.env.example` en `.env`,
renseignez-y le jeton et l’Account ID (étape S4), puis par exemple
`docker compose run --rm cli npx wrangler whoami`. Pour importer la liste en ligne depuis le serveur,
placez le fichier dans le dossier `donnees/` puis :
`docker compose run --rm cli npm run import -- donnees/Budget_reception_5.xlsx --dry-run`
(et sans `--dry-run` pour importer). Le fichier `.env` et le dossier `donnees/` ne sont jamais envoyés
sur GitHub ni copiés dans l’image.

### Étape A6 — Installer les outils du projet (une seule fois, 1 à 2 minutes)

```
npm install
```

### Étape A7 — Lancer le site sur votre PC

```
npm run dev
```

Attendez la ligne `Ready on http://localhost:8787`, puis ouvrez dans votre navigateur :

- <http://localhost:8787> : l’invitation générique ;
- <http://localhost:8787/admin> : l’administration (mot de passe local : **`admin-local`**).

### Étape A8 — Essayer avec la vraie liste (en local)

Laissez le premier terminal ouvert, ouvrez-en un **second** dans le dossier `Invitation_vodiondry`,
puis :

```
npm run import -- Budget_reception_5.xlsx --local
```

Rechargez <http://localhost:8787/admin> : 33 invités, 76 personnes. Cliquez **Voir** sur un invité pour
voir son invitation personnelle, répondez « Oui », regardez le tableau se mettre à jour.
Cette base locale est un **brouillon** : elle est indépendante de celle qui sera en ligne.

Pour arrêter le site local : dans le premier terminal, **Ctrl + C**.

---

## 2. Mise en ligne sans serveur — recommandé

Tout se fait **dans le navigateur** (ordinateur ou téléphone), sur les sites de Cloudflare et de GitHub.
Ensuite :

- le site, la base de données et l’administration tournent **chez Cloudflare** : ils fonctionnent même
  si votre PC ou votre serveur est éteint ou en panne ;
- chaque modification de la branche `main` sur GitHub est **testée puis mise en ligne
  automatiquement** par GitHub (onglet *Actions*) : aucun serveur personnel n’est nécessaire,
  même pour les mises à jour.

Coût : **0 €** (offres gratuites de Cloudflare et de GitHub).

### Étape S1 — Compte Cloudflare et adresse `workers.dev`

1. Créez un compte gratuit sur <https://dash.cloudflare.com/sign-up> et validez l’e-mail.
2. Ouvrez **Workers & Pages** (menu de gauche, parfois sous *Compute*). Si Cloudflare vous propose de
   **choisir votre sous-domaine `workers.dev`**, choisissez un nom court (ex. `orimbato-rojo`) ; sinon,
   il est affiché à droite de cette page, avec un bouton pour le choisir ou le changer.
   Votre adresse finale sera `https://vodiondry.orimbato-rojo.workers.dev`.
3. Notez votre **Account ID** : affiché à droite de la même page, ou dans l’adresse du navigateur
   (`dash.cloudflare.com/<account-id>/…`).

### Étape S2 — Créer la base de données

1. Menu **Storage & Databases → D1 SQL Database → Create** (ou *Create database*).
2. Nom : **`vodiondry`** (exactement) → **Create**.
3. Copiez le **Database ID** affiché (de la forme `8c1f2a4e-1234-4abc-9def-0123456789ab`).

### Étape S3 — Coller l’identifiant de la base dans `wrangler.toml`, sur GitHub

1. Sur <https://github.com/OriiT/Invitation_vodiondry> (branche `main`), ouvrez le fichier
   `wrangler.toml` puis cliquez sur le crayon (*Edit this file*).
2. Remplacez `00000000-0000-0000-0000-000000000000` par votre identifiant (gardez les guillemets).
3. **Commit changes…** → *Commit directly to the `main` branch* → **Commit changes**.

(L’identifiant n’est pas un secret : sans accès à votre compte Cloudflare, il ne permet rien.)

### Étape S4 — Créer un jeton API Cloudflare

1. Cloudflare → icône de profil en haut à droite → **My Profile → API Tokens → Create Token**.
2. Modèle **Edit Cloudflare Workers** → **Use template**.
3. Dans **Permissions**, **+ Add more** → **Account · D1 · Edit**.
4. **Account Resources** : *Include · votre compte* (laissez le reste tel quel).
5. **Continue to summary → Create Token**, puis **copiez le jeton** (il n’est affiché qu’une fois).

### Étape S5 — Donner les secrets à GitHub

Sur GitHub : dépôt → **Settings → Secrets and variables → Actions → New repository secret**,
quatre fois :

| Name | Secret |
|---|---|
| `CLOUDFLARE_API_TOKEN` | le jeton de l’étape S4 |
| `CLOUDFLARE_ACCOUNT_ID` | l’Account ID de l’étape S1 |
| `ADMIN_PASSWORD` | le mot de passe de l’administration (au moins 10 caractères) |
| `SESSION_SECRET` | une suite aléatoire d’au moins 32 caractères (générateur de mots de passe : 40 caractères, lettres et chiffres) |

Ces secrets ne sont jamais visibles dans le code ni dans les journaux, et GitHub ne les réaffiche plus.

### Étape S6 — Lancer la mise en ligne

1. Vérifiez que `main` est la branche par défaut : **Settings → General → Default branch → `main`**.
2. Onglet **Actions** → **Tests et mise en ligne** → **Run workflow** → branche `main` → **Run workflow**.
3. Attendez 2 à 4 minutes : *Tests* puis *Mise en ligne sur Cloudflare* passent au vert ✅.
4. Le site est en ligne à `https://vodiondry.<votre-sous-domaine>.workers.dev` (adresse aussi visible
   dans Cloudflare → **Workers & Pages → vodiondry**).

Si une étape est rouge ❌, cliquez dessus pour lire le message : voir aussi
[En cas de problème](#6-en-cas-de-problème). Si *Mise en ligne* est simplement sautée avec le message
« Mise en ligne non configurée », il manque un secret (S5) ou l’identifiant de la base (S3).

### Étape S7 — Importer la liste et vérifier

1. Ouvrez `https://vodiondry.<votre-sous-domaine>.workers.dev/admin` et connectez-vous (mot de passe S5).
2. **Import / export** → choisissez `Budget_reception_5.xlsx` → **Importer** :
   33 invités, 76 personnes (3 lignes ignorées). L’import peut être relancé sans créer de doublons.
3. **Voir** sur un invité : son prénom apparaît sur la carte « Réponse ».
4. Envoyez-vous un **WhatsApp** de test, ouvrez-le sur votre téléphone en 4G et répondez ; remettez
   ensuite la bonne réponse depuis la fiche de l’invité.
5. Envoyez les invitations (boutons **WhatsApp**). 🎉

### Ensuite : mises à jour automatiques

Toute modification fusionnée dans `main` (par exemple une *pull request*) est testée puis mise en ligne
toute seule. Si les tests échouent, rien n’est publié : le site garde la version précédente.
Les invités, réponses et réglages en ligne sont toujours conservés.

---

## 3. Mise en ligne depuis un terminal — autre méthode

À utiliser seulement si vous ne voulez pas de la mise en ligne sans serveur (partie 2) : chaque mise
à jour devra alors être publiée depuis votre PC avec `npm run deploy`.

> **Serveur sans écran** : `npx wrangler login` (étape B2) a besoin d’un navigateur sur la machine.
> Remplacez-le par le jeton de l’étape S4 :
> `export CLOUDFLARE_API_TOKEN="…"` et `export CLOUDFLARE_ACCOUNT_ID="…"` (vérification :
> `npx wrangler whoami`), ou utilisez les commandes Docker `docker compose run --rm cli …`
> ([variante Docker](#variante-docker--sans-installer-nodejs)).

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
5. Envoyez cette modification sur GitHub, pour que le dépôt distant contienne la bonne configuration :

   ```
   git add wrangler.toml
   git commit -m "Identifiant de la base D1 de production"
   git push
   ```

   (L’identifiant n’est pas un secret : sans accès à votre compte Cloudflare, il ne permet rien.)

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

### Étape B10 (facultative) — Mise en ligne automatique

Pour que GitHub publie le site tout seul à chaque mise à jour, faites les étapes S4 à S6 de la
partie 2 (jeton API, secrets GitHub, *Run workflow*).

---

## 4. Utilisation au quotidien

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

### Récupérer une mise à jour du code

Avec la mise en ligne sans serveur (partie 2), **il n’y a rien à faire** : toute modification de `main`
est publiée automatiquement. Les commandes ci-dessous ne servent qu’à mettre à jour votre copie locale
(essai en local) ou, avec la méthode de la partie 3, à publier depuis le PC. Dans le terminal ouvert
dans le dossier du projet :

```
git pull
npm install
npm run deploy
```

`git pull` récupère les modifications du dépôt distant ; `npm run deploy` les met en ligne
(inutile avec la mise en ligne automatique). Les invités, réponses et réglages en ligne sont conservés.

---

## 5. Tout supprimer après le 19 décembre

1. (Facultatif) Gardez un souvenir : **/admin → Import / export → Exporter (CSV)**.
1. Si vous utilisez la mise en ligne automatique (partie 2) : GitHub → **Actions → Tests et mise en
   ligne → ⋯ → Disable workflow** (sinon une future modification de `main` recréerait le site), puis
   **Settings → Secrets and variables → Actions** : supprimez les quatre secrets. Côté Cloudflare,
   **My Profile → API Tokens** : supprimez le jeton.
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
4. (Facultatif) Désinstallez Node.js, Git et GitHub CLI de votre PC, supprimez le dossier du projet,
   et `gh auth logout` pour délier l’ordinateur de GitHub.

Sans passer par le terminal, c’est aussi possible dans le tableau de bord Cloudflare :
*Workers & Pages → vodiondry → Settings → Delete*, puis *Storage & Databases → D1 → vodiondry → Delete*.

---

## 6. En cas de problème

| Message / situation | Solution |
|---|---|
| GitHub *Actions* : « You need to register a workers.dev subdomain » | Étape S1 : choisissez votre sous-domaine `workers.dev`, puis **Re-run jobs**. |
| GitHub *Actions* : « Authentication error » ou « code: 10000 » | Le jeton n’a pas les bonnes permissions : refaites l’étape S4 (avec **D1 · Edit**) et remplacez le secret `CLOUDFLARE_API_TOKEN`. |
| GitHub *Actions* : « Couldn't find a D1 DB » | Étapes S2-S3 : la base doit s’appeler `vodiondry` et son identifiant être collé dans `wrangler.toml`. |
| Pas de bouton **Run workflow** dans *Actions* | `main` n’est pas la branche par défaut : **Settings → General → Default branch**. |
| `npm` ou `npx` « n’est pas reconnu » | Node.js n’est pas installé : voir <https://nodejs.org>, puis rouvrez le terminal. |
| `Command 'github' not found` | La commande s’appelle `gh` : `gh auth login` (installation : étape A1). |
| `Wrangler requires at least Node.js v22` | Node.js trop ancien : installez la version 22 ou plus (étape A1). |
| `EACCES: permission denied` pendant `npm install` (Linux) | Le dossier appartient à `root` (ex. `/opt`) : clonez le projet dans votre dossier personnel (`cd ~` puis étape A5), sans `sudo`. |
| `Not logged in` / `Authentication error` | `npx wrangler login` |
| `database_id … 00000000…` ou `Couldn't find a D1 DB` | L’identifiant de l’étape B3 n’est pas collé dans `wrangler.toml`. |
| `no such table: guests` | Étape B4 oubliée : `npx wrangler d1 migrations apply vodiondry --remote` |
| La page de connexion dit que les secrets ne sont pas configurés | Étape B5 : `ADMIN_PASSWORD` et `SESSION_SECRET` (au moins 16 caractères). |
| Mot de passe de l’administration oublié (après l’avoir changé dans Réglages) | `npx wrangler d1 execute vodiondry --remote --command "DELETE FROM settings WHERE key = 'admin_password_hash'"` → le mot de passe redevient celui de l’étape B5 (`npx wrangler secret put ADMIN_PASSWORD` pour en choisir un autre). |
| « Trop de tentatives » | Protection contre les abus : attendez 15 minutes. |
| Un invité dit que son lien « n’est plus valide » | Son code a été régénéré : renvoyez-lui le nouveau lien depuis sa fiche. |
| Modifier le site après coup | `git pull` puis `npm run deploy` (les données sont conservées). |
| `git push` refusé (`Authentication failed`, `403`) | `gh auth login` (étape A4), puis `gh auth status` doit afficher « Logged in ». |
| `git pull` refuse à cause de « local changes » sur `wrangler.toml` | Envoyez d’abord votre modification (étape B3, point 5), puis refaites `git pull`. |
| Un invité n’arrive pas à ouvrir le lien depuis le réseau de son entreprise | Qu’il l’ouvre sur son téléphone en 4G ; voir aussi [Questions fréquentes](#7-questions-fréquentes). |

---

## 7. Questions fréquentes

### Et si mon PC ou mon serveur tombe en panne ?

Rien ne change pour les invités ni pour vous :

- le **site**, la **base de données** et l’**administration** tournent chez **Cloudflare** ;
- le **code** est sur **GitHub**, et les mises à jour y sont testées puis publiées (partie 2) ;
- votre PC ou votre serveur ne sert qu’à l’essai en local (partie 1), facultatif.

Vous pouvez tout gérer depuis un téléphone. Par précaution, exportez de temps en temps le CSV
(**Import / export → Exporter**) ; Cloudflare garde aussi un historique de la base de 7 jours
(*Time Travel*, offre gratuite) qui permet de revenir en arrière en cas d’erreur.

### Pourquoi Node.js ? Pourquoi pas Nuxt ?

- **Le site en ligne n’utilise pas Node.js.** Il tourne chez Cloudflare (Workers), sur leur propre
  moteur, mis à jour et protégé par Cloudflare. Rien de Node.js n’est exposé sur Internet.
- **Node.js ne sert que pour les outils** : sur votre PC pour l’essai local (ou dans Docker, sans
  l’installer), et chez GitHub pour les tests et la publication automatique (partie 2). Il lance
  `wrangler`, l’outil officiel de Cloudflare, qui est lui-même un programme Node.js.
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

## 8. Pour les curieux : fonctionnement

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
