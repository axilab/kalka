import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Root } from 'app/ui/Root'
import { mountKalka } from './mount'

function hosts(): NodeListOf<Element> {
  return document.body.querySelectorAll('[data-kalka-root]')
}

function shadowOf(): ShadowRoot {
  const host = hosts()[0]
  if (!(host instanceof HTMLElement) || host.shadowRoot === null) {
    throw new Error('host-элемент или его shadow root не найдены')
  }
  return host.shadowRoot
}

/** Текст стилей независимо от того, каким путём они применены. */
function stylesText(shadow: ShadowRoot): string {
  const adopted = shadow.adoptedStyleSheets ?? []
  if (adopted.length > 0) {
    return adopted
      .flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText))
      .join('\n')
  }
  return shadow.querySelector('style')?.textContent ?? ''
}

describe('mountKalka', () => {
  /** Снятие смонтированного тестом. Заполняется обёрткой `mount` ниже. */
  let unmountAll: (() => void)[] = []

  /**
   * Монтирует и запоминает, чем снять.
   *
   * Прямой `mountKalka` в тестах ниже больше не зовётся: смонтированные корни
   * иначе доживали до конца файла, и отложенные эффекты Preact срабатывали
   * уже после сноса окружения. `document.body.innerHTML = ''` их не снимает —
   * узлы уходят, а слушатели `window`, наблюдатели раскладки и подписки
   * на хранилище остаются.
   *
   * Это гигиена, а не починка наблюдаемого сбоя: строка `Errors` появлялась
   * в прогоне не всегда, и приписывать её одной причине было бы гаданием.
   */
  function mount(): () => void {
    const unmount = mountKalka(h(Root, {}))
    unmountAll.push(unmount)
    return unmount
  }

  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    for (const unmount of unmountAll) {
      try {
        unmount()
      } catch {
        // Тест мог снять свой корень сам — второй раз снимать нечего.
      }
    }
    unmountAll = []
  })

  it('добавляет ровно один host-элемент с открытым shadow root', () => {
    mount()

    expect(hosts()).toHaveLength(1)
    expect(shadowOf().mode).toBe('open')
  })

  it('критические свойства host заданы инлайново с приоритетом important', () => {
    mount()

    const host = hosts()[0] as HTMLElement
    expect(host.style.getPropertyValue('all')).toBe('initial')
    expect(host.style.getPropertyValue('position')).toBe('fixed')
    expect(host.style.getPropertyValue('z-index')).toBe('2147483647')

    for (const property of ['all', 'display', 'position', 'right', 'bottom', 'z-index']) {
      expect(host.style.getPropertyPriority(property)).toBe('important')
    }
  })

  it('стили попадают в shadow root любым из двух путей', () => {
    mount()

    const shadow = shadowOf()
    const css = stylesText(shadow)

    // Если текст пуст — искать потерянный css: true в блоке test (фаза 1, задача 2),
    // а не ослаблять условие: без него Vitest подменяет host.css?inline пустой строкой.
    expect(css).not.toBe('')
    expect(css).toContain('all: initial')
  })

  it('отключённая кнопка выглядит отключённой, а не нажимаемой', () => {
    mount()

    /*
     * Проверка по ТЕКСТУ таблицы, а не по вычисленному стилю: правило живёт
     * в теневом корне, и `getComputedStyle` в jsdom про него молчит. Приём
     * тот же, что у проверки `all: initial` выше.
     *
     * Стеречь это надо именно здесь, потому что дефект невидим в коде: у
     * `.kalka-button` заданы свои `color`, `background` и `cursor`, и они
     * перебивают то, чем браузер сам отличает `disabled`. Кнопка остаётся
     * белым по графиту с курсором-пальцем — то есть выглядит нажимаемой, —
     * а нажатие не делает ничего. «Экспорт» при пустом наборе с этим и жил.
     */
    const css = stylesText(shadowOf())

    expect(css).toContain('.kalka-button[disabled]')
    // Курсор-палец на кнопке, которая ничего не сделает, — обещание работы.
    expect(css).toContain('cursor: default')
  })

  it('точка монтирования несёт класс kalka-root, и правило для него есть в стилях', () => {
    mount()

    const shadow = shadowOf()
    expect(shadow.querySelector('.kalka-root')).not.toBeNull()
    expect(stylesText(shadow)).toContain('.kalka-root')
  })

  it('внутри shadow root отрисована рейка со входом в разбор', () => {
    mount()

    /*
     * Кнопки «Калька» больше нет: свёрнутое состояние подаётся рейкой,
     * которая видна всегда. Проверять по видимому тексту здесь тоже нечего —
     * у кнопок рейки его нет вовсе, — поэтому опора та же, что и во всём
     * остальном интерфейсе: доступное имя.
     */
    const shadow = shadowOf()
    expect(shadow.querySelector('.kalka-rail')).not.toBeNull()

    const names = [...shadow.querySelectorAll('button')].map(
      (button) => button.textContent?.trim() || button.getAttribute('aria-label'),
    )
    expect(names).toContain('Разбор')
    expect(names).not.toContain('Калька')
  })

  it('события интерфейса не доходят до слушателей носителя, а события страницы доходят', () => {
    mount()
    const button = shadowOf().querySelector('button')
    if (button === null) throw new Error('кнопка не найдена')

    const outside = document.createElement('div')
    document.body.append(outside)

    const listeners = {
      pointerdown: vi.fn(),
      mousedown: vi.fn(),
      click: vi.fn(),
    } as const
    for (const [type, listener] of Object.entries(listeners)) {
      document.addEventListener(type, listener)
    }

    for (const type of Object.keys(listeners)) {
      button.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true }))
    }
    for (const listener of Object.values(listeners)) {
      expect(listener).not.toHaveBeenCalled()
    }

    for (const type of Object.keys(listeners)) {
      outside.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true }))
    }
    for (const listener of Object.values(listeners)) {
      expect(listener).toHaveBeenCalledTimes(1)
    }
  })

  it('демонтаж возвращает страницу в исходное состояние', () => {
    const before = document.body.children.length

    const unmount = mount()
    unmount()

    expect(hosts()).toHaveLength(0)
    expect(document.body.children.length).toBe(before)
  })

  it('неудачное монтирование не оставляет частичный host в документе', () => {
    const before = document.body.children.length
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementationOnce(() => {
      throw new Error('не удалось создать shadow root')
    })

    expect(() => mountKalka(h(Root, {}))).toThrow('не удалось создать shadow root')
    expect(hosts()).toHaveLength(0)
    expect(document.body.children.length).toBe(before)
  })
})
