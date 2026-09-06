import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { pointFromBox, rectFromBox, restorePoint, restoreRect, watchLayout } from './geometry'

/*
 * Снятие наблюдения за раскладкой.
 *
 * На `watchLayout` подписаны трое: слой меток, окно правки и окно замечания.
 * Каждый снимает подписку при размонтировании, и если снятие неполное —
 * слушатель `scroll` остаётся висеть на `window` чужой страницы навсегда,
 * вместе с замыканием на снесённое дерево. Обещание «страница после демонтажа
 * неотличима от исходной» (NFR-06) на это не делает исключений.
 */

describe('watchLayout', () => {
  let added: { type: string; capture: boolean }[]
  let removed: { type: string; capture: boolean }[]

  beforeEach(() => {
    added = []
    removed = []
    vi.spyOn(window, 'addEventListener').mockImplementation(((
      type: string,
      _listener: unknown,
      options?: AddEventListenerOptions | boolean,
    ) => {
      added.push({ type, capture: typeof options === 'object' ? options.capture === true : false })
    }) as typeof window.addEventListener)

    vi.spyOn(window, 'removeEventListener').mockImplementation(((
      type: string,
      _listener: unknown,
      options?: EventListenerOptions | boolean,
    ) => {
      removed.push({ type, capture: typeof options === 'object' ? options.capture === true : false })
    }) as typeof window.removeEventListener)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('подписывается на прокрутку в фазе перехвата', () => {
    const stop = watchLayout(() => {})

    // `capture` обязателен: событие `scroll` внутреннего контейнера не всплывает,
    // и без фазы перехвата метка внутри блока с `overflow: auto` отрывалась бы
    // от своего места.
    expect(added).toContainEqual({ type: 'scroll', capture: true })

    stop()
  })

  it('снятие убирает слушатель ТЕМ ЖЕ capture, что и подписка', () => {
    const stop = watchLayout(() => {})
    stop()

    // Снятие с другим `capture` не снимает ничего: браузер считает это другим
    // слушателем, и подписка осталась бы висеть молча.
    expect(removed).toContainEqual({ type: 'scroll', capture: true })
    expect(removed).toHaveLength(added.length)
  })

  it('отключает наблюдатель размера', () => {
    const disconnect = vi.fn()
    const observe = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = observe
        disconnect = disconnect
      },
    )

    const stop = watchLayout(() => {})
    expect(observe).toHaveBeenCalledTimes(1)

    stop()
    expect(disconnect).toHaveBeenCalledTimes(1)

    vi.unstubAllGlobals()
  })

  it('без ResizeObserver подписка всё равно поднимается и снимается', () => {
    vi.stubGlobal('ResizeObserver', undefined)

    // Наблюдателя размера нет не везде: без него остаётся прокрутка, и это
    // лучше, чем упавший слой меток.
    const stop = watchLayout(() => {})
    expect(() => stop()).not.toThrow()
    expect(removed).toContainEqual({ type: 'scroll', capture: true })

    vi.unstubAllGlobals()
  })
})

/*
 * Пересчёт долей в пиксели кадра.
 *
 * Эти функции нужны отчёту: у вырезки нет элемента в DOM, а метка обязана встать
 * туда же, куда слой меток ставит её на живой странице. Значит расчёт обязан быть
 * ОДИН — здесь проверяется, что `restoreRect`/`restorePoint` действительно ходят
 * через него и отличаются от него ровно сдвигом на угол элемента.
 */

describe('rectFromBox и pointFromBox', () => {
  it('переводит доли в пиксели кадра от его угла', () => {
    const box = { w: 200, h: 100 }
    const got = rectFromBox({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, box)

    expect(got.x).toBe(50)
    expect(got.y).toBe(50)
    expect(got.width).toBe(100)
    expect(got.height).toBe(25)
  })

  it('точка даёт вырожденный прямоугольник нулевого размера', () => {
    // Форма ответа та же, что у рамки: потребителю нужен один тип на оба случая,
    // а размер самой метки задают стили, а не геометрия.
    const got = pointFromBox({ x: 0.5, y: 0.2 }, { w: 200, h: 100 })

    expect(got.x).toBe(100)
    expect(got.y).toBe(20)
    expect(got.width).toBe(0)
    expect(got.height).toBe(0)
  })

  it('нулевой кадр не отбрасывается: у кадра вырезки скрытости не бывает', () => {
    // `null` при нулевом размере — свойство ЖИВОГО элемента (`display: none`),
    // и эта ветка живёт в `restoreRect`. Чистая арифметика на нулевом кадре
    // обязана честно вернуть нули, а не выдумывать отказ.
    const got = rectFromBox({ x: 0.5, y: 0.5, w: 1, h: 1 }, { w: 0, h: 0 })

    expect(got.width).toBe(0)
    expect(got.height).toBe(0)
  })
})

describe('restoreRect и restorePoint поверх кадра', () => {
  function elementWith(box: { left: number; top: number; width: number; height: number }): Element {
    const el = document.createElement('div')
    el.getBoundingClientRect = () =>
      new DOMRect(box.left, box.top, box.width, box.height) as DOMRect
    return el
  }

  it('отличается от расчёта по кадру ровно сдвигом на угол элемента', () => {
    // Несущее свойство: отчёт считает метку `rectFromBox` по кадру вырезки,
    // экран — `restoreRect` по живому элементу. Разойдись эти два расчёта хоть
    // в чём-то кроме сдвига, номер на бумаге указывал бы не на то место,
    // что номер на экране.
    const rect = { x: 0.25, y: 0.5, w: 0.5, h: 0.25 }
    const el = elementWith({ left: 30, top: 70, width: 200, height: 100 })

    const onScreen = restoreRect(rect, el)
    const inFrame = rectFromBox(rect, { w: 200, h: 100 })

    expect(onScreen).not.toBeNull()
    expect(onScreen?.x).toBe(30 + inFrame.x)
    expect(onScreen?.y).toBe(70 + inFrame.y)
    expect(onScreen?.width).toBe(inFrame.width)
    expect(onScreen?.height).toBe(inFrame.height)
  })

  it('точка сдвигается так же и остаётся нулевого размера', () => {
    const point = { x: 0.5, y: 0.2 }
    const el = elementWith({ left: 30, top: 70, width: 200, height: 100 })

    const onScreen = restorePoint(point, el)

    expect(onScreen?.x).toBe(130)
    expect(onScreen?.y).toBe(90)
    expect(onScreen?.width).toBe(0)
  })

  it('скрытый элемент по-прежнему даёт null, а не нулевой прямоугольник', () => {
    // Поведение не менялось при переписывании через `rectFromBox`: «нечего
    // рисовать» и «нарисовать точку в углу экрана» — разные вещи.
    const el = elementWith({ left: 0, top: 0, width: 0, height: 0 })

    expect(restoreRect({ x: 0, y: 0, w: 1, h: 1 }, el)).toBeNull()
    expect(restorePoint({ x: 0, y: 0 }, el)).toBeNull()
  })
})
