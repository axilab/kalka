# Фаза 2: Загрузка, изоляция и кнопка «Калька»

План: [index.md](index.md)
Задачи: 6–12
Зависит от: фазы 1 (задачи 1–5)

## Цель

Скрипт, подключённый одной строкой, **молчит без явного включения** (FR-03), а при
`?kalka` создаёт на странице ровно один элемент, монтирует внутрь Shadow DOM интерфейс
на Preact (FR-04) и показывает свёрнутую кнопку «Калька» (первая половина FR-02).
Ошибка внутри виджета не всплывает в код носителя (NFR-06), а `window.__kalka.unmount()`
возвращает страницу в исходное состояние.

## Доказательства по текущему коду

| Путь | Символы / строки | Почему важно |
|---|---|---|
| `.claude/skills/kalka-overlay-widget/SKILL.md` | «Точка входа и guard активации», «Монтирование Preact в shadow root» | Эталонные фрагменты `shouldActivate`, `mountWidget`, `boot`. Задачи 8, 11, 12 реализуют их с уточнениями, перечисленными ниже |
| `.claude/skills/kalka-overlay-widget/references/isolation.md` | строки 39–62, 78–102, 104–142, 143–176 | Двойной сброс стилей, один host-элемент, `composedPath`, `window.__kalka`, полный демонтаж |
| `.ai-factory/rules/base.md` | «Обработка ошибок», «Интерфейс» | Обёртка публичных границ; весь текст по-русски без технических терминов |
| `.ai-factory/ARCHITECTURE.md` | строки 51–63, 106–119 | Точные пути `app/config/activation.ts`, `app/lib/mount.ts`, `app/ui/Root.tsx`, `app/ui/host.css`, `shared/api/storage.ts`, `shared/lib/dom.ts` |
| `src/shared/lib/log.ts` | `createLogger` | Логгер из фазы 1; все модули этой фазы получают через него свою область |
| `src/shared/config/constants.ts` | `STORAGE_PREFIX`, `ENABLED_KEY`, `ACTIVATION_PARAM`, `ROOT_ATTRIBUTE`, `TOP_LAYER_Z_INDEX` | Единственный источник ключей и имён |

## Файлы к изменению

| Путь | Действие | Что должно появиться |
|---|---|---|
| `src/shared/api/storage.ts` | создать | Обёртки над `localStorage` с префиксом и `try/catch` |
| `src/shared/api/storage.test.ts` | создать | Поведение при недоступном хранилище |
| `src/shared/lib/dom.ts` | создать | `isInsideKalka`, `onDocumentReady` |
| `src/shared/lib/dom.test.ts` | создать | Определение «своего» события через `composedPath` |
| `src/shared/lib/safe.ts` | создать | Обёртка границы с чужим кодом |
| `src/shared/lib/safe.test.ts` | создать | Исключение не всплывает наружу |
| `src/app/config/activation.ts` | создать | Guard активации по адресу и флагу |
| `src/app/config/activation.test.ts` | создать | Все ветки включения и выключения |
| `src/shared/model/ui.ts` | создать | Тип `Mode` |
| `src/shared/ui/Button.tsx` | создать | Единственный элемент UI-кита этапа |
| `src/shared/ui/Button.test.tsx` | создать | Отрисовка и обработчик |
| `src/app/ui/host.css` | создать | `:host { all: initial }` и токены `--kalka-*`; типографика и `box-sizing` — на `.kalka-root`; стили кнопки и панели |
| `src/pages/view-mode/ui/ViewMode.tsx` | создать | Свёрнутая кнопка «Калька» |
| `src/pages/view-mode/index.ts` | создать | Публичный API слайса |
| `src/pages/view-mode/ui/ViewMode.test.tsx` | создать | Отрисовка и нажатие |
| `src/app/ui/Root.tsx` | создать | Корневой компонент; в этой фазе — только режим Просмотр |
| `src/app/lib/mount.ts` | создать | host-элемент, Shadow DOM, стили, монтирование, демонтаж |
| `src/app/lib/mount.test.ts` | создать | Изоляция и полный демонтаж |
| `src/app/index.ts` | заменить | Загрузка: guard, защита от двойного подключения, `window.__kalka` |
| `src/app/index.test.ts` | создать | Ветки загрузки |

## Task 6: Обёртки над localStorage

### Назначение

Хранилище общее с сайтом-носителем, а в приватном режиме обращение к нему **бросает
исключение, а не возвращает `null`**. Оба факта должны быть решены один раз в одном
месте: guard активации (задача 8) и будущее хранилище правок (этап 4) обязаны вести
себя одинаково.

### Шаги реализации

1. Создать `src/shared/api/storage.ts`:

```ts
import { STORAGE_PREFIX } from 'shared/config/constants'
import { createLogger } from 'shared/lib/log'

const log = createLogger('storage')

function key(name: string): string {
  return `${STORAGE_PREFIX}${name}`
}

/** Читает значение. Недоступное хранилище — это `null`, а не исключение. */
export function read(name: string): string | null {
  try {
    const value = localStorage.getItem(key(name))
    log.debug('чтение', { ключ: key(name), значение: value })
    return value
  } catch (error) {
    log.warn('хранилище недоступно при чтении', { ключ: key(name), ошибка: error })
    return null
  }
}

/** Пишет значение. Возвращает `false`, если записать не удалось. */
export function write(name: string, value: string): boolean {
  try {
    localStorage.setItem(key(name), value)
    log.debug('запись', { ключ: key(name), значение: value })
    return true
  } catch (error) {
    log.warn('хранилище недоступно при записи', { ключ: key(name), ошибка: error })
    return false
  }
}

/** Удаляет значение. Возвращает `false`, если удалить не удалось. */
export function remove(name: string): boolean {
  try {
    localStorage.removeItem(key(name))
    log.debug('удаление', { ключ: key(name) })
    return true
  } catch (error) {
    log.warn('хранилище недоступно при удалении', { ключ: key(name), ошибка: error })
    return false
  }
}
```

2. Никакого кеширования в памяти в этапе 1 не вводить: значение читается редко,
   а кеш пришлось бы согласовывать с записью из другой вкладки.

### Требуемые интерфейсы и контракты

- Публичные функции: `read(name)`, `write(name, value)`, `remove(name)`.
  Имя передаётся **без** префикса — префикс добавляется внутри, чтобы ключ без него
  нельзя было записать случайно.
- `read` никогда не бросает; `write`/`remove` никогда не бросают и сообщают об отказе
  булевым результатом.
- Ни одна функция не сериализует объекты: в этапе 1 хранятся только строковые флаги.

### Обработка ошибок и логирование

- Каждое обращение к `localStorage` обёрнуто в `try/catch` — это требование навыка
  и реальность приватного режима.
