import { describe, expect, it } from 'vitest'

import type { Cutout } from 'shared/model/layer'
import { windowOf } from './window'

/*
 * Окно показа вырезки.
 *
 * Проверяются три несущих свойства: окно строится вокруг ЯКОРЯ по обеим осям,
 * оно не выходит за края кадра, и масштаб никогда не превышает 1. Величина
 * запаса намеренно НЕ прибивается ассертами к числу: тесты отвечают на вопрос
 * «правильно ли посчитано», а «сколько окрестности нужно человеку» проверяется
 * глазами на бумаге. Прибей мы запас — каждая настройка ширины колонки роняла
 * бы тесты, ничего при этом не поймав.
 */

/** Ширина колонки места в печатном документе. */
const PLACE_PX = 240

function cutoutOf(over: Partial<Cutout>): Cutout {
  return {
    html: '<p>Было так</p>',
    width: 1440,
    height: 1000,
    band: { y: 0, h: 100 },
    anchorBox: { x: 400, y: 400, w: 200, h: 50 },
    fontFaces: [],
    at: '2026-09-06T10:00:00.000Z',
    ...over,
  }
}

describe('windowOf', () => {
  it('окно строится вокруг якоря по ОБЕИМ осям и уже кадра', () => {
    // Якорь стоит в середине большого кадра: окно ни одной стороной не упирается
    // в край, то есть проверяется именно построение, а не обрезка.
    const show = windowOf(cutoutOf({}), PLACE_PX)

    // Якорь целиком внутри окна, и с запасом с каждой стороны.
    expect(show.x).toBeLessThan(400)
    expect(show.y).toBeLessThan(400)
    expect(show.x + show.w).toBeGreaterThan(400 + 200)
    expect(show.y + show.h).toBeGreaterThan(400 + 50)

    // Окно УЖЕ кадра по обеим осям — иначе горизонтальная обрезка не сделана,
    // и масштаб в узкой колонке остался бы прежним ≈0.17.
    expect(show.w).toBeLessThan(1440)
    expect(show.h).toBeLessThan(1000)

    // Запас симметричен: якорь стоит в середине окна, а не прижат к краю.
    expect(400 - show.x).toBe(show.x + show.w - (400 + 200))
    expect(400 - show.y).toBe(show.y + show.h - (400 + 50))
  })

  it('масштаб ужимает окно ровно под колонку места', () => {
    const show = windowOf(cutoutOf({}), PLACE_PX)

    expect(show.w * show.scale).toBeCloseTo(PLACE_PX, 6)
  })

  it('окно широкого якоря упирается в края кадра и не выходит за них', () => {
    // Якорь почти во весь кадр: запас с каждой стороны увёл бы окно в минус
    // слева и за нижний край снизу.
    const show = windowOf(
      cutoutOf({ width: 600, height: 300, anchorBox: { x: 20, y: 20, w: 560, h: 260 } }),
      PLACE_PX,
    )

    expect(show.x).toBe(0)
    expect(show.y).toBe(0)
    expect(show.x + show.w).toBe(600)
    expect(show.y + show.h).toBe(300)
  })

  it('якорь во весь кадр даёт окно ровно с кадр — это предел, а не сбой', () => {
    const show = windowOf(
      cutoutOf({ width: 600, height: 300, anchorBox: { x: 0, y: 0, w: 600, h: 300 } }),
      PLACE_PX,
    )

    expect(show).toMatchObject({ x: 0, y: 0, w: 600, h: 300 })
  })

  it('мелкий кадр не растягивается: масштаб не превышает 1', () => {
    // Вырезка это разметка со вкомпилированными стилями. Растянутая, она приедет
    // размытой подписью поверх крупного фона, а не увеличенным местом.
    const show = windowOf(
      cutoutOf({ width: 100, height: 80, anchorBox: { x: 10, y: 10, w: 40, h: 20 } }),
      PLACE_PX,
    )

    expect(show.w).toBe(100)
    expect(show.scale).toBe(1)
  })

  it('вырожденный кадр не даёт бесконечного масштаба', () => {
    // Деление на ноль уехало бы в атрибут `transform` строкой `scale(Infinity)`,
    // и документ приехал бы пустым листом вместо честно пустого превью.
    const show = windowOf(
      cutoutOf({ width: 0, height: 0, anchorBox: { x: 0, y: 0, w: 0, h: 0 } }),
      PLACE_PX,
    )

    expect(show).toEqual({ x: 0, y: 0, w: 0, h: 0, scale: 1 })
  })
})
