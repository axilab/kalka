import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CUTOUTS_KEY, CUTOUT_BUFFER_MAX_BYTES, ENTRIES_KEY } from 'shared/config/constants'
import type { Cutout } from 'shared/model/layer'
import { cutoutBuffer } from './buffer'

/*
 * Черновой буфер вырезок.
 *
 * Главное здесь не «кладёт и достаёт», а НЕСУЩИЙ ИНВАРИАНТ: при нехватке места
 * жертвуется вырезка, а не запись. Записи — то, ради чего продукт существует;
 * вырезки — вспомогательные картинки со сроком жизни до печати. Проверяется
 * прямо: буфер не трогает ключ записей и не поднимает их флаг отказа.
 */

function cutoutOf(at: string, padding = 0): Cutout {
  return {
    html: `<p>${'x'.repeat(padding)}</p>`,
    width: 320,
    height: 40,
    band: { y: 0, h: 40 },
    anchorBox: { x: 0, y: 0, w: 320, h: 40 },
    fontFaces: [],
    at,
  }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('черновой буфер вырезок', () => {
  it('выбрасывает вырезки ПРЕЖНЕЙ ФОРМЫ, оставляя годные', () => {
    // Буфер переживает передеплой: вырезку положила вчерашняя сборка виджета,
    // а достаёт сегодняшняя. Приведение типом этого не замечает — разбор
    // проходит, вырезка уходит в отчёт, и падает сборка документа на поле,
    // которого нет. Ровно так и вышло, когда `Cutout` получил поле `band`:
    // кнопка «Отчёт» перестала работать молча, а в консоль носителя улетело
    // `Cannot read properties of undefined`.
    const прежняя = { ...cutoutOf('2026-09-06T10:00:00.000Z') } as Partial<Cutout>
    delete прежняя.band

    localStorage.setItem(
      'kalka:' + CUTOUTS_KEY,
      JSON.stringify({
        старая: прежняя,
        новая: cutoutOf('2026-09-06T10:01:00.000Z'),
      }),
    )

    expect(cutoutBuffer.get('старая')).toBeNull()
    expect(cutoutBuffer.get('новая')).not.toBeNull()

    // Чистка записана, а не только применена к прочитанному: негодные байты
    // иначе занимали бы квоту, которой виджет делится с сайтом-носителем,
    // и предупреждение повторялось бы на каждое обращение к буферу.
    const снимок = JSON.parse(localStorage.getItem('kalka:' + CUTOUTS_KEY) ?? '{}') as object
    expect(Object.keys(снимок)).toEqual(['новая'])
  })

  it('вырезку с битым полем тоже выбрасывает, а не отдаёт наполовину', () => {
    // Не только «поля нет»: чужая запись под нашим ключом и просто побитый
    // снимок дают то же самое — вырезку, на которой сборка документа споткнётся.
    const битая = { ...cutoutOf('2026-09-06T10:00:00.000Z'), width: 'широкая' }

    localStorage.setItem('kalka:' + CUTOUTS_KEY, JSON.stringify({ битая }))

    expect(cutoutBuffer.get('битая')).toBeNull()
  })

  it('кладёт, отдаёт и снимает вырезку по идентификатору записи', () => {
    expect(cutoutBuffer.put('a1', cutoutOf('2026-09-06T10:00:00.000Z'))).toBe(true)

    expect(cutoutBuffer.has('a1')).toBe(true)
    expect(cutoutBuffer.get('a1')?.at).toBe('2026-09-06T10:00:00.000Z')

    cutoutBuffer.drop('a1')
    expect(cutoutBuffer.get('a1')).toBeNull()
  })

  it('пишет ТОЛЬКО под своим ключом и не трогает ключ записей', () => {
    // Прямая проверка инварианта. Лежи вырезки в ключе записей, переполнение
    // квоты от разросшихся картинок сорвало бы запись ПРАВОК.
    //
    // Хранилище записей тут не поднимается, и это не лень: `entities/entry` —
    // соседний слайс того же слоя, импортировать его отсюда запрещено
    // (линтер это и проверяет). Ключ берётся из `shared/config`, а вторая
    // половина инварианта — «флаг отказа записей не поднимается» — живёт
    // в `features/print-report/model/cleanup.test.ts`, на слое, который
    // законно видит оба слайса.
    localStorage.setItem(`kalka:${ENTRIES_KEY}`, '{"записи":"на месте"}')

    cutoutBuffer.put('a1', cutoutOf('2026-09-06T10:00:00.000Z'))

    expect(localStorage.getItem(`kalka:${CUTOUTS_KEY}`)).not.toBeNull()
    expect(localStorage.getItem(`kalka:${ENTRIES_KEY}`)).toBe('{"записи":"на месте"}')
  })

  it('отказ записи наверх идёт значением, а не исключением', () => {
    // Вызывающий обязан продолжить работу: не сохранилась КАРТИНКА, а правка
    // на месте. Бросок отсюда прервал бы сохранение правки ради картинки.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('квота кончилась')
    })

    expect(cutoutBuffer.put('a1', cutoutOf('2026-09-06T10:00:00.000Z'))).toBe(false)
  })

  it('потеря буфера штатна: непригодное содержимое читается как пустой буфер', () => {
    localStorage.setItem(`kalka:${CUTOUTS_KEY}`, 'это не разбирается')

    expect(cutoutBuffer.get('a1')).toBeNull()
    expect(cutoutBuffer.put('a1', cutoutOf('2026-09-06T10:00:00.000Z'))).toBe(true)
  })

  it('вытесняет самые СТАРЫЕ вырезки, когда буфер упёрся в потолок', () => {
    // Потолок настоящий, поэтому вырезки берутся крупные: смысл проверки —
    // в порядке вытеснения, а не в конкретном числе байт.
    const big = Math.ceil(CUTOUT_BUFFER_MAX_BYTES / 3)

    cutoutBuffer.put('старая', cutoutOf('2026-09-06T10:00:00.000Z', big))
    cutoutBuffer.put('средняя', cutoutOf('2026-09-06T11:00:00.000Z', big))
    cutoutBuffer.put('свежая', cutoutOf('2026-09-06T12:00:00.000Z', big))

    expect(cutoutBuffer.has('свежая')).toBe(true)
    expect(cutoutBuffer.has('старая')).toBe(false)
  })

  it('keep() снимает вырезки без записей и не трогает остальные', () => {
    // Сироты неизбежны по устройству: съёмка идёт на ЧЕРНОВИК, а черновик
    // записью становится не всегда — инструмент «Текст» захватывает элемент
    // на каждый клик, а замечание не сохраняется без комментария.
    cutoutBuffer.put('живая', cutoutOf('2026-09-06T10:00:00.000Z'))
    cutoutBuffer.put('сирота-1', cutoutOf('2026-09-06T10:01:00.000Z'))
    cutoutBuffer.put('сирота-2', cutoutOf('2026-09-06T10:02:00.000Z'))

    expect(cutoutBuffer.keep(['живая'])).toBe(2)

    expect(cutoutBuffer.has('живая')).toBe(true)
    expect(cutoutBuffer.has('сирота-1')).toBe(false)
    expect(cutoutBuffer.has('сирота-2')).toBe(false)
  })

  it('keep() без сирот ничего не пишет и возвращает ноль', () => {
    cutoutBuffer.put('живая', cutoutOf('2026-09-06T10:00:00.000Z'))
    const before = localStorage.getItem(`kalka:${CUTOUTS_KEY}`)

    expect(cutoutBuffer.keep(['живая'])).toBe(0)
    expect(localStorage.getItem(`kalka:${CUTOUTS_KEY}`)).toBe(before)
  })

  it('clear() стирает буфер целиком и называет число снятых', () => {
    cutoutBuffer.put('a1', cutoutOf('2026-09-06T10:00:00.000Z'))
    cutoutBuffer.put('a2', cutoutOf('2026-09-06T10:01:00.000Z'))

    expect(cutoutBuffer.clear()).toBe(2)
    expect(localStorage.getItem(`kalka:${CUTOUTS_KEY}`)).toBeNull()
    expect(cutoutBuffer.clear()).toBe(0)
  })
})