- `debug` — на каждое обращение (настройка плана: подробное логирование).
- `warn` — на недоступное хранилище: это не сбой работы, но объясняет, почему флаг
  активации не сохранился.
- В лог попадают ключ и значение флага. Пользовательских данных в этапе 1 в хранилище
  нет; когда они появятся (этап 4), значения логировать будет нельзя — записать это
  как комментарий в файле.

### Тесты

Файл `src/shared/api/storage.test.ts`, запуск: `npx vitest run src/shared/api/storage.test.ts`.

1. `write('enabled', '1')` затем `read('enabled')` → `'1'`, а в `localStorage`
   лежит ключ **`kalka:enabled`** (проверяется напрямую `localStorage.getItem`).
2. `read('нет-такого')` → `null`.
3. `remove('enabled')` затем `read('enabled')` → `null`.
4. Хранилище бросает: `vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('отказано') })`
   → `read` возвращает `null` и не бросает.
5. То же для `setItem` → `write` возвращает `false` и не бросает.

Оснастка: `localStorage.clear()` в `beforeEach`; jsdom предоставляет рабочий
`localStorage` из коробки.

### Критерии приёмки

- Все пять тестов проходят.
- Ни одна функция модуля не бросает исключений ни при каких входных данных.
- Ключ в хранилище всегда начинается с `kalka:`.

### Проверка

- `npx vitest run src/shared/api/storage.test.ts`
  Ожидаемо: 5 passed.

## Task 7: Утилиты границы с чужим DOM

### Назначение

Две вещи нужны почти всем следующим задачам: отличить своё событие от чужого
(`composedPath`, а не `target` — из-за ретаргетинга) и не дать исключению уйти
в код носителя (NFR-06). Обе живут в `shared/lib`, где по `rules/base.md` разрешено
трогать DOM носителя.

### Шаги реализации

1. Создать `src/shared/lib/dom.ts`:

```ts
import { ROOT_ATTRIBUTE } from 'shared/config/constants'

/**
 * Принадлежит ли событие интерфейсу «Кальки».
 *
 * Проверять `event.target` бесполезно: для слушателя снаружи он ретаргетится
 * на host-элемент, и внутренние узлы по нему неразличимы. Полный путь
 * с узлами открытого shadow root даёт только composedPath().
 */
export function isInsideKalka(event: Event): boolean {
  return event
    .composedPath()
    .some((node) => node instanceof Element && node.hasAttribute(ROOT_ATTRIBUTE))
}

/**
 * Выполняет `run`, когда документ готов принять host-элемент.
 * Возвращает функцию отмены: скрипт может быть снят до готовности документа.
 */
export function onDocumentReady(run: () => void): () => void {
  if (document.readyState !== 'loading') {
    run()
    return () => {}
  }
  const handler = (): void => run()
  document.addEventListener('DOMContentLoaded', handler, { once: true })
  return () => document.removeEventListener('DOMContentLoaded', handler)
}
```

2. Создать `src/shared/lib/safe.ts`:

```ts
import type { Logger } from 'shared/lib/log'

/**
 * Обёртка границы с чужим кодом: обработчика события, колбэка наблюдателя,
 * пропатченного метода носителя. Исключение не уходит наружу (NFR-06).
 */
export function safely<A extends unknown[]>(
  log: Logger,
  label: string,
  run: (...args: A) => void,
): (...args: A) => void {
  return (...args: A): void => {
    try {
      run(...args)
    } catch (error) {
      log.error(`сбой на границе: ${label}`, { ошибка: error })
    }
  }
}
```

3. `onDocumentReady` намеренно не использует `window.load`: ждать картинок незачем,
   а `DOMContentLoaded` уже гарантирует наличие `document.body`.

### Требуемые интерфейсы и контракты

- `isInsideKalka(event: Event): boolean` — единственный допустимый способ отличить
  своё событие. Прямые сравнения с `event.target` в проекте запрещены; это
  фиксируется комментарием в файле.
- `onDocumentReady(run): () => void` — идемпотентна по отношению к уже готовому
  документу: вызывает `run` синхронно и возвращает пустую отмену.
- `safely` **не** возвращает значение и не подавляет ошибку молча: она уходит
  в `log.error`, который в продакшене исчезает вместе с логгером. Функции,
  результат которых нужен, оборачивать этой утилитой нельзя.

### Обработка ошибок и логирование

- `safely` — единственное место, где исключение гасится намеренно. Каждое гашение
  сопровождается `error` с меткой границы, чтобы в разработке было видно, где именно
  сломалось.
- `isInsideKalka` и `onDocumentReady` не логируют: их вызывают часто, а полезной
  информации в этих вызовах нет.

### Тесты

Файлы `src/shared/lib/dom.test.ts` и `src/shared/lib/safe.test.ts`.
Запуск: `npx vitest run src/shared/lib`.

`dom.test.ts`:

1. Клик по элементу внутри открытого shadow root, host которого имеет
   `data-kalka-root` → `isInsideKalka` возвращает `true`.
   Оснастка: `const host = document.createElement('div'); host.setAttribute('data-kalka-root','');
   document.body.append(host); const shadow = host.attachShadow({ mode: 'open' });
   const btn = document.createElement('button'); shadow.append(btn)`;
   слушатель вешается на `document`, событие — `new MouseEvent('click', { bubbles: true, composed: true })`.
2. Клик по обычному элементу страницы → `false`.
3. `onDocumentReady` при `document.readyState === 'complete'` (значение в jsdom
   по умолчанию) вызывает колбэк синхронно.
4. `onDocumentReady` при подменённом `readyState === 'loading'`
   (`Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true })`)
   не вызывает колбэк сразу, вызывает после `document.dispatchEvent(new Event('DOMContentLoaded'))`,
   и не вызывает вовсе, если сначала выполнить возвращённую отмену.

`safe.test.ts`:

5. Обёрнутая функция, бросающая исключение, не бросает наружу, а вызывает `log.error`
   один раз с меткой границы (логгер — заглушка-объект с `vi.fn()`).
6. Обёрнутая функция получает свои аргументы без изменений.

### Критерии приёмки

- Шесть тестов проходят.
- В `src/**` нет ни одного сравнения с `event.target` для определения «своего» узла.
- `safely` применяется только к функциям, возвращающим `void`.

### Проверка

- `npx vitest run src/shared/lib`
  Ожидаемо: тесты `dom`, `safe` и `log` проходят.
- `grep -rn "event.target" src` (без учёта тестов)
  Ожидаемо: пусто.

## Task 8: Guard активации

### Назначение

FR-03: виджет не активируется, если не включён явно, — забытый скрипт не должен уехать
в прод рабочим. Одного параметра адреса мало: рецензент потеряет виджет на первом же
клике по внутренней ссылке. Поэтому параметр **включает и запоминает**, а флаг в
хранилище переживает переходы.

### Шаги реализации

