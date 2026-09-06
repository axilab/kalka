# Фаза 1: Репозиторий, сборка и автоматические проверки

План: [index.md](index.md)
Задачи: 1–5
Зависит от: ничего

## Цель

В корне репозитория появляется работающий проект «Кальки»: `npm run build` собирает
**ровно один** файл `dist/kalka.js` формата IIFE, а `npm run check:bundle` роняет сборку
при нарушении любого из четырёх ограничений — бюджет 100 КБ gzip (NFR-01), отсутствие
внешних адресов (NFR-03, NFR-04), отсутствие `console.*` в продакшен-бандле (rules/base.md),
отсутствие `react-dom` (NFR-02). Vitest запускается и проходит на первом настоящем тесте.
ESLint машинно проверяет направление зависимостей FSD и запрет сети.

## Доказательства по текущему коду

| Путь | Символы / строки | Почему важно |
|---|---|---|
| `spike/package.json` | `type: module`, `devDependencies` | Прецедент: ESM, TypeScript 5.9, Vitest 3, `@types/node` 24. Корневой проект держим на тех же мажорах |
| `spike/tsconfig.json` | `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` | Набор строгих флагов, уже принятый в проекте. Корневой `tsconfig.json` его повторяет, меняя только `module`/`moduleResolution`/`jsx` под сборщик |
| `spike/lib/build-browser.ts` | `format: 'iife'`, `globalName`, `target: 'es2022'` | Подтверждает, что IIFE-сборка в проекте уже применялась. Виджет собирается Vite, а не esbuild напрямую, но формат тот же |
| `.claude/skills/kalka-overlay-widget/references/build.md` | весь файл | Канонический конфиг сборки, контроль бюджета, список проверок результата |
| `.ai-factory/ARCHITECTURE.md` | строки 49–119, 121–139 | Структура папок и правила зависимостей, которые кодифицирует ESLint в задаче 5 |
| `.ai-factory/rules/base.md` | «Логирование», «Приватность» | Требования, которые задача 4 превращает в проверку сборки |
| `.gitignore` | `node_modules/`, `dist/`, `*.log` | Уже покрывает артефакты корневого проекта — менять не нужно |

## Файлы к изменению

| Путь | Действие | Что должно появиться |
|---|---|---|
| `package.json` | создать | Корневой манифест, зависимости, npm-скрипты |
| `tsconfig.json` | создать | Конфигурация TypeScript для `src/` (DOM, JSX Preact, алиасы слоёв) |
| `tsconfig.node.json` | создать | Конфигурация для `vite.config.ts` (Node-типы) |
| `src/env.d.ts` | создать | `vite/client`, `*.css?inline`, `__VERSION__`, `Window.__kalka` |
| `src/app/index.ts` | создать | Точка входа бандла. В задаче 1 — заглушка, наполняется в фазе 2 |
| `vite.config.ts` | создать | Library mode → IIFE, алиасы слоёв, блок `test` для Vitest |
| `src/shared/config/constants.ts` | создать | Ключи хранилища, параметр активации, атрибут host-элемента, лимиты |
| `src/shared/lib/log.ts` | создать | Логгер, полностью исчезающий из продакшен-сборки |
| `src/shared/lib/log.test.ts` | создать | Первый тест проекта |
| `scripts/check-bundle.mjs` | создать | Четыре проверки бандла, выход с кодом 1 при нарушении |
| `eslint.config.js` | создать | Границы слоёв FSD, запрет сети, запрет `console` вне логгера |

## Task 1: Корневой манифест и конфигурация TypeScript

### Назначение

Дать проекту корень, отдельный от `spike/`. Без него ни один следующий шаг не запускается.
`spike/` остаётся самостоятельным мини-проектом со своим `package.json` и своим
`node_modules`; корневой проект его не включает и не собирает.

### Шаги реализации

1. Создать `package.json` в корне репозитория:

```json
{
  "name": "kalka",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Калька — слой правок поверх прототипа",
  "scripts": {
    "dev": "vite",
    "build": "vite build && npm run check:bundle",
    "check:bundle": "node scripts/check-bundle.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json",
    "lint": "eslint ."
  }
}
```

   `npm run build` до задачи 4 будет падать на отсутствующем `scripts/check-bundle.mjs` —
   это ожидаемо; в задачах 2 и 3 сборка вызывается как `npx vite build`.

2. Установить зависимости **отдельными командами** (правило AGENTS.md: составные
   shell-команды разбиваются):

```
npm install preact@^10
```

