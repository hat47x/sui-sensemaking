from logging.config import fileConfig
import os

from alembic import context
from sqlalchemy import pool

# CI may export legacy DATABASE_URL for unrelated services.
# ENV-ARCH-01 enforces SUI_* only, so remove legacy key before importing app settings.
os.environ.pop("DATABASE_URL", None)

from sui_sensemaking_api.database_support import (
    alembic_config_database_url,
    create_verified_database_engine,
)
from sui_sensemaking_api.models import Base
from sui_sensemaking_api import guest_admission_models as _guest_admission_models  # noqa: E402,F401
from sui_sensemaking_api import agent_credential_models as _agent_credential_models  # noqa: E402,F401
from sui_sensemaking_api import guest_auth_session_models as _guest_auth_session_models  # noqa: E402,F401
from sui_sensemaking_api import guest_redeem_state_models as _guest_redeem_state_models  # noqa: E402,F401
from sui_sensemaking_api.persistence_shapes import install_portable_text_ddl_hook
from sui_sensemaking_api.settings import settings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", alembic_config_database_url(settings.database_url))

target_metadata = Base.metadata
install_portable_text_ddl_hook()


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_verified_database_engine(
        settings.database_url,
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
