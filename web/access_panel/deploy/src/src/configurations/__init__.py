from . import config as cf
from .env_config import EnvConfig as EC

env = EC.read()

main_config = cf.Config(
    db=cf.DBConfig(base=cf.Base, db_url=env("DB_URL")),
    jwt_conf=cf.JWTConfig(
        jwt_key=env("JWT_KEY"),
        algorithm=env("ALGORITHM"),
        expire=env.int("ACCESS_TOKEN_EXPIRE_MINUTES"),
    ),
    export_dir=env("EXPORT_DIR", "/app/exports"),
    app_port=env.int("APP_PORT", 57894),
)
