import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cutoutBuffer } from 'entities/cutout'
import { entryStore } from 'entities/entry'
import type { Entry, EntryType } from 'shared/model/format'
import type { Cutout } from 'shared/model/layer'
import { cutoutFor } from './collect'

/*
 * Выбор источника картинки места правки.
 *
 * Тесты живут ЗДЕСЬ, а не в `entities/cutout`: сбор берёт запись из
 * `entities/entry` и вырезку из `entities/cutout` — соседние слайсы одного
 * слоя, друг друга они не видят. Общая точка сборки лежит слоем выше.
 *
 * ── Главное здесь — вторая дверь в печатный документ ────────────────────────
 *
 * До съёмки в момент отчёта дверь была одна: буфер, куда кладёт только
 * `captureCutout` и только после самопроверки. Теперь появилась вторая, мимо
 * буфера, и обещание «ни одна кривая вырезка не попала в напечатанный
 * документ» держится на двух замках вместо одного. Проверяются оба.
 */

function bufferedCutout(): Cutout {
  return {
    html: '<p>Из буфера</p>',
    width: 320,
    height: 40,
    band: { y: 0, h: 40 },
    anchorBox: { x: 0, y: 0, w: 320, h: 40 },
    fontFaces: [],
    at: '2026-09-06T10:00:00.000Z',
  }
}

function entryOf(id: string, type: EntryType): Entry {
  return {
    id,
    type,
    route: '/',
    path: 'main > p',
    tag: 'p',
    was: 'Было так',
    now: type === 'comment' ? 'Это убрать' : 'Стало так',
    style: {},
    nearestHeading: '',
    contextBefore: '',
    contextAfter: '',
    occurrencesOnPage: 1,
    // `wasHtml` это innerHTML элемента, а не его outerHTML: так его снимает
    // `captureDraft`, и так же его подставляет движок наложения.
    // У замечания он пуст всегда (решение 5 вехи машиночитаемости).
    wasHtml: type === 'comment' ? '' : 'Было <b>так</b>',
    anchor: { selector: 'p', xpath: '/html/body/p', snippet: 'Было так', index: 0 },
    viewport: { w: 1440, h: 900 },
    at: '2026-09-06T10:00:00.000Z',
  }
}

let host: HTMLDivElement

/** Ненулевой bounding box: jsdom сам размеров не считает. */
function sized(el: Element, box: { w: number; h: number }): Element {
  el.getBoundingClientRect = () => new DOMRect(0, 0, box.w, box.h)
  return el
}

/**
 * Кладёт на страницу секцию с абзацем и публикует абзац как найденное место
 * записи — ровно так, как это делает движок наложения.
 *
 * Секция шириной с окно и втрое выше абзаца: съёмка берёт кадр во всю ширину
 * страницы, а по вертикали показывает полосу вокруг якоря.
 */
function place(entry: Entry, style = 'color: rgb(20, 20, 20)'): Element {
  host.innerHTML = `<section style="background-color: rgb(255, 255, 255)"><p style="${style}">Стало так</p></section>`
  // Секция шириной с окно: съёмка поднимается до предка во всю ширину, и кадром
  // должна оказаться именно она, а не абзац.
  sized(host.firstElementChild as Element, { w: window.innerWidth, h: 300 })
  const el = sized(host.querySelector('p') as Element, { w: 320, h: 40 })

  entryStore.seed([entry])
  entryStore.setStatus(entry.id, 'applied', 'selector', el)
  return el
}

beforeEach(() => {
  localStorage.clear()
  entryStore.seed([])
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  host.remove()
  vi.restoreAllMocks()
})

