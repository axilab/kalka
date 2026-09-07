import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { textBox } from './MarkLayer'

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

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => host.remove())

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
