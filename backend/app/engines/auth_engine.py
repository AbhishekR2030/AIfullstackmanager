from sqlalchemy import create_engine, Column, Integer, String, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext
import os

# Database Setup
SQLALCHEMY_DATABASE_URL = "sqlite:///./users.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
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
        hashed_password = self.get_password_hash(password)
        db_user = User(email=email, hashed_password=hashed_password)
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
        return db_user

    def get_user_by_email(self, db, email):
        return db.query(User).filter(User.email == email).first()

auth_engine = AuthEngine()
