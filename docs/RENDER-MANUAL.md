# Render: обычный Web Service, без Blueprints

1. Источник: `OLIGARH111/Cipherion`, одобренная ветка. Runtime Docker, Dockerfile `./Dockerfile`, root/context `.`.
2. `TRUST_PROXY=1`, `COOKIE_SECURE=1`, `PUBLIC_ORIGIN=https://cipherion-messenger.onrender.com`, `DATA_DIR=/app/data`. Render предоставляет `PORT`; не фиксируйте его в UI.
3. Health Check: `/health`. Один процесс/экземпляр: SSE и активные звонки находятся в памяти.
4. **Перед деплоем сохранить данные.** На Free диск временный. Локальная SQLite и медиа не переживут гарантированно restart/redeploy. Платный диск здесь не подключается автоматически; пользователь потребовал бесплатную инфраструктуру.
5. После согласованного деплоя проверить `/health`, вход двумя тестовыми аккаунтами, сообщение, SSE, медиа, детские ограничения. Затем проверить звонок в разных сетях.

## AI (необязательно; без ключа честное сообщение о недоступности)

| Переменная | Назначение |
| --- | --- |
| `AI_BASE_URL` | URL предоставленного владельцем совместимого Responses API, включая `/v1`, без `/responses` |
| `AI_API_KEY` | Серверный секрет провайдера; не помещать в git или frontend |
| `AI_MODEL` | Реальный ID доступной модели |
| `AI_MODELS` | Разрешённые ID моделей через запятую |
| `CHILD_AI_ENABLED` | По умолчанию выключено. `1` только после проверки возрастных правил провайдера и режима защиты |
| `TRANSCRIPTION_URL` | Совместимый endpoint `/audio/transcriptions` |
| `TRANSCRIPTION_KEY` | Серверный ключ сервиса распознавания |
| `TRANSCRIPTION_MODEL` | Доступная модель распознавания |

Приложение не подключает платный AI и не запускает запросы автоматически. Выберите собственный или бесплатный провайдер, условия и квоты которого проверены владельцем. Отсутствие оплаты за код не означает, что любой внешний API бесплатный. В настройках аккаунта включить AI и только нужные разрешения. Запись передается на расшифровку лишь после согласия и разрешения «Голосовые».

Источники реализации: [Responses streaming](https://developers.openai.com/api/docs/guides/streaming-responses), [Function calling](https://developers.openai.com/api/docs/guides/function-calling).

## Реальная причина TURN-проблемы

Ранее `/api/me` возвращал `JSON.parse(ICE_SERVERS || '[]')`. В Render переменная не была установлена, `RTCPeerConnection` создавался с пустым `iceServers`. Даже STUN не было. Прямой маршрут через разные NAT не гарантирован; интерфейс лишь предупреждал, а соединение могло бесконечно перезапускаться.

Теперь `/api/rtc-config` возвращает STUN и, **если настроен реальный TURN**, временные credentials. Техническая доставка сигналов остается SSE + HTTPS POST, а не WebSocket: это действующая архитектура проекта, её не подменяли.

## Coturn на отдельном сервере

Render Web Service не является UDP TURN-сервером. Нужен собственный доступный сервер с публичным IP либо предоставленный TURN-сервис. Не подключаем вымышленные адреса или чужие общие пароли.

На существующем сервере установите Coturn из пакетов ОС. Базовые параметры `turnserver.conf`:

```ini
listening-port=3478
tls-listening-port=5349
fingerprint
use-auth-secret
# static-auth-secret — случайный серверный секрет, одинаковый с TURN_SHARED_SECRET
# realm — ваш реальный DNS hostname
# external-ip — ваш реальный публичный IP (и private IP при 1:1 NAT)
# cert / pkey — действительный TLS сертификат и ключ hostname
min-port=49160
max-port=49200
no-multicast-peers
no-cli
stale-nonce=600
```

Откройте 3478 UDP/TCP, 5349 TCP для TLS и 49160–49200 UDP для relay в firewall сервера и облака. В закрытых сетях полезен отдельный listener TURN/TLS на 443, если этот порт доступен. Ограничьте relay к loopback, private и link-local диапазонам в соответствии с сетью; не запускайте анонимный open relay. Настройте сертификат, мониторинг и квоты Coturn.

В Environment Render добавьте **реальные** `TURN_URLS` через запятую: UDP/TCP `turn:` и TLS `turns:` адреса вашего сервера; `TURN_SHARED_SECRET` — общий секрет. Пример формата (не рабочая конфигурация): `turn:YOUR_HOST:3478?transport=udp,turn:YOUR_HOST:3478?transport=tcp,turns:YOUR_HOST:5349?transport=tcp`.

Клиент получает username `expiry:userId` и `HMAC-SHA1(secret,username)` в Base64. Срок — час, конфигурация запрашивается заново перед звонком. Общий секрет не передаётся. Для legacy `ICE_SERVERS` допустимы явно предоставленные credentials, но предпочтительны временные.

Проверка: два устройства/аккаунта, одна сеть, разные сети, Wi-Fi ↔ мобильная сеть, аудио/видео, смена камеры, экран, завершение с обеих сторон, повторный вызов и восстановление. В диагностике браузера проверить selected candidate pair типа `relay` при принудительном relay-тесте. Текущие логи выводят только состояния, типы кандидатов и протокол, без SDP, IP и паролей.

Источники: [Coturn](https://github.com/coturn/coturn/wiki/turnserver), [Perfect negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation), [Render Free](https://render.com/docs/free).
