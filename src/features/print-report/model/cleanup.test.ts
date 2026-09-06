import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cutoutBuffer } from 'entities/cutout'
import { entryStore } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import type { Cutout } from 'shared/model/layer'
import { armCutoutCleanupAfterPrint, sweepOrphanCutouts } from './cleanup'

/*
 * Срок жизни чернового буфера вырезок.
 *
 * Тесты живут ЗДЕСЬ, а не в `entities/cutout`, и это не выбор удобства:
 * им нужны сразу набор записей и буфер вырезок — соседние слайсы одного слоя,
 * импортировать друг друга они не могут (линтер это проверяет). Слой `features`
 * видит оба законно, и здесь же лежит вторая половина несущего инварианта
 * «жертвуем вырезку, а не запись»: флаг отказа записей от сбоя буфера
 * не поднимается.
 */

function cutoutOf(at: string): Cutout {
  return {
    html: '<p>Было так</p>',
    width: 320,
    height: 40,
    band: { y: 0, h: 40 },
    anchorBox: { x: 0, y: 0, w: 320, h: 40 },
    fontFaces: [],
    at,
  }
}

function entryOf(id: string): Entry {
  return {
    id,
    type: 'text-override',
    route: '/',
    path: 'main > p',
    tag: 'p',
    was: 'Было так',
    now: 'Стало так',
    style: {},
    nearestHeading: '',
    contextBefore: '',
    contextAfter: '',
    occurrencesOnPage: 1,
    wasHtml: '<p>Было так</p>',
    anchor: { selector: 'p', xpath: '/html/body/p', snippet: 'Было так', index: 0 },
    viewport: { w: 1440, h: 900 },
    at: '2026-09-06T10:00:00.000Z',
  }
}

beforeEach(() => {
  localStorage.clear()
  entryStore.seed([])
  entryStore.setPersistFailed(false, 'write')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sweepOrphanCutouts', () => {
  it('снимает вырезки, которым не соответствует ни одна запись', () => {
    // Сироты неизбежны по устройству: съёмка идёт на ЧЕРНОВИК, а черновик
    // записью становится не всегда — инструмент «Текст» захватывает элемент
    // на каждый клик, а замечание не сохраняется, пока не введён комментарий.
    entryStore.seed([entryOf('живая')])
    cutoutBuffer.put('живая', cutoutOf('2026-09-06T10:00:00.000Z'))
    cutoutBuffer.put('сирота', cutoutOf('2026-09-06T10:01:00.000Z'))

    expect(sweepOrphanCutouts()).toBe(1)

    expect(cutoutBuffer.has('живая')).toBe(true)
    expect(cutoutBuffer.has('сирота')).toBe(false)
  })

  it('на чистом буфере ничего не снимает', () => {
    entryStore.seed([entryOf('живая')])
    cutoutBuffer.put('живая', cutoutOf('2026-09-06T10:00:00.000Z'))

    expect(sweepOrphanCutouts()).toBe(0)
    expect(cutoutBuffer.has('живая')).toBe(true)
  })
})

describe('armCutoutCleanupAfterPrint', () => {
  it('не чистит буфер в момент постановки печати', () => {
    // Печать средствами браузера о своём исходе не сообщает: успехом пришлось
    // бы считать открытие диалога. Человек, отменивший диалог, чтобы что-нибудь
    // проверить, при повторной печати получил бы отчёт уже без картинок.
    cutoutBuffer.put('a1', cutoutOf('2026-09-06T10:00:00.000Z'))

    const stop = armCutoutCleanupAfterPrint()

    expect(cutoutBuffer.has('a1')).toBe(true)
    stop()
  })

  it('снимает вырезки напечатанного при ПЕРВОМ изменении набора после печати', () => {
    entryStore.seed([entryOf('a1')])
    cutoutBuffer.put('a1', cutoutOf('2026-09-06T10:00:00.000Z'))
    armCutoutCleanupAfterPrint()

    entryStore.upsert(entryOf('новая'))

    expect(cutoutBuffer.has('a1')).toBe(false)
  })

  it('НЕ трогает вырезку правки, которая очистку и разбудила', () => {
    // Первое изменение набора после печати — это, как правило, сохранение
    // следующей правки, а её вырезка к тому моменту уже снята (съёмка идёт
    // при создании черновика). Снеси здесь буфер целиком — и после каждой
    // печати следующая правка молча выходила бы в отчёт без картинки.
    // Найдено ручным прогоном на стенде 2026-09-06.
    entryStore.seed([entryOf('напечатанная')])
    cutoutBuffer.put('напечатанная', cutoutOf('2026-09-06T10:00:00.000Z'))

    armCutoutCleanupAfterPrint()

    // Рецензент правит дальше: черновик снят, вырезка легла, запись сохранена.
    cutoutBuffer.put('следующая', cutoutOf('2026-09-06T11:00:00.000Z'))
    entryStore.upsert(entryOf('следующая'))

    expect(cutoutBuffer.has('напечатанная')).toBe(false)
    expect(cutoutBuffer.has('следующая')).toBe(true)
  })

  it('повторная печать обновляет список снимаемого', () => {
    // Во второй документ могли уйти вырезки, которых в первом не было.
    entryStore.seed([entryOf('первая')])
    cutoutBuffer.put('первая', cutoutOf('2026-09-06T10:00:00.000Z'))
    armCutoutCleanupAfterPrint()

    entryStore.seed([entryOf('первая'), entryOf('вторая')])
    cutoutBuffer.put('вторая', cutoutOf('2026-09-06T11:00:00.000Z'))
    armCutoutCleanupAfterPrint()

    entryStore.upsert(entryOf('третья'))

    expect(cutoutBuffer.has('первая')).toBe(false)
    expect(cutoutBuffer.has('вторая')).toBe(false)
  })

  it('после срабатывания больше не вмешивается', () => {
    // Иначе вырезки, снятые для СЛЕДУЮЩЕГО круга правок, стирались бы
    // на каждом изменении набора, и второй отчёт вышел бы без картинок.
    armCutoutCleanupAfterPrint()
    entryStore.upsert(entryOf('первая'))

    cutoutBuffer.put('b1', cutoutOf('2026-09-06T11:00:00.000Z'))
    entryStore.upsert(entryOf('вторая'))

    expect(cutoutBuffer.has('b1')).toBe(true)
  })

  it('снятие отменяет ожидание вместе со списком', () => {
    entryStore.seed([entryOf('a1')])
    cutoutBuffer.put('a1', cutoutOf('2026-09-06T10:00:00.000Z'))

    armCutoutCleanupAfterPrint()()
    entryStore.upsert(entryOf('новая'))

    expect(cutoutBuffer.has('a1')).toBe(true)
  })

  it('повторная печать второй подписки не заводит', () => {
    const first = armCutoutCleanupAfterPrint()
    const second = armCutoutCleanupAfterPrint()

    expect(second).toBe(first)
    first()
  })
})

describe('несущий инвариант: жертвуем вырезку, а не запись', () => {
  it('сбой записи буфера НЕ поднимает флаг отказа у записей', () => {
    // Флаг `persistFailed` говорит рецензенту «правки не сохраняются».
    // Подними его отсюда — и виджет соврал бы: не сохранилась КАРТИНКА,
    // а правка на месте. Человек побежал бы спасать то, что не терялось.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('квота кончилась')
    })

    expect(cutoutBuffer.put('a1', cutoutOf('2026-09-06T10:00:00.000Z'))).toBe(false)
    expect(entryStore.persistFailed()).toBe(false)
  })
})
