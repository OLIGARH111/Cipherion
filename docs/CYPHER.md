# Cypher для Windows ↔ Cipherion

Cypher — ИИ-ассистент для Windows (канал выпусков github.com/OLIGARH111/Cypher). С версии Cypher 1.0.7 он
подключается к аккаунту Cipherion. Серверная часть — `server/cypher-link.js`, интерфейс — `public/cypher-link.js`.

## Подключение

1. Cypher на ПК: «Войти через Cipherion» на экране входа или «Настройки → Cipherion → Подключить».
   Cypher получает код `ABCD-EFGH` (10 минут) и QR со ссылкой `/#cypher-link=ABCDEFGH`.
2. В Cipherion (уже выполнен вход): QR открывает подтверждение, либо «AI → Cypher на компьютере →
   Подключить по коду». Видно имя компьютера и что получит Cypher.
3. Cypher забирает доступ отдельным секретом (`/api/cypher/link/poll`), не кодом с экрана.

Детские аккаунты и боты подключать Cypher не могут.

## Что получает подключённый Cypher

Токен компьютера (`Authorization: Bearer cyl_…`) открывает только `/api/cypher/*`, но не сеанс мессенджера.

| Возможность | API | Примечание |
|---|---|---|
| Вход в Cypher | `GET /api/cypher/me` | Cypher проверяет подключение раз в 6 часов, без связи работает до 14 дней |
| Управление ПК | `POST /api/cypher/remote`, `GET /api/cypher/remote/result` (раздел AI) · `GET /api/cypher/remote/next`, `POST /api/cypher/remote/reply` (Cypher) | в разделе AI выбирается «💻 Компьютер» в поле «Контекст»; команда ждёт ПК до 10 минут, вопрос и ответ сохраняются в истории AI |
| Уведомления | `GET /api/cypher/notifications?after=` | личные чаты и группы, без каналов и заглушённых чатов; текст только у незашифрованных сообщений |
| Общая память | `GET/POST/DELETE /api/cypher/memory` | те же записи, что `ai_memory` раздела AI |

Команды получает только выбранный компьютер. В Cypher 1.0.7 пультом был отдельный бот «Cypher · ПК» — эти боты и их чаты сервер удаляет при запуске.

## Управление

`GET /api/cypher/links` — подключённые компьютеры (с признаком «в сети»), `DELETE /api/cypher/links {id}` — отключить. Cypher может отключиться сам: `POST /api/cypher/unlink`.
