from pwdlib import PasswordHash


class HashPassword:
    def __init__(self):
        self.pwd_context = PasswordHash.recommended()

    def create_hash(self, password: str) -> str:
        return self.pwd_context.hash(password)

    def verify_hash(self, password: str, hashed_password: str) -> bool:
        return self.pwd_context.verify(password, hashed_password)