1. Создать `src/app/config/activation.ts`:

```ts
import { ACTIVATION_PARAM, ENABLED_KEY } from 'shared/config/constants'
import { read, remove, write } from 'shared/api/storage'
import { createLogger } from 'shared/lib/log'

const log = createLogger('activation')

/** Значения параметра, которые выключают виджет и стирают запомненный флаг. */
const OFF_VALUES = new Set(['0', 'off', 'false'])

/**
 * Решает, должен ли виджет подняться на этой странице.
 *
 * Приоритет:
 *   1. ?kalka=0|off|false — выключить и забыть; виджет не поднимается
 *   2. ?kalka (любое другое значение) — включить и запомнить
 *   3. запомненный флаг в хранилище — поднять без параметра
 *   4. иначе — не подниматься
 */
export function shouldActivate(search: string = location.search): boolean {
  const params = new URLSearchParams(search)

  if (params.has(ACTIVATION_PARAM)) {
    const value = params.get(ACTIVATION_PARAM) ?? ''
    if (OFF_VALUES.has(value.trim().toLowerCase())) {
      remove(ENABLED_KEY)
      log.info('выключено параметром адреса')
      return false
    }
    write(ENABLED_KEY, '1')
    log.info('включено параметром адреса')
    return true
  }

  const remembered = read(ENABLED_KEY) === '1'
  log.debug('решение по запомненному флагу', { включено: remembered })
  return remembered
}
```

2. Параметр по умолчанию `search: string = location.search` вводится **ради
   тестируемости**: чистая функция от строки запроса проверяется без подмены
   `location`. Прикладной код вызывает её без аргументов.

### Требуемые интерфейсы и контракты

- Единственный публичный экспорт — `shouldActivate(search?: string): boolean`.
- `?kalka`, `?kalka=1`, `?kalka=да` — включают. `?kalka=0`, `?kalka=off`, `?kalka=false`
  (в любом регистре, с пробелами по краям) — выключают и стирают флаг.
- Флаг в хранилище — строго строка `'1'` по ключу `kalka:enabled`. Любое другое
  значение считается выключенным: так «мусор», записанный кем-то ещё, не включит виджет.
- Функция не бросает: недоступное хранилище обрабатывается внутри `shared/api/storage`.
- Никакой отдельной проверки «прод это или стенд» нет и не будет: единственный признак —
  явное включение.

### Обработка ошибок и логирование

- `info` на каждое решение, принятое параметром адреса: это событие, которое рецензент
  или разработчик наблюдает и о котором спрашивает.
- `debug` на решение по запомненному флагу: происходит на каждой странице.
- Отказ записи флага (приватный режим) **не** отменяет активацию: виджет поднимется
  на текущей странице, а на следующей его снова включит параметр. Предупреждение об этом
  уже пишет `shared/api/storage`.

### Тесты

Файл `src/app/config/activation.test.ts`,
запуск: `npx vitest run src/app/config/activation.test.ts`.

1. `shouldActivate('')` при пустом хранилище → `false`.
2. `shouldActivate('?kalka')` → `true`, в `localStorage` появился `kalka:enabled = '1'`.
3. `shouldActivate('?kalka=1')` → `true`.
4. `shouldActivate('')` после пункта 2 → `true` (флаг запомнен).
5. `shouldActivate('?kalka=0')` → `false`, ключ `kalka:enabled` удалён.
6. `shouldActivate('?KALKA=OFF')` → параметр чувствителен к регистру имени, поэтому
   имя `KALKA` **не** распознаётся: ожидается решение по запомненному флагу.
   Отдельно проверить `?kalka=OFF` → `false` (значение регистронезависимо).
7. `shouldActivate('?other=1&kalka=off')` → `false`.
8. Хранилище бросает на `getItem`: `shouldActivate('')` → `false`, без исключения.

Оснастка: `localStorage.clear()` в `beforeEach`.

### Критерии приёмки

- Восемь тестов проходят.
- Без параметра и без флага виджет не активируется — это проверяется и на дев-стенде
  в фазе 4.
- `shouldActivate` не обращается к DOM и к `window` ни к чему, кроме `location.search`
  по умолчанию.

### Проверка

- `npx vitest run src/app/config/activation.test.ts`
  Ожидаемо: 8 passed.

## Task 9: Стили изоляции и UI-кит этапа

### Назначение

Shadow DOM изолирует стили не полностью: наследуемые свойства (`font-family`,
`font-size`, `color`, `line-height`) проходят через границу. Без двойного сброса
сайт с `body { font-family: 'Ужасный шрифт'; font-size: 11px }` испортит интерфейс —
ровно тот сценарий, который запрещает FR-04.

### Шаги реализации

1. Создать `src/shared/model/ui.ts`:

```ts
/** Режим виджета. За раз показан ровно один (FR-02). */
export type Mode = 'view' | 'edit' | 'review'
```

2. Создать `src/app/ui/host.css`:

```css
/*
 * Второй из двух сбросов. Первый — инлайновый all: initial на самом host-элементе
 * (app/lib/mount.ts): host — обычный элемент страницы и подчиняется её CSS.
 * Этот сброс обрубает наследование внутрь shadow tree.
 *
 * all: initial НЕ сбрасывает пользовательские свойства: переменные носителя видны
 * внутри. Поэтому все свои переменные — с префиксом --kalka-. По той же причине
 * переменные объявляются здесь и переживают инлайновый сброс на host.
 */
:host {
  all: initial;

  --kalka-bg: #ffffff;
  --kalka-fg: #1a1a1a;
  --kalka-muted: #6b7280;
  --kalka-accent: #1b3a6b;
  --kalka-border: #d9dde3;
  --kalka-radius: 10px;
  --kalka-gap: 8px;
  --kalka-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
}

/*
 * Базовая типографика живёт НЕ на :host, а на обёртке внутри теневого корня.
 *
 * Причина: инлайновый стиль host-элемента — объявление внешнего дерева, и оно
 * перебивает правила :host из теневого дерева, каким бы ни был порядок и
 * специфичность. Инлайновый all: initial из app/lib/mount.ts сбрасывает и
 * font-family, и font-size, и line-height, и color, и box-sizing, а :host
 * вернуть их уже не может. Проверено в браузере: интерфейс отрисовывался
 * шрифтом с засечками 16px вместо системного 14px, и на дев-стенде это
 * не заметно — контрольная и агрессивная страницы выглядят одинаково неверно.
 *
 * Класс вешается на точку монтирования в app/lib/mount.ts (задача 11).
 * Переменные --kalka-* при этом остаются на :host: их all: initial не сбрасывает.
 */
.kalka-root {
  display: block;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.4;
  color: var(--kalka-fg);
}

/* После all: initial box-sizing вернулся к content-box — задаём свой явно. */
.kalka-root,
.kalka-root * {
  box-sizing: border-box;
}

.kalka-panel {
  display: flex;
  flex-direction: column;
  gap: var(--kalka-gap);
  min-width: 220px;
  max-width: calc(100vw - 32px);
  padding: 12px;
  background: var(--kalka-bg);
  border: 1px solid var(--kalka-border);
  border-radius: var(--kalka-radius);
  box-shadow: var(--kalka-shadow);
}

.kalka-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--kalka-muted);
}

.kalka-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--kalka-gap);
}

.kalka-note {
  margin: 0;
  font-size: 13px;
  color: var(--kalka-muted);
}

.kalka-button {
  padding: 8px 14px;
  font: inherit;
  color: var(--kalka-fg);
  background: var(--kalka-bg);
  border: 1px solid var(--kalka-border);
  border-radius: var(--kalka-radius);
  cursor: pointer;
}

.kalka-button:hover {
  border-color: var(--kalka-accent);
}

.kalka-button--primary {
  color: #ffffff;
  background: var(--kalka-accent);
  border-color: var(--kalka-accent);
  box-shadow: var(--kalka-shadow);
}

.kalka-button--selected {
  border-color: var(--kalka-accent);
  box-shadow: inset 0 0 0 1px var(--kalka-accent);
}
```

