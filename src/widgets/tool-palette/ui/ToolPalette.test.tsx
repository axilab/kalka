import { render } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { entryStore } from 'entities/entry'
import type { Entry, EntryType } from 'shared/model/format'
import { ToolPalette } from './ToolPalette'

/*
 * Проверки держатся на РОЛЯХ И ДОСТУПНЫХ ИМЕНАХ, а не на тексте кнопок.
 *
 * Текста в кнопках инструмента нет вовсе: на рейке шириной 48px помещается
 * только иконка, и подпись живёт доступным именем да всплывающей
 * расшифровкой. Проверка по `textContent` после этого сравнивала бы пустые
 * строки и проходила бы на чём угодно.
 *
 * Порядок инструментов при этом проверяется по-прежнему: он задан PRD,
 * и рецензент к нему привыкает.
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

function buttons(): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')]
}

/** Доступные имена кнопок в порядке отрисовки. */
function names(): (string | null)[] {
  return buttons().map((button) => button.getAttribute('aria-label'))
}

function byName(name: string): HTMLButtonElement | undefined {
  return buttons().find((button) => button.getAttribute('aria-label') === name)
}

describe('ToolPalette', () => {
  it('показывает три инструмента в порядке PRD, все доступные', () => {
    render(<ToolPalette selected={null} onSelect={() => {}} />, container)

    expect(names()).toEqual(['Текст', 'Область', 'Указатель'])
    expect(container.querySelector('button[disabled]')).toBeNull()
  })

  it('у каждой иконной кнопки есть видимая расшифровка ещё до выбора', () => {
    render(<ToolPalette selected={null} onSelect={() => {}} />, container)

    // Доступного имени мало: человеку, впервые увидевшему три значка, узнать
    // их иначе как нажав — то есть перехватив клики наугад — нечем.
    const tips = [...container.querySelectorAll('.kalka-tip')].map((tip) => tip.textContent)
    expect(tips).toEqual(['Текст', 'Область', 'Указатель'])
    // Для программы чтения с экрана расшифровка скрыта: имя уже сказано.
    for (const tip of container.querySelectorAll('.kalka-tip')) {
      expect(tip.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('выбранный инструмент ровно один и назван состоянием, а не только цветом', () => {
    render(<ToolPalette selected="area" onSelect={() => {}} />, container)

    const pressed = buttons().filter((button) => button.getAttribute('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
    expect(pressed[0]?.getAttribute('aria-label')).toBe('Область')

    // Зрительный признак сохраняется вторым, а не единственным.
    const selected = buttons().filter((button) =>
      button.getAttribute('class')?.includes('kalka-button--selected'),
    )
    expect(selected).toHaveLength(1)
    expect(selected[0]).toBe(pressed[0])
  })

  it('без выбора не нажат ни один', () => {
    render(<ToolPalette selected={null} onSelect={() => {}} />, container)

    expect(buttons().every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true)
  })

  it('подсказка появляется с выбором и говорит, чем инструмент выключается', () => {
    render(<ToolPalette selected={null} onSelect={() => {}} />, container)
    expect(container.querySelector('.kalka-tools__hint')).toBeNull()

    render(<ToolPalette selected="area" onSelect={() => {}} />, container)
    const hint = container.querySelector('.kalka-tools__hint')?.textContent ?? ''
    expect(hint).toContain('Выбрано: Область')
    // Пока инструмент включён, клики по странице перехвачены, и без этой фразы
    // выход из перехвата приходится угадывать.
    expect(hint).toContain('Повторное нажатие кнопки выключит инструмент')
  })

  it('нажатие сообщает выбранный инструмент', () => {
    const onSelect = vi.fn()
    render(<ToolPalette selected={null} onSelect={onSelect} />, container)

    byName('Указатель')?.click()

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('point')
  })
})


/*
 * Счётчик правок по инструментам.
 *
 * Прежде на рейке стоял ОДИН общий счётчик размером с кнопку: он читался как
 * кнопка, звал нажать и не отвечал ни на один вопрос, который человек себе
 * задаёт. Число рядом с инструментом отвечает на «сколько я тут наразмечал».
 */
function entryOf(id: string, type: EntryType, geometry?: 'rect' | 'point'): Entry {
  return {
    id,
    type,
    route: '/',
    path: 'main > p',
    tag: 'p',
    was: 'Было так',
    now: type === 'style-wish' ? '' : 'Стало так',
    style: type === 'style-wish' ? { fontSize: '28px' } : {},
    nearestHeading: '',
    contextBefore: '',
    contextAfter: '',
    occurrencesOnPage: 1,
    wasHtml: '<p>Было так</p>',
    anchor: { selector: 'p', xpath: '/html/body/p', snippet: 'Было так', index: 0 },
    viewport: { w: 1440, h: 900 },
    at: '2026-09-06T10:00:00.000Z',
    ...(geometry === 'rect' ? { rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } } : {}),
    ...(geometry === 'point' ? { point: { x: 0.5, y: 0.5 } } : {}),
  }
}

/** Числа на кнопках в порядке инструментов; `null` — значка нет. */
function badges(): (string | null)[] {
  return buttons().map((button) => button.querySelector('.kalka-button__badge')?.textContent ?? null)
}

describe('ToolPalette: счётчики правок', () => {
  afterEach(() => entryStore.seed([]))

  it('при пустом наборе значков нет ни у одной кнопки', () => {
    entryStore.seed([])
    render(<ToolPalette selected={null} onSelect={() => {}} />, container)

    // Пустой значок сообщает не «нисколько», а «здесь что-то есть»: в состоянии,
    // с которого начинает каждый, это был бы чистый шум.
    expect(badges()).toEqual([null, null, null])
  })

  it('каждый инструмент считает СВОИ правки', () => {
    entryStore.seed([
      entryOf('t1', 'text-override'),
      entryOf('t2', 'text-override'),
      entryOf('s1', 'style-wish'),
      entryOf('a1', 'comment', 'rect'),
      entryOf('p1', 'comment', 'point'),
      entryOf('p2', 'comment', 'point'),
    ])
    render(<ToolPalette selected={null} onSelect={() => {}} />, container)

    // Пожелание по оформлению считается «Текстом»: его создаёт тот же редактор,
    // что и правку текста. Замечание разводится по геометрии — у него заполнено
    // ровно одно из `rect` / `point`.
    expect(badges()).toEqual(['3', '1', '2'])
  })

  it('число попадает и в доступное имя: значок программа чтения не прочтёт', () => {
    entryStore.seed([entryOf('t1', 'text-override'), entryOf('t2', 'text-override')])
    render(<ToolPalette selected={null} onSelect={() => {}} />, container)

    // `aria-label` заменяет содержимое кнопки целиком, и значок внутри неё
    // для программы чтения с экрана не существует вовсе.
    expect(names()).toContain('Текст, 2 правки')
    expect(names()).toContain('Область')
  })
})
