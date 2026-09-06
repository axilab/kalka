# Сборка: один файл, одна строка подключения

Реализация FR-01 (подключение одной строкой `<script>` без сборки на стороне сайта)
и NFR-01 (≤ 100 КБ gzip).

## Требование определяет формат

«Одна строка `<script>`» означает ровно одно: **один выходной файл, содержащий всё** —
JS, CSS, иконки. Не ES-модуль (потребовал бы `type="module"` и импорты), не отдельный
CSS-файл (потребовал бы второй строки).

Формат — `iife`: самовызывающаяся функция, не оставляющая ничего в глобальной области
сверх того, что мы положим сами.

```html
<script src="/kalka.js"></script>
```

## Конфиг

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  define: {
    __VERSION__: JSON.stringify(process.env.npm_package_version),
  },
  build: {
    lib: {
      entry: 'src/index.ts',
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
})
```

Построчно:

- **`formats: ['iife']`.** По умолчанию Vite для одиночной точки входа собирает `es` + `umd`.
  Нам нужен ровно один артефакт.
- **`name: 'Kalka'`.** Для `iife` и `umd` обязателен — это имя глобальной переменной.
  Без него сборка падает.
- **Пустой `rollupOptions.external`.** Ничего не выносим наружу: Preact должен оказаться
  **внутри** бандла. Внешние зависимости в `iife` требуют `output.globals` и присутствия
  библиотеки на странице — а носитель нам ничего не должен.
- **`cssCodeSplit: false`.** Без него CSS уедет отдельным файлом.
- **`target: 'es2020'`.** Целевые браузеры по NFR-05 — актуальные. Более низкий таргет
  добавит транспиляцию и вес без пользы.
- **`inlineDynamicImports: true`.** Запрещает вынос кусков в отдельные чанки: любой
  `import()` в коде иначе породил бы второй файл.

## CSS внутрь бандла

Обычный `import './widget.css'` в library mode породит отдельный `.css`. Для Shadow DOM
нам всё равно нужна **строка** — стили уходят в `adoptedStyleSheets`, а не в `<link>`:

```ts
import styles from './widget.css?inline'

const sheet = new CSSStyleSheet()
sheet.replaceSync(styles)
shadow.adoptedStyleSheets = [sheet]
```

`?inline` — суффикс Vite: содержимое файла приходит строкой вместо эмита ресурса.
Побочный эффект приятный: CSS автоматически оказывается внутри единственного JS-файла.

Объявление типа нужно один раз:

```ts
// src/env.d.ts
declare module '*.css?inline' {
  const content: string
  export default content
}
```

## Иконки

Только инлайновые SVG прямо в JSX. Иконочный шрифт — это внешний файл (вторая строка,
сетевой запрос, вес). Спрайт — тоже отдельный файл.

Загрузка шрифтов с CDN запрещена дважды: NFR-03 (ничего наружу) и NFR-04 (работа
за VPN и на `localhost` без внешних сервисов). Шрифт — системный стек.

## Контроль бюджета

Бюджет, который не проверяется автоматически, не соблюдается. Проверка — часть сборки:

```json
{
  "scripts": {
    "build": "vite build && npm run size",
    "size": "node scripts/check-size.mjs"
  }
}
```

```js
// scripts/check-size.mjs
import { gzipSync } from 'node:zlib'
import { readFileSync, statSync } from 'node:fs'

const LIMIT = 100 * 1024
const file = 'dist/kalka.js'

const raw = statSync(file).size
const gz = gzipSync(readFileSync(file)).length
const pct = ((gz / LIMIT) * 100).toFixed(1)

console.log(`kalka.js: ${(raw / 1024).toFixed(1)} КБ → ${(gz / 1024).toFixed(1)} КБ gzip (${pct}% бюджета)`)

if (gz > LIMIT) {
  console.error(`Превышен бюджет: ${gz} > ${LIMIT} байт gzip`)
  process.exit(1)
}
```

Сборка **падает** при превышении. Иначе бюджет незаметно уползёт: каждая отдельная
зависимость всегда выглядит маленькой.

Ориентир из PRD: SitePing — 23–30 КБ без редактора. 100 КБ — это запас, а не цель.

## Разбор размера

Когда бюджет поджимает:

```bash
npx vite-bundle-visualizer
```

Первое, на что смотреть, — редактор форматированного текста. Это единственная часть,
где внешняя библиотека вероятно оправдана, и одновременно самая тяжёлая. Требования
к нему скромные (FR-07: жирный, курсив, ссылка, список, снятие форматирования), поэтому
сравнивать кандидатов надо по весу, а не по возможностям.

Второе — не затесался ли React вместо Preact через транзитивную зависимость. Проверка:

```bash
grep -c 'react-dom' dist/kalka.js    # ожидаем 0
```

## Дев-стенд

Виджет нельзя разрабатывать в изоляции — он про поведение на чужой странице.
В `dev/` держится набор страниц-мишеней:

- статическая HTML-страница;
- SPA с клиентской навигацией — проверка переприменения;
- страница с агрессивным CSS (`* { box-sizing }`, `div { margin }`, свой `font-family`
  на `body`) — проверка изоляции;
- страница, создающая контекст наложения через `transform` на предке — проверка `z-index`.

Дев-страницы в бандл не попадают: `build.lib.entry` указывает только на `src/index.ts`.

## Проверка результата

```bash
npm run build
ls dist/                              # ровно один файл: kalka.js
grep -c 'http' dist/kalka.js          # ожидаем 0 — ни одного внешнего адреса
gzip -c dist/kalka.js | wc -c         # < 102400
```

Три проверки закрывают три требования: один файл (FR-01), никакой сети (NFR-03/04),
бюджет (NFR-01).

## Чек-лист

- [ ] `formats: ['iife']`, задан `name`
- [ ] `rollupOptions.external` пуст — Preact внутри бандла
- [ ] `cssCodeSplit: false`, CSS через `?inline`
- [ ] `inlineDynamicImports: true`
- [ ] В `dist/` ровно один файл
- [ ] В бандле нет внешних URL
- [ ] Проверка размера падает при превышении бюджета
- [ ] `react-dom` в бандле отсутствует
- [ ] Дев-стенд покрывает SPA, агрессивный CSS и контекст наложения
