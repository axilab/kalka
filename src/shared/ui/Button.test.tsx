import { render } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Button } from './Button'

// Отдельная библиотека для тестирования компонентов не подключается:
// это лишняя зависимость ради render в три строки.
let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  render(null, container)
  container.remove()
})

describe('Button', () => {
  it('отрисовывает кнопку с базовым классом', () => {
    render(<Button onClick={() => {}}>Текст</Button>, container)

    const button = container.querySelector('button')
    expect(button).not.toBeNull()
    expect(button?.getAttribute('type')).toBe('button')
    // Именно `contain`, а не строгое равенство: у кнопки прибавилось
    // модификаторов, и проверка «класс ровно один» падала бы на каждом новом,
    // ничего при этом не охраняя. Стеречь надо базовый класс, а не их число.
    expect(button?.getAttribute('class')).toContain('kalka-button')
    expect(button?.textContent).toBe('Текст')
  })

  it('primary и selected добавляют свои модификаторы', () => {
    render(
      <Button primary selected onClick={() => {}}>
        Текст
      </Button>,
      container,
    )

    const className = container.querySelector('button')?.getAttribute('class')
    expect(className).toContain('kalka-button--primary')
    expect(className).toContain('kalka-button--selected')
  })

  it('нажатие вызывает обработчик один раз', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Текст</Button>, container)

    container.querySelector('button')?.click()

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('label попадает в aria-label', () => {
    render(
      <Button label="Открыть Кальку" onClick={() => {}}>
        К
      </Button>,
      container,
    )

    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('Открыть Кальку')
  })

  it('кнопка из одной иконки получает свой модификатор и доступное имя', () => {
    render(<Button icon={<svg />} label="Разбор" onClick={() => {}} />, container)

    const button = container.querySelector('button')
    expect(button?.getAttribute('class')).toContain('kalka-button--icon')
    expect(button?.getAttribute('aria-label')).toBe('Разбор')
    // Текста в такой кнопке нет вовсе — имя остаётся единственным, чем она
    // себя называет.
    expect(button?.textContent).toBe('')
    expect(button?.querySelector('svg')).not.toBeNull()
  })

  it('pressed выходит в aria-pressed, а без него атрибута нет вовсе', () => {
    render(<Button pressed onClick={() => {}}>Жирный</Button>, container)
    expect(container.querySelector('button')?.getAttribute('aria-pressed')).toBe('true')

    render(<Button onClick={() => {}}>Жирный</Button>, container)
    // Не «false», а отсутствие: кнопка без состояния не выключатель, и
    // объявлять её ненажатой значит соврать про её природу.
    expect(container.querySelector('button')?.hasAttribute('aria-pressed')).toBe(false)
  })

  it('expanded и controls связывают кнопку с раскрываемым блоком', () => {
    render(
      <Button expanded={false} controls="kalka-drawer" icon={<svg />} label="Разбор" onClick={() => {}} />,
      container,
    )

    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-expanded')).toBe('false')
    expect(button?.getAttribute('aria-controls')).toBe('kalka-drawer')
    // `aria-pressed` рядом не появляется: одно состояние двумя словами.
    expect(button?.hasAttribute('aria-pressed')).toBe(false)
  })

  it('tip даёт видимую расшифровку, скрытую от программ чтения с экрана', () => {
    render(<Button icon={<svg />} label="Область" tip="Область" onClick={() => {}} />, container)

    const tip = container.querySelector('.kalka-tip')
    expect(tip?.textContent).toBe('Область')
    expect(tip?.getAttribute('aria-hidden')).toBe('true')
    // Подпись — СОСЕД кнопки, а не потомок: на этом держится правило показа
    // `.kalka-button:hover + .kalka-tip`.
    expect(tip?.previousElementSibling?.tagName).toBe('BUTTON')
  })

  it('без tip обёртки не появляется вовсе', () => {
    render(<Button onClick={() => {}}>Текст</Button>, container)

    expect(container.querySelector('.kalka-tipped')).toBeNull()
    expect(container.firstElementChild?.tagName).toBe('BUTTON')
  })
})
