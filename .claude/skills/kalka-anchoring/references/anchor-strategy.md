# Трёхуровневая стратегия якорей

Полные алгоритмы. Обзор — в [../SKILL.md](../SKILL.md).

## Общий контракт

```ts
type AnchorMethod = 'selector' | 'xpath' | 'snippet'

interface Resolution {
  element: Element
  method: AnchorMethod
  exact: boolean      // false для snippet — результат считается догадкой
}

type ResolveResult = Resolution | { status: 'lost' }
```

Порядок фиксирован: уровень считается успешным только если элемент найден **и**
прошёл проверку `was` (см. [drift-detection.md](drift-detection.md)).

```ts
function resolve(anchor: Anchor, was: string, root: Document = document): ResolveResult {
  const bySelector = trySelector(anchor.selector, root)
  if (bySelector && matchesWas(bySelector, was)) {
    return { element: bySelector, method: 'selector', exact: true }
  }

  const byXPath = tryXPath(anchor.xpath, root)
  if (byXPath && matchesWas(byXPath, was)) {
    return { element: byXPath, method: 'xpath', exact: true }
  }

  const bySnippet = trySnippet(anchor.snippet, anchor.index, root)
  if (bySnippet) {
    return { element: bySnippet, method: 'snippet', exact: false }
  }

  return { status: 'lost' }
}
```

Обратите внимание: третий уровень **не** сверяется с `was`. Он ищет именно по тексту,
и требовать совпадения текста было бы тавтологией. Именно поэтому его результат
помечается `exact: false`.

## Уровень 1: построение CSS-селектора

Строится один раз при создании правки. Идём снизу вверх, останавливаемся на первом
варианте, дающем ровно одно совпадение по документу.

```ts
function buildSelector(el: Element): string {
  const parts: string[] = []
  let node: Element | null = el

  while (node && node !== document.documentElement) {
    parts.unshift(describeNode(node))
    const candidate = parts.join(' > ')
    if (document.querySelectorAll(candidate).length === 1) return candidate
    node = node.parentElement
  }

  return parts.join(' > ')
}
```

### describeNode: чем описываем один узел

Приоритет по убыванию устойчивости:

1. **Стабильный `id`** — `#main-nav`. Только если проходит `isStableToken`.
2. **`data-*`-атрибут** — `[data-testid="hero"]`. Пишется человеком, переживает пересборку.
3. **Тег + стабильный класс** — `section.hero`.
4. **Тег + `:nth-of-type`** — `li:nth-of-type(3)`. Последнее средство.

```ts
function describeNode(el: Element): string {
  const tag = el.tagName.toLowerCase()

  if (el.id && isStableToken(el.id)) return `#${CSS.escape(el.id)}`

  for (const attr of ['data-testid', 'data-test', 'data-id', 'data-section']) {
    const v = el.getAttribute(attr)
    if (v) return `${tag}[${attr}="${CSS.escape(v)}"]`
  }

  const cls = Array.from(el.classList).filter(isStableToken)
  if (cls.length) return `${tag}.${cls.map((c) => CSS.escape(c)).join('.')}`

  return `${tag}:nth-of-type(${indexAmongType(el)})`
}
```

`CSS.escape` обязателен: идентификаторы на чужой странице могут содержать что угодно.

### isStableToken: отсев сгенерированных имён

Главная причина мёртвых селекторов — классы от сборщика. Они меняются при каждой
пересборке.

```ts
const GENERATED = [
  /^css-[a-z0-9]{5,}$/i,        // emotion / styled-components
  /^_[A-Za-z0-9]+_[a-z0-9]{4,}$/, // CSS Modules
  /^sc-[A-Za-z0-9]{5,}$/,        // styled-components
  /^svelte-[a-z0-9]{5,}$/,
  /^jsx-\d+$/,                   // styled-jsx
  /^[a-f0-9]{8,}$/i,             // голый хеш
  /^v-[a-f0-9]{8}$/,             // Vue scoped
]

