from sqlalchemy import create_engine, Column, Integer, String, Boolean, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext
import os

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
        db_user = User(email=normalized_email, hashed_password=hashed_password)
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

auth_engine = AuthEngine()
