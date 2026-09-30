# =========================================================
# Dandiwal Township – authentication (FastAPI router)
# Sections: 1 Imports & config · 2 Password hashing
#           3 JWT helpers · 4 Request/response models
#           5 Endpoints (/auth/register, /auth/login)
#           6 Dependency other files use: get_current_user
# =========================================================

# ---------- 1. IMPORTS & CONFIG ----------
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "database" / "township.db"

# ⚠️ For a real deployment, move this into an environment variable —
# never leave a real secret key hardcoded in a file you might upload/share.
SECRET_KEY = "dev-only-change-this-secret-key"
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60 * 24  # tokens are valid for 1 day

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")  # tells /docs where to log in
router = APIRouter(prefix="/auth", tags=["auth"])


# ---------- 2. PASSWORD HASHING ----------
def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ---------- 3. JWT HELPERS ----------
def create_token(user_id: int) -> str:
    expire = datetime.utcnow() + timedelta(minutes=TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user_id), "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


# ---------- 4. REQUEST / RESPONSE MODELS ----------
class RegisterIn(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    password: str


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    name: str
    email: str
    phone: Optional[str] = None


# ---------- 5. ENDPOINTS ----------
@router.post("/register", response_model=UserOut)
def register(body: RegisterIn):
    """Create an account. Called once, when someone signs up on the dashboard."""
    conn = get_connection()
    exists = conn.execute("SELECT id FROM users WHERE email = ?", (body.email,)).fetchone()
    if exists:
        conn.close()
        raise HTTPException(status_code=400, detail="An account with this email already exists")
    cur = conn.execute(
        "INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)",
        (body.name, body.email, body.phone, hash_password(body.password)),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return {"id": new_id, "name": body.name, "email": body.email, "phone": body.phone}


@router.post("/login")
def login(body: LoginIn):
    """Check email + password, return a token the frontend stores and re-sends."""
    conn = get_connection()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (body.email,)).fetchone()
    conn.close()
    if row is None or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    token = create_token(row["id"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": row["id"], "name": row["name"], "email": row["email"]},
    }


# ---------- 6. DEPENDENCY: GET_CURRENT_USER ----------
def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """
    Any endpoint that needs to know WHO is asking (saved plots, inquiries)
    takes `user: dict = Depends(get_current_user)` as a parameter. FastAPI
    then requires a valid "Authorization: Bearer <token>" header automatically.
    """
    invalid = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise invalid
    conn = get_connection()
    row = conn.execute("SELECT id, name, email, phone FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    if row is None:
        raise invalid
    return dict(row)
