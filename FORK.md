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
| `packages/opencode/src/gptunnel/urls.ts` | Константы URL-ов для дистрибуции и обновлений |
| `packages/opencode/src/gptunnel/update-notifier.ts` | Фоновая проверка обновлений при запуске (кеш 24ч, stderr) |
| `packages/opencode/src/gptunnel/install.sh` | Curl-установщик для пользователей (`curl -fsSL gptunnel.ru/install.sh \| bash`) |
| `packages/opencode/src/gptunnel/release.sh` | Сборка + переименование архивов opencode-* → tunnelcode-* |
| `packages/opencode/src/gptunnel/upload.sh` | Локальный фоллбек: сборка tunnelcode.Dockerfile + пуш в cr.yandex |
| `packages/opencode/src/gptunnel/index.html` | Лендинг code.gptunnel.ru |
| `packages/opencode/src/gptunnel/assets/` | Фавиконки и OG-картинки для лендинга |
| `packages/opencode/src/gptunnel/og-image.jpeg` | OG-изображение |
| `.drone.yml` | CI: Build/Upload по custom/tag, Deploy по promote |
| `tunnelcode.Dockerfile` | Единственный Dockerfile дистрибуции: bun-сборка всех платформ → nginx |
| `kube/env.sh` | Общие переменные kube-скриптов: реестр, версия, версия bun |
| `kube/build.sh`, `kube/upload.sh`, `kube/deploy.sh` | Drone-скрипты: docker build / push в cr.yandex / kubectl apply + rollout status |
| `kube/manifests/tunnelcode.yaml` | K8s-манифест (Ingress+Service+Deployment), образ пинуется через `_VERSION` |
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
| `src/installation/index.ts` | +import gptunnel/urls, +`.tunnelcode/bin` в method(), curl→TUNNELCODE URL в upgrade(), +curl branch в latest() | ~10-15% |
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

**installation/index.ts** — upstream изменил method()/upgrade()/latest():
→ Принять upstream, убедиться что: (1) `import { TUNNELCODE }` на месте, (2) `.tunnelcode/bin` check в method(), (3) TUNNELCODE.INSTALL_URL в curl case upgrade(), (4) curl branch перед fallback в latest().

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

### Сборка и релиз (Drone CI)

Drone подключён к GitLab (`git.shds.io`), поэтому сборка идёт из зеркала
`git.shds.io:gptunnel/tc` (паттерн как у `gpt`). GitHub — публичный
origin. Чтобы зеркало не отставало, у `origin` настроены два push-URL —
обычный `git push origin dev` обновляет оба репозитория. Настройка
локальная (`.git/config`), после нового клона повторить:

```bash
git remote set-url --add --push origin git@github.com:script-heads/opencode.git
git remote set-url --add --push origin git@git.shds.io:gptunnel/tc.git
```

Отдельный remote `gitlab` оставлен для fetch и точечных пушей
(`git push gitlab dev`). Нюанс: при `--force-with-lease` lease проверяется
по tracking-ref'ам GitHub; зеркало пишется только с этой машины, так что
это безопасно, но пуш в GitLab из других мест ломает гарантию.

Секреты (`DOCKER_KEY` — base64 json-ключа SA drone,
`KUBE_CONFIG` — base64 kubeconfig) хранятся в Drone, в репо их нет.

1. **Build** — custom event (кнопка в Drone UI) или git-тег: `kube/build.sh tunnelcode`
   собирает `tunnelcode.Dockerfile` (внутри: bun-сборка всех платформ через `release.sh`).
   Версия релиза = `<версия package.json>.<номер билда>`, напр. `1.17.1.42` — она же
   тег образа, она же в `latest.txt` и бинарниках, поэтому ребилд той же upstream-версии
   доезжает до пользователей через auto-update.
2. **Upload** — `kube/upload.sh tunnelcode`: docker login в cr.yandex ключом SA drone,
   push версионного тега + `latest` (информационный; деплой использует только пиновный тег).
3. **Deploy** — promote билда в Drone (target `tunnelcode`, указывать номер **Build**-прогона):
   `kube/deploy.sh` подставляет версию в `kube/manifests/*.yaml` (`_VERSION`), делает
   `kubectl apply` и ждёт `rollout status` — упавший pull валит пайплайн, а не молчит.

Манифест сам по себе (`kubectl apply -f` без deploy.sh) не применим — в нём
плейсхолдер `_VERSION`; подставьте тег вручную или используйте promote.

Локальный фоллбек (нужны права pusher на cr.yandex):

```bash
bash packages/opencode/src/gptunnel/upload.sh --push   # из любого места
# затем: kubectl set image deployment/tunnelcode tunnelcode=<образ>:<тег> -n timenote
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
