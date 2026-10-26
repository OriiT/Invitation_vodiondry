-- Anciens noms des invités (avant un renommage dans l'administration) et noms des invités supprimés.
-- L'import les consulte : réimporter le fichier ne recrée pas un invité renommé, et signale un invité supprimé
-- qu'il recrée (restauration de la liste depuis l'export).

CREATE TABLE former_names (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Pas de clé étrangère : la ligne doit survivre à la suppression de l'invité.
  guest_id  INTEGER NOT NULL,
  name      TEXT    NOT NULL,
  -- 1 : l'invité a été supprimé.
  deleted   INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
);
CREATE INDEX idx_former_names_guest ON former_names(guest_id);