function isStableToken(t: string): boolean {
  if (!t || t.length > 60) return false
  if (/^\d/.test(t)) return false            // невалидно как CSS-идентификатор без экранирования
  if (/\d{6,}/.test(t)) return false          // длинные числовые серии — обычно генерация
  return !GENERATED.some((re) => re.test(t))
}
```

Список открытый: встретили новый шаблон генерации — дописали.

> [!warning] Утилитарные классы фильтр проходят — и это правильно, но опасно
> `isStableToken` отсеивает имена, **сгенерированные сборщиком**. Классы
> Tailwind (`mt-3`, `text-fg-muted`, `min-h-11`) написаны человеком, генерацией
> не выглядят и в селектор попадают.
>
> Отсеивать их нельзя: на Tailwind-проекте без них у большинства узлов не
> останется ничего, кроме `:nth-of-type`, и первый уровень станет хрупче,
> а не устойчивее.
>
> Но и рассчитывать на них как на устойчивые не следует. Спайк R1, сценарий
> передеплоя: переименование `mt-3 text-sm text-fg-muted` →
> `mt-4 text-sm leading-relaxed text-fg-muted` сломало селектор при живом
> элементе, и правку поднял **второй уровень**. Меняется оформление —
> ломается первый уровень; ровно для этого существуют второй и третий.

### indexAmongType

`:nth-of-type` считает среди **сиблингов того же тега**, а не среди всех сиблингов.
Это важно: `:nth-child` сломается, если рядом добавят элемент другого типа.

```ts
function indexAmongType(el: Element): number {
  const tag = el.tagName
  let i = 1
  let sib = el.previousElementSibling
  while (sib) {
    if (sib.tagName === tag) i++
    sib = sib.previousElementSibling
  }
  return i
}
```

## Уровень 2: XPath

### Построение

```ts
function buildXPath(el: Element): string {
  const parts: string[] = []
  let node: Element | null = el

  while (node && node.nodeType === Node.ELEMENT_NODE) {
    const tag = node.tagName.toLowerCase()   // строчными: HTML-документ
    parts.unshift(`${tag}[${indexAmongType(node)}]`)
    node = node.parentElement
  }

  return '/' + parts.join('/')
}
```

Путь строится явным, от корня. `//tag` сканирует всё дерево — по MDN это заметно медленнее
и вдобавок менее предсказуемо.

XPath-индексы **начинаются с 1**, не с 0. Совпадает с `:nth-of-type`, поэтому
`indexAmongType` переиспользуется без сдвига.

### Разрешение

```ts
function tryXPath(xpath: string, root: Document): Element | null {
  try {
    const r = root.evaluate(
      xpath,
      root,
      null,                                  // HTML-документ: resolver не нужен
      XPathResult.FIRST_ORDERED_NODE_TYPE,   // 9 → singleNodeValue
      null
    )
    const n = r.singleNodeValue
    return n && n.nodeType === Node.ELEMENT_NODE ? (n as Element) : null
  } catch {
    return null                              // невалидный XPath — просто следующий уровень
  }
}
```

**Почему именно `FIRST_ORDERED_NODE_TYPE`.** По MDN итераторные типы
(`UNORDERED_NODE_ITERATOR_TYPE` = 4, `ORDERED_NODE_ITERATOR_TYPE` = 5) **инвалидируются
при модификации документа** — следующий `iterateNext()` бросит исключение. Мы модифицируем
документ, накладывая правки, поэтому итераторы здесь непригодны. Если когда-нибудь
понадобится несколько результатов — брать снапшот-типы (6, 7), которые мутацию переживают
(но, по той же MDN, могут не отражать текущее состояние документа).

## Уровень 3: поиск по фрагменту текста

### Нормализация

Сравнивать сырой текст бессмысленно: вёрстка свободно меняет пробелы и переносы.

