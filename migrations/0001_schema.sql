-- Core schema for the car maintenance tracker.

CREATE TABLE vehicles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,            -- what shows in the dropdown, e.g. "Justin's RAV4"
  year            INTEGER,
  make            TEXT,
  model           TEXT,
  trim            TEXT,
  engine          TEXT,
  vin             TEXT,
  plate           TEXT,
  color           TEXT,
  in_service_date TEXT,                     -- YYYY-MM-DD; time-based intervals start here when nothing is logged
  start_miles     INTEGER NOT NULL DEFAULT 0,
  oil_spec        TEXT,
  sort            INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Odometer readings. Current mileage = highest reading or service mileage.
CREATE TABLE odometer (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id  INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  miles       INTEGER NOT NULL,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX odometer_vehicle ON odometer(vehicle_id, date);

-- Maintenance schedule items. An item with no interval is "as needed".
CREATE TABLE items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id      INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  interval_miles  INTEGER,
  interval_months INTEGER,
  first_miles     INTEGER,                  -- first service due at (if different from the repeat interval)
  first_months    INTEGER,
  notes           TEXT,
  source          TEXT,                     -- where the interval came from
  sort            INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX items_vehicle ON items(vehicle_id, sort);

-- A service event: one visit / one receipt.
CREATE TABLE services (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id  INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  miles       INTEGER,                      -- optional: old receipts often don't have it
  title       TEXT,                         -- free text for work not on the schedule
  shop        TEXT,
  cost_cents  INTEGER,
  notes       TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX services_vehicle ON services(vehicle_id, date);

CREATE TABLE service_items (
  service_id  INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, item_id)
);
CREATE INDEX service_items_item ON service_items(item_id);

-- Files in R2: receipts (tied to a service) and documents (manuals etc., tied to the vehicle).
CREATE TABLE files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id    INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service_id    INTEGER REFERENCES services(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('receipt', 'document')),
  title         TEXT,
  r2_key        TEXT NOT NULL UNIQUE,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size          INTEGER NOT NULL,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX files_vehicle ON files(vehicle_id, kind);
CREATE INDEX files_service ON files(service_id);
