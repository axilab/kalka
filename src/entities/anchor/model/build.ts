import type { Anchor } from 'shared/model/format'
import { SNIPPET_MAX_LENGTH } from 'shared/config/constants'
import { createLogger } from 'shared/lib/log'
import { normalize } from 'shared/lib/normalize'
import { collectSnippetMatches } from './walk'

const log = createLogger('anchor:build')

/**
 * Шаблоны имён, сгенерированных сборщиком. Главная причина мёртвых селекторов:
 * такое имя меняется при каждой пересборке прототипа.
 *
 * Список ОТКРЫТЫЙ: встретили новый шаблон генерации на очередном прототипе —
 * дописали сюда. Полноты здесь не бывает и не требуется, потому что промах
 * первого уровня ловят второй и третий.
 */
const GENERATED = [
  /^css-[a-z0-9]{5,}$/i, // emotion / styled-components
  /^_[A-Za-z0-9]+_[a-z0-9]{4,}$/, // CSS Modules
  /^sc-[A-Za-z0-9]{5,}$/, // styled-components
  /^svelte-[a-z0-9]{5,}$/,
  /^jsx-\d+$/, // styled-jsx
  /^[a-f0-9]{8,}$/i, // голый хеш
  /^v-[a-f0-9]{8}$/, // Vue scoped
]

/** Атрибуты, которые пишет человек: они переживают пересборку. */
const STABLE_ATTRIBUTES = ['data-testid', 'data-test', 'data-id', 'data-section']

/**
 * Похоже ли имя (`id` или класс) на написанное человеком, а не на генерацию.
 *
 * Утилитарные классы Tailwind (`mt-3`, `text-fg-muted`, `min-h-11`) фильтр
 * ПРОХОДЯТ, и это намеренно: на Tailwind-проекте без них у большинства узлов
 * не осталось бы ничего, кроме `:nth-of-type`, и первый уровень стал бы хрупче,
 * а не устойчивее.
 *
 * Но устойчивыми они при этом не считаются. Спайк R1, сценарий передеплоя:
 * переименование `mt-3 text-sm text-fg-muted` → `mt-4 text-sm leading-relaxed
 * text-fg-muted` сломало селектор при живом элементе, и правку поднял второй
 * уровень. Меняется оформление — ломается первый уровень; ровно для этого
 * существуют уровни 2 и 3.
 */
export function isStableToken(token: string): boolean {
  if (!token || token.length > 60) return false
  // Идентификатор с цифры невалиден в CSS без экранирования и почти всегда генерация.
  if (/^\d/.test(token)) return false
  // Длинная числовая серия — тоже обычно генерация.
  if (/\d{6,}/.test(token)) return false
  return !GENERATED.some((pattern) => pattern.test(token))
}

/**
 * Номер элемента среди сиблингов ТОГО ЖЕ тега, с единицы.
 *
 * Считается именно среди своего тега, а не среди всех детей: `:nth-child`
 * сломается, если рядом добавят элемент другого типа. Индексы `:nth-of-type`
 * и XPath начинаются с единицы одинаково, поэтому функция переиспользуется
 * обоими уровнями без сдвига.
 */
export function indexAmongType(el: Element): number {
  const tag = el.tagName
  let index = 1
  let sibling = el.previousElementSibling
  while (sibling) {
    if (sibling.tagName === tag) index += 1
    sibling = sibling.previousElementSibling
  }
  return index
}

/**
 * Описание одного узла для CSS-селектора. Приоритет по убыванию устойчивости:
 * стабильный `id` → `data-*` от человека → тег и стабильные классы →
 * тег и `:nth-of-type` как последнее средство.
 *
 * `CSS.escape` обязателен везде: идентификаторы на чужой странице содержат
 * что угодно, вплоть до точек и двоеточий.
 */
