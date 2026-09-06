import { render } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Style } from 'shared/model/format'
import { StyleBar } from './StyleBar'

/*
 * Размер и цвет как пожелания (FR-08).
 *
 * Главное, что здесь закрепляется, невидимо на экране и стоит дорого при
 * поломке: НЕЗАДАННОЕ СВОЙСТВО НЕ ПОПАДАЕТ В ОБЪЕКТ ВОВСЕ. Пустая строка
 * в файле обмена читается агентом как «задан пустой размер», то есть как
 * ошибка, а не как «не трогать», — и заметить подмену можно только на той
 * стороне, где правку уже применяют.
 */

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  render(null, container)
  container.remove()
})

function draw(value: Style, onChange: (next: Style) => void = () => {}): void {
  render(<StyleBar value={value} onChange={onChange} />, container)
}

function size(): HTMLSelectElement {
  const select = container.querySelector('select')
  if (!select) throw new Error('в ряду нет выбора размера')
  return select
}

function picker(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="color"]')
  if (!input) throw new Error('в ряду нет поля выбора цвета')
  return input
}

function byName(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    (button) => button.getAttribute('aria-label') === name,
  )
}

describe('StyleBar', () => {
  it('размер уходит в пикселях, а «как на сайте» не кладёт свойство вовсе', () => {
    const onChange = vi.fn()
    draw({}, onChange)

    size().value = '20px'
    size().dispatchEvent(new Event('change', { bubbles: true }))
    expect(onChange).toHaveBeenLastCalledWith({ fontSize: '20px' })

    draw({ fontSize: '20px' }, onChange)
    size().value = ''
    size().dispatchEvent(new Event('change', { bubbles: true }))

    // Именно так, а не `{ fontSize: '' }`: пустая строка — это ошибка,
    // а отсутствие ключа — «оставить как на сайте».
    expect(onChange).toHaveBeenLastCalledWith({})
    expect('fontSize' in (onChange.mock.lastCall?.[0] as Style)).toBe(false)
  })

  it('цвет выбирается нативным диалогом, а не списком', () => {
    draw({})

    // Список из пяти цветов отменён: выбор свободный. Прежние пять остались
    // образцами в самом диалоге, и это `datalist`, а не выпадающий список.
    expect(picker().type).toBe('color')
    expect(container.querySelectorAll('datalist option')).toHaveLength(5)
  })

  it('выбранный цвет попадает в пожелание', () => {
    const onChange = vi.fn()
    draw({}, onChange)

    picker().value = '#0b4a8f'
    picker().dispatchEvent(new Event('change', { bubbles: true }))

    expect(onChange).toHaveBeenLastCalledWith({ color: '#0b4a8f' })
  })

  it('возврат к «как на сайте» убирает свойство, а не красит белым', () => {
    const onChange = vi.fn()
    draw({ color: '#b3261e' }, onChange)

    byName('Вернуть цвет как на сайте')?.click()

    expect(onChange).toHaveBeenLastCalledWith({})
    expect('color' in (onChange.mock.lastCall?.[0] as Style)).toBe(false)
  })

  it('возвращать нечего — кнопки возврата нет', () => {
    draw({})

    // Единственный путь обратно в «не менять»: у нативного поля выбора всегда
    // есть значение. Показывать кнопку, когда цвет не задан, значило бы
    // предлагать отменить то, чего не делали.
    expect(byName('Вернуть цвет как на сайте')).toBeUndefined()
  })

  it('пожелания не мешают друг другу', () => {
    const onChange = vi.fn()
    draw({ fontSize: '28px' }, onChange)

    picker().value = '#1b5e20'
    picker().dispatchEvent(new Event('change', { bubbles: true }))

    expect(onChange).toHaveBeenLastCalledWith({ fontSize: '28px', color: '#1b5e20' })
  })

  it('состояние «цвет не задан» названо и нарисовано', () => {
    draw({})
    expect(byName('Цвет текста: как на сайте')).toBeDefined()
    expect(container.querySelector('.kalka-swatch--none')).not.toBeNull()

    draw({ color: '#111111' })
    expect(byName('Цвет текста')).toBeDefined()
    expect(container.querySelector('.kalka-swatch--none')).toBeNull()
  })
})
