from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import sessionmaker
from models import Base
import os
from pathlib import Path

# On Render free tier the filesystem is ephemeral. If a persistent disk is
# mounted at /data (or DATABASE_DIR is set), keep messenger.db there so
# registrations survive restarts/deploys.
_db_dir = os.getenv("DATABASE_DIR") or ("/data" if Path("/data").is_dir() else ".")
Path(_db_dir).mkdir(parents=True, exist_ok=True)
_db_path = str(Path(_db_dir) / "messenger.db")
SQLALCHEMY_DATABASE_URL = f"sqlite:///{_db_path}"
print(f"Cipherion: SQLite database at {_db_path}")

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _sqlite_literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def _default_for_column(column):
    if column.server_default is not None:
        return str(column.server_default.arg)
    if column.default is not None and column.default.is_scalar:
        return _sqlite_literal(column.default.arg)
    if column.nullable:
        return None
    name = column.name.lower()
    if "is_" in name or name.startswith("phone_verified"):
        return "0"
    if name.endswith("_id"):
        return "0"
    return "''"


def _upgrade_sqlite_schema():
    inspector = inspect(engine)
    with engine.begin() as connection:
        for table in Base.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing = {col["name"] for col in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing:
                    continue
                type_sql = column.type.compile(dialect=engine.dialect)
                statement = f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {type_sql}'
                default = _default_for_column(column)
                if default is not None:
                    statement += f" DEFAULT {default}"
                connection.execute(text(statement))
                print(f"Cipherion: migrated {table.name}.{column.name}")


def init_db():
    Base.metadata.create_all(bind=engine)
    _upgrade_sqlite_schema()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