3. Создать `src/shared/ui/Button.tsx`:

```tsx
import type { ComponentChildren, JSX } from 'preact'

export interface ButtonProps {
  children: ComponentChildren
  onClick: () => void
  /** Главная кнопка режима: свёрнутая «Калька». */
  primary?: boolean
  /** Выбранный инструмент палитры (используется с фазы 3). */
  selected?: boolean
  /** Подпись для программ чтения с экрана, если текста кнопки мало. */
  label?: string
}

export function Button({ children, onClick, primary, selected, label }: ButtonProps): JSX.Element {
  const className = [
    'kalka-button',
    primary ? 'kalka-button--primary' : '',
    selected ? 'kalka-button--selected' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button type="button" class={className} aria-label={label} onClick={onClick}>
      {children}
    </button>
  )
}
```

4. Иконок в этапе 1 нет: кнопки текстовые. Инлайновый SVG появится позже и **без
   атрибута `xmlns`** — Preact ставит пространство имён сам, а лишний атрибут только
   расходует бюджет бандла (фаза 1, задача 4). Записать это комментарием
   в `src/shared/ui/Button.tsx`, чтобы следующая правка не наступила на грабли.
5. Все размеры — в `px` и `rem`-независимые: `all: initial` уже отвязал нас от
   `font-size` носителя, но `em` внутри панели снова свяжет части интерфейса между собой.

### Требуемые интерфейсы и контракты

- Один host-элемент, один `<style>`/`adoptedStyleSheets`, один набор классов
  с префиксом `kalka-`. Классы внутри shadow root наружу не видны, префикс нужен для
  читаемости кода, а не для изоляции.
- Разделение обязанностей в `host.css` строгое: `:host` держит **только** `all: initial`
  и переменные `--kalka-*`; всё, что наследуется (шрифт, размер, межстрочный интервал,
  цвет, `box-sizing`), задаётся на `.kalka-root`. Добавлять наследуемые свойства
  в `:host` бесполезно — их перебьёт инлайновый сброс host-элемента.
- Переменные — только `--kalka-*`. Использование `--spacing`, `--color` и подобных
  общих имён запрещено: `all: initial` их не сбрасывает, и значение носителя протечёт.
- `Button` — единственный компонент `shared/ui` в этапе 1. Он не знает ни о режимах,
  ни об инструментах: только вид и обработчик.
- `class`, а не `className`: Preact принимает оба, в проекте используется `class`.

### Обработка ошибок и логирование

Компонент представления, границ с чужим кодом не имеет — логирования нет.
Обработчик `onClick` приходит сверху уже обёрнутым там, где это нужно.

### Тесты

Файл `src/shared/ui/Button.test.tsx`,
запуск: `npx vitest run src/shared/ui/Button.test.tsx`.

1. `render(<Button onClick={fn}>Текст</Button>, container)` → в контейнере
   `<button type="button" class="kalka-button">Текст</button>`.
2. `primary` добавляет класс `kalka-button--primary`, `selected` — `kalka-button--selected`.
3. Клик по кнопке (`container.querySelector('button').click()`) вызывает `onClick` один раз.
4. `label` попадает в `aria-label`.

Оснастка: `import { render } from 'preact'`; контейнер — `document.createElement('div')`,
добавленный в `document.body`; после теста `render(null, container)` и `container.remove()`.
Отдельная библиотека для тестирования компонентов не подключается: это лишняя
зависимость ради `render` в три строки.

### Критерии приёмки

- Четыре теста проходят.
- В `host.css` есть `:host { all: initial }`, а типографика и `box-sizing` заданы
  на `.kalka-root`, а не на `:host`.
- Все CSS-переменные начинаются с `--kalka-`.
- В `src/**` нет ни одного `xmlns`.

### Проверка

- `npx vitest run src/shared/ui/Button.test.tsx`
  Ожидаемо: 4 passed.
- `grep -rn "xmlns" src`
  Ожидаемо: пусто.
- `grep -n -- "--[a-z]" src/app/ui/host.css`
  Ожидаемо: все найденные переменные начинаются с `--kalka-`.
- `grep -n -A20 "^:host {" src/app/ui/host.css`
  Ожидаемо: внутри блока `:host` только `all: initial` и переменные `--kalka-*`;
  ни `font-family`, ни `font-size`, ни `color`, ни `box-sizing`.

## Task 10: Режим Просмотр: свёрнутая кнопка

### Назначение

FR-02 требует режим Просмотр, в котором виджет свёрнут в кнопку. Это первое, что
видит рецензент, и единственное, что виджет показывает по умолчанию: страница
прототипа должна оставаться страницей прототипа.

### Шаги реализации

1. Создать `src/pages/view-mode/ui/ViewMode.tsx`:

```tsx
import type { JSX } from 'preact'
import { Button } from 'shared/ui/Button'

export interface ViewModeProps {
  /** Переход в режим правки. */
  onOpen: () => void
}

export function ViewMode({ onOpen }: ViewModeProps): JSX.Element {
  return (
    <Button primary onClick={onOpen}>
      Калька
    </Button>
  )
}
```

2. Создать `src/pages/view-mode/index.ts`:

```ts
export { ViewMode } from './ui/ViewMode'
export type { ViewModeProps } from './ui/ViewMode'
```

3. `export *` не использовать: барели расходуют бюджет бандла (`rules/base.md`).
4. Текст кнопки — ровно «Калька». Никаких «Edit», «Feedback» и технических слов (FR-36).

### Требуемые интерфейсы и контракты

