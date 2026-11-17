# Antigravity Milk UI Mod

Мод оформления и телеметрии для **Google Antigravity IDE** (Windows, Electron 44+ / v2.32+):

- **Динамический движок обоев** (`.png`, `.jpg`, `.webp`, `.gif`, `.mp4`, `.webm`) из `%USERPROFILE%\.gemini\antigravity\wallpapers`:
  - автоматическое извлечение цветовой палитры (акцент, свечение, спотлайт, частицы) прямо из текущих обоев;
  - отдельные закрепления обоев для главного экрана (`Home`) и чата (`Чат`), авторотация, слайдер затемнения фона;
  - атмосферные эффекты: 240 пиксельных частиц, параллакс и дыхание камеры, тёплый спотлайт за курсором, CRT-сканлайны и VHS-переключение каналов;
  - полупрозрачные стеклянные карточки сообщений, поля ввода (с пульсацией при работе ИИ и подсветкой по завершении), боковой панели и верхнего бара, а также удержание широких Markdown-таблиц внутри карточки чата.
- **Нижняя панель телеметрии сессии**:
  - `turns` / `steps` / скорость `tok/s` (живой расчёт + спарклайн скорости в поповере);
  - текущий контекст (`lastInput + lastCache`), Cache Hit %, общий объём токенов за сессию (включая всех субагентов), % заполнения окна (`1M`);
  - расчёт стоимости API (`Input / Cache / Output`, чат + субагенты) и активное время работы ИИ (без простоя ожидания пользователя);
  - **Инспектор контекста** (разбивка вызовов инструментов, топ тулзов, список прочитанных/изменённых файлов);
  - **Карта роя субагентов** (интерактивное масштабируемое SVG-дерево вызовов `invoke_subagent`).

> **Важно про модели:** в текущей конфигурации оставлены только **Gemini 3.8 Flash**, **Gemini 4 Hydrogen**, **Gemini 4 Argon** и **Gemini 4 Carbon** (окно `1M`). Если нужны другие модели (Claude, GPT и т.д.), попросите своего ИИ-агента расширить `modelPattern` и `__resolveModelPricing` по инструкции ниже.

---

## Быстрая установка для человека (Windows)

### Требования
- Windows 10/11
- Установленный **Antigravity** в `%LOCALAPPDATA%\Programs\Antigravity`
- **Node.js** (LTS, команда `node` и `npx` в `PATH`)

### Шаги
1. Скачайте или клонируйте репозиторий:
   ```powershell
   git clone https://github.com/Aldiyuar/antigravity-milk-ui-mod.git
   cd antigravity-milk-ui-mod
   ```
2. Откройте PowerShell (или дайте инструкцию ниже вашему ИИ-агенту в Antigravity) и выполните:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```
   Скрипт скопирует:
   - скрипты мода → `%USERPROFILE%\.gemini\antigravity\tools\`
   - обои (5 шт.) → `%USERPROFILE%\.gemini\antigravity\wallpapers\`
   - батник запуска → на **Рабочий стол** (`Apply_AG_UI_Mods.bat`)
   и соберёт пропатченный `app.asar` (оригинал сохраняется в `app.asar.bak`).

### Полезные команды батника
- Обычный запуск `Apply_AG_UI_Mods.bat` — закрывает Antigravity, устанавливает/обновляет патч (или применяет кэш `app.asar.patched`) и запускает Antigravity.
- `Apply_AG_UI_Mods.bat -Rebuild` — принудительно пересобрать `app.asar.patched`.
- `Apply_AG_UI_Mods.bat -BuildOnly` — только пересобрать `app.asar.patched` без закрытия Antigravity.
- `Apply_AG_UI_Mods.bat -Restore` — полностью откатить интерфейс к оригинальному `app.asar.bak`.

Свои обои можно в любой момент закинуть в `%USERPROFILE%\.gemini\antigravity\wallpapers\` (кнопка открытия папки есть прямо в меню обоев справа внизу).

---

## Инструкция для ИИ-агента (как применить этот дизайн на чистый Antigravity)

Вы можете просто отправить своему ИИ-агенту в чистом Antigravity следующий промпт:

> Прочитай `README.md` из репозитория `https://github.com/Aldiyuar/antigravity-milk-ui-mod` и примени этот UI-мод (обои, тему и панель телеметрии токенов) к моему локальному Antigravity. Перед установкой проверь пути, совместимость `app.asar` и запусти проверки (`node --check` и `-BuildOnly`), затем объясни мне, как перезапустить Antigravity для активации.

### Техническая спецификация для ИИ-агента

