import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { entryStore } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import { lineOf } from './line'

/*
 * Строка «стало» печатного отчёта — один из двух читателей `now` вне движка.
 *
 * С вехи «правка текста в кнопках и ссылках» у правки границы `now` приходит
 * ТЕКСТОМ, а не разметкой, и разбирать его как HTML перестало быть безопасным.
 * Живого элемента здесь уже нет, поэтому путь восстанавливается по самой
 * записи — по `tag` и `wasHtml`.
 */

const ROUTE = `${location.pathname}${location.hash}`

function entryOf(over: Partial<Entry> & Pick<Entry, 'id' | 'tag' | 'was' | 'wasHtml' | 'now'>): Entry {
  return {
    type: 'text-override',
    route: ROUTE,
    path: 'main > el',
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

beforeEach(() => entryStore.seed([]))
afterEach(() => entryStore.seed([]))

describe('now текстового пути доходит до строки отчёта целиком', () => {
  it('угловые скобки, набранные КАК ЧАСТЬ ТЕКСТА, не съедаются разбором', () => {
    // Рецензент написал имя тега как содержание правки — так бывает
    // на прототипах инструментов для разработчиков.
    const entry = entryOf({
      id: 'кнопка',
      tag: 'button',
      was: 'Оформить заказ',
      wasHtml: '<svg></svg>Оформить заказ',
      now: 'Ставьте <b> вокруг цены',
    })
    entryStore.seed([entry])

    const line = lineOf(entry, document)

    /*
     * До вехи это было безопасно: `now` приходил из `area.innerHTML`, где
     * угловая скобка уже `&lt;`. Теперь `now` сырой, и разбор съел бы `<b>`
     * вместе со всем, что за ним, — в отчёте «стало» оказалось бы обрезанным
     * и молча.
     */
    expect(line.now).toBe('Ставьте <b> вокруг цены')
  })

  it('у обычного абзаца строка отчёта по-прежнему снимает разметку', () => {
    const entry = entryOf({
      id: 'абзац',
      tag: 'p',
      was: 'обычный абзац',
      wasHtml: 'обычный абзац',
      now: 'правленый <b>абзац</b>',
    })
    entryStore.seed([entry])

    expect(lineOf(entry, document).now).toBe('правленый абзац')
  })
})

describe('место записи называет ровно одно поле', () => {
  /*
   * «Было» и дорожка ходят парой и обе сразу не заполняются никогда.
   * Проверяется не только то, что появилось у замечания, но и то, что УЦЕЛЕЛО
   * у соседей: правило идёт по типу записи, а инструмент «Текст» даёт два
   * разных типа, и промахнуться здесь означало бы забрать «было» у пожелания
   * оформления — то есть у записи, где без исходного текста непонятно, чему
   * менять размер.
   */
  it('у замечания место называет ДОРОЖКА, а «было» пусто', () => {
    const entry = entryOf({
      id: 'замечание',
      type: 'comment',
      tag: 'section',
      was: 'Весь текст обведённого блока, все три абзаца подряд',
      wasHtml: '',
      now: 'Этот блок убрать, он дублирует шапку',
      path: 'Продукция → карточка 2 → заголовок',
      rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.3 },
    })

    const line = lineOf(entry, document)

    expect(line.trail).toBe('Продукция → карточка 2 → заголовок')
    expect(line.was).toBe('')
    // Текст замечания приезжает как есть — его дорожка не трогает.
    expect(line.now).toBe('Этот блок убрать, он дублирует шапку')
  })

  it('у пожелания оформления «было» УЦЕЛЕЛО, а дорожки нет', () => {
    const entry = entryOf({
      id: 'пожелание',
      type: 'style-wish',
      tag: 'h1',
      was: 'Заголовок страницы',
      wasHtml: '',
      now: '',
      path: 'Главная → шапка → заголовок',
      style: { fontSize: '44px' },
    })

    const line = lineOf(entry, document)

    expect(line.was).toBe('Заголовок страницы')
    expect(line.trail).toBe('')
  })

  it('у правки текста «было» УЦЕЛЕЛО, а дорожки нет', () => {
    const entry = entryOf({
      id: 'правка',
      tag: 'p',
      was: 'обычный абзац',
      wasHtml: 'обычный абзац',
      now: 'правленый абзац',
      path: 'Главная → текст',
    })

    const line = lineOf(entry, document)

    expect(line.was).toBe('обычный абзац')
    expect(line.trail).toBe('')
  })

  it('пустая дорожка замечания не подменяется текстом якоря', () => {
    // Запись из файла, снятого до вехи «Машиночитаемость»: `path` пуст.
    // Показать нечего — не показываем, а не придумываем.
    const entry = entryOf({
      id: 'старое-замечание',
      type: 'comment',
      tag: 'section',
      was: 'Весь текст обведённого блока',
      wasHtml: '',
      now: 'Поправить отступы',
      path: '',
      rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.3 },
    })

    const line = lineOf(entry, document)

    expect(line.trail).toBe('')
    expect(line.was).toBe('')
  })
})