```
npm install --save-dev vite@^7 @preact/preset-vite@^2 typescript@^5.9 vitest@^3 jsdom@^26 @types/node@^24 eslint@^9 @eslint/js@^9 typescript-eslint@^8
```

   Мажоры зафиксированы намеренно. **Vite остаётся на 7.x**: Vite 8 переводит сборку
   на Rolldown и переименовывает `build.rollupOptions` → `build.rolldownOptions`,
   а конфиг из `kalka-overlay-widget/references/build.md` написан под 7.x. Переход
   на 8.x — отдельная задача после этапа 1, вместе с правкой навыка.
   Если npm сообщает, что запрошенный мажор недоступен, **не подбирать версию наугад**:
   остановиться и зафиксировать это как блокирующий вопрос в `index.md`.

3. Создать `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["vite/client"],
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "paths": {
      "app/*": ["./src/app/*"],
      "pages/*": ["./src/pages/*"],
      "widgets/*": ["./src/widgets/*"],
      "features/*": ["./src/features/*"],
      "entities/*": ["./src/entities/*"],
      "shared/*": ["./src/shared/*"]
    }
  },
  "include": ["src"]
}
```

   `lib` намеренно равен `target`: иначе в коде окажутся API новее того, что
   собирается в бандл. `paths` даёт импорты вида `shared/lib/log`, как их записывает
   `.ai-factory/ARCHITECTURE.md`; зеркальные алиасы для сборщика задаются в задаче 2.

4. Создать `tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "strict": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["vite.config.ts"]
}
```

5. Создать `src/env.d.ts`:

```ts
/// <reference types="vite/client" />

declare module '*.css?inline' {
  const content: string
  export default content
}

/** Подставляется сборкой из поля `version` корневого package.json. */
declare const __VERSION__: string

interface Window {
  /** Единственное, что «Калька» пишет в глобальную область носителя. */
  __kalka?: { readonly version: string; readonly unmount: () => void }
}
```

   Файл обязан остаться **глобальным скриптом**: ни `export`, ни `import`,
   ни обёртки `declare global`. Одна строка `export {}` делает файл модулем, и тогда
   подстановочное объявление `*.css?inline` и `declare const __VERSION__` уходят
   в область модуля вместо глобальной. Проверено компилятором на этом же наборе флагов:
   получаются `TS2304: Cannot find name '__VERSION__'` в `src/app/index.ts` (задача 12)
   и `TS2307: Cannot find module './host.css?inline'` в `src/app/lib/mount.ts` (задача 11).
   В глобальном скрипте `interface Window` дополняет глобальный тип напрямую —
   `declare global` здесь, наоборот, был бы ошибкой.

6. Создать заглушку точки входа `src/app/index.ts`:

```ts
// Точка входа бандла (build.lib.entry). Наполняется в фазе 2.
export {}
```

7. Создать каталоги только под код этого плана: `src/app/config`, `src/app/lib`,
   `src/app/ui`, `src/pages`, `src/widgets`, `src/shared/api`, `src/shared/config`,
   `src/shared/lib`, `src/shared/model`, `src/shared/ui`, `scripts`, `dev`.
   Каталоги `src/features` и `src/entities` **не создавать**: в этапе 1 кода в них нет,
   а пустые слои запрещены (ARCHITECTURE.md, «Замечание об организации кода»).

8. `.gitignore` менять не нужно: `node_modules/` и `dist/` уже перечислены. Проверить
   это и явно зафиксировать в коммите отсутствие правки.

### Требуемые интерфейсы и контракты

- Имя выходного файла — `kalka.js`, имя глобальной переменной — `Kalka` (задача 2).
- Алиасы слоёв — ровно шесть имён слоёв FSD без префикса, как в ARCHITECTURE.md.
- `Window.__kalka` объявлен типом, а не через `as any`: любое обращение к нему
  проверяется компилятором.
- `src/env.d.ts` — глобальный скрипт без единого `export` и `import`. Это условие
  работоспособности `*.css?inline` и `__VERSION__` во всём проекте.
- Корневой проект не ссылается на `spike/` ни `include`, ни зависимостями.

### Обработка ошибок и логирование

Задача конфигурационная, рантайма не добавляет. Логирования нет.
Отказ установки зависимостей — блокирующий: не подменять мажоры и не переходить
на другой пакетный менеджер, а остановиться.

### Тесты

Тестов нет: задача создаёт только конфигурацию. Проверка — компилятором в разделе
«Проверка».

### Критерии приёмки

- В корне лежат `package.json`, `tsconfig.json`, `tsconfig.node.json`, `src/env.d.ts`, `src/app/index.ts`.
- `node_modules/` установлен, `preact` в `dependencies`, остальное — в `devDependencies`.
- `npm run typecheck` завершается без ошибок.
- В `src/env.d.ts` нет ни одного `export` и ни одного `import`: иначе объявления
  перестают быть глобальными.
