-- Schéma initial : invités, réponses, ouvertures de lien, tables, réglages.

CREATE TABLE tables (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  capacity    INTEGER NOT NULL DEFAULT 10 CHECK (capacity >= 0),
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE guests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT    NOT NULL UNIQUE,
  name            TEXT    NOT NULL,
  side            TEXT    NOT NULL CHECK (side IN ('rojo', 'orimbato')),
  expected_count  INTEGER NOT NULL DEFAULT 1 CHECK (expected_count >= 0),
  phone           TEXT    NULL,
  notes           TEXT    NOT NULL DEFAULT '',
  table_id        INTEGER NULL REFERENCES tables(id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_guests_table ON guests(table_id);
CREATE INDEX idx_guests_name ON guests(name COLLATE NOCASE);

-- Une ligne par réponse (ou changement de réponse) : la plus récente fait foi.
CREATE TABLE responses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id     INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  answer       TEXT    NOT NULL CHECK (answer IN ('oui', 'non')),
  count        INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  message      TEXT    NOT NULL DEFAULT '',
  answered_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_responses_guest ON responses(guest_id, id);

-- Chaque ouverture du lien personnel.
CREATE TABLE opens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id   INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  opened_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ua         TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX idx_opens_guest ON opens(guest_id, id);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
