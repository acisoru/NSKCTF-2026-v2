# Chaotic incident | hard | forensic

## Информация

> Кажется на лабораторном стенде произошел "сбой", во время которого стерся флаг. Можно еще его вернуть?  
> Google drive `https://drive.google.com/drive/folders/1MP2oYZiDUF_jQeg9FVslv4pd2T9Ndatv?usp=sharing`

## Деплой

```bash
export C2_FLAG='nskctf{3xf1ltr4t10n_un1u(K}'
scripts/issue_material.sh
docker compose -f deploy/docker-compose.yaml up -d --build
```

Control plane слушает `9443/tcp` (TLS 1.3 + обязательный клиентский
сертификат `CN=gw-07`, поверх него HTTP/1.1 REST). Все параметры передаются
через environment; подробно в [deploy/README.md](deploy/README.md).

## Выдать участникам

Файлы задачи находятся в [public/](public/):

- Google drive `https://drive.google.com/drive/folders/1MP2oYZiDUF_jQeg9FVslv4pd2T9Ndatv?usp=sharing` ,  в котором дамп памяти и профиль структур ядра
- `SHA256SUMS` — контрольные суммы;

## Описание

Цепочка: найти скрытый LKM и его fileless-агента, восстановить mTLS
серт, повторить application-протокол к локальному C2 и перебором
integer file id через `GET /v1/files/{id}` выгрузить `flag.txt` из
server-side file store.

## Решение

[solve/solve.md](solve/solve.md)

## Флаг

`nskctf{3xf1ltr4t10n_un1u(K}`