```ts
function normalize(s: string): string {
  return s
    .replace(/ /g, ' ')   // NBSP — в вёрстке встречается постоянно
    .replace(/\s+/g, ' ')
    .trim()
}
```

Одна и та же `normalize` применяется и при записи `snippet`, и при поиске, и при проверке
`was`. Разные нормализации в этих трёх местах — источник неуловимых расхождений.

> [!note] Невидимые символы форматирования
> Функция схлопывает пробелы и NBSP, но **не удаляет мягкий перенос** (U+00AD)
> и прочие невидимые символы. Такой символ не виден на экране, попадает в `was`
> из DOM и делает строку не равной исходнику в коде.
>
> В прототипе заказчика мягких переносов нет, поэтому спайк этого не показал. Если
> случай встретится на другом прототипе — правится **здесь, в самой `normalize`**,
> разом во всех трёх точках её применения. Локальная заплатка в одном месте —
> ровно тот сценарий, от которого предостерегает абзац выше.

### Обход

```ts
function trySnippet(snippet: string, index: number, root: Document): Element | null {
  const needle = normalize(snippet)
  if (!needle) return null

  const walker = root.createTreeWalker(root.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      const parent = (node as Text).parentElement
      if (!parent) return NodeFilter.FILTER_REJECT

      // Отсекаем собственный UI вместе со всем поддеревом.
      if (parent.closest(WIDGET_ROOT_SELECTOR)) return NodeFilter.FILTER_REJECT

      // Служебные элементы текста не содержат.
      if (parent.closest('script, style, noscript, template')) return NodeFilter.FILTER_REJECT

      return normalize(node.textContent ?? '')
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP
    },
  })

  const hits: Element[] = []
  while (walker.nextNode()) {
    const text = normalize(walker.currentNode.textContent ?? '')
    if (text.includes(needle)) {
      const parent = (walker.currentNode as Text).parentElement
      if (parent) hits.push(parent)
    }
  }

  return hits[index] ?? hits[0] ?? null
}
```

**`FILTER_REJECT` против `FILTER_SKIP`.** По MDN: `REJECT` исключает узел **и всё его
поддерево**, `SKIP` исключает только сам узел, но обход продолжается в детей. Для отсечения
интерфейса виджета нужен именно `REJECT` — иначе обход провалится внутрь собственного UI
и найдёт там текст правки, которую сам же и наложил. Для пустых текстовых узлов подходит
`SKIP`: сам узел не нужен, но у текстовых узлов детей и нет.

**Про `index`.** Если исходный `index` вышел за границы (совпадений стало меньше),
падаем на первое совпадение, а не возвращаем `null`. Показать разработчику вероятное
место лучше, чем не показать ничего, — правка всё равно помечена как неточная.

## Что писать при создании правки

```ts
function captureAnchor(el: Element): Anchor {
  const snippet = normalize(el.textContent ?? '').slice(0, 120)
  return {
    selector: buildSelector(el),
    xpath: buildXPath(el),
    snippet,
    index: countPrecedingMatches(el, snippet),
  }
}
```

`snippet` обрезается: он нужен для поиска, а не для хранения содержимого — полный текст
уже лежит в `was`. 120 символов достаточно для уникальности и не раздувает файл обмена.

`index` считается **в момент захвата**: сколько элементов до текущего уже содержат этот же
фрагмент. Без него две одинаковые кнопки «Подробнее» неразличимы.

## Shadow DOM носителя

`querySelector`, `document.evaluate` и `createTreeWalker` **не проходят сквозь границу
shadow root**. Если текст носителя лежит внутри его собственного Shadow DOM, все три
уровня его не увидят.

Для V1 это осознанное ограничение: PRD (раздел 11, допущения) исходит из того, что
прототипы отдают осмысленный HTML с текстом в обычном DOM. Если такой прототип встретится —
это не баг анкоринга, а выход за границы допущения, и его нужно фиксировать явно,
а не пытаться лечить эвристиками.