- Публичный API слайса — `ViewMode` и `ViewModeProps`, ничего больше.
- Слайс не знает о других режимах и не хранит состояние: решение о переходе принимает
  `app/ui/Root.tsx`.
- Счётчика правок и состояния «не экспортировано» (FR-25) здесь нет — это этап 4.

### Обработка ошибок и логирование

Логирования нет: компонент представления. Переход между режимами логирует `Root`
(задача 11 и фаза 3).

### Тесты

Файл `src/pages/view-mode/ui/ViewMode.test.tsx`,
запуск: `npx vitest run src/pages/view-mode`.

1. Отрисовка даёт единственную кнопку с текстом «Калька» и классом `kalka-button--primary`.
2. Нажатие вызывает `onOpen` один раз.

### Критерии приёмки

- Два теста проходят.
- Слайс импортирует только из `shared` (проверяется линтером).
- В `index.ts` нет `export *`.

### Проверка

- `npx vitest run src/pages/view-mode`
  Ожидаемо: 2 passed.
- `npm run lint`
  Ожидаемо: без ошибок.

## Task 11: Монтирование в Shadow DOM и полный демонтаж

### Назначение

FR-04 и NFR-06 целиком: интерфейс живёт в изолированном поддереве, на странице
появляется ровно один элемент, клики внутри интерфейса не всплывают в обработчики
носителя, а демонтаж возвращает страницу в исходное состояние.

### Шаги реализации

1. Создать `src/app/ui/Root.tsx`:

```tsx
import type { JSX } from 'preact'
import { ViewMode } from 'pages/view-mode'
import { createLogger } from 'shared/lib/log'

const log = createLogger('root')

export function Root(): JSX.Element {
  // Состояние режима и переходы появляются в фазе 3 (задача 16).
  // Здесь — единственный режим, который уже реализован.
  return <ViewMode onOpen={() => log.debug('запрошен переход в режим правки')} />
}
```

2. Создать `src/app/lib/mount.ts`:

```ts
import { render } from 'preact'
import type { VNode } from 'preact'
import { ROOT_ATTRIBUTE, TOP_LAYER_Z_INDEX } from 'shared/config/constants'
import { createLogger } from 'shared/lib/log'
import { safely } from 'shared/lib/safe'
import styles from '../ui/host.css?inline'

const log = createLogger('mount')

/**
 * Стили в shadow root.
 *
 * Основной путь — adoptedStyleSheets: браузер парсит таблицу один раз, и она
 * не участвует в дереве. Запасной путь — элемент <style>: конструируемые таблицы
 * есть не везде (в частности, их нет в jsdom, на котором идут наши тесты),
 * а падать из-за стилей виджет не имеет права.
 */
function applyStyles(shadow: ShadowRoot, css: string): void {
  const supported =
    typeof CSSStyleSheet === 'function' &&
    'replaceSync' in CSSStyleSheet.prototype &&
    'adoptedStyleSheets' in shadow

  if (supported) {
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(css)
      shadow.adoptedStyleSheets = [sheet]
      log.debug('стили через adoptedStyleSheets')
      return
    } catch (error) {
      log.warn('adoptedStyleSheets не сработали, запасной путь', { ошибка: error })
    }
  }

  const style = document.createElement('style')
  style.textContent = css
  shadow.appendChild(style)
  log.debug('стили через элемент style')
}

/**
 * Создаёт host-элемент, изолирует интерфейс и монтирует его.
 * Возвращает полный демонтаж.
 */
export function mountKalka(view: VNode): () => void {
  const host = document.createElement('div')
  host.setAttribute(ROOT_ATTRIBUTE, '')
  const mountPoint = document.createElement('div')
  mountPoint.className = 'kalka-root'
  const BOUNDARY_EVENTS = ['pointerdown', 'mousedown', 'click'] as const
  const stop = safely(log, 'событие интерфейса', (event: Event) => event.stopPropagation())
  let listenersAttached = false
  let renderStarted = false
  let disposed = false

  // Внешнее author-правило с !important сильнее обычного inline-стиля. Поэтому
  // критические свойства получают тот же приоритет: inline !important выигрывает
  // у общих правил носителя и не даёт им сдвинуть или спрятать интерфейс.
  const hostStyles = [
    ['all', 'initial'],
    ['display', 'block'],
    ['position', 'fixed'],
    ['right', '16px'],
    ['bottom', '16px'],
    ['z-index', String(TOP_LAYER_Z_INDEX)],
  ] as const
  for (const [property, value] of hostStyles) {
    host.style.setProperty(property, value, 'important')
  }

  function teardown(): void {
    if (disposed) return
    disposed = true

    if (listenersAttached) {
      for (const type of BOUNDARY_EVENTS) mountPoint.removeEventListener(type, stop)
    }

    if (renderStarted) {
      try {
        render(null, mountPoint)
      } catch (error) {
        // Демонтаж остаётся безопасной границей: host всё равно удаляется.
        log.error('не удалось размонтировать дерево Preact', { ошибка: error })
      }
    }

    host.remove()
  }

  try {
    document.body.appendChild(host)

    const shadow = host.attachShadow({ mode: 'open' })
    applyStyles(shadow, styles)

    // Класс обязателен: базовая типографика и box-sizing живут на .kalka-root,
    // а не на :host — инлайновый all: initial на host перебивает правила :host
    // (см. комментарий в app/ui/host.css).
    shadow.appendChild(mountPoint)

    // События интерфейса не должны срабатывать на обработчиках носителя: они
    // композитные и всплывают до document. Одного click мало — страницы закрывают
    // меню, модальные окна и поповеры по «нажатию снаружи», а его ловят на
    // pointerdown или mousedown, то есть раньше, чем случится click.
    // stopPropagation — да, preventDefault — нет: он сломает фокус и ввод с клавиатуры.
    for (const type of BOUNDARY_EVENTS) mountPoint.addEventListener(type, stop)
    listenersAttached = true

    renderStarted = true
    render(view, mountPoint)
    log.info('виджет смонтирован')
  } catch (error) {
    // Монтирование транзакционно: частичный host не остаётся в чужом DOM.
    teardown()
    throw error
  }

  return (): void => {
    teardown()
    log.info('виджет размонтирован')
  }
}
```

3. `mount.ts` принимает готовый `VNode`, а не импортирует `Root`: так файл остаётся
   `.ts` (без JSX), как записано в `ARCHITECTURE.md`, и не тянет за собой слой `ui`.
4. host вешается **прямо на `document.body`**: контекст наложения, созданный носителем
   на промежуточном контейнере (`transform`, `filter`, `opacity < 1`, `will-change`),
   запер бы виджет внутри себя, и никакой `z-index` не помог бы.

### Требуемые интерфейсы и контракты