- Каталогов `src/features` и `src/entities` не существует.

### Проверка

- `npm run typecheck`
  Ожидаемо: пустой вывод, код возврата 0.
- `grep -nE "^(export|import)" src/env.d.ts`
  Ожидаемо: пусто.
- `node -e "console.log(require('fs').existsSync('src/entities'), require('fs').existsSync('src/features'))"`
  Ожидаемо: `false false`.

## Task 2: Сборка Vite в один IIFE-файл и конфигурация Vitest

### Назначение

Реализовать FR-01: подключение одной строкой `<script>` без сборки на стороне сайта.
Один конфиг обслуживает и сборку, и тесты — чтобы алиасы слоёв и JSX-настройки
не разъезжались между `npm run build` и `npm test`.

### Шаги реализации

1. Создать `vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

const src = (layer: string) => fileURLToPath(new URL(`./src/${layer}`, import.meta.url))

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      app: src('app'),
      pages: src('pages'),
      widgets: src('widgets'),
      features: src('features'),
      entities: src('entities'),
      shared: src('shared'),
    },
  },
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/app/index.ts', import.meta.url)),
      name: 'Kalka',
      formats: ['iife'],
      fileName: () => 'kalka.js',
    },
    cssCodeSplit: false,
    target: 'es2020',
    minify: 'esbuild',
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    // Обязательно. По умолчанию Vitest подменяет любой CSS пустой строкой —
    // суффикс ?inline от этого не спасает. Без css: true в тесты монтирования
    // (фаза 2, задача 11) приходит пустой host.css, и проверка изоляции
    // превращается в проверку пустоты.
    css: true,
  },
})
```

2. Отклонение от навыка зафиксировать комментарием в конфиге: `build.md` показывает
   `entry: 'src/index.ts'`, а точка входа проекта — `src/app/index.ts`
   (ARCHITECTURE.md, «Структура папок»: `app/index.ts # точка входа бандла`).
   Побеждает ARCHITECTURE.md.
3. `rollupOptions.external` не задаётся вовсе — Preact обязан оказаться внутри бандла.
4. Убедиться, что `npx vite build` создаёт `dist/kalka.js` и больше ничего.

### Требуемые интерфейсы и контракты

- Формат — `iife`, глобальное имя — `Kalka`; без `name` сборка library mode падает.
- `cssCodeSplit: false` и импорт CSS через `?inline` (фаза 2) держат стили внутри
  единственного JS-файла.
- `inlineDynamicImports: true` запрещает появление второго чанка.
- `target: 'es2020'` — по NFR-05 целевые браузеры актуальные; полифилы не подключаются.
- Алиасы в `resolve.alias` обязаны совпадать с `paths` из `tsconfig.json` один в один.
  Расхождение даёт «работает в редакторе, падает в сборке».
- Блок `test` использует те же алиасы и тот же JSX-плагин, поэтому отдельного
  `vitest.config.ts` в проекте нет.
- `test.css: true` — не украшение, а условие работоспособности тестов изоляции.
  Умолчание `css: false` заставляет Vitest возвращать пустую строку для всего,
  что подходит под `\.css($|\?)`, включая импорты с `?inline`.
- **Глобалей тестов в проекте нет.** `globals` в блоке `test` намеренно не включается,
  и каждый тестовый файл начинается с явного импорта:
  `import { describe, expect, it, vi } from 'vitest'` (плюс `beforeEach`, где он нужен).
  Это не стилевое предпочтение: корневой `tsconfig.json` задаёт `"types": ["vite/client"]`,
  то есть глобальных типов тестов в проекте нет вовсе, и файл без импорта падает дважды —
  `ReferenceError: describe is not defined` в рантайме и `TS2304: Cannot find name 'describe'`
  на `npm run typecheck`. Соглашение действует во всех тестовых файлах плана: задачи
  3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16. Альтернатива — `globals: true` плюс
  `"vitest/globals"` в `types` — отклонена: она требует держать в согласии два места
  ради одной сэкономленной строки в файле.

### Обработка ошибок и логирование

Рантайма нет. Ошибка сборки должна оставаться ошибкой: не добавлять `|| true`
и не глушить вывод Vite.

### Тесты

Собственных тестов у конфига нет. Работоспособность тестового окружения проверяется
в разделе «Проверка» запуском Vitest без тестов, а по-настоящему — задачей 3.

### Критерии приёмки

