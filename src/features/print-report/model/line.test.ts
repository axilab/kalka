import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { entryStore } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import { lineOf } from './line'

/*
 * Строка «стало» печатного отчёта — один из двух читателей `now` вне движка.
 *
 * С вехи «правка текста в кнопках и ссылках» у правки границы `now` приходит
 * ТЕКСТОМ, а не разметкой, и разбирать его как HTML перестало быть безопасным.
 * Живого элемента здесь уже нет, поэтому путь восстанавливается по самой
 * записи — по `tag` и `wasHtml`.
 */

const ROUTE = `${location.pathname}${location.hash}`

function entryOf(over: Partial<Entry> & Pick<Entry, 'id' | 'tag' | 'was' | 'wasHtml' | 'now'>): Entry {
  return {
    type: 'text-override',
    route: ROUTE,
    path: 'main > el',
    style: {},
    nearestHeading: '',
    contextBefore: '',
    contextAfter: '',
    occurrencesOnPage: 1,
    anchor: { selector: '#цель', xpath: '', snippet: over.was, index: 0 },
    viewport: { w: 1440, h: 900 },
    at: '2026-09-07T10:00:00.000Z',
    ...over,
  }
}

beforeEach(() => entryStore.seed([]))
afterEach(() => entryStore.seed([]))

describe('now текстового пути доходит до строки отчёта целиком', () => {
  it('угловые скобки, набранные КАК ЧАСТЬ ТЕКСТА, не съедаются разбором', () => {
    // Рецензент написал имя тега как содержание правки — так бывает
    // на прототипах инструментов для разработчиков.
    const entry = entryOf({
      id: 'кнопка',
      tag: 'button',
      was: 'Оформить заказ',
      wasHtml: '<svg></svg>Оформить заказ',
      now: 'Ставьте <b> вокруг цены',
    })
    entryStore.seed([entry])

    const line = lineOf(entry, document)

    /*
     * До вехи это было безопасно: `now` приходил из `area.innerHTML`, где
     * угловая скобка уже `&lt;`. Теперь `now` сырой, и разбор съел бы `<b>`
     * вместе со всем, что за ним, — в отчёте «стало» оказалось бы обрезанным
     * и молча.
     */
    expect(line.now).toBe('Ставьте <b> вокруг цены')
  })

  it('у обычного абзаца строка отчёта по-прежнему снимает разметку', () => {
    const entry = entryOf({
      id: 'абзац',
      tag: 'p',
      was: 'обычный абзац',
      wasHtml: 'обычный абзац',
      now: 'правленый <b>абзац</b>',
    })
    entryStore.seed([entry])

    expect(lineOf(entry, document).now).toBe('правленый абзац')
  })
})