- Публичный экспорт — `mountKalka(view: VNode): () => void`.
- Ровно один элемент в `document.body`, с атрибутом `data-kalka-root`; критические
  inline-свойства `all`, `display`, `position`, `right`, `bottom`, `z-index` имеют
  приоритет `important`, чтобы author-правила носителя с `!important` их не перебили.
- Точка монтирования внутри shadow root несёт класс `kalka-root`: без него весь
  типографический сброс из `host.css` не применяется.
- `mountKalka` не знает о `window`: глобальное свойство `window.__kalka` заводит
  и убирает только `app/index.ts` (задача 12). Возвращаемая функция отвечает
  строго за DOM — слушатель, дерево Preact и host-элемент.
- `attachShadow({ mode: 'open' })` — не `closed`: закрытый режим не даёт безопасности,
  зато ломает отладку и наш собственный обход DOM.
- Наружу не выпускаются три события: `pointerdown`, `mousedown`, `click`. Только `click`
  недостаточно — «нажатие снаружи», по которому носитель закрывает своё меню или
  модальное окно, ловится обычно на первых двух, и виджет схлопывал бы чужой интерфейс
  раньше, чем реагировал сам (NFR-06). Подписка и отписка идут по одному списку
  `BOUNDARY_EVENTS`: расхождение между ними оставило бы слушателя на удалённом узле.
- Демонтаж обязан снять слушатель, размонтировать Preact и удалить host. Проверка
  «на странице не осталось следов» — часть критериев приёмки, а не пожелание.
- Монтирование транзакционно: исключение после `appendChild` запускает тот же cleanup,
  удаляет частичный host и затем повторно бросает исходную ошибку загрузчику.
- Расширение демонтажа (снятие слоя правок, возврат `history`, отключение наблюдателей)
  — этапы 2 и далее; сигнатура для этого уже готова.

### Обработка ошибок и логирование

- `info` на монтирование и демонтаж, `debug` на выбранный путь применения стилей,
  `warn` на отказ `adoptedStyleSheets`.
- Обработчик событий границы обёрнут `safely`: это граница, откуда исключение ушло бы
  в обработчики носителя.
- `mountKalka` ловит ошибку только ради отката уже выполненных DOM-операций и затем
  повторно бросает исходную ошибку. Решение о том, что ошибка не уходит в носитель,
  по-прежнему принимает `app/index.ts` (задача 12).
- Ошибка `render(null, mountPoint)` логируется, но не мешает удалить host: отказ
  Preact при очистке не должен оставить узел в документе или всплыть в код носителя.

### Тесты

Файл `src/app/lib/mount.test.ts`,
запуск: `npx vitest run src/app/lib/mount.test.ts`.

1. `mountKalka(h(Root, {}))` добавляет в `document.body` ровно один элемент
   с атрибутом `data-kalka-root`; у него есть `shadowRoot` с `mode === 'open'`.
2. Инлайновый стиль host содержит `all: initial`, `position: fixed`
   и `z-index: 2147483647`; `getPropertyPriority()` возвращает `'important'` для
   `all`, `display`, `position`, `right`, `bottom` и `z-index`.
3. Стили применены: в jsdom конструируемых таблиц нет, поэтому внутри shadow root
   присутствует `<style>` с текстом, содержащим `all: initial`.
   (Тест проверяет наличие стилей любым из двух путей: `shadow.adoptedStyleSheets.length > 0`
   **или** непустой `<style>`. Так он не сломается, когда jsdom научится
   конструируемым таблицам.)
   Тест опирается на `test.css: true` в `vite.config.ts` (фаза 1, задача 2): при
   умолчании Vitest подменяет `host.css?inline` пустой строкой, и проверка проходит
   вхолостую на пустом `<style>`. Если тест внезапно упал на пустом тексте — искать
   потерянный `css: true`, а не ослаблять условие.
4. Точка монтирования внутри shadow root имеет класс `kalka-root`, и текст стилей
   содержит правило `.kalka-root`: без этой пары типографический сброс не действует,
   а в jsdom вычисленные стили это не покажут.
5. Внутри shadow root отрисована кнопка с текстом «Калька».
6. Ни `pointerdown`, ни `mousedown`, ни `click`, начатые на кнопке внутри интерфейса,
   не доходят до слушателей на `document` (три отдельных `vi.fn()`, ожидание — ноль
   вызовов у каждого); при этом те же три события на обычном элементе страницы
   до слушателей доходят. Проверять надо именно все три: тест только на `click`
   пропустил бы самый частый способ закрыть чужое меню.
7. Демонтаж: после вызова возвращённой функции в `document.body` нет элементов
   с `data-kalka-root`, а `document.body.children.length` вернулся к исходному значению.
8. Транзакционный откат: подменить `Element.prototype.attachShadow` так, чтобы первый
   вызов бросил `Error('не удалось создать shadow root')`; `mountKalka` повторно бросает
   ту же ошибку, но число детей `document.body` равно исходному и элементов
   с `data-kalka-root` нет.

Отдельного теста на исключение в обработчике клика нет: подменить обработчик снаружи
нельзя, а поведение `safely` уже проверено в задаче 7. Пункта 6 достаточно.

Оснастка: `import { h } from 'preact'`, `import { Root } from 'app/ui/Root'`;
`document.body.innerHTML = ''` в `beforeEach`.

### Критерии приёмки

- Восемь тестов проходят.
- На странице после монтирования — ровно один новый элемент.
- После демонтажа страница не отличается от исходной.
- После неудачного частичного монтирования страница также не отличается от исходной.
- В коде нет `mode: 'closed'`.
- `mountKalka` не обращается к `window.__kalka`.

### Проверка

- `npx vitest run src/app/lib/mount.test.ts`
  Ожидаемо: 8 passed.
- `grep -n "__kalka" src/app/lib/mount.ts`
  Ожидаемо: пусто.

## Task 12: Загрузка виджета

### Назначение

Собрать guard, монтирование и защиту от повторного подключения в единственную точку
входа бандла. Это та граница, где ошибка виджета либо остаётся его ошибкой,
либо ломает сайт носителя.

### Шаги реализации

1. Заменить `src/app/index.ts`:

