from datetime import datetime, timedelta
from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    Boolean,
    DateTime,
    func,
    inspect,
    text,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext
import os
import threading

# Database Setup - Use PostgreSQL from environment or fallback to SQLite
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./users.db")

# Handle postgres:// vs postgresql:// for SQLAlchemy 1.4+
if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Configure engine based on database type
if "sqlite" in SQLALCHEMY_DATABASE_URL:
    engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# User Model
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    is_active = Column(Boolean, default=True)
    plan = Column(String(20), nullable=False, default="free")
    plan_expires_at = Column(DateTime, nullable=True)

class UsageLog(Base):
    __tablename__ = "usage_log"
    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    action = Column(String(64), index=True, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


def _run_schema_migrations():
    """
    Lightweight startup migration for environments without Alembic.
    Adds plan fields to existing users table and ensures usage_log table exists.
    """
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())

    # Fresh database: create all tables with the latest schema.
    if "users" not in table_names:
        Base.metadata.create_all(bind=engine)
        return

    user_columns = {col["name"] for col in inspector.get_columns("users")}
    migration_statements = []

    if "plan" not in user_columns:
        migration_statements.append("ALTER TABLE users ADD COLUMN plan VARCHAR(20) DEFAULT 'free'")
    if "plan_expires_at" not in user_columns:
        migration_statements.append("ALTER TABLE users ADD COLUMN plan_expires_at TIMESTAMP")

    if migration_statements:
        with engine.begin() as connection:
            for statement in migration_statements:
                connection.execute(text(statement))
            connection.execute(text("UPDATE users SET plan = 'free' WHERE plan IS NULL OR plan = ''"))

    # Ensure new tables (usage_log) are created.
    Base.metadata.create_all(bind=engine)

# Security / Hashing
# Security / Hashing
# Using pbkdf2_sha256 as it is consistently fast/compatible on all environments (sometimes bcrypt pure-python fallback is slow)
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

class AuthEngine:
    def get_db(self):
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    def verify_password(self, plain_password, hashed_password):
        return pwd_context.verify(plain_password, hashed_password)

    def get_password_hash(self, password):
        return pwd_context.hash(password)

    def create_user(self, db, email, password):
        normalized_email = (email or "").strip().lower()
        hashed_password = self.get_password_hash(password)
        db_user = User(
            email=normalized_email,
            hashed_password=hashed_password,
            plan="free",
            plan_expires_at=None,
        )
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
        return db_user

    def get_user_by_email(self, db, email):
        normalized_email = (email or "").strip().lower()
        return (
            db.query(User)
            .filter(func.lower(User.email) == normalized_email)
            .order_by(User.id.desc())
            .first()
        )

    def get_effective_plan(self, user):
        if not user:
            return "free"

        plan = (getattr(user, "plan", None) or "free").strip().lower()
        if plan != "pro":
            return "free"

        expiry = getattr(user, "plan_expires_at", None)
        if expiry and expiry <= datetime.utcnow():
            return "free"

        return "pro"

    def downgrade_user_if_expired(self, email: str):
        normalized_email = (email or "").strip().lower()
        if not normalized_email:
            return False

        db = SessionLocal()
        try:
            user = self.get_user_by_email(db, normalized_email)
            if not user:
                return False
            if (user.plan or "").lower() == "pro" and user.plan_expires_at and user.plan_expires_at <= datetime.utcnow():
                user.plan = "free"
                user.plan_expires_at = None
                db.add(user)
                db.commit()
                return True
            return False
        finally:
            db.close()

    def schedule_expiry_downgrade(self, email: str):
        threading.Thread(
            target=self.downgrade_user_if_expired,
            args=(email,),
            daemon=True,
        ).start()

    def activate_pro_plan(self, db, email: str, billing_plan: str):
        user = self.get_user_by_email(db, email)
        if not user:
            return None

        normalized_plan = (billing_plan or "").strip().lower()
        if normalized_plan not in {"monthly", "yearly"}:
            raise ValueError("plan must be 'monthly' or 'yearly'")

        duration_days = 365 if normalized_plan == "yearly" else 30
        user.plan = "pro"
        user.plan_expires_at = datetime.utcnow() + timedelta(days=duration_days)
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

auth_engine = AuthEngine()

_run_schema_migrations()
