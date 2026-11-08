# alice-console | easy | forensic

## Информация

> После инцидента 2018 года ALICE восстановила архивный доступ к делу «GAP 2018–2019».
> Вам выдан read-only терминал специалиста по восстановлению записей. Найдите
> единственный подлинный артефакт допуска и восстановите запись.
>
> http://<ip>:18112
>
> Логин: `user` / пароль: `user`

## Деплой

```sh
cd deploy
docker-compose up --build -d
```

## Выдать участникам

Только URL, логин и пароль.

## Описание

Веб-консоль в стиле CRT-терминала.

## Решение

1. `/` → `/login` → `user` / `user` → `/console`.
2. `ls /`, `ls /home/archive/artifacts | wc -l` — 120 папок.
3. `cd /home/archive/artifacts`; сузить кандидатов:
   `grep -l '"owner": "mr.x"' */meta.json`,
   `grep -l '"admission": "000"' */meta.json`,
   `grep -l '"status": "restored"' */meta.json`,
   проверить `chain` в `meta.json`.
4. У кандидатов сверить `sha256sum ART-*/artifact.*` со значением `sha256` из
   `meta.json`. Семь near-miss проходят meta-фильтр, но их хеш не сходится; подлинная
   папка ровно одна.
5. Запустите `/bin/alice-auth`, введите абсолютный путь к подлинному файлу:
   `/home/archive/artifacts/ART-.../artifact.log` → `ЗАПИСЬ ВОССТАНОВЛЕНА: nskctf{...}`.
6. `cat /var/lib/alice/flag` от `user` недоступен; каталог, `meta.json`, near-miss и `..` дают
   `ACCESS DENIED`.

[Решение](solve/1.md)

## Флаг

`nskctf{th4_2rch1v4_h2s_b44n_r2154d}`

