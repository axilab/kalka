import { h, render } from 'preact'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { entryStore } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import { ROOT_ATTRIBUTE } from 'shared/config/constants'
import { MarkLayer, textBox } from './MarkLayer'

/*
 * Геометрия метки у СТРОЧНОЙ цели.
 *
 * Веха «правка текста в кнопках и ссылках» впервые делает целью строчный
 * элемент, и слой меток такого вида цели не видел: до неё `climbToOutermost`
 * всегда доводил подъём до блочного предка. У ссылки внутри абзаца,
 * перенесённой по словам на две строки, объединённый bounding box
 * растягивается на всю ширину контейнера и на высоту обеих строк.
 *
 * jsdom не раскладывает текст вовсе: `getClientRects()` пуст у всего, а
 * `getBoundingClientRect()` возвращает нули. Поэтому прямоугольники здесь
 * подставляются вручную — проверяется ПРАВИЛО выбора, а не раскладка браузера.
 * Как это выглядит на настоящей странице, смотрят на стенде
 * `dev/interactive.html`, где для того и заведена длинная переносящаяся ссылка.
 */

function rect(x: number, y: number, w: number, h: number): DOMRect {
  return new DOMRect(x, y, w, h)
}

/** Подменяет обе меры элемента: тест задаёт раскладку, которой в jsdom нет. */
function layOut(el: Element, boxes: DOMRect[], bounding: DOMRect): void {
  const list = Object.assign([...boxes], { item: (i: number) => boxes[i] ?? null })
  el.getClientRects = () => list as unknown as DOMRectList
  el.getBoundingClientRect = () => bounding
}

let host: HTMLDivElement

/*
 * Вид страницы и набор записей сбрасываются на уровне ФАЙЛА, а не блока.
 *
 * `entryStore` — модульный синглтон, а проверки видимости ниже переключают вид
 * в обе стороны и заполняют набор. `beforeEach` блока «окно замечания» ни того,
 * ни другого не трогает: утёкшее `showOriginal === true` оставило бы его без
 * меток на пустом месте. Повторяется на выходе — образец в проекте именно
 * такой (`app/lib/overlay/engine.test.ts`).
 */
function resetStore(): void {
  entryStore.setShowOriginal(false)
  entryStore.seed([])
  entryStore.setRoute('')
}

beforeEach(() => {
  resetStore()
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  host.remove()
  resetStore()
})

describe('textBox', () => {
  it('у цели с одним прямоугольником рамка совпадает с нынешней дословно', () => {
    host.innerHTML = '<p id="цель">обычный абзац</p>'
    const цель = host.querySelector('#цель') as Element
    const bounding = rect(10, 20, 300, 24)
    // Прямоугольник строки НАРОЧНО не совпадает с bounding box: правило обязано
    // взять именно bounding box, как оно делало до вехи. У элемента
    // с переполнением или трансформацией это не одно и то же.
    layOut(цель, [rect(11, 21, 280, 22)], bounding)

    const box = textBox(цель)

    expect(box?.box).toBe(bounding)
    expect(box?.numberX).toBe(0)
    expect(box?.numberY).toBe(0)
  })

  it('у цели с двумя прямоугольниками узел встаёт на последний, номер уходит к первому', () => {
    host.innerHTML = '<p>Смотри <a id="цель">очень длинную ссылку</a> здесь</p>'
    const цель = host.querySelector('#цель') as Element
    const первый = rect(200, 100, 120, 20)
    const второй = rect(10, 120, 80, 20)
    // Объединённая рамка — на всю ширину контейнера и на обе строки: ровно то,
    // подо что легло бы подчёркивание без этой ветки.
    layOut(цель, [первый, второй], rect(10, 100, 310, 40))

    const box = textBox(цель)

    // Подчёркивание — по ПОСЛЕДНЕМУ прямоугольнику.
    expect(box?.box).toBe(второй)
    // Номер — у ПЕРВОГО: сдвиг считается от левого нижнего угла последнего.
    expect(box?.numberX).toBe(190)
    expect(box?.numberY).toBe(-20)
  })

  it('ноль прямоугольников даёт null', () => {
    host.innerHTML = '<p id="цель" hidden>свёрнутый блок</p>'
    const цель = host.querySelector('#цель') as Element
    layOut(цель, [], rect(0, 0, 0, 0))

    // Тот же ответ, что и сегодня у нулевой рамки: метки нет, но запись цела
    // и потерянной не считается — якорь-то нашёлся.
    expect(textBox(цель)).toBeNull()
  })
})

