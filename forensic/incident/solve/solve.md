# Chaotic incident

Ядро `7.0.0-38-generic`

## 1. Руткит

По строкам в дампе находится нестандартный модуль `em_ksnftc`
(`em_ksnftc_getdents64_hook`, `em_ksnftc_tcp4_seq_show`) со параметрами
`hidden_prefix`, `remote_addr`, `remote_port`. Модуль скрывает файлы,
записи каталогов с префиксом `ksnftc` и соединение с C2.

Адрес C2 восстанавливается из журнала ядра, сохранившегося в памяти:
`em_ksnftc: active prefix=ksnftc remote=131.186.66.179:9443`.
Модуль передаёт `%pI4` указатель на целочисленный адрес в host byte order,
поэтому октеты в журнальной строке переставлены —
**179.66.186.131:9443**. Прямой IP в дампе не встречается: в теле агента
он RC4-запечатан, а страницы с записью конфигурации не сохранились.

## 2. Скрытый агент

В дампе есть `task_struct` с `comm` `[kworker/14:1-n` (обрезано до 15
байт как в ядре). По смещениям из `kernel.isf.json`: pid = tgid = 1528,
поле `mm` ненулевое — у настоящего kthread оно пустое. Это пользовательский
процесс, маскирующийся под kernel worker.

По имени агента в памяти находим предшествующий ELF-заголовок и вырезаем
образ (~64 КБ, заголовок `ET_DYN`):

```python
a = image.rfind(b'\x7fELF', 0xa3a2c47 - 0x100000, 0xa3a2c47)  # -> 0xa39ec40
image[a:a+0x10000] -> agent.elf
```

## 3. Протокол

Реверс `agent.elf` (IDA): агент (`ks-worker/2.0`, OpenSSL, TLS 1.3 + mTLS,
SNI `c2-control`, User-Agent `ks-worker/2.0`) каждые 23 с + jitter опрашивает
`GET /v1/tasks`. Типы заданий: `ex_command` (выполнить команду, результат —
`POST /v1/tasks/{id}/result`), `upload` (`POST /v1/files` → integer id),
`download` (`GET /v1/files/{id}`). Файлы складывает в `/tmp/ksnftc-{id}`.

Конфигурация и mTLS-материал лежат в теле агента без шифрования — в дампе
читаются напрямую: порт `9443`, SNI `c2-control`, маршруты `/v1/tasks`,
`/result`, `/v1/files`. RC4 (ключ `ksnftc-lab-instance`, тоже виден в дампе)
применён только к IP.

## 4. mTLS-идентичность

Из дампа вырезаются PEM-блоки: CA `CN=chaotic-ca`, клиентский сертификат
`CN=gw-07` и приватный ключ. Сравнение публичных ключей подтверждает, что
ключ соответствует сертификату. Идентичность восстановлена полностью.

## 5. Флаг

`POST /v1/files` возвращает integer id — значит `GET /v1/files/{id}`
принимает любой id. Перебор `curl --cert client.crt --key client.key
--resolve c2-control:9443:179.66.186.131 https://c2-control:9443/v1/files/{id}`
по id 1..N выгружает файлы агента; несуществующий id даёт `404`. На
`id=5` — флаг:

**`nskctf{3xf1ltr4t10n_un1u(K}`**

### Фан факты

LKM `em_ksnftc.ko` из `/lib/modules/7.0.0-38-generic/kernel/net/` через ftrace-хуки
фильтрует `getdents64` (прячет объекты с префиксом `ksnftc`), скрывает
TCP-соединение к C2 из `/proc/net/tcp`, прячет саму запись в
`/proc/modules` и `/sys/module`, оставляя в памяти восстановимые следы
(`struct sock`, dentry, module allocation). Через 137 секунд после
загрузки модуль расшифровывает встроенный в `.ko` образ воркера и отдаёт
его через виртуальный procfs-атрибут `/proc/ksnftc_img`; запущенный через
`call_usermodehelper` лоадер `ks-worker-loader` читает образ, копирует
его в анонимный inode (`O_TMPFILE` в `/var/tmp`) и исполняет через
`execveat(AT_EMPTY_PATH)` как процесс `[kworker/14:1-net-em]`.
Именованный файл на диске не создаётся. По сут длярешения достаточно будет найти kworker а работать с его дампом памяти. 
Но руткит еще никому не вредил + в нем embedded полный код агента.