#### 1. Структура файлов репозитория
- `tools/antigravity_core_mod.js` — клиентский скрипт для renderer-окна Electron (DOM-наблюдение, панель токенов, поповер, SVG-карта роя, движок обоев/FX, CSS `#antigravity-milk-style`, удержание таблиц `constrainTablesInDialogBox`).
- `tools/update_antigravity_mods.ps1` — распаковывает `%LOCALAPPDATA%\Programs\Antigravity\resources\app.asar` через `npx --yes @electron/asar`, идемпотентно патчит 3 файла в `dist/` с комментариями-маркерами `BEGIN`/`END`, проверяет синтаксис через `node`, пакует обратно с `--unpack "**/node_modules/chrome-devtools-mcp/**"` и сохраняет кэш `app.asar.patched` + `app.asar.patched.unpacked` + `.ver`.
- `tools/restart_and_apply.ps1` — быстрая установка уже собранного `app.asar.patched` (и `.unpacked`) с перезапуском приложения.
- `Apply_AG_UI_Mods.bat` — обёртка для запуска под Windows с UAC-элевацией (требуется, если Antigravity запущен с правами администратора), проверкой `node --check` и нормализацией флагов `-BuildOnly` / `-Rebuild` / `-Restore`.
- `wallpapers/` — 5 PNG-обоев для темы.
- `install.ps1` — копирует всё в `%USERPROFILE%\.gemini\antigravity\{tools,wallpapers}` и на Рабочий стол.

#### 2. Точки интеграции внутри `app.asar` (что и как патчится)
Если в более новой версии Antigravity структура `dist/` изменится и патчер бросит ошибку, ИИ-агенту нужно проверить 3 точки в распакованном `app.asar`:

1. **`dist/utils.js`** (маркеры `// Antigravity Core Mod Loader BEGIN` ... `END`):
   - Вставляется сразу после `(0, loadingOverlay_1.attachLoadingOverlay)(win, foregroundColor, backgroundColor);`.
   - Вешает `win.webContents.on('did-finish-load', ...)` и выполняет `fs.readFileSync(<homedir>/.gemini/antigravity/tools/antigravity_core_mod.js, 'utf8')` через `win.webContents.executeJavaScript(modCode)`.
   - *Плюс:* правки `antigravity_core_mod.js` не требуют пересборки `app.asar` — достаточно перезагрузить окно.
2. **`dist/preload.js`** (маркеры `// Antigravity Token Bridge BEGIN` ... `END`):
   - Пробрасывает `window.antigravityTokenBridge` через `contextBridge.exposeInMainWorld` (используя `electron_1` с фоллбэком на `require('electron')`) с методами:
     - `getStats(convId, modelName)` → `antigravity:get-token-stats`
     - `listWallpapers()` → `antigravity:list-wallpapers`
     - `readWallpaper(fileName)` → `antigravity:read-wallpaper`
     - `openWallpapersDir()` → `antigravity:open-wallpapers-dir`
3. **`dist/ipcHandlers.js`** (маркеры `// Antigravity Token Stats IPC Handler BEGIN` ... `END`):
   - Вставляется в конец функции `registerIpcHandlers` (перед последней `}` до `//# sourceMappingURL`).
   - Инкрементально (по `byteOffset` и кэшу `__tokenStatsCache`) читает `%USERPROFILE%\.gemini\antigravity\brain\<convId>\.system_generated\logs\transcript.jsonl` и дочерние транскрипты субагентов из `invoke_subagent`.
   - Если формат `transcript.jsonl` изменится (поля `step_index`, `type`, `created_at`, `input_tokens`, `cache_read_tokens`, `output_tokens`, `tool_calls`), нужно обновить `__applyTranscriptLines`.

#### 3. Что проверить и адаптировать агенту на чистой машине
1. **Если пользователь не хочет запускать IDE от администратора:** в `Apply_AG_UI_Mods.bat` и `update_antigravity_mods.ps1` можно убрать `-Verb RunAs` при старте `Antigravity.exe` (для перезаписи `app.asar` в `%LOCALAPPDATA%` права админа не нужны, если сама IDE запущена от обычного пользователя; это также вернёт drag-and-drop из обычного Проводника).
2. **Если пользователь пользуется другими моделями (Claude / GPT / DeepSeek):**
   - в `tools/antigravity_core_mod.js` расширить `modelPattern` в `getActiveModelName`;
   - в `tools/update_antigravity_mods.ps1` добавить нужные лимиты в `__resolveModelLimit` и тарифы в `__resolveModelPricing`.
3. **Безопасная проверка перед заменой `app.asar`:**
   - Сначала запустить `install.ps1 -BuildOnly` (или `update_antigravity_mods.ps1 -BuildOnly`) — это распакует текущий `app.asar` пользователя, прогонит `new Function(...)` синтаксис-чек для всех 3 патченных файлов и соберёт `app.asar.patched`, **не трогая работающий Antigravity** (важно, если сам агент запущен внутри этого Antigravity!).
   - После сборки попросить пользователя закрыть Antigravity и запустить `Apply_AG_UI_Mods.bat` с Рабочего стола.
4. **Откат:** `Apply_AG_UI_Mods.bat -Restore` вернёт `app.asar.bak` на место `app.asar`.