- `npx vite build` завершается успешно.
- В `dist/` ровно один файл — `kalka.js`.
- `npx vitest run --passWithNoTests` завершается успешно (окружение jsdom поднимается).
- В блоке `test` задан `css: true`.
- В блоке `test` **не** задан `globals`: тесты импортируют `describe`, `it`, `expect`
  и `vi` из `vitest` явно.
- `npm run typecheck` по-прежнему проходит (включая `tsconfig.node.json` с `vite.config.ts`).

### Проверка

- `npx vite build`
  Ожидаемо: сборка без ошибок.
- `ls dist`
  Ожидаемо: единственная строка `kalka.js`.
- `npx vitest run --passWithNoTests`
  Ожидаемо: `No test files found` и код возврата 0.

## Task 3: Константы и логгер, исчезающий из продакшен-сборки

### Назначение

`rules/base.md` требует: в продакшен-сборке виджет молчит, диагностика допустима только
под флагом отладки, который выключен по умолчанию и **вырезается сборкой**. Настройка
плана — подробное логирование, поэтому логгер должен быть удобным и многословным
в разработке и физически отсутствовать в бандле. Константы выносятся сюда же, потому что
логгер и хранилище (фаза 2) обязаны использовать один и тот же префикс ключей.

### Шаги реализации

1. Создать `src/shared/config/constants.ts`:

```ts
/** Префикс всех ключей в localStorage носителя: хранилище общее с сайтом. */
export const STORAGE_PREFIX = 'kalka:'

/** Ключ флага активации, переживающего переход по внутренним ссылкам. */
export const ENABLED_KEY = 'enabled'

/** Имя параметра адреса, включающего виджет (FR-03). */
export const ACTIVATION_PARAM = 'kalka'

/** Атрибут host-элемента: по нему свои узлы отличаются от чужих при обходе DOM. */
export const ROOT_ATTRIBUTE = 'data-kalka-root'

/** Потолок z-index. Не гарантия — см. shared/lib/dom и app/lib/mount. */
export const TOP_LAYER_Z_INDEX = 2147483647
```

2. Создать `src/shared/lib/log.ts`:

```ts
/**
 * Логгер разработки.
 *
 * В продакшен-сборке `import.meta.env.DEV` заменяется на `false`, ветка с console
 * удаляется минификатором целиком, и в бандле не остаётся ни одного вызова console
 * (проверяется scripts/check-bundle.mjs).
 */

type Fields = Readonly<Record<string, unknown>>

export interface Logger {
  debug(message: string, fields?: Fields): void
  info(message: string, fields?: Fields): void
  warn(message: string, fields?: Fields): void
  error(message: string, fields?: Fields): void
  /** Дочерний логгер с уточнённой областью: `mount` → `mount:styles`. */
  child(scope: string): Logger
}

const SILENT: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => SILENT,
}

function verbose(scope: string): Logger {
  const at =
    (level: 'debug' | 'info' | 'warn' | 'error') =>
    (message: string, fields?: Fields): void => {
      const prefix = `[kalka:${scope}]`
      if (fields === undefined) console[level](prefix, message)
      else console[level](prefix, message, fields)
    }

  return {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: (suffix) => verbose(`${scope}:${suffix}`),
  }
}

export function createLogger(scope: string): Logger {
  return import.meta.env.DEV ? verbose(scope) : SILENT
}
```

3. Создать `src/shared/lib/log.test.ts` — первый тест проекта (см. «Тесты»).
4. Проверить, что тернарный оператор стоит **внутри** `createLogger`, а не вокруг
   объявлений: именно так минификатор при `DEV === false` выбрасывает `verbose`
   и все вызовы `console`.

### Требуемые интерфейсы и контракты

- Публичный экспорт `src/shared/lib/log.ts` — `createLogger(scope: string): Logger`
  и тип `Logger`. Больше ничего.
- Уровни: `debug` (подробности хода), `info` (заметные события), `warn` (не остановило
  работу, но требует внимания), `error` (сбой с контекстом). `child` уточняет область.
- Никаких `RESULT`-уровней, файлов и `process.env`: это браузерный код, а не спайк.
- Ошибки никуда не отправляются (NFR-03) — логгер умеет только `console`.
- Все остальные модули получают логгер через `createLogger('<область>')` на уровне модуля.

### Обработка ошибок и логирование

- Логгер сам не бросает исключений: `console[level]` существует во всех целевых браузерах,
  дополнительная защита не нужна.
- Сериализации полей нет — объект передаётся в `console` как есть, чтобы в devtools
  он раскрывался. Это допустимо только потому, что вызовов в продакшене не остаётся.

### Тесты

Файл `src/shared/lib/log.test.ts`, запуск: `npx vitest run src/shared/lib/log.test.ts`.

Случаи:

