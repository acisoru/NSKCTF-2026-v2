# alice_link | easy | reverse

## Информация

> После «РЕВИЗИИ» ALICE открыла служебный канал восстановления записей. В журнале осталась стёртая > строка, которую система обязана была показать оператору, но так и не показала. Вернуть её можно, > только поняв логику самого канала...
>
> `<ip>:18111` (TCP), клиент — в архиве.

## Деплой

```sh
cd deploy
docker compose up --build -d
```

Если меняете `KEY_HEX`, пересоберите клиент из `deploy/alice_link.c` и обновите архив в
`public/`; иначе выданный бинарь не сможет построить валидный HMAC.

## Выдать участникам

Архив [public/alice-link.zip](public/alice-link.zip) и IP:PORT сервера.

## Описание

CLI-утилита с подкомандами `connect`, `send --data` и `status` общается с сервером по
текстовому каналу, внутри которого передаётся бинарный пакет. master-ключ собирается из обфусцированных таблиц, а ключ каждого пакета зависит от случайного challenge сервера. Задача — разобрать формат пакета, восстановить derivation и отправить корректный запрос с актуальными nonce/challenge.

## Решение

### 1. Первичная разведка

```sh
$ ./alice-link --help
alice-link [--host H] [--port P] connect
alice-link [options] send --data <hex|base64>
alice-link [options] status
```

Подключаемся:

```sh
$ ./alice-link --host 127.0.0.1 --port 18111 connect
OK nonce=4f3c9d2a7b1e8065c4a91f0d2e7b3a68 challenge=1d9e7b3a68c4a91f0d2e7b3a684f3c9d
```

`nonce` и `challenge` — по 16 байт (32 hex-символа). Оба одноразовые, живут 60 секунд
и привязаны к TCP-соединению. `status` работает как `connect`.

`send` без `--data` отправляет legacy-payload и получает `ERR invalid combination`:
старые значения и старый формат пакета больше не принимаются.

### 2. Реверс клиента

Файл — stripped PIE ELF x86-64. В `strings` находятся только текстовые команды и
`nonce=` / `challenge=`. В коде есть две обфусцированные 32-байтные таблицы, из которых
собирается master-ключ, и функция, выводящая сессионный ключ:

```text
master[i] = KEY_BLOB[i] ^ KEY_MASK[i] ^ (0x5a + i * 13)
session_key = HMAC-SHA256(master, "AL1C/3/" + challenge)
```

Важно, что `challenge` приходит от сервера: один и тот же клиент отправляет разные HMAC
в разных сессиях. Статического `SEG/MASK` и фиксированного HMAC-ключа в бинаре больше нет.

Клиент также проверяет `TracerPid` в `/proc/self/status` и вызывает
`prctl(PR_SET_DUMPABLE, 0)`; отладка приведёт к `ERR link unavailable`.

### 3. Формат пакета

| Смещение | Размер | Поле |
| --- | --- | --- |
| 0 | 4 | magic `AL1C` |
| 4 | 2 | version, `u16 BE`, значение `3` |
| 6 | 1 | type, `u8`, значение `0x10` |
| 7 | 1 | reserved, `u8`, значение `0` |
| 8 | 2 | payload_len, `u16 BE` |
| 10 | `payload_len` | payload |
| 10 + `payload_len` | 16 | nonce |
| 26 + `payload_len` | 32 | HMAC-SHA256 |

HMAC считается по всем байтам от начала пакета до nonce включительно, то есть по
`packet[:-32]`; используется сессионный ключ, выведенный из challenge.

Эквивалентная сборка:

```python
pkt = struct.pack(">4sHBBH", b"AL1C", 3, 0x10, 0, len(payload))
pkt += payload + nonce
pkt += hmac.new(session_key, pkt, hashlib.sha256).digest()
```

### 4. Payload

Из `legacy_payload` видно старые значения `0x3E7`, `0x4C4142`, `0x5A1F3000`; сервер их
отвергает. Актуальное условие:

- payload ровно 12 байт;
- первое `u32 BE` — `0x3E7`;
- второе `u32 BE` — `0x58414C` (`XAL`);
- третье `u32 BE` — текущее Unix-время, допуск ±30 секунд.

```python
payload = struct.pack(">III", 0x3E7, 0x58414C, int(time.time()))
```

Время нужно отправлять сразу после получения nonce: nonce живёт 60 секунд, а payload —
±30 секунд.

### 5. Nonce, challenge и соединение

`CONNECT` и `SEND` должны идти в **одном TCP-соединении**. Сервер хранит nonce и
challenge в привязке к объекту соединения. После успешной проверки сессия изымается;
повтор того же пакета уже не проходит. Ошибочный HMAC или payload не расходует сессию,
но проще запросить новую.

### 6. Короткий путь через клиент

Клиент принимает готовый 12-байтный payload в hex или base64, сам делает `CONNECT`,
разбирает nonce/challenge, выводит сессионный ключ и добавляет тег:

```sh
PAYLOAD=$(python3 -c 'import struct,time; print(struct.pack(">III", 0x3E7, 0x58414C, int(time.time())).hex())')
./alice-link --host 127.0.0.1 --port 18111 send --data "$PAYLOAD"
```

[Референсный эксплоит](solve/solve_ref.py)

## Флаг

`nskctf{5ucc455ful_c0nn4ct10n}`
