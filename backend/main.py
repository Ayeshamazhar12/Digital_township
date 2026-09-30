# =========================================================
# Dandiwal Township – backend API (FastAPI)
# Sections: 1 Imports & paths · 2 Database helpers
#           3 Database initialization (create tables + seed data)
#           4 FastAPI app & CORS · 5 Endpoints
# =========================================================

# ---------- 1. IMPORTS & PATHS ----------
import json
import sqlite3
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from auth import router as auth_router
from user_routes import router as user_router

BASE_DIR = Path(__file__).parent               # .../backend
DB_PATH = BASE_DIR / "database" / "township.db"     # created automatically, do not hand-edit
SCHEMA_PATH = BASE_DIR / "database" / "schema.sql"
SEED_PATH = BASE_DIR / "database" / "seed.json"


# ---------- 2. DATABASE HELPERS ----------
def get_connection() -> sqlite3.Connection:
    """Open a connection to township.db (SQLite creates the file the first time)."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row          # lets us read columns by name, like a dict
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def row_to_plot(row: sqlite3.Row) -> dict:
    """Shape one database row the way the frontend map expects a plot to look."""
    return {
        "id": row["id"], "block": row["block"], "marla": row["marla"],
        "dimensions": row["dimensions"], "sqft": row["sqft"], "status": row["status"],
        "price_lakh": row["price_lakh"],
        "map": {"x": row["map_x"], "y": row["map_y"], "w": row["map_w"], "h": row["map_h"]},
    }


def row_to_facility(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"], "name": row["name"], "type": row["type"], "icon": row["icon"],
        "description": row["description"],
        "map": {"x": row["map_x"], "y": row["map_y"], "w": row["map_w"], "h": row["map_h"]},
    }


# ---------- 3. DATABASE INITIALIZATION ----------
def init_db() -> None:
    """
    Runs once every time the server starts:
      1. Create the six tables from schema.sql (CREATE TABLE IF NOT EXISTS,
         so this never wipes data that's already there).
      2. If the plots table is still empty, load seed.json into it.
    """
    conn = get_connection()
    conn.executescript(SCHEMA_PATH.read_text())

    already_seeded = conn.execute("SELECT COUNT(*) FROM plots").fetchone()[0] > 0
    if not already_seeded:
        data = json.loads(SEED_PATH.read_text(encoding="utf-8"))
        conn.executemany(
            """INSERT INTO plots
               (id, block, marla, dimensions, sqft, status, price_lakh, map_x, map_y, map_w, map_h)
               VALUES
               (:id, :block, :marla, :dimensions, :sqft, :status, :price_lakh, :map_x, :map_y, :map_w, :map_h)""",
            data["plots"],
        )
        conn.executemany(
            """INSERT INTO facilities (id, name, type, icon, description, map_x, map_y, map_w, map_h)
               VALUES (:id, :name, :type, :icon, :description, :map_x, :map_y, :map_w, :map_h)""",
            data["facilities"],
        )
        conn.commit()
        print(f"[startup] Seeded {len(data['plots'])} plots and {len(data['facilities'])} facilities.")
    else:
        print("[startup] Database already has data — skipped seeding.")

    conn.close()


# ---------- 4. FASTAPI APP & CORS ----------
app = FastAPI(title="Dandiwal Township API")

app.include_router(auth_router)
app.include_router(user_router)

# Lets script.js call this API from a browser during development.
# Fine for now; narrow allow_origins to your real domain once this goes live.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()


# ---------- 5. ENDPOINTS ----------
@app.get("/")
def root():
    return {"message": "Dandiwal Township API is running. Try /plots, /facilities or /docs."}


@app.get("/plots")
def list_plots(
    status: Optional[str] = None,
    marla: Optional[int] = None,
    block: Optional[str] = None,
    max_price: Optional[float] = Query(None, description="Maximum price, in PKR Lakh"),
):
    """All plots, optionally filtered — mirrors the filter bar on the map."""
    conn = get_connection()
    sql, params = "SELECT * FROM plots WHERE 1=1", []
    if status:
        sql += " AND status = ?"; params.append(status)
    if marla:
        sql += " AND marla = ?"; params.append(marla)
    if block:
        sql += " AND block = ?"; params.append(block)
    if max_price is not None:
        sql += " AND price_lakh <= ?"; params.append(max_price)
    rows = conn.execute(sql + " ORDER BY id", params).fetchall()
    conn.close()
    return [row_to_plot(r) for r in rows]


@app.get("/plots/{plot_id}")
def get_plot(plot_id: int):
    """A single plot by its number — powers the detail panel on the map."""
    conn = get_connection()
    row = conn.execute("SELECT * FROM plots WHERE id = ?", (plot_id,)).fetchone()
    conn.close()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Plot {plot_id} not found")
    return row_to_plot(row)


@app.get("/facilities")
def list_facilities():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM facilities").fetchall()
    conn.close()
    return [row_to_facility(r) for r in rows]
