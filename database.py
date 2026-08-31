from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import sessionmaker
from models import Base

SQLALCHEMY_DATABASE_URL = "sqlite:///./messenger.db"

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
    # Existing rows need a value when a newly-added column is NOT NULL.
    # Most project columns are nullable or have Python-side defaults.
    if column.server_default is not None:
        return str(column.server_default.arg)
    if column.default is not None and column.default.is_scalar:
        return _sqlite_literal(column.default.arg)
    if column.nullable:
        return None
    # Safe fallbacks for legacy databases.
    name = column.name.lower()
    if "is_" in name or name.startswith("phone_verified"):
        return "0"
    if name.endswith("_id"):
        return "0"
    return "''"


def _upgrade_sqlite_schema():
    """Add columns introduced by newer Cipherion versions to old SQLite DBs."""
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
                # SQLite permits adding nullable columns without a default.
                # Avoid adding primary-key/unique constraints during migration;
                # these are already present on databases created from metadata.
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