export function describeNode(el: Element): string {
  const tag = el.tagName.toLowerCase()

  if (el.id && isStableToken(el.id)) return `#${CSS.escape(el.id)}`

  for (const attribute of STABLE_ATTRIBUTES) {
    const value = el.getAttribute(attribute)
    if (value) return `${tag}[${attribute}="${CSS.escape(value)}"]`
  }

  const classes = Array.from(el.classList).filter(isStableToken)
  if (classes.length) return `${tag}.${classes.map((c) => CSS.escape(c)).join('.')}`

  return `${tag}:nth-of-type(${indexAmongType(el)})`
}

/**
 * Уровень 1: CSS-селектор.
 *
 * Идём снизу вверх и останавливаемся на первом варианте, дающем ровно одно
 * совпадение по документу: короткий селектор устойчивее длинного, потому что
 * зависит от меньшего числа предков.
 *
 * `root` передаётся параметром и не берётся из глобали — ядро якорей чистое
 * (ARCHITECTURE.md, «Ключевые принципы», пункт 3). Это отклонение от образца
 * навыка kalka-anchoring, где `buildSelector` обращается к `document` напрямую,
 * и оно намеренное.
 */
export function buildSelector(el: Element, root: Document): string {
  const parts: string[] = []
  let node: Element | null = el

  while (node && node !== root.documentElement) {
    parts.unshift(describeNode(node))
    const candidate = parts.join(' > ')
    if (root.querySelectorAll(candidate).length === 1) return candidate
    node = node.parentElement
  }

  return parts.join(' > ')
}

/**
 * Уровень 2: XPath.
 *
 * Путь строится явным, от корня: `//tag` сканирует всё дерево — по MDN
 * это заметно медленнее и вдобавок менее предсказуемо.
 *
 * Имена тегов строчными: документ HTML, а `tagName` в нём отдаёт заглавные.
 */
export function buildXPath(el: Element): string {
  const parts: string[] = []
  let node: Element | null = el

  while (node) {
    parts.unshift(`${node.tagName.toLowerCase()}[${indexAmongType(node)}]`)
    node = node.parentElement
  }

  return `/${parts.join('/')}`
}

/**
 * Сколько совпадений фрагмента идёт по документу ДО этого элемента.
 *
 * Без этого счётчика две одинаковые кнопки «Подробнее» неразличимы, и третий
 * уровень выберет первую попавшуюся. Считается в момент захвата: позже страница
 * уже другая.
 *
 * Совпадения берутся тем же обходом, что и при поиске (`walk.ts`), — иначе
 * номер повтора нумеровал бы один список, а поиск выбирал бы из другого.
 */
export function countPrecedingMatches(el: Element, snippet: string, root: Document): number {
  const hits = collectSnippetMatches(snippet, root)
  const at = hits.indexOf(el)
  if (at !== -1) return at

  // Элемента нет в списке: его текст разорван вложенной разметкой, и целиком
  // фрагмент не лежит ни в одном текстовом узле. Считаем совпадения, идущие
  // строго раньше по документу, — это лучшая доступная догадка.
  return hits.filter(
    (hit) => (el.compareDocumentPosition(hit) & Node.DOCUMENT_POSITION_PRECEDING) !== 0,
  ).length
}

/**
 * Полный якорь элемента: все три уровня разом, один проход при создании правки.
 *
 * `root` по умолчанию — документ самого элемента, а не глобальный `document`:
 * так функция остаётся чистой и проверяемой без браузера.
 */
export function captureAnchor(el: Element, root: Document = el.ownerDocument): Anchor {
  const snippet = normalize(el.textContent ?? '').slice(0, SNIPPET_MAX_LENGTH)
  const anchor: Anchor = {
    selector: buildSelector(el, root),
    xpath: buildXPath(el),
    snippet,
    index: countPrecedingMatches(el, snippet, root),
  }

  // Текст фрагмента в лог не пишется: это содержимое страницы заказчика.
  // Наружу оно не уходит (NFR-03), но и в консоли ему делать нечего.
  log.debug('якорь построен', {
    тег: el.tagName.toLowerCase(),
    длинаСелектора: anchor.selector.length,
    сегментовXPath: anchor.xpath.split('/').length - 1,
    длинаФрагмента: anchor.snippet.length,
    повторовДо: anchor.index,
  })

  return anchor
}
