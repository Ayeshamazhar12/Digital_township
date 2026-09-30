-- =========================================================
-- Dandiwal Township – database schema
-- Works as-is in SQLite. For PostgreSQL later: change
-- INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL PRIMARY KEY,
-- and TIMESTAMP DEFAULT CURRENT_TIMESTAMP stays the same.
-- =========================================================

-- ---------- 1. PLOTS ----------
-- One row per plot on the map (currently the PLOTS array in script.js).
CREATE TABLE IF NOT EXISTS plots (
  id          INTEGER PRIMARY KEY,        -- plot number from the flyer (1-41)
  block       TEXT    NOT NULL,           -- 'A' / 'B' / 'C'
  marla       INTEGER NOT NULL,           -- 5 or 6
  dimensions  TEXT    NOT NULL,           -- e.g. '30 x 45 ft'
  sqft        INTEGER NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'available', -- available | reserved | sold
  price_lakh  NUMERIC NOT NULL,           -- current asking price, PKR Lakh
  map_x       REAL    NOT NULL,           -- position on the SVG map (kept
  map_y       REAL    NOT NULL,           -- so the frontend map doesn't need
  map_w       REAL    NOT NULL,           -- to be redrawn once data is
  map_h       REAL    NOT NULL            -- served from the backend)
);

-- ---------- 2. FACILITIES ----------
CREATE TABLE IF NOT EXISTS facilities (
  id          TEXT PRIMARY KEY,           -- 'park', 'mosque', ...
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,              -- park | mosque | school | commercial | hospital | gate
  icon        TEXT,                       -- emoji used on the map
  description TEXT,
  map_x REAL NOT NULL, map_y REAL NOT NULL, map_w REAL NOT NULL, map_h REAL NOT NULL
);

-- ---------- 3. USERS ----------
-- Replaces the browser-only profile in localStorage.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT NOT NULL,            -- never store a plain password
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------- 4. SAVED PLOTS ----------
-- Replaces the "saved" array in localStorage. One row per (user, plot).
CREATE TABLE IF NOT EXISTS saved_plots (
  user_id  INTEGER NOT NULL REFERENCES users(id),
  plot_id  INTEGER NOT NULL REFERENCES plots(id),
  saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, plot_id)
);

-- ---------- 5. INQUIRIES (visit requests) ----------
-- Replaces the "inq" array in localStorage.
CREATE TABLE IF NOT EXISTS inquiries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  plot_id      INTEGER NOT NULL REFERENCES plots(id),
  status       TEXT DEFAULT 'pending',    -- pending | contacted | done
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------- 6. PRICE HISTORY ----------
-- Empty for now. Every time a plot's price changes (or a sale closes),
-- insert a row here. This table is what step 8 (the real ML model)
-- will eventually train on — without it there is no historical data
-- to learn from, only the current snapshot in `plots`.
CREATE TABLE IF NOT EXISTS price_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  plot_id     INTEGER NOT NULL REFERENCES plots(id),
  price_lakh  NUMERIC NOT NULL,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
