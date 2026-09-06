import { describe, expect, it } from 'vitest'

import type { Entry } from 'shared/model/format'
import type { Cutout } from 'shared/model/layer'
import { markUp } from './mark'

/*
 * Метка поверх вырезки.
 *
 * Проверяется одно несущее свойство: метка считается от ЯКОРЯ внутри кадра,
 * а не от всего кадра. Кадр замечания шире якоря — без окрестности «это убрать»
 * не опознать, — и подстановка долей в размер всего кадра промахнулась бы ровно
 * у того типа записи, весь смысл которого «вот это здесь».
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

/** Широкий кадр 600×300, якорь 320×40 со смещением 40/60 внутри него. */
function wideCutout(): Cutout {
  return {
    html: '<p>Было так</p>',
    width: 600,
    height: 300,
    // Полоса охватывает якорь с запасом 30px сверху и снизу.
    band: { y: 30, h: 100 },
    anchorBox: { x: 40, y: 60, w: 320, h: 40 },
    fontFaces: [],
    at: '2026-09-06T10:00:00.000Z',
  }
}

function px(html: string, name: string): number {
  const found = new RegExp(`${name}:(-?\\d+)px`).exec(html)
  if (found?.[1] === undefined) throw new Error(`нет ${name} в «${html}»`)
  return Number(found[1])
}

describe('markUp', () => {
  it('рамка считается от ЯКОРЯ и сдвигается на его место в кадре', () => {
    // Доля 0.5/0.25 от якоря 320×40 — это 160/10 внутри якоря, плюс смещение
    // якоря 40/60. Считай мы от кадра 600×300, вышло бы 300/75 — мимо.
    const entry = entryOf({ rect: { x: 0.5, y: 0.25, w: 0.25, h: 0.5 } })

    const html = markUp(entry, 4, wideCutout())

    expect(px(html, 'left')).toBe(40 + 160)
    expect(px(html, 'top')).toBe(60 + 10)
    expect(px(html, 'width')).toBe(80)
    expect(px(html, 'height')).toBe(20)
  })

  it('указатель считается так же и несёт номер записи', () => {
    const entry = entryOf({ point: { x: 0.5, y: 0.5 } })

    const html = markUp(entry, 12, wideCutout())

    expect(html).toContain('mark--point')
    expect(px(html, 'left')).toBe(40 + 160)
    expect(px(html, 'top')).toBe(60 + 20)
    // Номер — единственная ниточка между бумагой и экраном.
    expect(html).toContain('>12<')
  })

  it('у правки текста обводится сам якорь целиком', () => {
    // Своей геометрии у неё нет: правился сам элемент, и обвести надо его.
    const entry = entryOf({ type: 'text-override' })

    const html = markUp(entry, 1, wideCutout())

    expect(px(html, 'left')).toBe(40)
    expect(px(html, 'top')).toBe(60)
    expect(px(html, 'width')).toBe(320)
    expect(px(html, 'height')).toBe(40)
  })

  it('у вырожденного якоря метки нет вовсе', () => {
    // Нулевая метка в углу хуже её отсутствия: читатель принял бы её
    // за указание на угол.
    const cutout = { ...wideCutout(), anchorBox: { x: 0, y: 0, w: 0, h: 0 } }

    expect(markUp(entryOf({ rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } }), 1, cutout)).toBe('')
  })
})
