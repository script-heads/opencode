# TunnelCode Fork Guide

Форк [opencode](https://github.com/opencode-ai/opencode) с интеграцией GPTunnel.

## Архитектура

Принцип: **минимум правок upstream-файлов**. Вся GPTunnel-логика в отдельных файлах, конфигурация через встроенные механизмы upstream (`OPENCODE_CONFIG_CONTENT`, `enabled_providers`).

## Наши файлы (0% конфликтов при sync)

| Файл | Назначение |
|------|-----------|
| `packages/opencode/src/gptunnel/provider-loader.ts` | Custom loader: загрузка моделей с GPTunnel API, кеширование |
| `packages/opencode/bin/tunnelcode` | Shell-скрипт launcher: устанавливает дефолтный конфиг и запускает opencode |
| `packages/opencode/test/provider/gptunnel.test.ts` | Тесты GPTunnel провайдера |
| `FORK.md` | Этот файл |

Эти файлы можно свободно редактировать — upstream их никогда не тронет.

## Правки upstream-файлов (держать минимальными)

| Файл | Что изменено | Риск конфликта |
|------|-------------|----------------|
| `src/cli/logo.ts` | Лого TunnelCode | ~0% (файл почти не меняется) |
| `src/index.ts` | `.scriptName("tunnelcode")` | ~0% |
| `src/provider/provider.ts` | +import `gptunnelCustomLoader`, +`gptunnel:` в `CUSTOM_LOADERS`, +`models: data.models` в patch | ~5% |
| `script/build.ts` | outfile/user-agent → `tunnelcode` | ~10% |
| `package.json` | +`"tunnelcode"` в секции `bin` | тривиальный |

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

**package.json** — upstream обновил версии:
→ Принять upstream, убедиться что `"tunnelcode": "./bin/tunnelcode"` в секции `bin`.

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
- **Не трогать `dialog-provider.tsx`** — `enabled_providers` фильтрует UI автоматически
- **Не добавлять провайдеры в `BUNDLED_PROVIDERS`** — `@ai-sdk/openai-compatible` уже там
- **Не править файлы вне списка выше** без крайней необходимости
- **Не использовать merge** — только rebase, иначе история засоряется

## Ключевые механизмы upstream

- `OPENCODE_CONFIG_CONTENT` (env var) — инжектирует JSON-конфиг, приоритет выше project config
- `enabled_providers` (config field) — UI показывает ТОЛЬКО перечисленных провайдеров
- `CUSTOM_LOADERS` (provider.ts) — хук для кастомной загрузки моделей
- `@ai-sdk/openai-compatible` — SDK для OpenAI-совместимых API (уже bundled)
