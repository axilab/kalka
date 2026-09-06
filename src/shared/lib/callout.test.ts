import { beforeEach, describe, expect, it } from 'vitest'

import { placeCallout } from './callout'

/*
 * Геометрия выноски: где встаёт окно правки и окно замечания.
 *
 * Проверяется чистая арифметика, без разметки: она и решает, увидит ли человек
 * то, что правит. Вьюпорт задаётся явно — jsdom по умолчанию даёт 1024×768,
 * и молчаливая опора на это значение сделала бы проверки нечитаемыми.
 */

const WIDTH = 1000
const HEIGHT = 800

beforeEach(() => {
  window.innerWidth = WIDTH
  window.innerHeight = HEIGHT
})

/** Прямоугольник якоря во вьюпортных координатах. */
function anchorAt(left: number, top: number, width = 200, height = 40): DOMRectReadOnly {
  return new DOMRect(left, top, width, height)
}

describe('placeCallout', () => {
  it('ставит окно под правимой строкой, выровняв по её левому краю', () => {
    const place = placeCallout({
      anchor: anchorAt(100, 100),
      size: { width: 340, height: 200 },
      reservedRight: 48,
    })

    expect(place.side).toBe('below')
    expect(place.flipped).toBe(false)
    expect(place.left).toBe(100)
    // Зазор между строкой и окном: впритык окно читается как часть строки.
    expect(place.top).toBe(140 + 8)
  })

  it('переворачивает окно вверх, когда снизу не помещается', () => {
    const place = placeCallout({
      anchor: anchorAt(100, HEIGHT - 60),
      size: { width: 340, height: 300 },
      reservedRight: 48,
    })

    expect(place.side).toBe('above')
    expect(place.flipped).toBe(true)
    // Нижний край окна встаёт над якорем с тем же зазором.
    expect(place.top + 300).toBe(HEIGHT - 60 - 8)
  })

  it('не помещается ни снизу, ни сверху — встаёт туда, где просторнее, под потолком', () => {
    // Якорь у самого верха: снизу места много, сверху почти нет.
    const place = placeCallout({
      anchor: anchorAt(100, 30),
      size: { width: 340, height: 5000 },
      reservedRight: 48,
    })

    expect(place.side).toBe('below')
    // Окно не уезжает за экран, а получает потолок и прокручивается внутри.
    expect(place.top + place.maxHeight).toBeLessThanOrEqual(HEIGHT)
    expect(place.maxHeight).toBeGreaterThan(0)
  })

  it('прижимает окно внутрь, чтобы оно не уехало под рейку', () => {
    const place = placeCallout({
      anchor: anchorAt(WIDTH - 260, 100),
      size: { width: 340, height: 200 },
      reservedRight: 48,
    })

    // Правый край окна остаётся левее занятой интерфейсом полосы.
    expect(place.left + 340).toBeLessThanOrEqual(WIDTH - 48)
  })

  it('открытый ящик отодвигает окно сильнее закрытого', () => {
    const anchor = anchorAt(WIDTH - 260, 100)
    const size = { width: 340, height: 200 }

    const closed = placeCallout({ anchor, size, reservedRight: 48 })
    const open = placeCallout({ anchor, size, reservedRight: 408 })

    expect(open.left).toBeLessThan(closed.left)
    expect(open.left + 340).toBeLessThanOrEqual(WIDTH - 408)
  })

  it('не утапливает левый край окна за экран', () => {
    // Ящик открыт, окно шире оставшейся полосы: вытащить его целиком нельзя,
    // но терять начало текста — хуже, чем упереться в край.
    const place = placeCallout({
      anchor: anchorAt(WIDTH - 100, 100),
      size: { width: 900, height: 200 },
      reservedRight: 408,
    })

    expect(place.left).toBeGreaterThanOrEqual(0)
    // Ширина тоже ограничена оставшейся полосой — окно сожмётся по ней.
    expect(place.maxWidth).toBeLessThanOrEqual(WIDTH - 408)
  })
})
