// Crée .dev.vars (secrets locaux) à partir de .dev.vars.example s'il n'existe pas encore.
import { existsSync, copyFileSync } from 'node:fs';

if (!existsSync('.dev.vars')) {
  copyFileSync('.dev.vars.example', '.dev.vars');
  console.log('→ Fichier .dev.vars créé (mot de passe admin local : admin-local)');
}