1. `createLogger('mount').debug('поднялись', { x: 1 })` → `console.debug` вызван один раз
   с аргументами `'[kalka:mount]'`, `'поднялись'`, `{ x: 1 }`.
   (В Vitest `import.meta.env.DEV === true`, поэтому логгер многословный.)
2. Без поля `fields` вызов идёт двумя аргументами, а не тремя с `undefined`.
3. `createLogger('mount').child('styles').info('готово')` → префикс `'[kalka:mount:styles]'`.
4. `warn` пишет в `console.warn`, `error` — в `console.error` (проверяются раздельными
   шпионами, чтобы перепутанные уровни не прошли).

Оснастка: файл открывается строкой
`import { describe, expect, it, vi } from 'vitest'` — глобалей в проекте нет
(задача 2, «Требуемые интерфейсы и контракты»), и это первый файл, который задаёт
образец для всех последующих. Шпионы — `vi.spyOn(console, 'debug').mockImplementation(() => {})`
и аналогичные; `restoreMocks: true` в конфиге снимает их после каждого теста.

### Критерии приёмки

- `npx vitest run` находит и проходит четыре теста.
- В `src/shared/lib/log.ts` нет обращений к `process`, `window` и сети.
- `createLogger` — единственная функция, экспортируемая наружу вместе с типом `Logger`.

### Проверка

- `npx vitest run src/shared/lib/log.test.ts`
  Ожидаемо: 4 passed.
- `npm run typecheck`
  Ожидаемо: без ошибок.

## Task 4: Проверка бандла, роняющая сборку

### Назначение

`build.md`: «Бюджет, который не проверяется автоматически, не соблюдается». Четыре
требования PRD проверяются одним скриптом, потому что каждое из них ломается тихо
и обнаруживается поздно.

### Шаги реализации

1. Создать `scripts/check-bundle.mjs`:

```js
/**
 * Четыре проверки выходного бандла. Любая непройденная роняет сборку.
 *
 * 1. FR-01  — в dist ровно один файл: подключение одной строкой <script>
 * 2. NFR-01 — не больше 100 КБ gzip
 * 3. NFR-03/04 — ни одного внешнего адреса: виджет ничего не грузит извне
 * 4. NFR-02 — react-dom не просочился транзитивной зависимостью
 * 5. rules/base.md — в продакшен-сборке нет ни одного вызова console
 */
import { gzipSync } from 'node:zlib'
import { readFileSync, readdirSync, statSync } from 'node:fs'

const DIST = 'dist'
const FILE = `${DIST}/kalka.js`
const LIMIT = 100 * 1024

/**
 * Пространства имён разметки — не загрузка ресурса, а строковые константы.
 * Ядро Preact содержит все три в основном пути отрисовки (проверено на 10.27.1),
 * они не вырезаются деревотрясением, и без этого исключения падала бы любая сборка.
 * Список закрытый: расширять его можно только под такие же строки-идентификаторы,
 * по которым браузер никуда не ходит.
 */
const NAMESPACES = /^https?:\/\/www\.w3\.org\//

const problems = []

const files = readdirSync(DIST)
if (files.length !== 1 || files[0] !== 'kalka.js') {
  problems.push(`в ${DIST}/ должен быть ровно один файл kalka.js, а лежит: ${files.join(', ')}`)
}

const code = readFileSync(FILE, 'utf8')
const raw = statSync(FILE).size
const gz = gzipSync(readFileSync(FILE)).length

console.log(
  `kalka.js: ${(raw / 1024).toFixed(1)} КБ → ${(gz / 1024).toFixed(1)} КБ gzip ` +
    `(${((gz / LIMIT) * 100).toFixed(1)}% бюджета)`,
)

if (gz > LIMIT) problems.push(`превышен бюджет: ${gz} > ${LIMIT} байт gzip`)

const urls = [...code.matchAll(/https?:\/\/[^\s'"`)]+/g)]
  .map((match) => match[0])
  .filter((url) => !NAMESPACES.test(url))

if (urls.length > 0) problems.push(`внешний адрес в бандле: ${urls[0]}`)

if (code.includes('react-dom')) problems.push('в бандле найден react-dom')

const call = code.match(/console\s*\.\s*[a-z]+/)
if (call) problems.push(`вызов console в продакшен-сборке: ${call[0]}`)

if (problems.length > 0) {
  for (const p of problems) console.error(`✗ ${p}`)
  process.exit(1)
}

