import type { Anchor } from 'shared/model/format'
import type { ResolveResult } from 'shared/model/layer'
import { createLogger } from 'shared/lib/log'
import { matchesWas } from './drift'
import { collectSnippetMatches } from './walk'

const log = createLogger('anchor:resolve')

/*
 * Трёхуровневый поиск с откатом. Порядок уровней фиксирован и записан явной
 * последовательностью попыток, а не вложенными условиями (rules/base.md).
 *
 * Границу Shadow DOM носителя не пересекает ни один из трёх уровней:
 * `querySelector`, `evaluate` и `createTreeWalker` в чужой shadow root
 * не заходят. Для V1 это осознанное ограничение — PRD (раздел 11, допущения)
 * исходит из того, что прототипы отдают текст в обычном DOM. Встреченный
 * такой прототип — выход за допущение, а не дефект анкоринга.
 */

/** Уровень 1: CSS-селектор. */
export function trySelector(selector: string, root: Document): Element | null {
  if (!selector) return null
  try {
    return root.querySelector(selector)
  } catch {
    // Селектор приехал из чужого файла обмена и может быть невалидным.
    // Это не ошибка виджета, а повод перейти на следующий уровень.
    return null
  }
}

/** Уровень 2: XPath. */
export function tryXPath(xpath: string, root: Document): Element | null {
  if (!xpath) return null
  try {
    const result = root.evaluate(
      xpath,
      root,
      null, // документ HTML: resolver пространств имён не нужен
      // Только FIRST_ORDERED_NODE_TYPE. Итераторные типы (4 и 5) по MDN
      // ИНВАЛИДИРУЮТСЯ при модификации документа, а мы документ мутируем —
      // наложение слоя и есть мутация, и следующий iterateNext() бросил бы
      // исключение. Понадобится несколько результатов — брать снапшот-типы
      // (6 и 7), они мутацию переживают.
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    )
    const node = result.singleNodeValue
    return node && node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null
  } catch {
    return null
  }
}

/**
 * Уровень 3: поиск по фрагменту текста.
 *
 * Если исходный `index` вышел за границы (совпадений на странице стало меньше),
 * откатываемся на первое совпадение, а не возвращаем `null`: показать
 * разработчику вероятное место лучше, чем не показать ничего. Правка всё равно
 * будет помечена как неточная — уровень возвращает `exact: false`.
 */
export function trySnippet(snippet: string, index: number, root: Document): Element | null {
  const hits = collectSnippetMatches(snippet, root)
  return hits[index] ?? hits[0] ?? null
}

/**
 * Полный поиск с откатом.
 *
 * Уровень считается успешным, только если элемент найден И прошёл сверку `was`:
 * живой селектор на переименованном заголовке — ровно тот случай, ради которого
 * сверка существует (спайк R1). Третий уровень с `was` не сверяется — он ищет
 * именно по тексту, и требовать совпадения текста было бы тавтологией; поэтому
 * его результат помечен `exact: false`.
 */
export function resolveAnchor(anchor: Anchor, was: string, root: Document): ResolveResult {
  const bySelector = trySelector(anchor.selector, root)
  if (bySelector && matchesWas(bySelector, was)) {
    log.debug('уровень 1 сработал: селектор')
    return { element: bySelector, method: 'selector', exact: true }
  }
  log.debug('уровень 1 не сработал', {
    причина: bySelector ? 'текст не сошёлся' : 'элемент не найден',
  })

  const byXPath = tryXPath(anchor.xpath, root)
  if (byXPath && matchesWas(byXPath, was)) {
    log.debug('уровень 2 сработал: XPath')
    return { element: byXPath, method: 'xpath', exact: true }
  }
  log.debug('уровень 2 не сработал', {
    причина: byXPath ? 'текст не сошёлся' : 'элемент не найден',
  })

  const bySnippet = trySnippet(anchor.snippet, anchor.index, root)
  if (bySnippet) {
    log.debug('уровень 3 сработал: фрагмент текста, результат неточный')
    return { element: bySnippet, method: 'snippet', exact: false }
  }

  log.debug('ни один уровень не сработал', { длинаИсходногоТекста: was.length })
  return { status: 'lost' }
}