```ts
import { h } from 'preact'
import { shouldActivate } from 'app/config/activation'
import { mountKalka } from 'app/lib/mount'
import { Root } from 'app/ui/Root'
import { onDocumentReady } from 'shared/lib/dom'
import { createLogger } from 'shared/lib/log'

const log = createLogger('boot')

function start(): void {
  const unmount = mountKalka(h(Root, {}))

  // Демонтаж снимает и глобальное свойство: иначе страница после unmount()
  // отличается от исходной, а повторный подъём виджета навсегда заблокирован
  // проверкой двойного подключения.
  const api: NonNullable<Window['__kalka']> = {
    version: __VERSION__,
    unmount: () => {
      unmount()
      // Старая сохранённая ссылка не имеет права удалить более новый экземпляр.
      if (window.__kalka === api) delete window.__kalka
    },
  }
  window.__kalka = api
}

function boot(): void {
  if (window.__kalka) {
    log.warn('скрипт подключён дважды, вторая загрузка пропущена')
    return
  }

  if (!shouldActivate()) {
    log.debug('виджет не включён — ничего не делаем')
    return
  }

  let cancelReady = (): void => {}
  const reservation: NonNullable<Window['__kalka']> = {
    version: __VERSION__,
    unmount: () => {
      cancelReady()
      if (window.__kalka === reservation) delete window.__kalka
    },
  }

  // Признак занятости ставится ЗДЕСЬ, синхронно, а не после монтирования.
  // Временный unmount не пустой: до DOMContentLoaded он отменяет отложенный запуск.
  window.__kalka = reservation

  try {
    cancelReady = onDocumentReady(() => {
      // Отменённая или заменённая reservation не имеет права монтировать виджет.
      if (window.__kalka !== reservation) return

      try {
        start()
      } catch (error) {
        // Неудачная загрузка не должна блокировать следующую, исправную.
        if (window.__kalka === reservation) delete window.__kalka
        // Сайт-носитель продолжает работать (NFR-06). Наружу — ничего (NFR-03).
        log.error('не удалось поднять виджет', { ошибка: error })
      }
    })
  } catch (error) {
    // Ошибка самой постановки ожидания тоже снимает только нашу reservation.
    if (window.__kalka === reservation) delete window.__kalka
    throw error
  }
}

try {
  boot()
} catch (error) {
  log.error('сбой при загрузке', { ошибка: error })
}
```

2. Жизненный цикл `window.__kalka` — три момента, и все три обязательны:
   - **заводится синхронно** в `boot()`, сразу после решения активироваться,
     с временным отменяющим `unmount`. Только так признак успевает встать
     до того, как второй тег `<script>` выполнит свою проверку: оба скрипта в `<head>`
     отрабатывают раньше `DOMContentLoaded`; вызов временного `unmount()` снимает
     обработчик готовности и удаляет только собственную reservation;
   - **заменяется настоящим** в `start()`, когда виджет действительно смонтирован;
   - **удаляется** при неудачном монтировании, при ошибке постановки ожидания и внутри
     собственного `unmount()`. И reservation, и готовый API проверяют владение через
     сравнение по ссылке, поэтому старая сохранённая функция не удалит новый экземпляр.
   Требование «неудачная первая загрузка не блокирует вторую, исправную» выполняется
   не откладыванием признака, а его снятием в ветке ошибки.
3. Внешний `try/catch` вокруг `boot()` нужен потому, что сам `boot` вызывает
   `shouldActivate` и `onDocumentReady` — они не должны уронить исполнение скрипта
   носителя даже теоретически.
4. Ничего, кроме `window.__kalka`, в глобальную область не пишется — включая саму
   обёртку IIFE. `build.lib.name` (`Kalka`) требуется валидацией конфига Vite для
   форматов `iife` и `umd`, но глобальную переменную создаёт не он, а Rollup — и только
   когда точке входа есть что экспортировать. `src/app/index.ts` не экспортирует ничего,
   поэтому артефакт начинается прямо с `(function(){"use strict";`, и `window.Kalka`
   не появляется вовсе. Проверено сборкой на `vite@7.3.6` с этим самым конфигом.
   Отсутствие публичного API у виджета — намеренное решение, а не побочный эффект:
   единственная точка управления — `window.__kalka`.

### Требуемые интерфейсы и контракты

- `window.__kalka` — объект `{ version: string; unmount: () => void }`, объявленный
  типом в `src/env.d.ts` (фаза 1). Обращения через `as any` в проекте запрещены.
- `app/index.ts` — **единственный** владелец `window.__kalka`: только он его заводит,
  подменяет и удаляет. `app/lib/mount.ts` о глобальной области не знает вовсе.
- `unmount()` возвращает страницу в исходное состояние целиком: снимает слушатель,
  размонтирует Preact, удаляет host-элемент **и** стирает `window.__kalka`. После него
  повторный подъём виджета возможен.
- `unmount()` временной reservation до `DOMContentLoaded` отменяет отложенный callback,
  стирает `window.__kalka`, и последующий `DOMContentLoaded` ничего не монтирует.
- `__VERSION__` подставляется сборкой из `package.json`.
- Файл не экспортирует ничего наружу. Это не косметика, а условие того, что IIFE-обёртка
  не заводит глобальную переменную `Kalka`: появившийся экспорт молча нарушит Definition
  of Done («виджет не пишет в `window`»).
- Порядок решений строгий: двойное подключение → активация → признак занятости →
  готовность документа → монтирование. Перестановка первых двух проверок дала бы запись
  предупреждения на каждой странице, где виджет выключен; перенос признака занятости
  за готовность документа вернул бы два виджета на одну страницу.

### Обработка ошибок и логирование

- `warn` — двойное подключение (реальный сценарий: скрипт в шаблоне плюс скрипт,
  вставленный сборщиком).
- `debug` — виджет выключен: самая частая ветка, в `info` она была бы шумом.
- `error` — сбой монтирования и сбой загрузки, с объектом ошибки.
- Ни одна ветка не бросает наружу. Ни одна не обращается к сети.

### Тесты

Файл `src/app/index.test.ts`,
запуск: `npx vitest run src/app/index.test.ts`.

Модуль выполняет работу как побочный эффект импорта, поэтому каждый случай
импортирует его заново: `vi.resetModules()` в `beforeEach`, затем
`await import('app/index')`.

1. Без параметра и без флага: после импорта в `document.body` нет элементов
   с `data-kalka-root`, `window.__kalka` не определён.
2. С `?kalka`: задать адрес окном jsdom (`window.history.replaceState({}, '', '/?kalka')`) —
   после импорта элемент с `data-kalka-root` существует, `window.__kalka.version` —
   непустая строка, а `window.__kalka.unmount` — не пустая заглушка из `boot()`.
3. Повторный импорт при уже установленном `window.__kalka` не добавляет второго
   host-элемента.
4. **Двойное подключение до готовности документа.** `readyState = 'loading'`;
   модуль исполняется дважды подряд (`vi.resetModules()` между импортами,
   `window.__kalka` между ними **не** сбрасывается — это имитация двух тегов
   `<script>` в `<head>`), затем `document.dispatchEvent(new Event('DOMContentLoaded'))`.
   Ожидание: ровно один элемент с `data-kalka-root` и одна запись `warn`
   о повторном подключении. Именно этот случай ловит преждевременный признак
   занятости; тест 3 его пропускает.
5. `window.__kalka.unmount()` удаляет host-элемент **и** делает `window.__kalka`
   неопределённым: `expect(window.__kalka).toBeUndefined()`.
