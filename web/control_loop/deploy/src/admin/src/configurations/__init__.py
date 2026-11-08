from . import config as cf
from .env_config import EnvConfig as EC

env = EC.read()

main_config = cf.Config(
    jwt_conf=cf.JWTConfig(
        jwt_key=env("JWT_KEY"),
        algorithm=env("ALGORITHM", "HS256"),
        expire=env.int("ACCESS_TOKEN_EXPIRE_MINUTES", 60),
    ),
    admin_port=env.int("ADMIN_PORT", 80),
)
