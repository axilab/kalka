/*
 * Пять полей записи, которые читает ИИ-агент (FR-42, FR-43, FR-44).
 *
 * Слайс собирает ровно те поля, что раньше заполнялись заглушкой: `path`,
 * `nearestHeading`, `contextBefore`, `contextAfter`, `occurrencesOnPage`.
 * `route`, `tag`, `was` и `wasHtml` в набор НЕ входят, хотя образец в справке
 * навыка показывает их вместе с остальными: эти четыре собираются в своих
 * местах и собираются верно, а `wasHtml` у записи типа `comment` обязан
 * остаться ПУСТЫМ. Монолитный сборщик либо сломал бы этот инвариант, либо
 * потребовал бы флага «а этому не надо» — то есть выдал бы, что границу
 * провели не там (решение 5 плана вехи).
 *
 * ── Чего этот файл НЕ читает, и это правило, а не совпадение (FR-46) ─────────
 *
 * Ни одно из пяти полей не берёт `href`, `src`, `data-*`, `<meta>`, `<base>`,
 * `document.baseURI`, HTML-комментарии и содержимое `script`/`style`. `path`
 * строится только из человекочитаемых меток, контекст — только из видимого
 * текста. Это правила отбора, реализованные ниже, а не декларация в шапке.
 *
 * Предел, который кодом не снимается, и притворяться не надо: если на странице
 * прототипа видна ссылка на файл, её ВИДИМЫЙ текст попадёт в `contextBefore` —
 * потому что он и есть текст страницы. Вырезать его значило бы разойтись
 * с исходником, то есть сломать поле, ради которого веха затеяна. Это данные,
 * а не команды, и об этом говорит сама шапка файла обмена (`ABOUT.data`).
 */

import { PATH_MAX_PARTS } from 'shared/config/constants'
import { createLogger } from 'shared/lib/log'
import { normalize } from 'shared/lib/normalize'
import type { AgentContext } from 'shared/model/format'

import { buildPageText, countOccurrences, sliceContext } from './occurrences'

const log = createLogger('agent-context:capture')

/** Разделитель звеньев человекочитаемого пути. */
const PATH_SEPARATOR = ' → '

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'

/**
 * Теги, у которых меткой служит СОБСТВЕННЫЙ заголовок секции.
 *
 * `article` сюда намеренно не входит: карточка в ряду однотипных опознаётся
 * порядковым номером («карточка 2»), и это ровно тот ответ, которого ждёт
 * читатель пути. Заголовок карточки всё равно окажется следующим звеном,
 * когда правят его самого, — брать его ещё и меткой родителя значило бы
 * потратить одно из четырёх звеньев впустую.
 */
const OWN_HEADING_TAGS = new Set(['SECTION', 'NAV', 'ASIDE', 'MAIN', 'HEADER', 'FOOTER', 'DIALOG'])

/**
 * Роль элемента по тегу — по-русски и без технических терминов (FR-36).
 *
 * `path` читает в том числе человек (решение 10), и слов «селектор», «DOM»
 * и имён тегов как есть он видеть не должен. Тег, которого здесь нет, метки
 * по роли не получает вовсе: `div`, `dl`, `ul` без `aria-label` дают пустую
 * строку и в путь не попадают — имя обёртки не сообщает ничего, а звено
 * расходует (правило 3 задачи 4).
 */
const ROLE_BY_TAG: Record<string, string> = {
  LI: 'пункт списка',
  ARTICLE: 'карточка',
  H1: 'заголовок',
  H2: 'заголовок',
  H3: 'заголовок',
  H4: 'заголовок',
  H5: 'заголовок',
  H6: 'заголовок',
  BUTTON: 'кнопка',
  A: 'ссылка',
  TD: 'ячейка',
  TH: 'ячейка',
  FIGCAPTION: 'подпись',
  SUMMARY: 'заголовок блока',
  LABEL: 'подпись поля',
}

/**
 * Второй словарь — по АТРИБУТУ `role`.
 *
 * `<div role="button">` на живых страницах встречается не реже настоящей
 * кнопки, а по тегу такое звено метки не получало вовсе и в путь не попадало.
 * Приём взят из `identifyElement` репозитория agentation, но словарь остаётся
 * РУССКИМ и без технических терминов (FR-36), а правило «звено без метки в путь
 * не попадает» не ослабляется: неизвестное значение атрибута падает на тег.
 *
 * ⚠ Правила отбора при этом не меняются НИ В ОДНОМ месте: `href`, `src`,
 * `data-*`, `<meta>` и содержимое `script`/`style` этот файл не читает и читать
 * не начинает (FR-46). `role` — не адрес и не команда: это назначение элемента,
 * написанное для программ чтения с экрана, и читать его правилу не противоречит.
 */
