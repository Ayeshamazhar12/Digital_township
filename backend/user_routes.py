# =========================================================
# Dandiwal Township – per-user data (FastAPI router)
# Everything here requires login (uses auth.get_current_user).
# This is the backend replacement for the browser's localStorage
# "saved" list and "inq" list in the dashboard.
# Sections: 1 Imports & helpers · 2 Saved plots · 3 Visit requests
# =========================================================

# ---------- 1. IMPORTS & HELPERS ----------
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "database" / "township.db"

router = APIRouter(tags=["user data"])


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# ---------- 2. SAVED PLOTS ----------
@router.get("/saved-plots")
def list_saved_plots(user: dict = Depends(get_current_user)):
    """Full plot details for everything this user has saved."""
    conn = get_connection()
    rows = conn.execute(
        """SELECT p.* FROM plots p
           JOIN saved_plots s ON s.plot_id = p.id
           WHERE s.user_id = ? ORDER BY s.saved_at DESC""",
        (user["id"],),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.post("/saved-plots/{plot_id}", status_code=201)
def save_plot(plot_id: int, user: dict = Depends(get_current_user)):
    conn = get_connection()
    if conn.execute("SELECT 1 FROM plots WHERE id = ?", (plot_id,)).fetchone() is None:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Plot {plot_id} not found")
    conn.execute(
        "INSERT OR IGNORE INTO saved_plots (user_id, plot_id) VALUES (?, ?)",
        (user["id"], plot_id),
    )
    conn.commit()
    conn.close()
    return {"saved": plot_id}


@router.delete("/saved-plots/{plot_id}")
def unsave_plot(plot_id: int, user: dict = Depends(get_current_user)):
    conn = get_connection()
    conn.execute("DELETE FROM saved_plots WHERE user_id = ? AND plot_id = ?", (user["id"], plot_id))
    conn.commit()
    conn.close()
    return {"removed": plot_id}


# ---------- 3. VISIT REQUESTS (INQUIRIES) ----------
@router.get("/inquiries")
def list_inquiries(user: dict = Depends(get_current_user)):
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM inquiries WHERE user_id = ? ORDER BY requested_at DESC",
        (user["id"],),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.post("/inquiries/{plot_id}", status_code=201)
def request_visit(plot_id: int, user: dict = Depends(get_current_user)):
    conn = get_connection()
    if conn.execute("SELECT 1 FROM plots WHERE id = ?", (plot_id,)).fetchone() is None:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Plot {plot_id} not found")
    already = conn.execute(
        "SELECT 1 FROM inquiries WHERE user_id = ? AND plot_id = ? AND status = 'pending'",
        (user["id"], plot_id),
    ).fetchone()
    if already:
        conn.close()
        raise HTTPException(status_code=400, detail="You already have a pending request for this plot")
    conn.execute("INSERT INTO inquiries (user_id, plot_id) VALUES (?, ?)", (user["id"], plot_id))
    conn.commit()
    conn.close()
    return {"requested": plot_id}
