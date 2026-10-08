-- Email notifications, recalls, warranties/renewals, and the "what to buy" parts card.

ALTER TABLE vehicles ADD COLUMN notify_emails TEXT;        -- comma-separated; who gets this car's emails
ALTER TABLE vehicles ADD COLUMN recall_models TEXT;        -- NHTSA model names to check, comma-separated
ALTER TABLE vehicles ADD COLUMN recalls_checked_at TEXT;

-- Warranties (kind = 'warranty': months from in-service date / miles on the odometer)
-- and dated reminders (kind = 'renewal' or 'other': due_date, rolled forward by repeat_months).
CREATE TABLE reminders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id     INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('warranty', 'renewal', 'other')),
  title          TEXT NOT NULL,
  months         INTEGER,      -- warranty length from the in-service date
  miles_limit    INTEGER,      -- warranty odometer limit
  due_date       TEXT,         -- renewal / other
  repeat_months  INTEGER,      -- renewal cadence
  notes          TEXT,
  source         TEXT,
  sort           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX reminders_vehicle ON reminders(vehicle_id, kind, sort);

CREATE TABLE recalls (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id   INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  campaign     TEXT NOT NULL,          -- NHTSA campaign number, e.g. 24V911000
  report_date  TEXT,
  component    TEXT,
  summary      TEXT,
  consequence  TEXT,
  remedy       TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'not_applicable')),
  first_seen   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (vehicle_id, campaign)
);

CREATE TABLE specs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id   INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  item         TEXT NOT NULL,          -- "Oil filter"
  ask_for      TEXT,                   -- what to say / search for at the store
  part_numbers TEXT,
  notes        TEXT,
  sort         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX specs_vehicle ON specs(vehicle_id, sort);

-- One row per email-worthy event already sent, so the daily job never repeats itself.
CREATE TABLE notices (
  key         TEXT PRIMARY KEY,
  vehicle_id  INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
  sent_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