const ROLE_BY_ATTRIBUTE: Record<string, string> = {
  tab: 'вкладка',
  menuitem: 'пункт меню',
  button: 'кнопка',
  link: 'ссылка',
}

/**
 * Метка звена по назначению элемента. Атрибут `role` СТАРШЕ тега.
 *
 * Порядок обязателен и не переставляется. `ROLE_BY_TAG` знает `BUTTON`,
 * и при проверке тега первым `<button role="tab">` навсегда остался бы
 * «кнопкой», хотя вкладка здесь точнее. Неизвестное или отсутствующее значение
 * атрибута падает на тег, поэтому `<button>` и `<li role="presentation">` дают
 * прежние метки, а `<div role="button">` — «кнопку».
 *
 * Решение живёт в ОДНОМ месте: его спрашивают и построение пути, и журнал.
 */
function roleLabel(el: Element): { label: string; byAttribute: boolean } {
  const attribute = el.getAttribute('role')
  const byRole = attribute === null ? undefined : ROLE_BY_ATTRIBUTE[attribute]
  if (byRole !== undefined) return { label: byRole, byAttribute: true }
  return { label: ROLE_BY_TAG[el.tagName] ?? '', byAttribute: false }
}

function isHeading(el: Element): boolean {
  return /^H[1-6]$/.test(el.tagName)
}

/**
 * Заголовок, стоящий в документе ПЕРЕД правкой: сам кандидат либо ПОСЛЕДНИЙ
 * вложенный в него заголовок.
 *
 * Последний, а не первый: ближайший к правке заголовок — тот, что стоит
 * непосредственно перед ней, а не тот, с которого блок начался.
 */
function lastHeadingIn(candidate: Element): string {
  if (isHeading(candidate)) return normalize(candidate.textContent ?? '')

  const found = candidate.querySelectorAll(HEADING_SELECTOR)
  const nearest = found[found.length - 1]
  return nearest ? normalize(nearest.textContent ?? '') : ''
}

/**
 * СОБСТВЕННЫЙ заголовок секции: прямой ребёнок либо заголовок внутри её
 * прямого `<header>`. Пустая строка — своего заголовка нет.
 *
 * Именно прямой, а не любой вложенный: секция «Каталог» с тремя карточками
 * внутри взяла бы заголовок ТРЕТЬЕЙ карточки и назвалась бы её именем. Путь
 * тогда сообщал бы про место, к которому правка не имеет отношения, — а это
 * хуже пустого звена, потому что выглядит осмысленно.
 */
function ownHeadingOf(section: Element): string {
  for (const child of section.children) {
    if (isHeading(child)) return normalize(child.textContent ?? '')
    if (child.tagName !== 'HEADER') continue
    for (const inner of child.children) {
      if (isHeading(inner)) return normalize(inner.textContent ?? '')
    }
  }
  return ''
}

/**
 * Ближайший заголовок выше по дереву И среди предыдущих соседей (FR-42).
 *
 * Самое дешёвое поле для разрешения дубликатов: одна и та же строка «Подробнее»
 * под разными заголовками — разные строки в исходнике. Замер R8: разрешило
 * 1 случай из 15, и это больше, чем дал `path` (0 из 15).
 *
 * Сам элемент заголовком себя не считает: спрашивается, ПОД каким заголовком
 * он стоит. Пустая строка — законный ответ: заголовка выше может не быть.
 */
export function findNearestHeading(el: Element): string {
  let node: Element | null = el

  while (node && node.tagName !== 'BODY') {
    for (
      let sibling = node.previousElementSibling;
      sibling;
      sibling = sibling.previousElementSibling
    ) {
      const heading = lastHeadingIn(sibling)
      if (heading) return heading
    }
    node = node.parentElement
  }

  return ''
}

/**
 * Порядковый номер среди СОСЕДЕЙ ТОГО ЖЕ ТЕГА, начиная с единицы.
 * `0` — соседей того же тега нет, номер не нужен и только мешал бы читать.
 */
function siblingOrdinal(el: Element): number {
  const parent = el.parentElement
  if (!parent) return 0

  let total = 0
  let position = 0
  for (const child of parent.children) {
    if (child.tagName !== el.tagName) continue
    total += 1
    if (child === el) position = total
  }

  return total > 1 ? position : 0
}

/**
 * Человекочитаемая метка ОДНОГО звена пути. Пустая строка — законный ответ.
 *
 * Порядок источников: собственный заголовок секции → `aria-label` → `title` →
 * роль по тегу с порядковым номером среди однотипных соседей.
 *
 * Три правила, и каждое чинит конкретный дефект замера R8:
 *   1. Технические имена не берутся НИКОГДА — ни `class`, ни `id`, ни `data-*`,
 *      ни имя тега как есть. Этот текст читает человек, а по FR-36 он не должен
 *      видеть слов «селектор» и «DOM».
 *   2. Никакого чтения окружения: `href`, `src`, `<meta>`, `<base>` источниками
 *      метки не являются (FR-46, решение 8).
 *   3. Пустая метка — это пустая метка, а не имя обёртки.
 */