6. После `unmount()` повторное исполнение модуля снова поднимает виджет —
   демонтаж не оставляет блокировки.
7. Документ ещё грузится (`readyState = 'loading'`): сразу после импорта элемента нет,
   после `document.dispatchEvent(new Event('DOMContentLoaded'))` — появился.
8. Документ ещё грузится: после импорта вызвать временный `window.__kalka.unmount()`,
   затем отправить `DOMContentLoaded`. Ожидание: `window.__kalka` не определён,
   host-элемента нет — отложенный callback действительно отменён.
9. Документ ещё грузится, а первый `document.addEventListener` для `DOMContentLoaded`
   бросает исключение. Импорт модуля не бросает наружу, `window.__kalka` не определён,
   host-элемента нет — ошибка постановки ожидания не оставляет блокировку.

Оснастка: `beforeEach` очищает `document.body`, `localStorage`, `delete window.__kalka`
и возвращает адрес на `/` через `window.history.replaceState({}, '', '/')`.
Адрес с параметром задаётся тем же способом: `window.history.replaceState({}, '', '/?kalka')`.
Перед каждым тестом сохранить `Object.getOwnPropertyDescriptor(document, 'readyState')`,
а в `afterEach` восстановить его через `Object.defineProperty` или удалить созданное
own-свойство через `Reflect.deleteProperty`, если исходного descriptor не было. Это
обязательно: прямой `Object.defineProperty(..., { value: 'loading' })` иначе протекает
из теста 4 в тесты 5–9. `afterEach` импортируется явно из `vitest` вместе с остальными
функциями; `restoreMocks: true` own-свойство документа не восстанавливает.
Подменять `window.location` через `vi.spyOn` не нужно и не стоит — в jsdom оно
неконфигурируемо и попытка бросит исключение.

### Критерии приёмки

- Девять тестов проходят.
- Без явного включения виджет не создаёт на странице ни одного элемента и не пишет
  в `window` — ни `__kalka`, ни `Kalka`. Единственное, что виджет когда-либо кладёт
  в глобальную область, — `window.__kalka` после успешной активации; на собранном
  бандле это проверяется на дев-стенде (задача 17).
- Два подключения скрипта до готовности документа дают один виджет.
- Отмена до готовности документа не даёт виджету смонтироваться позже.
- Ошибка постановки ожидания готовности не оставляет `window.__kalka`.
- `window.__kalka.unmount()` возвращает страницу в исходное состояние, включая
  глобальную область.
- `npm run build` проходит, и проверка бандла не находит ни `console`, ни внешних адресов.

### Проверка

- `npx vitest run src/app/index.test.ts`
  Ожидаемо: 9 passed.
- `npm test`
  Ожидаемо: все тесты фаз 1–2 проходят.
- `npm run build`
  Ожидаемо: `✓ бандл соответствует ограничениям`, размер существенно ниже 100 КБ gzip.

## Риски фазы и меры

- **Риск:** jsdom не поддерживает конструируемые таблицы стилей, и тест монтирования
  падает на `new CSSStyleSheet()`.
  **Мера:** это учтено в реализации: `applyStyles` определяет поддержку и имеет
  запасной путь через `<style>`. Тест проверяет факт наличия стилей, а не способ.
- **Риск:** тесты `app/index.test.ts` протекают друг в друга из-за побочного эффекта
  импорта или оставленного own-свойства `document.readyState`.
  **Мера:** `vi.resetModules()`, полная очистка окружения в `beforeEach` и восстановление
  исходного descriptor `readyState` в `afterEach` — это записано в оснастке задачи 12.
- **Риск:** ошибка после добавления host оставляет частичный узел в документе, а
  повторная загрузка накапливает следы.
  **Мера:** `mountKalka` выполняет единый транзакционный `teardown()` и повторно бросает
  исходную ошибку; тест 8 задачи 11 проверяет откат после отказа `attachShadow`.
- **Риск:** общие `!important`-правила носителя перебивают позиционирование host.
  **Мера:** критические inline-свойства получают `important`; задача 17 проверяет их
  на усиленной странице `dev/hostile-css.html`.
- **Риск:** носитель создал контекст наложения на предке, и виджет оказался под
  содержимым страницы.
  **Мера:** host висит прямо на `document.body`. Проверяется на дев-странице
  с `transform` на предке в фазе 4.
- **Риск:** нажатие на интерфейс закрывает модальное окно или меню носителя.
  **Мера:** `stopPropagation` на корне интерфейса для `pointerdown`, `mousedown`
  и `click` — «нажатие снаружи» страницы ловят обычно на первых двух, а не на третьем;
  тест 6 задачи 11 проверяет все три. `preventDefault` намеренно не ставится.
- **Риск:** два тега `<script>` в `<head>` поднимают два виджета, потому что признак
  занятости ставится позже их выполнения.
  **Мера:** признак ставится синхронно в `boot()` и снимается в ветке ошибки
  (задача 12, шаг 2); тест 4 задачи 12 воспроизводит именно этот порядок событий.
- **Риск:** `unmount()` оставляет `window.__kalka`, и страница после демонтажа
  отличается от исходной, виджет больше не поднимается или всё же монтируется после
  отмены до `DOMContentLoaded`.
  **Мера:** и временный, и готовый API стирают только собственное свойство; временный
  API дополнительно отменяет callback готовности. Тесты 5, 6 и 8 задачи 12 проверяют
  отсутствие свойства, повторный подъём и раннюю отмену.
- **Риск:** типографический сброс задан на `:host` и молча не применяется,
  потому что инлайновый `all: initial` на host-элементе его перебивает.
  **Мера:** типографика вынесена на `.kalka-root` внутри теневого корня
  (задачи 9 и 11). Дев-стенд этот дефект не ловит — контрольная и агрессивная
  страницы выглядят одинаково неверно, — поэтому проверка механическая:
  `grep` по блоку `:host` в критериях приёмки задачи 9 и тест 4 задачи 11.
- **Риск:** запись флага активации в `localStorage` носителя воспринимается как
  вмешательство в сайт.
  **Мера:** префикс `kalka:` и единственный ключ `kalka:enabled`; `?kalka=0` стирает
  его. Это документируется в README (фаза 4).

## Чек-лист завершения фазы

- Каждая задача 6–12 удовлетворяет своим критериям приёмки.
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` проходят.
- Виджет не поднимается без явного включения.
- Демонтаж не оставляет следов ни в DOM, ни в `window`.
- Неудачное частичное монтирование также не оставляет host в DOM.
- `unmount()` до `DOMContentLoaded` отменяет отложенное монтирование.
- Два подключения скрипта до готовности документа дают один виджет.
- В `host.css` блок `:host` содержит только `all: initial` и переменные `--kalka-*`.
- Чекбоксы задач 6–12 отмечены в `index.md` сразу после проверки.
