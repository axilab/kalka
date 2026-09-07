import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { entryStore } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import { normalize } from 'shared/lib/normalize'
import { applyLayer, revertLayer } from './engine'

/*
 * Движок наложения: текстовый путь против пути разметки.
 *
 * В `src/app/lib/overlay/` не было НИ ОДНОГО тестового файла — ни для
 * `engine.ts`, ни для `mutations.ts`, ни для `navigation.ts`. Обвязка заводится
 * здесь, и она не бесплатна: движок тянет `entryStore`, `MutationObserver`,
 * `history` и `sanitizeHtml`.
 *
 * Проход гоняется целиком через `applyLayer(document)`, а не через внутреннюю
 * `applyToElement`: та наружу не торчит, а идемпотентность и уборка следов —
 * свойства именно прохода. Записи ложатся в настоящий `entryStore`, поэтому
 * каждый тест его чистит.
 *
 * ── Что здесь проверяется прежде всего ──────────────────────────────────────
 *
 * НЕОБРАТИМАЯ ПОТЕРЯ ЧУЖОЙ ВЁРСТКИ. Путь разметки сам приводит кнопку
 * со счётчиком к виду без детей-элементов (белый список санитайзера `<span>`
 * не пропускает). Считай движок путь по живому элементу — второй проход ушёл бы
 * на текстовый, и `<span class="count">` не вернулся бы ни при переприменении,
 * ни при снятии слоя. Ошибка проходит зелёной везде, кроме этого теста.
 */

/** Маршрут текущей страницы: записи чужого маршрута движок не накладывает. */
const ROUTE = `${location.pathname}${location.hash}`

function entryOf(over: Partial<Entry> & Pick<Entry, 'id' | 'was' | 'wasHtml' | 'now'>): Entry {
  return {
    type: 'text-override',
    route: ROUTE,
    path: 'main > el',
    tag: 'p',
    style: {},
    nearestHeading: '',
    contextBefore: '',
    contextAfter: '',
    occurrencesOnPage: 1,
    anchor: { selector: '#цель', xpath: '', snippet: over.was, index: 0 },
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
  entryStore.setShowOriginal(false)
})

afterEach(() => {
  revertLayer(document)
  entryStore.seed([])
  host.remove()
})

/** Текст цели с нормализованными пробелами: сравнивать сырой `textContent` нельзя. */
function текстЦели(): string {
  return normalize(document.querySelector('#цель')?.textContent ?? '')
}

describe('наложение правки кнопки со значком', () => {
  beforeEach(() => {
    host.innerHTML = '<button id="цель"><svg id="значок"></svg>Оформить заказ</button>'
    entryStore.seed([
      entryOf({
        id: 'кнопка',
        tag: 'button',
        was: 'Оформить заказ',
        wasHtml: '<svg id="значок"></svg>Оформить заказ',
        now: 'Купить сейчас',
      }),
    ])
  })

  it('после наложения текст сменился, а значок остался', () => {
    applyLayer(document)

    expect(текстЦели()).toBe('Купить сейчас')
    // Проверяется не только подставленное, но и УЦЕЛЕВШЕЕ: правило
    // профилактики патча 2026-09-06-21.55.
    expect(document.querySelector('#значок')).not.toBeNull()
  })

  it('снятие слоя возвращает текст, значок по-прежнему на месте', () => {
    applyLayer(document)
    revertLayer(document)

    expect(текстЦели()).toBe('Оформить заказ')
    expect(document.querySelector('#значок')).not.toBeNull()
    expect(document.querySelector('[data-kalka-applied]')).toBeNull()
  })

  it('двойной проход даёт тот же DOM, что и одинарный', () => {
    applyLayer(document)
    const послеПервого = document.querySelector('#цель')?.innerHTML

    applyLayer(document)

    expect(document.querySelector('#цель')?.innerHTML).toBe(послеПервого)
  })

  it('снятие записи из хранилища возвращает текст, не трогая значок', () => {
    applyLayer(document)
    // Запись удалена: `wasHtml` взять уже неоткуда, восстанавливает память
    // движка — и она же помнит ПРИНЯТОЕ решение о пути.
    entryStore.seed([])

    applyLayer(document)

    expect(текстЦели()).toBe('Оформить заказ')
    expect(document.querySelector('#значок')).not.toBeNull()
    expect(document.querySelector('[data-kalka-applied]')).toBeNull()
  })
})

describe('обычный абзац: путь разметки не изменился', () => {
  it('разметка правки доходит до страницы, оригинал возвращается целиком', () => {
    host.innerHTML = '<p id="цель">обычный <strong>абзац</strong> с разметкой</p>'
    entryStore.seed([
      entryOf({
        id: 'абзац',
        was: 'обычный абзац с разметкой',
        wasHtml: 'обычный <strong>абзац</strong> с разметкой',
        now: 'правленый <b>абзац</b> с разметкой',
      }),
    ])

    applyLayer(document)

    // Невырожденная пара к случаю кнопки: поведение обязано остаться дословно
    // прежним, иначе веха сломала бы почти все правки ради нового случая.
    expect(document.querySelector('#цель b')).not.toBeNull()
    expect(текстЦели()).toBe('правленый абзац с разметкой')

    revertLayer(document)

    expect(document.querySelector('#цель strong')).not.toBeNull()
    expect(текстЦели()).toBe('обычный абзац с разметкой')
  })
})