export function describeForHuman(el: Element): string {
  if (OWN_HEADING_TAGS.has(el.tagName)) {
    const heading = ownHeadingOf(el)
    if (heading) return heading
  }

  // `aria-label` и `title` — человекочитаемые подписи, для того и заведённые.
  // Читаются только они: остальные атрибуты либо технические, либо адреса.
  const label = normalize(el.getAttribute('aria-label') ?? '')
  if (label) return label

  const title = normalize(el.getAttribute('title') ?? '')
  if (title) return title

  // Место вставки — ПОСЛЕ `aria-label` и `title`: те остаются старше обоих
  // словарей, и их порядок эта веха не трогает.
  const { label: role } = roleLabel(el)
  if (!role) return ''

  const ordinal = siblingOrdinal(el)
  return ordinal ? `${role} ${ordinal}` : role
}

/**
 * Человекочитаемый путь до элемента (FR-43): до `PATH_MAX_PARTS` непустых
 * звеньев снизу вверх, до `body`, соединённых стрелкой сверху вниз.
 *
 * ПОДРЯД ИДУЩИЕ ОДИНАКОВЫЕ ЗВЕНЬЯ СХЛОПЫВАЮТСЯ. Это прямое исправление дефекта
 * замера R8, где путь читался как «Оператор персональных данных → Оператор
 * персональных данных»: секция и внутренний блок несли одну и ту же подпись,
 * и половина пути ничего не сообщала.
 *
 * Поле признано полем ДЛЯ ЧЕЛОВЕКА (решение 10): замер R8 показал, что `path`
 * не разрешил ни одного случая неоднозначности — разрешали `route`, контекст
 * и `nearestHeading`. Дефекты вывода починены, но требований по M7 к нему
 * больше не предъявляется, и агент, который ждёт от него выбора места,
 * потратит ход впустую.
 */
export function buildPath(el: Element): string {
  const parts: string[] = []
  let node: Element | null = el

  while (node && node.tagName !== 'BODY' && parts.length < PATH_MAX_PARTS) {
    const label = describeForHuman(node)
    // Сравнение с последним собранным, а не со всеми: схлопывается ПОДРЯД
    // идущее. Одинаковые метки на разных концах пути — это разные места,
    // и склеивать их значило бы врать про вложенность.
    if (label && label !== parts[parts.length - 1]) parts.push(label)
    node = node.parentElement
  }

  return parts.reverse().join(PATH_SEPARATOR)
}

/**
 * Собирает все пять полей для агента по элементу (FR-42, FR-43, FR-44).
 *
 * Сбор возможен ТОЛЬКО в момент создания правки: дописать поля потом нечем —
 * ни элемента, ни той страницы уже не будет (решение 14). По той же причине
 * не заводится кеш текста страницы: носитель перерисовывается когда угодно,
 * а устаревший текст даёт неверные смещения молча. Проход стоит единицы
 * миллисекунд и случается по действию человека, а не в кадре прокрутки.
 *
 * `occurrencesOnPage` — флаг осторожности, а не разрешающее поле (решение 11):
 * это число, а не признак места, и ни один вывод в коде на нём не строится.
 * Его подтверждённая польза другая — он ловит расхождение «в DOM строка одна,
 * а кандидатов в исходниках несколько».
 */
export function captureAgentContext(
  el: Element,
  root: Document = el.ownerDocument,
): AgentContext {
  // Текст страницы строится ОДИН раз, и из него берутся оба ответа сразу —
  // контекст и счётчик (решение 1). Второго прохода здесь нет намеренно.
  const page = buildPageText(el, root)
  const context = sliceContext(page)
  const path = buildPath(el)
  const nearestHeading = findNearestHeading(el)
  const occurrencesOnPage = countOccurrences(normalize(el.textContent ?? ''), page)

  // В лог идут длины, количества и тег — ни `path`, ни `nearestHeading`,
  // ни текста контекста в консоли не появляется (решение 16). Наружу это
  // и так не уходит (NFR-03), но в консоли содержимому чужой страницы
  // тоже делать нечего.
  log.debug('контекст для агента собран', {
    тег: el.tagName.toLowerCase(),
    звеньевПути: path ? path.split(PATH_SEPARATOR).length : 0,
    длинаПути: path.length,
    // Новое звено словаря: метка пришла от атрибута `role`, а не от тега.
    меткаПоРоли: roleLabel(el).byAttribute,
    естьЗаголовок: Boolean(nearestHeading),
    знаковДо: context.contextBefore.length,
    знаковПосле: context.contextAfter.length,
    повторов: occurrencesOnPage,
  })

  return { path, nearestHeading, ...context, occurrencesOnPage }
}
