import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { captureCutout, makeCutout } from './capture'
import { cutoutBuffer } from './buffer'

/*
 * Стык съёмки и заморозки движения.
 *
 * Заморозка живёт в `shared/lib/dom.ts`, съёмка — здесь, и проверять их надо
 * на ОБОИХ уровнях: правило профилактики патча 2026-09-06-21.55 про дефект
 * на стыке слайсов. Сама `freezeMotion` проверяется в `shared/lib/dom.test.ts`;
 * здесь — что она вообще зовётся, зовётся на ОБОИХ входах съёмки и снимается
 * даже тогда, когда съёмка бросила.
 *
 * Признак заморозки — собственный `<style>` в `<head>` носителя: он ставится
 * на время съёмки и обязан исчезнуть после неё.
 */

const FREEZE = 'style[data-kalka-freeze-style]'

let host: HTMLDivElement

/** Ненулевой bounding box: jsdom сам размеров не считает. */
function sized(el: Element, w: number, h: number): Element {
  el.getBoundingClientRect = () => new DOMRect(0, 0, w, h)
  return el
}

function place(): Element {
  host.innerHTML =
    '<section style="background-color: rgb(255, 255, 255)">' +
    '<p style="color: rgb(20, 20, 20)">Строка</p></section>'
  sized(host.firstElementChild as Element, window.innerWidth, 300)
  return sized(host.querySelector('p') as Element, 320, 40)
}

beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  cutoutBuffer.clear()
})

afterEach(() => {
  vi.useRealTimers()
  host.remove()
  document.head.querySelector(FREEZE)?.remove()
  vi.restoreAllMocks()
})

describe('заморозка на время съёмки', () => {
  it('синхронный вход makeCutout проходит через заморозку и снимает её', () => {
    const el = place()
    let былаВоВремяСъёмки = false

    // Подсмотреть заморозку можно только изнутри съёмки: снаружи она уже снята.
    const measure = el.getBoundingClientRect.bind(el)
    el.getBoundingClientRect = (): DOMRect => {
      былаВоВремяСъёмки ||= document.head.querySelector(FREEZE) !== null
      return measure()
    }

    expect(makeCutout({ anchor: el, wide: false })).not.toBeNull()

    expect(былаВоВремяСъёмки).toBe(true)
    expect(document.head.querySelector(FREEZE)).toBeNull()
  })

  it('отложенный вход captureCutout проходит через ту же заморозку', () => {
    /*
     * Второй вход обязан быть проверен отдельно: поставь заморозку в одном
     * из двух, и второй молча останется без неё. Отсрочка здесь тоже
     * не ловушка — `setTimeout` зовёт `shoot` уже внутри.
     */
    const el = place()
    let былаВоВремяСъёмки = false

    const measure = el.getBoundingClientRect.bind(el)
    el.getBoundingClientRect = (): DOMRect => {
      былаВоВремяСъёмки ||= document.head.querySelector(FREEZE) !== null
      return measure()
    }

    captureCutout({ entryId: 'c1', anchor: el, wide: false })
    vi.runAllTimers()

    expect(былаВоВремяСъёмки).toBe(true)
    expect(document.head.querySelector(FREEZE)).toBeNull()
  })

  it('исключение внутри съёмки всё равно снимает заморозку целиком', () => {
    // Невырожденная пара к успешному проходу. Без `try/finally` страница
    // осталась бы с нашим правилом `transition: none` в чужом `<head>`
    // навсегда — и никто бы этого не заметил.
    const el = place()
    el.getBoundingClientRect = (): DOMRect => {
      throw new Error('носитель сломался посреди замера')
    }

    expect(() => makeCutout({ anchor: el, wide: false })).toThrow()
    expect(document.head.querySelector(FREEZE)).toBeNull()
  })
})
