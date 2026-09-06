import { render } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Marker } from './Marker'

/*
 * Формы меток и — главное — то, какие из них нажимаются.
 *
 * Нажатие по метке правки текста открыло бы окно замечания, чьё «Сохранить»
 * подменило бы набранную разметку голым текстом, а «Удалить» снесло бы правку
 * целиком. Заказчик получил бы это, нажав на собственное подчёркивание,
 * поэтому проверка здесь не про оформление, а про сохранность работы.
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

describe('Marker', () => {
  it('метка замечания — настоящая кнопка с доступным именем', () => {
    render(<Marker kind="point" title="Замечание к месту № 3" onClick={() => {}} />, container)

    const button = container.querySelector('button')
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-label')).toBe('Замечание к месту № 3')
    expect(button?.getAttribute('class')).toContain('kalka-mark--point')
  })

  it('метка правки текста кнопкой НЕ становится', () => {
    render(<Marker kind="text" title="Правка текста № 1" />, container)

    expect(container.querySelector('button')).toBeNull()

    const note = container.querySelector('.kalka-mark--text')
    // Пометка на полях, которую читают, а не нажимают.
    expect(note?.getAttribute('role')).toBe('note')
    // Имя при этом остаётся: без него правки текста для программы чтения
    // с экрана на странице не существовало бы вовсе (FR-36).
    expect(note?.getAttribute('aria-label')).toBe('Правка текста № 1')
  })

  it('пожелание по оформлению рисуется так же и тоже не нажимается', () => {
    render(<Marker kind="text" title="Пожелание по оформлению № 2" />, container)

    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('.kalka-mark--text')?.getAttribute('aria-label')).toBe(
      'Пожелание по оформлению № 2',
    )
  })

  it('номер рисуется внутри метки и скрыт от программ чтения с экрана', () => {
    render(<Marker kind="area" title="Замечание к области № 7" number={7} onClick={() => {}} />, container)

    const badge = container.querySelector('.kalka-mark__number')
    expect(badge?.textContent).toBe('7')
    // Номер уже вошёл в доступное имя — второй раз его произносить незачем.
    expect(badge?.getAttribute('aria-hidden')).toBe('true')
    // И он ВНУТРИ метки: уехать от неё при прокрутке не может по построению.
    expect(badge?.closest('.kalka-mark')).not.toBeNull()
  })

  it('без номера значка нет вовсе — так рисуется черновик', () => {
    render(<Marker kind="point" title="Замечание к месту" onClick={() => {}} />, container)

    expect(container.querySelector('.kalka-mark__number')).toBeNull()
  })

  it('уехавшая метка отличается модификатором, а не только тоном', () => {
    render(<Marker kind="area" drifted title="Замечание к области" onClick={() => {}} />, container)

    expect(container.querySelector('.kalka-mark')?.getAttribute('class')).toContain(
      'kalka-mark--drifted',
    )
  })

  it('ведомая рамка не кликается и не читается', () => {
    const onClick = vi.fn()
    render(<Marker kind="area" preview onClick={onClick} />, container)

    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('.kalka-mark')?.getAttribute('aria-hidden')).toBe('true')
  })
})