describe('cutoutFor', () => {
  it('буфер имеет приоритет над съёмкой на месте', () => {
    // Снятое в момент правки заведомо показывает ИСХОДНОЕ состояние места:
    // элемент тогда ещё не был тронут слоем, догадок не потребовалось,
    // и вырезка уже прошла самопроверку. Точное лучше восстановленного.
    const entry = entryOf('t1', 'text-override')
    place(entry)
    cutoutBuffer.put(entry.id, bufferedCutout())

    const cutout = cutoutFor(entry, document)

    expect(cutout?.html).toBe('<p>Из буфера</p>')
  })

  it('при пустом буфере вырезка снимается по элементу из хранилища', () => {
    const entry = entryOf('t1', 'text-override')
    place(entry)

    const cutout = cutoutFor(entry, document)

    expect(cutout).not.toBeNull()
    expect(cutout?.html).toContain('Было <b>так</b>')
  })

  it('снятое на месте в буфер НЕ пишется', () => {
    // Буфер существует ради записей с ДРУГИХ страниц. Место, найденное здесь,
    // доступно, пока страница открыта: писать его в буфер значило бы ускорять
    // вытеснение по потолку ровно тех вырезок, ради которых буфер и заведён.
    const entry = entryOf('t1', 'text-override')
    place(entry)

    expect(cutoutFor(entry, document)).not.toBeNull()
    expect(cutoutBuffer.has(entry.id)).toBe(false)
  })

  it('запись без найденного элемента даёт null, а не бросок', () => {
    // Это запись с ДРУГОЙ страницы: снимать её нечем, в текущем DOM её места
    // не существует. Отчёт покажет текст с пометкой.
    const entry = entryOf('t1', 'text-override')
    entryStore.seed([entry])
    entryStore.setStatus(entry.id, 'lost')

    expect(cutoutFor(entry, document)).toBeNull()
  })

  it('оторванный от документа элемент даёт null, а не бросок', () => {
    // Носитель мог перерисовать блок между проходом наложения и печатью —
    // хранилище об этом прямо предупреждает. Оторванный узел размеров не имеет,
    // и вырезка вышла бы пустой, то есть картинкой, которая врёт.
    const entry = entryOf('t1', 'text-override')
    const el = place(entry)
    el.remove()

    expect(cutoutFor(entry, document)).toBeNull()
  })

  it('элемент, не прошедший самопроверку, картинки не даёт', () => {
    // ГЛАВНЫЙ тест файла. Съёмка в момент отчёта — вторая дверь в печатный
    // документ, и замок на ней тот же: белым по белому даёт контраст 1.00
    // и бракуется. Разберись эта дверь однажды на рефакторинге — заголовок
    // поверх фотографии молча приехал бы на бумагу нечитаемым, и заметили бы
    // это глазами.
    const entry = entryOf('t1', 'text-override')
    place(entry, 'color: rgb(255, 255, 255)')

    expect(cutoutFor(entry, document)).toBeNull()
  })

  it('у правки текста в разметку попадает «было», а не «стало»', () => {
    // Элемент несёт `now`, а на картинке должно быть исходное состояние места.
    const entry = entryOf('t1', 'text-override')
    place(entry)

    const html = cutoutFor(entry, document)?.html ?? ''

    // Вложенная разметка «было» доезжает как есть — со своим видом браузера
    // и без вкомпилированных стилей: оговорка записана в шапке `build.ts`.
    expect(html).toContain('Было <b>так</b>')
    expect(html).not.toContain('Стало так')
  })

  it('подстановка «было» не стирает окружение места на всём пути съёмки', () => {
    // Регрессия 2026-09-06, найденная глазами на бумаге. Кадр берётся во всю
    // ширину — то есть секцией-предком, — а подстановка «было» шла в корень
    // кадра. Из отчёта выходил голый фон секции с одной строкой в углу,
    // и метка стояла отдельно от неё.
    //
    // Тест живёт ЗДЕСЬ, а не только в `entities/cutout`: дефект родился на
    // стыке — `pageWide` поднимает кадр к предку, а подстановку задаёт этот
    // слой. Проверять надо весь путь, иначе стык снова окажется ничьим.
    //
    // Соседний абзац в секции обязателен: без него терять нечего, и тест
    // «попадает «было», а не «стало»» проходил насквозь мимо дефекта.
    const entry = entryOf('t1', 'text-override')
    host.innerHTML =
      '<section style="background-color: rgb(255, 255, 255)">' +
      '<h2 style="color: rgb(20, 20, 20)">Заголовок секции</h2>' +
      '<p style="color: rgb(20, 20, 20)">Стало так</p>' +
      '<p style="color: rgb(20, 20, 20)">Соседний абзац</p></section>'
    sized(host.firstElementChild as Element, { w: window.innerWidth, h: 300 })
    const el = sized(host.querySelectorAll('p')[0] as Element, { w: 320, h: 40 })
    entryStore.seed([entry])
    entryStore.setStatus(entry.id, 'applied', 'selector', el)

    const html = cutoutFor(entry, document)?.html ?? ''

    expect(html).toContain('Было <b>так</b>')
    expect(html).not.toContain('Стало так')
    // Место узнают по окружению: заголовок над правкой и соседний абзац —
    // единственное, чего нет в строках «Было/Стало» под картинкой.
    expect(html).toContain('Заголовок секции')
    expect(html).toContain('Соседний абзац')
  })

  it('кадр берётся во всю ширину у ЛЮБОЙ записи, а полоса у замечания шире', () => {
    // Пересмотр прежнего правила «узкий кадр у правок текста». Узкий кадр
    // отвечает на «что исправить», но это и так написано строками «Было/Стало»;
    // на «ГДЕ это на странице» отвечает только полоса во всю ширину.
    // От типа записи зависит теперь высота полосы, а не ширина кадра.
    const comment = entryOf('c1', 'comment')
    place(comment)
    const wide = cutoutFor(comment, document)

    const text = entryOf('t1', 'text-override')
    place(text)
    const narrow = cutoutFor(text, document)

    // Кадр один и тот же — предок во всю ширину, а не сам абзац (320px).
    expect(wide?.width).toBe(narrow?.width)
    expect(wide?.width).toBeGreaterThan(320)

    // А окрестности у замечания больше: без неё «это убрать» не значит ничего.
    expect(wide?.band.h).toBeGreaterThan(narrow?.band.h ?? 0)
  })
})