/*
 * Проводка окна замечания: нажатие по странице и Escape.
 *
 * Проверяется НЕ механика перехвата — она разобрана в `shared/lib/dom.test.ts`, —
 * а то, что слой её включил: предикат паузы передан режиму, `watchEscape`
 * поднят вместе с окном. Обе поломки здесь — поломки проводки, и юнит-тесты
 * механики их не видят вовсе.
 *
 * jsdom не раскладывает страницу: `elementFromPoint` и `getBoundingClientRect`
 * подставляются, как и в проверках геометрии выше.
 */
describe('окно замечания', () => {
  let container: HTMLDivElement
  let target: HTMLDivElement
  /** jsdom `elementFromPoint` не реализует вовсе — отсюда `undefined`. */
  let elementFromPoint: typeof document.elementFromPoint | undefined

  beforeEach(() => {
    target = document.createElement('div')
    target.textContent = 'Тариф «Домашний»'
    target.getBoundingClientRect = () => rect(0, 0, 800, 600)
    document.body.append(target)

    elementFromPoint = document.elementFromPoint
    document.elementFromPoint = () => target

    container = document.createElement('div')
    // Тот же атрибут, что у настоящего host-элемента: без него слой считал бы
    // собственные узлы чужой страницей (см. разбор в `app/ui/Root.test.tsx`).
    container.setAttribute(ROOT_ATTRIBUTE, '')
    document.body.append(container)
    render(h(MarkLayer, { tool: 'area' }), container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    target.remove()
    document.elementFromPoint = elementFromPoint as typeof document.elementFromPoint
  })

  function pointer(type: string, x: number, y: number): MouseEvent {
    const event = new MouseEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    })
    document.body.dispatchEvent(event)
    return event
  }

  async function flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 30))
  }

  /** Обводит рамку на странице и дожидается окна замечания. */
  async function draw(): Promise<void> {
    await flush()
    pointer('pointerdown', 10, 10)
    pointer('pointerup', 300, 300)
    await flush()
  }

  const окно = (): Element | null => container.querySelector('.kalka-comment')

  it('рисование по странице не выбрасывает недописанное замечание', async () => {
    await draw()

    const поле = container.querySelector('textarea')
    expect(поле).not.toBeNull()
    if (!поле) return
    поле.value = 'убрать этот блок'
    поле.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    // Вторая рамка ЦЕЛИКОМ, а не одно нажатие: прежде черновик подменялся
    // на `pointerup`, и набранный текст исчезал молча.
    const event = pointer('pointerdown', 400, 400)
    pointer('pointerup', 700, 700)
    await flush()

    expect(окно()).not.toBeNull()
    expect(container.querySelector('textarea')?.value).toBe('убрать этот блок')
    // Гашение при этом обязано остаться: ссылки носителя не оживают.
    expect(event.defaultPrevented).toBe(true)
  })

  it('Escape закрывает окно замечания', async () => {
    await draw()
    expect(окно()).not.toBeNull()

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    )
    await flush()

    expect(окно()).toBeNull()
  })
})

/*
 * Правило видимости меток: одно на все три инструмента.
 *
 * До вехи «вид страницы в два состояния» эта ветка не была покрыта ни одним
 * тестом. Проверялись чистая функция `textBox`, компонент `Marker` с готовыми
 * пропсами и поведение окна замечания — но не ОТБОР записей. Сними фильтр
 * молча — и сборка осталась бы зелёной при изменившемся поведении.
 *
 * jsdom не раскладывает страницу: `getBoundingClientRect` подставляется, как
 * и в проверках геометрии выше. Здесь важно не место метки, а то, сколько
 * их построено.
 */
