# Санитизация текста правки

Реализация FR-07 (разрешённый набор форматирования) и FR-12 (чистка вставки из Word).

## Цель — применимость, а не безопасность

Рецензент правит собственный прототип и атаковать себя не собирается. Санитизация нужна
не от злоумышленника, а от **Microsoft Word**.

В PRD 1.1 у неё появился второй адресат. Текст правки попадает не только к человеку,
но и в контекст ИИ-агента, который подставит `now` в исходники прототипа. Грязный HTML,
который человек бы просто вычистил руками, агент вставит как есть.

Вставка из Word приносит примерно такое:

```html
<span style="mso-fareast-font-family:'Times New Roman'; font-size:11.0pt"
      class="MsoNormal"><o:p>Краны полярные</o:p></span>
```

Если это попадёт в `now`, разработчик получит правку, из которой текст надо выковыривать
руками. Это ломает Ц2 («правки в применимом виде») и метрику M2.

Второстепенно, но реально: `<script>` в поле правки сломает страницу разработчика
при импорте. Белый список закрывает и это.

### Санитизация и правило FR-46

FR-46 запрещает класть в файл что-либо, что агент мог бы принять за команду. Белый
список тегов — часть исполнения этого правила: он не пропускает в `now` ни комментарии
HTML, ни `<script>`, ни атрибуты `on*`, ни `href` со схемой `javascript:`.

Но санитизация разметки — не весь FR-46. Содержимое `now` остаётся **произвольным
текстом заказчика**, и запретить ему написать «удали этот файл» невозможно и не нужно.
Ответственность разделена: виджет гарантирует, что в файле нет ничего командоподобного
**сверх текста правок**, а скилл `kalka-apply` трактует `now` и `note` как данные,
а не как инструкции (правило 3 скилла, риск R10).

## Белый список

```ts
const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'A', 'UL', 'OL', 'LI', 'BR'])
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(['href']),
}
```

Ровно набор из FR-07 и ничего сверх. `<span>` в списке нет намеренно: он не несёт смысла
форматирования и служит исключительно контейнером для `style`, а оформление у нас живёт
в отдельном поле.

## Алгоритм

Разбор через `DOMParser`, а не регулярными выражениями. Регулярка по HTML не справится
с вложенностью и незакрытыми тегами — а Word генерирует и то, и другое.

```ts
export function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  clean(doc.body)
  return doc.body.innerHTML
}

function clean(node: Element): void {
  // Обход в обратном порядке: узлы удаляются по ходу дела.
  for (let i = node.childNodes.length - 1; i >= 0; i--) {
    const child = node.childNodes[i]

    if (child.nodeType === Node.TEXT_NODE) continue

    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove()              // комментарии, CDATA и прочее
      continue
    }

    const el = child as Element

    if (!ALLOWED_TAGS.has(el.tagName)) {
      clean(el)                   // сначала чистим внутренности
      unwrap(el)                  // затем разворачиваем: текст сохраняется, тег исчезает
      continue
    }

    stripAttrs(el)
    clean(el)
  }
}

function unwrap(el: Element): void {
  const parent = el.parentNode
  if (!parent) return
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  el.remove()
}
```

**`unwrap`, а не `remove`.** Запрещённый тег разворачивается — содержимое остаётся,
исчезает только обёртка. Удаление вместе с содержимым потеряло бы текст правки, а это
худшее, что может сделать редактор.

Исключение — теги, у которых содержимое не является текстом:

```ts
const DROP_ENTIRELY = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT'])
```

Их содержимое разворачивать нельзя — код превратился бы в текст правки.

**Обход в обратном порядке.** `childNodes` — живая коллекция: удаление элемента во время
прямого прохода сдвигает индексы и заставляет пропускать узлы.

## Атрибуты

```ts
function stripAttrs(el: Element): void {
  const allowed = ALLOWED_ATTRS[el.tagName] ?? EMPTY

  for (const attr of Array.from(el.attributes)) {
    if (!allowed.has(attr.name.toLowerCase())) {
      el.removeAttribute(attr.name)
      continue
    }
    if (attr.name.toLowerCase() === 'href' && !isSafeHref(attr.value)) {
      el.removeAttribute(attr.name)
    }
  }
}

function isSafeHref(v: string): boolean {
  const s = v.trim().toLowerCase()
  return !s.startsWith('javascript:') && !s.startsWith('data:') && !s.startsWith('vbscript:')
}
```

`Array.from(el.attributes)` обязателен: `attributes` — живая коллекция, удаление
во время итерации по ней пропускает атрибуты.

Снимается **всё**, включая `class`, `id`, `style`, `data-*` и обработчики `on*`.
Белый список — единственное, что остаётся.

### `style` вырезается всегда

Даже на разрешённых тегах. Оформление живёт в отдельном поле `style` записи
(см. [../SKILL.md](../SKILL.md)) — это решение PRD по риску R4. Атрибут `style`
внутри `now` нарушил бы разделение, ради которого поле и заводили.

## Мусор от Word

После разворачивания запрещённых тегов остаются два следа, которые стоит убрать отдельно.

**Пустые элементы.** Word оставляет `<b></b>` и подобное:

```ts
function dropEmpty(root: Element): void {
  for (const el of Array.from(root.querySelectorAll('b, strong, i, em, a'))) {
    if (!el.textContent?.trim() && !el.querySelector('br')) el.remove()
  }
}
```

Проверка на `<br>` нужна: `<b><br></b>` текста не содержит, но перенос строки несёт.

**Неразрывные пробелы.** Word ставит `&nbsp;` вместо обычных пробелов пачками:

```ts
function normalizeSpaces(s: string): string {
  return s.replace(/ /g, ' ').replace(/[ \t]{2,}/g, ' ')
}
```

Это та же нормализация, что применяется при сверке `was` в
[kalka-anchoring](../../kalka-anchoring/references/drift-detection.md). Расхождение
между ними даст правки, которые помечаются уехавшими на ровном месте.

## Где вызывать

Санитизация вызывается **при сохранении правки**, а не при экспорте и не при отображении.

Причины:

- В `localStorage` должно лежать уже чистое значение — иначе мусор переживёт перезагрузку.
- Санитизация при отображении означала бы прогон на каждой отрисовке.
- Санитизация при экспорте означала бы, что рецензент правил и видел одно,
  а отправил другое.

Дополнительно её стоит вызывать на событии `paste` — тогда рецензент сразу видит, что
именно вставилось, вместо расхождения между видимым и сохранённым.

## Проверка

Минимальный набор случаев для тестов:

```ts
sanitize('<b>жирный</b>')                          // → '<b>жирный</b>'
sanitize('<span style="color:red">текст</span>')   // → 'текст'
sanitize('<script>alert(1)</script>текст')         // → 'текст'
sanitize('<b style="font-size:28px">т</b>')        // → '<b>т</b>'
sanitize('<a href="javascript:alert(1)">т</a>')    // → '<a>т</a>'
sanitize('<div><p>а</p><p>б</p></div>')            // → 'аб'
sanitize('<b><i>вложенный</i></b>')                // → '<b><i>вложенный</i></b>'
sanitize('<o:p>Word</o:p>')                        // → 'Word'
```

Последние два — регрессионные: вложенное разрешённое форматирование должно пережить
чистку, а неизвестный namespace-тег из Word — развернуться без потери текста.
