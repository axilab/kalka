import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { entryStore, numbering } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import { UNDO_REMOVE_MS } from 'shared/config/constants'
import {
  flushRemovals,
  pendingRemovals,
  removeWithUndo,
  subscribeRemovals,
  undoRemove,
} from './pending'

/*
 * Удаление правки из списка разбора с откатом.
 *
 * Проверяется здесь ровно то, что легко потерять правкой и невозможно заметить
 * глазами сразу: отмена возвращает запись НА СВОЁ МЕСТО, а не в конец списка,
 * и возвращает вместе с автором. Оба свойства держатся на `entryStore.insertAt`,
 * и оба молча ломаются, если однажды заменить его на `upsert`.
 */

function entryOf(id: string, was: string): Entry {
  return {
    id,
    type: 'text-override',
    route: '/',
    path: 'main > p',
    tag: 'p',
    was,
    now: `${was} — исправлено`,
    style: {},
    nearestHeading: '',
    contextBefore: '',
    contextAfter: '',
    occurrencesOnPage: 1,
    wasHtml: `<p>${was}</p>`,
    anchor: { selector: 'p', xpath: '/html/body/p', snippet: was, index: 0 },
    viewport: { w: 1440, h: 900 },
    at: '2026-09-06T10:00:00.000Z',
  }
}

/** Идентификаторы набора в порядке хранилища: по нему считаются и номера. */
function order(): string[] {
  return entryStore.list().map((entry) => entry.id)
}

beforeEach(() => {
  vi.useFakeTimers()
  entryStore.seed([entryOf('a', 'Первая'), entryOf('b', 'Вторая'), entryOf('c', 'Третья')])
})

afterEach(() => {
  flushRemovals()
  vi.useRealTimers()
  entryStore.seed([])
})

describe('удаление правки с откатом', () => {
  it('снимает запись сразу, не дожидаясь конца окна отката', () => {
    removeWithUndo('b')

    expect(order()).toEqual(['a', 'c'])
    expect(entryStore.get('b')).toBeUndefined()
  })

  it('номера сдвигаются сразу: это цена удаления, а не отложенное следствие', () => {
    removeWithUndo('a')

    // Была второй — стала первой. Тот же номер стоит на метке правки
    // на странице, и разъехаться они не имеют права.
    expect(numbering().get('b')).toBe(1)
    expect(numbering().get('c')).toBe(2)
  })

  it('удалённая запись ждёт отката и знает своё место', () => {
    removeWithUndo('b')

    expect(pendingRemovals()).toHaveLength(1)
    expect(pendingRemovals()[0]?.id).toBe('b')
    expect(pendingRemovals()[0]?.index).toBe(1)
  })

  it('отмена возвращает запись НА СВОЁ МЕСТО, а не в конец набора', () => {
    removeWithUndo('b')
    undoRemove('b')

    // Ровно то, ради чего заведён `insertAt`: `upsert` дал бы ['a','c','b'],
    // и номера обеих соседок переехали бы на отмене удаления.
    expect(order()).toEqual(['a', 'b', 'c'])
    expect(numbering().get('c')).toBe(3)
    expect(pendingRemovals()).toHaveLength(0)
  })

  it('отмена возвращает и автора чужой правки', () => {
    entryStore.addMany([{ entry: entryOf('d', 'Чужая'), origin: { author: 'Ирина Со', sourceId: 'x1', importedAt: '2026-09-06T11:00:00.000Z' } }])

    removeWithUndo('d')
    expect(entryStore.originOf('d')).toBeUndefined()

    undoRemove('d')

    // Без автора дедупликация повторного импорта уже сломана: тот же файл
    // втянулся бы вторым экземпляром той же правки.
    expect(entryStore.originOf('d')?.author).toBe('Ирина Со')
    expect(entryStore.hasOrigin('Ирина Со', 'x1')).toBe(true)
  })

  it('чужая правка отмечена в буфере: у неё своя фраза на полосе отмены', () => {
    entryStore.addMany([{ entry: entryOf('d', 'Чужая'), origin: { author: 'Ирина Со', sourceId: 'x1', importedAt: '2026-09-06T11:00:00.000Z' } }])

    removeWithUndo('a')
    removeWithUndo('d')

    const byId = new Map(pendingRemovals().map((item) => [item.id, item.imported]))
    expect(byId.get('a')).toBe(false)
    expect(byId.get('d')).toBe(true)
  })

  it('буфер называет момент закрытия окна, а не остаток', () => {
    const before = Date.now()
    removeWithUndo('b')

    // Метка времени, а не оставшиеся миллисекунды: остаток устаревает к первой
    // же отрисовке, а метка — нет. На ней держится полоса обратного отсчёта:
    // перерисованная посреди отсчёта, она обязана показать верный остаток,
    // а не начать пять секунд заново.
    expect(pendingRemovals()[0]?.until).toBe(before + UNDO_REMOVE_MS)
  })

  it('по истечении окна запись уходит из буфера и вернуть её больше нечем', () => {
    removeWithUndo('b')
    vi.advanceTimersByTime(UNDO_REMOVE_MS)

    expect(pendingRemovals()).toHaveLength(0)

    undoRemove('b')
    expect(order()).toEqual(['a', 'c'])
  })

  it('окно отката закрывается ПОДТВЕРЖДЕНИЕМ, а не возвратом правок', () => {
    removeWithUndo('a')
    removeWithUndo('c')

    flushRemovals()

    // Демонтаж «Кальки» не имеет права вернуть человеку то, что он на глазах
    // удалил: записи сняты со страницы ещё в момент нажатия.
    expect(order()).toEqual(['b'])
    expect(pendingRemovals()).toHaveLength(0)
  })

  it('удалять нечего — набор не меняется и буфер пуст', () => {
    removeWithUndo('нет-такой')

    expect(order()).toEqual(['a', 'b', 'c'])
    expect(pendingRemovals()).toHaveLength(0)
  })

  it('подписчик слышит и удаление, и отмену, и истечение окна', () => {
    const listener = vi.fn()
    const stop = subscribeRemovals(listener)

    removeWithUndo('b')
    expect(listener).toHaveBeenCalledTimes(1)

    undoRemove('b')
    expect(listener).toHaveBeenCalledTimes(2)

    removeWithUndo('c')
    vi.advanceTimersByTime(UNDO_REMOVE_MS)
    expect(listener).toHaveBeenCalledTimes(4)

    stop()
    removeWithUndo('a')
    expect(listener).toHaveBeenCalledTimes(4)
  })
})
