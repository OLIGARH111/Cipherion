from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from models import Base

SQLALCHEMY_DATABASE_URL = "sqlite:///./messenger.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_db():
    Base.metadata.create_all(bind=engine)
    # ``create_all`` does not add columns to installations that already have a
    # database. Keep the lightweight SQLite project upgrade-safe.
    with engine.begin() as connection:
        columns = {row[1] for row in connection.execute(text("PRAGMA table_info(users)"))}
        if "privacy_email" not in columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN privacy_email VARCHAR(20) DEFAULT 'contacts'"))

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
