import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { entryStore } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import { saveEdit } from './save'

/*
 * Сохранение правки на текстовом пути.
 *
 * С вехи «правка текста в кнопках и ссылках» у правки границы (кнопка, ссылка,
 * подпись поля, заголовок раскрывающегося блока) в `now` идёт ТЕКСТ, а не
 * разметка: редактор её там и не даёт набрать. Формат обмена при этом
 * не меняется ни на байт — признак виджет выводит сам.
 *
 * У `now` есть читатели ВНЕ движка, и живого элемента у них уже нет. Они лежат
 * в соседних слайсах этого же слоя, а соседние слайсы друг друга не видят,
 * поэтому их тесты стоят рядом с ними: `print-report/model/line.test.ts`.
 */

const ROUTE = `${location.pathname}${location.hash}`

function draftOf(over: Partial<Entry> & Pick<Entry, 'id' | 'tag' | 'was' | 'wasHtml'>): Entry {
  return {
    type: 'text-override',
    route: ROUTE,
    path: 'main > el',
    now: '',
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

describe('saveEdit при plainOnly', () => {
  it('правка кнопки даёт now без единого тега', () => {
    const draft = draftOf({
      id: 'кнопка',
      tag: 'button',
      was: 'Оформить заказ',
      wasHtml: '<svg></svg>Оформить заказ',
    })

    // Область стоит `plaintext-only`, а окно берёт `textContent`: разметке
    // взяться неоткуда. Но второй рубеж обязан держать и её.
    saveEdit(draft, 'Купить <b>сейчас</b>', {}, true)

    expect(entryStore.get('кнопка')?.now).toBe('Купить сейчас')
  })

  it('правка обычного абзаца по-прежнему сохраняет разметку', () => {
    const draft = draftOf({
      id: 'абзац',
      tag: 'p',
      was: 'обычный абзац',
      wasHtml: 'обычный абзац',
    })

    // Невырожденная пара: поведение почти всех правок в проекте не меняется.
    saveEdit(draft, 'правленый <b>абзац</b>', {}, false)

    expect(entryStore.get('абзац')?.now).toBe('правленый <b>абзац</b>')
  })

  it('правка, сведённая к исходной строке, снимает запись', () => {
    const draft = draftOf({
      id: 'кнопка',
      tag: 'button',
      was: 'Оформить заказ',
      wasHtml: '<svg></svg>Оформить заказ',
    })
    entryStore.seed([{ ...draft, now: 'Купить сейчас' }])

    saveEdit(draft, 'Оформить заказ', {}, true)

    // `resolveType` сравнивает нормализованный текст с `was` и на простом
    // тексте работает без правок.
    expect(entryStore.get('кнопка')).toBeUndefined()
  })
})
