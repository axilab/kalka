import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CUTOUT_MIN_CONTRAST } from 'shared/config/constants'
import { checkCutout } from './check'

/*
 * Самопроверка вырезки по контрасту.
 *
 * Это ЕДИНСТВЕННАЯ защита от кривой картинки в напечатанном документе, поэтому
 * тест здесь важнее остальных в вехе. Числа взяты не из головы: гейт
 * 2026-09-05 на живом прототипе дал годным вырезкам 5.62, 15.49 и 15.67,
 * а провалившейся — 1.00, белым по белому. Провал был ровно один и ровно
 * такого рода: заголовок героя, фон под которым рисуют не предки, а соседние
 * абсолютно позиционированные слои.
 *
 * Сверять размеры и текст бесполезно — у той самой провалившейся вырезки они
 * совпали с оригиналом идеально. Здесь это зафиксировано случаем «текст
 * на месте, а читать нечего».
 */

let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  host.remove()
})

/** Элемент с заданным цветом текста внутри фона указанного предка. */
function place(textColor: string, backgroundColor: string): Element {
  const background = document.createElement('section')
  background.style.backgroundColor = backgroundColor

  const el = document.createElement('p')
  el.style.color = textColor
  el.textContent = 'Строка, которая должна читаться на бумаге'

  background.appendChild(el)
  host.appendChild(background)
  return el
}

describe('checkCutout', () => {
  it('белым по белому отбраковывается: контраст 1.00', () => {
    // Тот самый провал гейта. Текст на месте, размеры на месте, читать нечего —
    // ровно поэтому проверка идёт по контрасту, а не по тексту и размерам.
    const el = place('rgb(255, 255, 255)', 'rgb(255, 255, 255)')

    const result = checkCutout(el)

    expect(result.contrast).toBeCloseTo(1, 2)
    expect(result.ok).toBe(false)
  })

  it('белый на тёмно-синем проходит', () => {
    const el = place('rgb(255, 255, 255)', 'rgb(16, 24, 64)')

    const result = checkCutout(el)

    expect(result.contrast).toBeGreaterThan(CUTOUT_MIN_CONTRAST)
    expect(result.ok).toBe(true)
  })

  it('серый на белом проходит', () => {
    const el = place('rgb(90, 90, 90)', 'rgb(255, 255, 255)')

    const result = checkCutout(el)

    expect(result.contrast).toBeGreaterThan(CUTOUT_MIN_CONTRAST)
    expect(result.ok).toBe(true)
  })

  it('порог лежит внутри разрыва между провальным и годным замером', () => {
    // Замеры гейта: провал 1.00, ближайший годный 5.62. Любое значение внутри
    // разделяет их верно, и порог обязан оставаться внутри — иначе он начнёт
    // либо пропускать белое по белому, либо браковать годные вырезки.
    expect(CUTOUT_MIN_CONTRAST).toBeGreaterThan(1)
    expect(CUTOUT_MIN_CONTRAST).toBeLessThan(5.62)
  })

  it('прозрачный фон не считается фоном: берётся ближайший непрозрачный предок', () => {
    // Приём, которым гейт верно разобрал тёмную секцию. Без него белый текст
    // на тёмной секции с прозрачной обёрткой браковался бы как белое по белому.
    const dark = document.createElement('section')
    dark.style.backgroundColor = 'rgb(16, 24, 64)'
    const clear = document.createElement('div')
    clear.style.backgroundColor = 'rgba(0, 0, 0, 0)'
    const el = document.createElement('p')
    el.style.color = 'rgb(255, 255, 255)'

    clear.appendChild(el)
    dark.appendChild(clear)
    host.appendChild(dark)

    expect(checkCutout(el).ok).toBe(true)
  })

  it('неразобранный цвет текста не бракует вырезку', () => {
    // Браузер может отдать цвет записью, которую эта арифметика не знает.
    // Выбрасывать из-за этого годную картинку значит терять места на ровном
    // месте: посчитать нечем — не повод объявить вырезку кривой.
    const el = document.createElement('p')
    Object.defineProperty(el, 'ownerDocument', {
      value: {
        defaultView: {
          getComputedStyle: () => ({
            color: 'какая-то-незнакомая-запись',
            backgroundColor: 'rgb(255, 255, 255)',
          }),
        },
      },
    })

    expect(checkCutout(el).ok).toBe(true)
  })
})