describe('кнопка со счётчиком: два прохода подряд', () => {
  beforeEach(() => {
    // Счётчик в `<b>`, а НЕ в `<span>`, как на боевом прототипе, и это
    // вынужденная замена, а не небрежность. `<span>` белый список санитайзера
    // не пропускает, и `restore` разворачивает его в текст ещё до вехи —
    // то есть на `<span>` разницы между двумя путями просто не видно, и тест
    // был бы зелёным при любой реализации. `<b>` в белом списке есть, поэтому
    // путь разметки его ВОЗВРАЩАЕТ, а текстовый — нет. См. также «Пределы»
    // ниже: потеря `<span>` из `wasHtml` — отдельный, более старый дефект.
    host.innerHTML = '<button id="цель">Купить <b>3</b></button>'
    entryStore.seed([
      entryOf({
        id: 'счётчик',
        tag: 'button',
        was: 'Купить 3',
        wasHtml: 'Купить <b>3</b>',
        now: 'Добавить 3',
      }),
    ])
  })

  it('второй проход остаётся на пути разметки, а снятие слоя возвращает вёрстку', () => {
    applyLayer(document)

    /*
     * После первого прохода детей-элементов у кнопки НЕТ: `now` тегов
     * не содержит, и живой элемент стал `<button>Добавить 3</button>`.
     * Спроси движок путь у живого элемента сейчас — он ответит «текстовый»,
     * и всё дальнейшее восстановление пошло бы мимо `wasHtml`.
     */
    expect(document.querySelector('#цель b')).toBeNull()

    applyLayer(document)
    revertLayer(document)

    // Страница вернулась к исходному виду ЦЕЛИКОМ, а не только текстом
    // (NFR-06). Без этой проверки ошибка ловится только глазами на боевом
    // прототипе.
    expect(document.querySelector('#цель b')?.textContent).toBe('3')
    expect(текстЦели()).toBe('Купить 3')
  })

  it('удалённая запись восстанавливает вёрстку из памяти движка', () => {
    applyLayer(document)
    entryStore.seed([])

    applyLayer(document)

    // У удалённой записи `wasHtml` взять уже неоткуда, и решение о пути
    // пересчитать не по чему: память движка хранит его ПРИНЯТЫМ.
    expect(document.querySelector('#цель b')?.textContent).toBe('3')
  })
})

/*
 * ── Предел, который веха НЕ трогает и трогать не имеет права ────────────────
 *
 * `restore` возвращает оригинал через `sanitizeHtml(entry.wasHtml)`, то есть
 * через тот же белый список `B/STRONG/I/EM/A/UL/OL/LI/BR`, что и текст правки.
 * Значит `<span class="count">` из ИСХОДНОЙ вёрстки носителя не возвращается
 * и до вехи: он разворачивается в собственный текст, и после снятия слоя
 * на странице остаётся `<button>Купить 3</button>`.
 *
 * Это более старый дефект, чем разбираемая веха, и лечится он не здесь:
 * `wasHtml` — снимок чужой разметки, а не текст правки, и прогонять его через
 * список, написанный для `now`, неверно по существу. Но `wasHtml` приезжает
 * и из чужого файла обмена, поэтому «просто не санитизировать» нельзя —
 * решение нужно отдельное и осознанное.
 *
 * Тест ниже фиксирует предел как он есть, чтобы починка не прошла незамеченной
 * и чтобы никто не принял его за поломку этой вехи.
 */
describe('предел: белый список съедает вёрстку из wasHtml', () => {
  it('span из оригинала после снятия слоя не возвращается', () => {
    host.innerHTML = '<button id="цель">Купить <span class="count">3</span></button>'
    entryStore.seed([
      entryOf({
        id: 'спан',
        tag: 'button',
        was: 'Купить 3',
        wasHtml: 'Купить <span class="count">3</span>',
        now: 'Добавить 3',
      }),
    ])

    applyLayer(document)
    revertLayer(document)

    // Текст цел, вёрстка — нет. Дефект старше вехи и её решением не является.
    expect(текстЦели()).toBe('Купить 3')
    expect(document.querySelector('#цель .count')).toBeNull()
  })
})

describe('совместимость с правками, сохранёнными до вехи', () => {
  it('разметка в now на текстовом пути показывается чистым текстом', () => {
    host.innerHTML = '<a id="цель" href="/prices">Перейти к прайсу</a>'
    entryStore.seed([
      entryOf({
        id: 'ссылка',
        tag: 'a',
        was: 'Перейти к прайсу',
        wasHtml: 'Перейти к прайсу',
        // Запись снята ДО вехи: тогда ссылка правилась путём разметки.
        now: 'Перейти <b>к прайсу</b>',
      }),
    ])

    applyLayer(document)

    // Видимых угловых скобок на странице быть не должно.
    expect(текстЦели()).toBe('Перейти к прайсу')
    expect(document.querySelector('#цель')?.innerHTML).not.toContain('&lt;b&gt;')
  })

  it('запись без тегов проходит насквозь без изменений', () => {
    host.innerHTML = '<a id="цель" href="/prices">Перейти к прайсу</a>'
    entryStore.seed([
      entryOf({
        id: 'ссылка',
        tag: 'a',
        was: 'Перейти к прайсу',
        wasHtml: 'Перейти к прайсу',
        now: 'Открыть прайс',
      }),
    ])

    applyLayer(document)

    expect(текстЦели()).toBe('Открыть прайс')
  })
})
