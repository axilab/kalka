import { render } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ReviewMode } from './ReviewMode'

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  render(null, container)
  container.remove()
})

function buttons(): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')]
}

/**
 * Доступное имя кнопки: видимый текст, а если его нет — `aria-label`.
 *
 * У иконных кнопок текста нет вовсе, и искать их по `textContent` значило бы
 * искать пустую строку. Имя есть у каждой — это обеспечивает тип `Button`.
 */
function accessibleName(button: HTMLButtonElement): string {
  const text = button.textContent?.trim() ?? ''
  return text || (button.getAttribute('aria-label') ?? '')
}

function press(name: string): void {
  buttons()
    .find((button) => accessibleName(button) === name)
    ?.click()
}

describe('ReviewMode', () => {
  it('показывает содержимое ящика: заголовок, список и загрузку с проверкой', () => {
    render(<ReviewMode onCollapse={() => {}} />, container)

    expect(container.querySelector('.kalka-title')?.textContent).toBe('Разбор')
    expect(container.querySelector('.kalka-list')).not.toBeNull()

    // Проверка по НАБОРУ имён, а не по их порядку: перестановка кнопок
    // не должна ронять проверку требования, которое про наличие, а не про
    // расположение.
    const names = new Set(buttons().map(accessibleName))
    expect(names).toContain('Загрузить правки')
    expect(names).toContain('Проверить правки')
    expect(names).toContain('Закрыть разбор')
  })

  it('правки идут первыми, инструменты разработчика — под ними', () => {
    render(<ReviewMode onCollapse={() => {}} />, container)

    const list = container.querySelector('.kalka-list')
    const groups = container.querySelector('.kalka-list__groups')
    const dev = container.querySelector('.kalka-list__dev')

    expect(groups).not.toBeNull()
    expect(dev).not.toBeNull()

    /*
     * Порядок ЗАКРЕПЛЁН проверкой, а не оставлен на усмотрение разметки.
     *
     * «Загрузить правки» и «Проверить правки» стояли над списком и держали
     * первый экран ящика постоянно, хотя обращаются к ним дважды за разбор.
     * Это тот случай, который тихо возвращается при следующей правке JSX:
     * поменяешь местами два блока — и внешне ничего не сломается, а разбор
     * снова будет начинаться с четвёртой строки сверху.
     *
     * Проверяется порядок в РАЗМЕТКЕ, потому что он же порядок обхода
     * с клавиатуры: переставь блоки стилями — и табуляция пошла бы против
     * того, что видно на экране.
     */
    const order = [...(list?.children ?? [])]
    expect(order.indexOf(groups as Element)).toBeLessThan(order.indexOf(dev as Element))
  })

  it('собственного листа у содержимого нет: лист — сам ящик', () => {
    render(<ReviewMode onCollapse={() => {}} />, container)

    // Панель внутри панели была бы карточкой в карточке. Геометрию задаёт
    // `.kalka-drawer` снаружи.
    expect(container.querySelector('.kalka-panel')).toBeNull()
  })

  // Кнопка при пустом наборе НЕАКТИВНА, но с экрана не исчезает: исчезнувшая
  // выглядела бы так, будто проверки в продукте нет вовсе.
  it('проверка недоступна, пока правок нет', () => {
    render(<ReviewMode onCollapse={() => {}} />, container)

    const verify = buttons().find((button) => accessibleName(button) === 'Проверить правки')

    expect(verify?.disabled).toBe(true)
  })

  it('закрытие ящика — единственный выход отсюда', () => {
    const onCollapse = vi.fn()
    render(<ReviewMode onCollapse={onCollapse} />, container)

    press('Закрыть разбор')

    expect(onCollapse).toHaveBeenCalledTimes(1)
    // Кнопки «Правка» больше нет и быть не должно: инструменты доступны прямо
    // на рейке при открытом ящике, и «вернуться к правке» стало означать ровно
    // то же, что «закрыть ящик».
    expect(buttons().map(accessibleName)).not.toContain('Правка')
  })

  it('технических терминов в тексте нет (FR-36)', () => {
    render(<ReviewMode onCollapse={() => {}} />, container)

    const text = (container.textContent ?? '').toLowerCase()
    for (const word of ['json', 'импорт', 'файл']) {
      expect(text).not.toContain(word)
    }
  })
})
