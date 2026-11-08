from dataclasses import dataclass


@dataclass
class JWTConfig:
    jwt_key: str
    algorithm: str
    expire: int


@dataclass
class Config:
    jwt_conf: JWTConfig
    admin_port: int
