import { describe, expect, it } from 'vitest'

import type { Entry } from 'shared/model/format'
import type { Cutout } from 'shared/model/layer'
import { markUp } from './mark'
import type { ShowWindow } from './window'

/*
 * Метка поверх вырезки.
 *
 * Проверяются два несущих свойства.
 *
 * Первое: метка считается от ЯКОРЯ внутри кадра, а не от всего кадра. Кадр
 * замечания шире якоря — без окрестности «это убрать» не опознать, — и
 * подстановка долей в размер всего кадра промахнулась бы ровно у того типа
 * записи, весь смысл которого «вот это здесь».
 *
 * Второе: геометрия отдаётся в ПРОЦЕНТАХ окна показа, а не в пикселях кадра.
 * Метка переехала наружу масштабируемого узла, потому что её рамка в 2 px при
 * масштабе ≈0.1 печаталась как 0.2 px и исчезала с бумаги. Проценты не зависят
 * от масштаба, поэтому метка остаётся на месте, а рамка — настоящей.
 *
 * Окно сюда передаётся ГОТОВЫМ, а не считается `windowOf`: так эти проверки
 * ловят арифметику метки, а не запас окна, который живёт и меняется отдельно
 * (его проверяет `window.test.ts`). Обе части встречаются на сборке документа,
 * и там их проверяет `report.test.ts` — стык не остаётся ничьим.
 */

function entryOf(over: Partial<Entry>): Entry {
  return {
    id: 'e1',
    type: 'comment',
    route: '/',
    path: 'main > p',
    tag: 'p',
    was: 'Было так',
    now: 'Убрать это',
    style: {},
    nearestHeading: '',
    contextBefore: '',
    contextAfter: '',
    occurrencesOnPage: 1,
    wasHtml: '<p>Было так</p>',
    anchor: { selector: 'p', xpath: '/html/body/p', snippet: 'Было так', index: 0 },
    viewport: { w: 1440, h: 900 },
    at: '2026-09-06T10:00:00.000Z',
    ...over,
  }
}

/** Кадр 900×600, якорь 320×40 со смещением 200/150 внутри него. */
function wideCutout(): Cutout {
  return {
    html: '<p>Было так</p>',
    width: 900,
    height: 600,
    // Полоса описью не читается: она посчитана под прежнюю широкую колонку.
    band: { y: 120, h: 100 },
    anchorBox: { x: 200, y: 150, w: 320, h: 40 },
    fontFaces: [],
    at: '2026-09-06T10:00:00.000Z',
  }
}

/**
 * Окно 560×280 со смещением 80/30 внутри кадра.
 *
 * Начало окна отлично от нуля по ОБЕИМ осям намеренно: при нулевом начале
 * вычитание начала окна ничего не меняет, и ошибка «забыли вычесть» прошла бы
 * насквозь. Вырожденный случай проверяется отдельным тестом, а не вместо этого.
 */
function showWindow(): ShowWindow {
  return { x: 80, y: 30, w: 560, h: 280, scale: 240 / 560 }
}

function pct(html: string, name: string): number {
  const found = new RegExp(`${name}:(-?[\\d.]+)%`).exec(html)
  if (found?.[1] === undefined) throw new Error(`нет ${name} в «${html}»`)
  return Number(found[1])
}

describe('markUp', () => {
  it('рамка считается от ЯКОРЯ и переводится в проценты ОКНА', () => {
    // Доля 0.5/0.25 от якоря 320×40 — это 160/10 внутри якоря, плюс смещение
    // якоря 200/150 в кадре. Считай мы от кадра 900×600, вышло бы 450/150 — мимо.
    const entry = entryOf({ rect: { x: 0.5, y: 0.25, w: 0.25, h: 0.5 } })

    const html = markUp(entry, 4, wideCutout(), showWindow())

    // (200 + 160 − 80) / 560 и (150 + 10 − 30) / 280.
    expect(pct(html, 'left')).toBeCloseTo(50, 2)
    expect(pct(html, 'top')).toBeCloseTo(46.43, 2)
    // 80 / 560 и 20 / 280.
    expect(pct(html, 'width')).toBeCloseTo(14.29, 2)
    expect(pct(html, 'height')).toBeCloseTo(7.14, 2)
  })

  it('в геометрии метки нет пикселей кадра вовсе', () => {
    // Прямая проверка причины переезда: пиксель, оставшийся в координате, снова
    // поехал бы вместе с масштабом, и метка разъехалась бы с картинкой.
    const html = markUp(
      entryOf({ rect: { x: 0.5, y: 0.25, w: 0.25, h: 0.5 } }),
      4,
      wideCutout(),
      showWindow(),
    )

    expect(/(?:left|top|width|height):[^;"]*px/.test(html)).toBe(false)
  })

  it('указатель считается так же и несёт номер записи', () => {
    const entry = entryOf({ point: { x: 0.5, y: 0.5 } })

    const html = markUp(entry, 12, wideCutout(), showWindow())

    expect(html).toContain('mark--point')
    // (200 + 160 − 80) / 560 и (150 + 20 − 30) / 280.
    expect(pct(html, 'left')).toBeCloseTo(50, 2)
    expect(pct(html, 'top')).toBeCloseTo(50, 2)
    // Размеров у указателя здесь нет: кружок задан документом в печатных
    // пикселях, иначе он снова ужимался бы вместе с картинкой.
    expect(html).not.toContain('width:')
    // Номер — единственная ниточка между бумагой и экраном.
    expect(html).toContain('>12<')
  })

  it('у правки текста обводится сам якорь целиком', () => {
    // Своей геометрии у неё нет: правился сам элемент, и обвести надо его.
    const entry = entryOf({ type: 'text-override' })

    const html = markUp(entry, 1, wideCutout(), showWindow())

    // (200 − 80) / 560 и (150 − 30) / 280; 320 / 560 и 40 / 280.
    expect(pct(html, 'left')).toBeCloseTo(21.43, 2)
    expect(pct(html, 'top')).toBeCloseTo(42.86, 2)
    expect(pct(html, 'width')).toBeCloseTo(57.14, 2)
    expect(pct(html, 'height')).toBeCloseTo(14.29, 2)
  })

  it('у вырожденного якоря метки нет вовсе', () => {
    // Нулевая метка в углу хуже её отсутствия: читатель принял бы её
    // за указание на угол.
    const cutout = { ...wideCutout(), anchorBox: { x: 0, y: 0, w: 0, h: 0 } }

    expect(
      markUp(entryOf({ rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } }), 1, cutout, showWindow()),
    ).toBe('')
  })

  it('у вырожденного окна метки нет вовсе', () => {
    // Делить на ноль нечем, а метка в пустом превью всё равно ничего не отметит.
    const empty: ShowWindow = { x: 0, y: 0, w: 0, h: 0, scale: 1 }

    expect(
      markUp(entryOf({ rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } }), 1, wideCutout(), empty),
    ).toBe('')
  })
})