describe('видимость меток', () => {
  let container: HTMLDivElement
  /** Маршрут текущей страницы: записи чужого маршрута слой не рисует. */
  const ROUTE = `${location.pathname}${location.hash}`

  /** Идентификатор записи → текст её якоря на странице. */
  const ЯКОРЯ: Readonly<Record<string, string>> = {
    правка1: 'Тариф «Домашний»',
    правка2: 'Подключить за час',
    оформление: 'Скидка 20%',
    область: 'Блок отзывов',
    место: 'Кнопка внизу',
  }

  function entryOf(over: Partial<Entry> & Pick<Entry, 'id' | 'type' | 'was'>): Entry {
    return {
      route: ROUTE,
      path: 'main > el',
      tag: 'p',
      now: over.was,
      style: {},
      nearestHeading: '',
      contextBefore: '',
      contextAfter: '',
      occurrencesOnPage: 1,
      anchor: { selector: `#${over.id}`, xpath: '', snippet: over.was, index: 0 },
      viewport: { w: 1440, h: 900 },
      at: '2026-09-07T10:00:00.000Z',
      ...over,
    } as Entry
  }

  /**
   * Набор из всех четырёх видов записей, какими их даёт палитра.
   *
   * Правок текста ДВЕ, а не одна: единственное, что веха изменила
   * в поведении, — подчёркивания правок текста видны теперь всегда, и на одной
   * записи эта разница не читается. Вырожденный случай обязан иметь рядом
   * невырожденный (`.ai-factory/patches/2026-09-06-21.55.md`).
   */
  function seedAll(): void {
    entryStore.seed([
      entryOf({ id: 'правка1', type: 'text-override', was: 'Тариф «Домашний»' }),
      entryOf({ id: 'правка2', type: 'text-override', was: 'Подключить за час' }),
      entryOf({
        id: 'оформление',
        type: 'style-wish',
        was: 'Скидка 20%',
        style: { fontSize: '24px' },
      }),
      entryOf({
        id: 'область',
        type: 'comment',
        was: 'Блок отзывов',
        now: 'убрать целиком',
        rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.3 },
      }),
      entryOf({
        id: 'место',
        type: 'comment',
        was: 'Кнопка внизу',
        now: 'не видно',
        point: { x: 0.5, y: 0.5 },
      }),
    ])
  }

  beforeEach(() => {
    /*
     * Якоря записей на странице.
     *
     * Текст элемента обязан СОВПАДАТЬ с `was` записи: первая ступень разбора
     * якоря сверяет найденное по селектору с исходным текстом и без совпадения
     * уходит дальше, а дальше здесь ничего нет. Иначе все пять записей
     * оказались бы «потерянными местами», и проверка видимости прошла бы
     * мимо своего предмета.
     */
    for (const [id, was] of Object.entries(ЯКОРЯ)) {
      const el = document.createElement('div')
      el.id = id
      el.textContent = was
      el.getBoundingClientRect = () => rect(0, 0, 800, 600)
      host.append(el)
    }

    entryStore.setRoute(ROUTE)
    container = document.createElement('div')
    container.setAttribute(ROOT_ATTRIBUTE, '')
    document.body.append(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  async function flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 30))
  }

  function marks(): Element[] {
    return [...container.querySelectorAll('.kalka-mark')]
  }

  it('в виде «с правками» метку получают все записи, включая правки текста', async () => {
    seedAll()
    render(h(MarkLayer, { tool: null }), container)
    await flush()

    expect(marks()).toHaveLength(5)
    // Именно этого не было до вехи: подчёркивания правок текста подчинялись
    // отдельному тумблеру, а рамка и точка были видны всегда.
    expect(container.querySelectorAll('.kalka-mark--text')).toHaveLength(3)
    expect(container.querySelectorAll('.kalka-mark--area')).toHaveLength(1)
    expect(container.querySelectorAll('.kalka-mark--point')).toHaveLength(1)
  })

  it('в виде «оригинал» не рисуется ни одной метки', async () => {
    seedAll()
    render(h(MarkLayer, { tool: null }), container)
    await flush()
    expect(marks()).toHaveLength(5)

    entryStore.setShowOriginal(true)
    await flush()

    // Правило одно на все три инструмента: страница без следов «Кальки».
    expect(marks()).toHaveLength(0)
  })

  it('запись чужого маршрута не рисуется ни в каком виде', async () => {
    // Невырожденная пара к первому случаю: правило маршрута веха не трогает,
    // и оно обязано уцелеть рядом со снятым отбором по типу записи.
    seedAll()
    entryStore.seed([
      ...entryStore.list(),
      entryOf({
        id: 'чужая',
        type: 'text-override',
        was: 'Тариф «Домашний»',
        // Якорь тот же, что у своей записи: место на странице находится, и
        // не рисуется она ИМЕННО из-за маршрута, а не из-за потерянного места.
        anchor: { selector: '#правка1', xpath: '', snippet: 'Тариф «Домашний»', index: 0 },
        route: '/другая-страница',
      }),
    ])
    render(h(MarkLayer, { tool: null }), container)
    await flush()

    expect(marks()).toHaveLength(5)

    entryStore.setShowOriginal(true)
    await flush()
    expect(marks()).toHaveLength(0)
  })
})
