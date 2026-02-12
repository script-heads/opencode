# TunnelCode Fork Guide

Форк [opencode](https://github.com/opencode-ai/opencode) с интеграцией GPTunnel.

## Архитектура

Принцип: **минимум правок upstream-файлов**. Вся GPTunnel-логика в отдельных файлах, конфигурация через встроенные механизмы upstream (`OPENCODE_CONFIG_CONTENT`, `enabled_providers`).

## Наши файлы (0% конфликтов при sync)

| Файл | Назначение |
|------|-----------|
| `packages/opencode/src/gptunnel/defaults.ts` | Дефолтный конфиг: `OPENCODE_CONFIG_CONTENT` с `enabled_providers` |
| `packages/opencode/src/gptunnel/provider-loader.ts` | Custom loader: загрузка моделей с GPTunnel API, кеширование |
| `packages/opencode/src/gptunnel/auth.ts` | Auth-плагин: OAuth code flow для ввода API-ключа со ссылкой на profile |
| `packages/opencode/src/gptunnel/install.sh` | Curl-установщик для пользователей (`curl -fsSL gptunnel.ru/install.sh \| bash`) |
| `packages/opencode/src/gptunnel/release.sh` | Сборка + переименование архивов opencode-* → tunnelcode-* |
| `packages/opencode/src/gptunnel/upload.sh` | Загрузка архивов на сервер gptunnel.ru |
| `packages/opencode/bin/tunnelcode` | Shell-скрипт launcher: устанавливает дефолтный конфиг и запускает opencode |
| `packages/opencode/test/provider/gptunnel.test.ts` | Тесты GPTunnel провайдера |
| `FORK.md` | Этот файл |

Эти файлы можно свободно редактировать — upstream их никогда не тронет.

## Правки upstream-файлов (держать минимальными)

| Файл | Что изменено | Риск конфликта |
|------|-------------|----------------|
| `src/cli/logo.ts` | Лого TunnelCode | ~0% (файл почти не меняется) |
| `src/index.ts` | `+import "./gptunnel/defaults"`, `.scriptName("tunnelcode")` | ~0% |
| `src/provider/provider.ts` | +import `gptunnelCustomLoader`, +`gptunnel:` в `CUSTOM_LOADERS`, +`models: data.models` в patch | ~5% |
| `src/plugin/index.ts` | +import GptunnelAuthPlugin, +entry в INTERNAL_PLUGINS | ~3% |
| `src/server/routes/provider.ts` | Auth-method провайдеры в `all` для "Connect" диалога | ~5% |
| `script/build.ts` | outfile/user-agent → `tunnelcode` | ~10% |
| `package.json` | +`"tunnelcode"` в секции `bin` | тривиальный |
| `src/cli/cmd/upgrade.ts` | describe + log-сообщения → tunnelcode | ~2% (describe редко меняется) |
| `src/cli/cmd/uninstall.ts` | describe, intro, thank-you → TunnelCode | ~2% |
| `src/cli/cmd/serve.ts` | describe → tunnelcode | ~1% |
| `src/cli/cmd/run.ts` | describe + option describe → tunnelcode | ~2% |
| `src/cli/cmd/web.ts` | describe → tunnelcode | ~1% |
| `src/cli/cmd/pr.ts` | describe → tunnelcode, spawn fix: `process.execPath` вместо hardcoded `"opencode"` | ~3% |
| `src/cli/cmd/tui/thread.ts` | describe → tunnelcode | ~1% |
| `src/cli/cmd/tui/attach.ts` | describe → tunnelcode | ~1% |
| `src/cli/error.ts` | `tunnelcode models`, MCP текст → tunnelcode (НО `opencode.json` оставлен — реальное имя файла) | ~2% |

## Sync с upstream (rebase)

```bash
git fetch upstream
git rebase upstream/dev
# 0-2 конфликта → разрешить (обычно в provider.ts или build.ts)
git push --force-with-lease origin dev
bun run build -- --single
# Smoke test: GPTUNNEL_API_KEY=... bun run dev
```

Частота: раз в неделю, ~5-15 минут.

### Типичные конфликты и их решение

**provider.ts** — upstream добавил нового провайдера в `CUSTOM_LOADERS`:
→ Принять upstream, убедиться что `gptunnel: gptunnelCustomLoader` остался в конце объекта.

**build.ts** — upstream изменил параметры сборки:
→ Принять upstream, заменить `opencode` на `tunnelcode` в outfile/execArgv.

**plugin/index.ts** — upstream добавил новый internal plugin:
→ Принять upstream, добавить `GptunnelAuthPlugin` в конец массива `INTERNAL_PLUGINS`.

**package.json** — upstream обновил версии:
→ Принять upstream, убедиться что `"tunnelcode": "./bin/tunnelcode"` в секции `bin`.

**routes/provider.ts** — upstream изменил route handler для `/`:
→ Принять upstream, добавить блок `const all = Object.values(providers)` + auth-methods loop после `providers`. Заменить `all: Object.values(providers)` на `all,` в return.

## Как безопасно кастомить

### Добавить фичу без конфликтов
Создай новый файл в `src/gptunnel/` — это наша зона, upstream её не видит.

### Изменить поведение провайдера
Редактируй `src/gptunnel/provider-loader.ts` — вся логика загрузки моделей, кеширования, авторизации тут.

### Изменить дефолтную конфигурацию
Редактируй `bin/tunnelcode` — JSON в `OPENCODE_CONFIG_CONTENT`. Например, добавить дефолтную модель:
```json
{
  "enabled_providers": ["gptunnel"],
  "model": "gptunnel/claude-4.5-sonnet",
  "provider": { ... }
}
```

### Добавить кастомные tips/подсказки
Создай `src/gptunnel/tips.ts` и импортируй — не трогай `tips.tsx`.

## Чего НЕ делать

- **Не трогать `config.ts`** — используй `OPENCODE_CONFIG_CONTENT` через launcher
- **Не трогать `global/index.ts`** — XDG-пути остаются `opencode`, общие данные (сессии, auth, LSP) — это фича, не баг
- **Не трогать `network.ts` / `mdns.ts`** — mDNS выключен по умолчанию, косметика не стоит конфликтов
- **Не менять `opencode.json` на `tunnelcode.json`** — конфиг-файл реально называется `opencode.json` (захардкожен в десятках мест)
- **Не менять pkg manager команды в `uninstall.ts`** — мёртвый код для curl-пользователей TunnelCode
- **Не трогать `dialog-provider.tsx`** — `enabled_providers` фильтрует UI автоматически
- **Не добавлять провайдеры в `BUNDLED_PROVIDERS`** — `@ai-sdk/openai-compatible` уже там
- **Не править файлы вне списка выше** без крайней необходимости
- **Не использовать merge** — только rebase, иначе история засоряется

## Дистрибуция

TunnelCode распространяется через `gptunnel.ru` как бинарник (curl install). Не публикуется в npm/brew/choco.

### Сборка и релиз

```bash
cd packages/opencode
bash src/gptunnel/release.sh          # сборка + переименование архивов
bash src/gptunnel/upload.sh user@srv  # загрузка на сервер
```

### Установка пользователем

```bash
curl -fsSL https://gptunnel.ru/install.sh | bash
```

### Структура на сервере

```
/var/www/gptunnel.ru/releases/
├── latest.txt                    # "1.0.0"
└── v1.0.0/
    ├── tunnelcode-darwin-arm64.zip
    ├── tunnelcode-linux-x64.tar.gz
    └── ...
```

## Ключевые механизмы upstream

- `OPENCODE_CONFIG_CONTENT` (env var) — инжектирует JSON-конфиг, приоритет выше project config
- `enabled_providers` (config field) — UI показывает ТОЛЬКО перечисленных провайдеров
- `CUSTOM_LOADERS` (provider.ts) — хук для кастомной загрузки моделей
- `@ai-sdk/openai-compatible` — SDK для OpenAI-совместимых API (уже bundled)
