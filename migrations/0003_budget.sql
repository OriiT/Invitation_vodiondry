-- Budget du mariage (page « Budget » de l'administration), option retenue : grande salle de La Rizière
-- et Grill Traiteur Parasoly, menu 3. Montants en Ariary (nombres entiers).
--   « forfait »      : montant fixe (location de la salle, décoration…)
--   « par_personne » : montant multiplié par le nombre de personnes (menu, couverts…)

CREATE TABLE budget_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT    NOT NULL,
  detail      TEXT    NOT NULL DEFAULT '',
  kind        TEXT    NOT NULL CHECK (kind IN ('forfait', 'par_personne')),
  amount      INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Postes du fichier Excel (option retenue).
INSERT INTO budget_items (label, detail, kind, amount, sort_order) VALUES
  ('Menu Parasoly 3', 'Entrée 2, plat laoka 2, dessert, jus naturel, gâteau, sono avec DJ, lumière et effets spéciaux', 'par_personne', 45000, 1),
  ('Couverts', '3 000 Ar par personne, à confirmer avec Parasoly', 'par_personne', 3000, 2),
  ('Boisson', 'jus naturel compris dans le menu', 'par_personne', 0, 3);

INSERT INTO budget_items (label, detail, kind, amount, sort_order) VALUES
  ('Location salle La Rizière', 'grande salle, tables et chaises, sans couvert', 'forfait', 300000, 10),
  ('Fono tseza', 'housses de chaises', 'forfait', 90000, 11),
  ('Nappes', '', 'forfait', 25000, 12),
  ('Décoration salle', 'comptée ici, pas dans le menu', 'forfait', 750000, 13),
  ('Sono, DJ, lumière', 'compris dans le menu Parasoly 3', 'forfait', 0, 14),
  ('Gâteau', 'compris dans le menu Parasoly 3', 'forfait', 0, 15),
  ('Divers', '', 'forfait', 0, 16);

-- Personnes présentes au repas mais absentes de la liste d'invités (lignes que l'import ignore volontairement :
-- les mariés, une famille non identifiée, le mpikabary). Fichier Excel : 83 personnes = 76 de la liste + 7.
INSERT INTO settings (key, value) VALUES ('budget_extra_people', '7') ON CONFLICT(key) DO NOTHING;
