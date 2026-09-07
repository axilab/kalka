import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { entryStore } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import { findEntryFor } from './find'

/*
 * Вложенная цель внутри уже правленого элемента.
 *
 * До вехи «правка текста в кнопках и ссылках» кликнутый узел и элемент записи
 * совпадали ВСЕГДА: подъём доводил цель до того же элемента, на котором висит
 * правка. Граница правки это ломает — в `<p>Смотри <a>прайс</a> здесь</p>`
 * с уже внесённой правкой АБЗАЦА клик приходит на ссылку.
 *
 * Хуже всего в трёх случаях, где метки наложения законно нет и работает шаг 2:
 * режим «оригинал» (FR-21), запись `style-wish` и статус `lost`. Шаг 2 сверял
 * элементы строго, разрешённый абзац кликнутой ссылке не равен, запись
 * не находилась — и `captureDraft` заводил ВТОРУЮ, вложенную запись на то же
 * место. Прямое нарушение FR-10, ради которого шаг 2 и написан.
 */

const ROUTE = `${location.pathname}${location.hash}`

function entryOf(over: Partial<Entry> & Pick<Entry, 'id' | 'was'>): Entry {
  return {
    type: 'text-override',
    route: ROUTE,
    path: 'main > p',
    tag: 'p',
    wasHtml: over.was,
    now: 'правленый текст',
    style: {},
    nearestHeading: '',
    contextBefore: '',
    contextAfter: '',
    occurrencesOnPage: 1,
    anchor: { selector: '#абзац', xpath: '', snippet: over.was, index: 0 },
    viewport: { w: 1440, h: 900 },
    at: '2026-09-07T10:00:00.000Z',
    ...over,
  }
}

let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  entryStore.seed([])
})

afterEach(() => {
  entryStore.seed([])
  host.remove()
})

describe('findEntryFor: клик внутри правленого элемента', () => {
  beforeEach(() => {
    host.innerHTML = '<p id="абзац">Смотри <a id="ссылка">прайс</a> здесь</p>'
  })

  it('шаг 1: метка на предке отдаёт запись ВМЕСТЕ с элементом записи', () => {
    const абзац = host.querySelector('#абзац') as Element
    абзац.setAttribute('data-kalka-applied', 'абзац')
    entryStore.seed([entryOf({ id: 'абзац', was: 'Смотри прайс здесь' })])

    const found = findEntryFor(host.querySelector('#ссылка') as Element)

    expect(found?.entry.id).toBe('абзац')
    // Элемент — АБЗАЦ, а не кликнутая ссылка: по нему меряется окно, берётся
    // шрифт и считается признак простого текста.
    expect(found?.element).toBe(абзац)
  })

  it('шаг 2: запись без метки находится по клику внутрь неё', () => {
    // Метки нет — так выглядит режим «оригинал», запись `style-wish` и статус
    // `lost`. Именно здесь без послабления заводилась вторая запись.
    entryStore.seed([entryOf({ id: 'абзац', was: 'Смотри прайс здесь' })])

    const found = findEntryFor(host.querySelector('#ссылка') as Element)

    expect(found?.entry.id).toBe('абзац')
    expect(found?.element).toBe(host.querySelector('#абзац'))
  })

  it('шаг 2 у записи style-wish ведёт себя так же', () => {
    entryStore.seed([
      entryOf({
        id: 'абзац',
        was: 'Смотри прайс здесь',
        type: 'style-wish',
        now: '',
        style: { color: '#c8362a' },
      }),
    ])

    const found = findEntryFor(host.querySelector('#ссылка') as Element)

    expect(found?.entry.id).toBe('абзац')
  })

  it('клик по абзацу, внутри которого правлена ТОЛЬКО ссылка, заводит новую запись', () => {
    /*
     * Невырожденная пара, и послабление здесь запрещено: правка на ссылке
     * не имеет права перехватывать клик по абзацу вокруг неё. Там правка ещё
     * не вносилась, и человек ждёт новую запись.
     */
    entryStore.seed([
      entryOf({
        id: 'ссылка',
        tag: 'a',
        was: 'прайс',
        anchor: { selector: '#ссылка', xpath: '', snippet: 'прайс', index: 0 },
      }),
    ])

    expect(findEntryFor(host.querySelector('#абзац') as Element)).toBeNull()
  })
})
