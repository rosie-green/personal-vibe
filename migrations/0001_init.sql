-- Medicine tracker schema.
--
-- Principle: store what HAPPENED (completions, deliveries, recounts) and derive
-- everything else (stars, calendar colours, stock left) when asked.
-- Dates are local calendar days as 'YYYY-MM-DD' strings, chosen by the browser.

-- ---------------------------------------------------------------------------
-- Medicine module
-- ---------------------------------------------------------------------------

CREATE TABLE medications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  unit              TEXT    NOT NULL DEFAULT 'dose',   -- what one "dose" is called
  pack_size         INTEGER NOT NULL CHECK (pack_size > 0), -- doses per tube/box
  pack_label        TEXT    NOT NULL DEFAULT 'pack',   -- "tube", "box", ...
  reorder_lead_days INTEGER CHECK (reorder_lead_days IS NULL OR reorder_lead_days >= 0),
  order_cover_days  INTEGER CHECK (order_cover_days IS NULL OR order_cover_days > 0),
  auto_supplied     INTEGER NOT NULL DEFAULT 0 CHECK (auto_supplied IN (0, 1)),
  notes             TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Dose history, so changing your dose never rewrites the past.
-- `amount` is how many doses ONE completion of a linked task uses.
CREATE TABLE dose_schedules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  medication_id  INTEGER NOT NULL REFERENCES medications (id),
  amount         REAL    NOT NULL CHECK (amount > 0),
  every_n_days   INTEGER NOT NULL DEFAULT 1 CHECK (every_n_days >= 1),
  effective_from TEXT    NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  UNIQUE (medication_id, effective_from)
);

-- kind = 'delivery'   : doses is the (positive) number of doses that arrived
-- kind = 'adjustment' : doses is a signed correction (spilled, wasted, found...)
-- kind = 'recount'    : doses is the ABSOLUTE number left at the end of `date`
CREATE TABLE stock_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  medication_id INTEGER NOT NULL REFERENCES medications (id),
  date          TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  kind          TEXT    NOT NULL CHECK (kind IN ('delivery', 'adjustment', 'recount')),
  doses         REAL    NOT NULL,
  note          TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX stock_events_by_med ON stock_events (medication_id, date, id);

-- ---------------------------------------------------------------------------
-- Generic core: tasks and completions (nothing here is medicine specific)
-- ---------------------------------------------------------------------------

CREATE TABLE tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  time_of_day   TEXT    NOT NULL DEFAULT 'any' CHECK (time_of_day IN ('morning', 'evening', 'any')),
  medication_id INTEGER REFERENCES medications (id),   -- optional link to the medicine module
  reminder_text TEXT,                                   -- shown while pending
  done_text     TEXT,                                   -- shown once completed
  sort_order    INTEGER NOT NULL DEFAULT 0,
  -- A task counts on every day from active_from to active_to (both inclusive).
  -- Retiring a task sets active_to, so past months never change.
  active_from   TEXT    NOT NULL CHECK (active_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  active_to     TEXT    CHECK (active_to IS NULL OR active_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX tasks_by_medication ON tasks (medication_id);

CREATE TABLE completions (
  task_id      INTEGER NOT NULL REFERENCES tasks (id),
  date         TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  completed_at TEXT    NOT NULL,                        -- ISO timestamp (UTC)
  PRIMARY KEY (task_id, date)
) WITHOUT ROWID;
CREATE INDEX completions_by_date ON completions (date);
