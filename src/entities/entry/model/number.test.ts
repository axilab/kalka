import { beforeEach, describe, expect, it } from 'vitest'

import type { Entry } from 'shared/model/format'
import { entryStore } from './store'
import { numbering } from './number'

/*
 * Сквозная нумерация: номер метки на странице обязан совпадать с номером
 * строки в списке, и наоборот. До этой вехи связи между ними не было никакой.
 */

/** Минимальная запись: нумерации важен только порядок и `id`. */
function entryWith(id: string, route: string): Entry {
  return {
    id,
    type: 'comment',
    route,
    tag: 'p',
    was: `текст ${id}`,
    wasHtml: `текст ${id}`,
    now: `замечание ${id}`,
    style: {},
    path: '',
    nearestHeading: '',
    contextBefore: '',
    contextAfter: '',
    occurrencesOnPage: 1,
    anchor: { selector: `#${id}`, xpath: '', snippet: `текст ${id}`, index: 0 },
    viewport: { w: 1280, h: 800 },
    point: { x: 0.5, y: 0.5 },
    at: '2026-09-05T00:00:00.000Z',
  }
}

beforeEach(() => {
  entryStore.seed([])
})

describe('numbering', () => {
  it('нумерует с единицы в порядке добавления', () => {
    entryStore.seed([entryWith('a', '/'), entryWith('b', '/'), entryWith('c', '/')])

    const numbers = numbering()
    expect(numbers.get('a')).toBe(1)
    expect(numbers.get('b')).toBe(2)
    expect(numbers.get('c')).toBe(3)
  })

  it('не даёт номера записи, которой в наборе нет', () => {
    entryStore.seed([entryWith('a', '/')])

    // Так ведёт себя ЧЕРНОВИК: слой рисует его наравне с сохранёнными, но
    // в хранилище его ещё нет. Номер появился бы пустым местом ровно тогда,
    // когда человек смотрит на только что поставленную метку.
    expect(numbering().get('черновик')).toBeUndefined()
  })

  it('накопительный импорт продолжает нумерацию, а не начинает заново', () => {
    entryStore.seed([entryWith('свой-1', '/'), entryWith('свой-2', '/')])
    // Второй файл дописывается в конец — так работает слияние при импорте.
    entryStore.addMany(
      [entryWith('чужой-1', '/other'), entryWith('чужой-2', '/other')].map((entry) => ({
        entry,
        origin: { author: 'второй рецензент', sourceId: 'файл-2', importedAt: entry.at },
      })),
    )

    const numbers = numbering()
    expect([...numbers.values()]).toEqual([1, 2, 3, 4])
    expect(numbers.get('чужой-1')).toBe(3)
  })

  it('номера не зависят от страницы записи', () => {
    // Список показывает текущую страницу первой, но нумерация идёт по набору:
    // считай её на месте отрисовки — и на второй группе она началась бы заново.
    entryStore.seed([
      entryWith('другая', '/other'),
      entryWith('эта', '/'),
      entryWith('другая-2', '/other'),
    ])

    const numbers = numbering()
    expect(numbers.get('другая')).toBe(1)
    expect(numbers.get('эта')).toBe(2)
    expect(numbers.get('другая-2')).toBe(3)
  })

  it('номера не повторяются', () => {
    entryStore.seed(['a', 'b', 'c', 'd', 'e'].map((id) => entryWith(id, '/')))

    const values = [...numbering().values()]
    expect(new Set(values).size).toBe(values.length)
  })
})