console.log('✓ бандл соответствует ограничениям')
```

2. Скрипт собирает **все** нарушения и только потом выходит с ошибкой: иначе каждая
   правка вскрывает ровно одну проблему за прогон.
3. Исключение для `www.w3.org` — не смягчение проверки, а её условие работоспособности.
   В `dist/preact.min.js` версии 10.27.1 лежат три строки: `http://www.w3.org/2000/svg`,
   `http://www.w3.org/1999/xhtml`, `http://www.w3.org/1998/Math/MathML`. Это аргументы
   `createElementNS` в основном пути `diffElementNodes`, а не адреса загрузки: браузер
   по ним никуда не обращается, NFR-03 и NFR-04 не затрагиваются. Без исключения
   проверка падала бы на **каждой** сборке, и её пришлось бы выключить целиком.
   Проверять `grep -c 'http' dist/kalka.js` (как показано в `build.md`) по этой же
   причине нельзя — результат всегда ненулевой.
4. Убедиться, что `npm run build` теперь выполняет обе стадии и падает при нарушении.
5. Внести в `README` (фаза 4, задача 18) правило: проверки не ослабляются. Если
   `console` или внешний адрес появились — искать источник через
   `npx vite-bundle-visualizer`, а не смягчать регулярное выражение. Расширение
   списка `NAMESPACES` — не исключение из правила: туда попадают только строки-
   идентификаторы, по которым не происходит сетевого обращения, и каждое пополнение
   сопровождается объяснением, почему это так.

### Требуемые интерфейсы и контракты

- Скрипт запускается из корня, путь `dist/kalka.js` захардкожен вместе с именем
  из `build.lib.fileName`. Оба меняются только вместе.
- Код возврата: 0 — всё в порядке, 1 — есть нарушения. Никаких предупреждений «мягко».
- Проверка внешних адресов ловит `http://` и `https://` **кроме** пространств имён
  `www.w3.org`, которые приходят из ядра Preact. Соглашение «инлайновые SVG пишутся
  без атрибута `xmlns`» при этом сохраняется, но уже не как защита от падения сборки:
  Preact рендерит SVG-элементы в правильном пространстве имён сам, и атрибут просто
  лишний вес в бандле.
- Проверка `console` намеренно грубая (`console` + точка + слово): её задача —
  поймать факт, а не разобрать синтаксис.

### Обработка ошибок и логирование

- Отсутствие `dist/` означает, что сборка не запускалась: `readdirSync` бросит
  исключение с внятным сообщением Node — отдельная обработка не нужна и не добавляется.
- Скрипт печатает строку размера **всегда**, даже когда всё в порядке: рост бандла
  должен быть виден в каждом прогоне сборки, а не только при отказе.

### Тесты

Модульных тестов у скрипта нет: он сам является проверкой и запускается на каждой
сборке. Его поведение проверяется в разделе «Проверка» — прогоном на настоящем
и на заведомо испорченном бандле.

### Критерии приёмки

- `npm run build` проходит целиком и печатает строку размера и `✓`.
- Испорченный бандл роняет сборку с кодом 1 и понятным сообщением.
- Ни одна проверка не выключена и не смягчена. Единственное исключение —
  пространства имён `www.w3.org`, и оно объяснено комментарием в скрипте.

### Проверка

- `npm run build`
  Ожидаемо: строка вида `kalka.js: … КБ gzip (…% бюджета)` и `✓ бандл соответствует ограничениям`.
  Если вместо этого сборка падает на `http://www.w3.org/…` — исключение `NAMESPACES`
  потеряно при наборе скрипта.
- `node -e "require('fs').appendFileSync('dist/kalka.js','//https://example.com')"`, затем `npm run check:bundle`
  Ожидаемо: `✗ внешний адрес в бандле: https://example.com`, код возврата 1.
- `node -e "require('fs').appendFileSync('dist/kalka.js','//https://www.w3.org.evil.test/x')"`, затем `npm run check:bundle`
  Ожидаемо: адрес пойман — исключение привязано к началу строки и на поддомен не распространяется.
- `npm run build`
  Ожидаемо: снова успех (сборка перезаписала испорченный файл).

## Task 5: ESLint и границы слоёв FSD

### Назначение

ARCHITECTURE.md, ключевой принцип 1: «Правило импорта — машинно-проверяемое.
Нарушение — ошибка сборки». Тот же конфиг механически закрывает NFR-03 (никаких
сетевых вызовов) и правило `rules/base.md` о `console` — обе ошибки иначе
обнаруживаются только на проверке бандла, то есть поздно.

### Шаги реализации

1. Создать `eslint.config.js`:

```js
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Порядок слоёв FSD сверху вниз. Модуль импортирует только из слоёв строго ниже
 * и не импортирует соседние слайсы своего слоя.
 */
const LAYERS = ['app', 'pages', 'widgets', 'features', 'entities', 'shared']

/** app и shared — одновременно слои и слайсы: внутри них импорт свободен. */
const SINGLE_SLICE = new Set(['app', 'shared'])

/** Слои со слайсами: наружу видна только точка входа слайса. */
const SLICED = LAYERS.filter((l) => !SINGLE_SLICE.has(l))

const SRC = fileURLToPath(new URL('./src', import.meta.url))

function locate(filename) {
  const relative = path.relative(SRC, filename)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null

  const [layer, slice] = relative.split(path.sep)
  if (!LAYERS.includes(layer)) return null

  return {
    layer,
    slice: SINGLE_SLICE.has(layer) ? layer : slice,
  }
}

function restrictionsFor(layer) {
  const index = LAYERS.indexOf(layer)
  const above = LAYERS.slice(0, index)
  const patterns = above.map((l) => ({
    group: [`${l}`, `${l}/**`],
    message: `Импорт вверх по слоям запрещён: ${layer} не знает о ${l} (ARCHITECTURE.md).`,
  }))

  if (!SINGLE_SLICE.has(layer)) {
    patterns.push({
      group: [`${layer}/**`],
      message: `Слайсы одного слоя не импортируют друг друга: общаться через хранилище (ARCHITECTURE.md).`,
    })
  }

  for (const l of SLICED) {
    if (l === layer) continue
    patterns.push({
      group: [`${l}/*/**`],
      message: `Обращение внутрь слайса в обход index.ts запрещено: импортируйте из ${l}/<слайс>.`,
    })
  }

  return patterns
}

/**
 * `no-restricted-imports` видит текст спецификатора, но относительный путь
 * `../../review-mode` не знает ни о слоях, ни о слайсах. Это правило разрешает
 * относительные импорты только внутри текущего слайса. Между слоями и слайсами
 * используются алиасы, которые проверяет `no-restricted-imports` выше.
 */
const kalka = {
  rules: {
    'relative-inside-boundary': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          outside:
            'Относительный импорт вышел за границу слайса: используйте публичный API и алиас слоя (ARCHITECTURE.md).',
        },
      },
      create(context) {
        const from = locate(context.filename ?? context.getFilename())

        function check(node) {
          const specifier = node.source?.value
          if (!from || typeof specifier !== 'string' || !specifier.startsWith('.')) return

          const filename = context.filename ?? context.getFilename()
          const target = locate(path.resolve(path.dirname(filename), specifier))
          const sameBoundary =
            target !== null && target.layer === from.layer && target.slice === from.slice

          if (!sameBoundary) {
            context.report({ node: node.source, messageId: 'outside' })
          }
        }

        return {
          ImportDeclaration: check,
          ExportNamedDeclaration: check,
          ExportAllDeclaration: check,
          ImportExpression: check,
        }
      },
    },
  },
}

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'spike/**', 'dev/**', 'scripts/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { kalka },
    rules: {
      'kalka/relative-inside-boundary': 'error',
      'no-console': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Виджет ничего не отправляет наружу (NFR-03).' },
        { name: 'XMLHttpRequest', message: 'Виджет ничего не отправляет наружу (NFR-03).' },
        { name: 'WebSocket', message: 'Виджет ничего не отправляет наружу (NFR-03).' },
        { name: 'EventSource', message: 'Виджет ничего не отправляет наружу (NFR-03).' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'navigator', property: 'sendBeacon', message: 'Виджет ничего не отправляет наружу (NFR-03).' },
        { object: 'window', property: 'fetch', message: 'Виджет ничего не отправляет наружу (NFR-03).' },
      ],
    },
  },
  ...LAYERS.map((layer) => ({
    files: [`src/${layer}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': ['error', { patterns: restrictionsFor(layer) }],
    },
  })),
  {
    // Единственное место, где console разрешён: он и есть логгер.
    files: ['src/shared/lib/log.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['src/**/*.test.{ts,tsx}'],
    rules: { 'no-console': 'off' },
  },
)
```

2. `spike/**` вынесен в `ignores` намеренно: спайк — одноразовый код вне FSD, который
   будет удалён (`spike/VERDICT.md`, раздел «Что удалить»). Линтовать его нечем и незачем.
3. Плагин границ (`eslint-plugin-boundaries`, `steiger`) **не подключается**:
   алиасные импорты проверяет правило ядра `no-restricted-imports`, а относительные —
   локальное правило `kalka/relative-inside-boundary` из того же конфига. Оно вычисляет
   фактические пути источника и цели и разрешает относительный импорт только внутри
   одного слайса; для `app` и `shared` границей считается весь слой.
4. Убедиться, что оба уровня запрета работают: отдельно проверить алиасный импорт вверх
   (`import 'app/index'` из `shared`) и относительный импорт соседнего слайса
   (`import '../../review-mode'` из `pages/view-mode/ui`). Временные строки удалять
   отдельными правками сразу после каждого отрицательного прогона.

### Требуемые интерфейсы и контракты

- Конфиг — flat config (ESLint 9), формат ESM, имя файла `eslint.config.js`.
- Проверяется только `src/**`. `vite.config.ts` и `scripts/**` — инструментарий,
  а не код виджета; сетевые запреты к ним не относятся.
- `no-restricted-imports` работает с алиасами слоёв; локальное правило вычисляет
  относительные пути. `./x` и `../model/x` внутри одного слайса разрешены,
  `../../<соседний-слайс>` и относительный выход в другой слой запрещены.
- Правила `no-restricted-globals` / `no-restricted-properties` — вторая линия обороны
  к проверке бандла: они ловят намерение в исходнике, скрипт ловит факт в артефакте.

### Обработка ошибок и логирование

Рантайма нет. Нарушения — ошибки уровня `error`, предупреждений в конфиге нет вовсе:
предупреждение, которое никто не чинит, хуже отсутствующего правила.

### Тесты

Модульных тестов у конфига нет. Работоспособность правил проверяется временными
нарушениями в разделе «Проверка»; после проверки временные строки удаляются.

### Критерии приёмки

- `npm run lint` проходит на чистом `src/`.
- Импорт вверх по слоям, импорт соседнего слайса и обращение внутрь слайса
  дают ошибку линтера как через алиас, так и через относительный путь.
- `fetch` в коде `src/**` даёт ошибку линтера.
- `console.log` вне `src/shared/lib/log.ts` даёт ошибку линтера.

### Проверка

- `npm run lint`
  Ожидаемо: пустой вывод, код возврата 0.
- Временно дописать в `src/shared/config/constants.ts` строку `import 'app/index'`, затем `npm run lint`
  Ожидаемо: `Импорт вверх по слоям запрещён: shared не знает о app`. Строку удалить.
- Временно дописать в `src/pages/view-mode/ui/ViewMode.tsx` строку
  `import '../../review-mode'`, затем `npm run lint`
  Ожидаемо: `Относительный импорт вышел за границу слайса`. Строку удалить.
- Временно дописать в `src/shared/config/constants.ts` строку `void fetch('/x')`, затем `npm run lint`
  Ожидаемо: сообщение про NFR-03. Строку удалить.

## Риски фазы и меры

- **Риск:** мажор `vite@^7` окажется недоступен или несовместим с `@preact/preset-vite@^2`.
  **Мера:** это блокирующий вопрос, а не повод подобрать версию наугад — остановиться
  и записать вопрос в `index.md`. Переход на Vite 8 требует правки навыка
  (`rollupOptions` → `rolldownOptions`) и не делается попутно.
- **Риск:** алиасы слоёв в `tsconfig.json` и `vite.config.ts` разъедутся, и код будет
  собираться, но не проверяться типами (или наоборот).
  **Мера:** оба списка состоят из одних и тех же шести имён; задача 2 требует их
  сверки, `npm run typecheck` и `npx vite build` в одной проверке ловят расхождение.
- **Риск:** проверка внешних адресов сработает на пространствах имён из ядра Preact
  и уронит любую сборку.
  **Мера:** учтено в задаче 4 списком `NAMESPACES`. Проверено на `preact@10.27.1`:
  в бандле ровно три таких строки, все — `http://www.w3.org/…`. Если проверка
  всё-таки падает на адресе `www.w3.org`, значит исключение потеряно при наборе;
  если падает на любом другом адресе — это настоящая находка, и её ищут
  визуализатором бандла.
- **Риск:** проверка `console` в бандле сработает на коде Preact, а не на нашем.
  **Мера:** ядро Preact вызовов `console` не содержит — их добавляет `preact/debug`,
  который `@preact/preset-vite` подключает только в dev. Если проверка всё же упала,
  источник ищется визуализатором бандла, а проверка не ослабляется.
- **Риск:** разработчик обойдёт алиасные ограничения относительным импортом между
  слайсами (`../../review-mode`).
  **Мера:** `kalka/relative-inside-boundary` вычисляет фактические границы и запрещает
  такой выход; отрицательный прогон в задаче 5 проверяет именно относительный обход.
  README (задача 18) описывает то же правило для человека.

## Чек-лист завершения фазы

- Каждая задача 1–5 удовлетворяет своим критериям приёмки.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` проходят.
- В `dist/` ровно один файл; строка размера напечатана.
- Чекбоксы задач 1–5 отмечены в `index.md` сразу после проверки.
