import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Модуль делает свою работу побочным эффектом импорта, поэтому каждый случай
 * импортирует его заново после vi.resetModules().
 */
async function load(): Promise<void> {
  await import('app/index')
}

function hosts(): NodeListOf<Element> {
  return document.body.querySelectorAll('[data-kalka-root]')
}

/**
 * Прямой Object.defineProperty на document.readyState создаёт own-свойство,
 * которое restoreMocks не снимает: без восстановления значение 'loading'
 * протекает из теста в тест.
 */
const originalReadyState = Object.getOwnPropertyDescriptor(document, 'readyState')

function pretendLoading(): void {
  Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true })
}

beforeEach(() => {
  vi.resetModules()
  document.body.innerHTML = ''
  localStorage.clear()
  delete window.__kalka
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  if (originalReadyState) Object.defineProperty(document, 'readyState', originalReadyState)
  else Reflect.deleteProperty(document, 'readyState')
})

describe('загрузка виджета', () => {
  it('без параметра и без флага не трогает страницу и window', async () => {
    await load()

    expect(hosts()).toHaveLength(0)
    expect(window.__kalka).toBeUndefined()
  })

  it('с ?kalka поднимает виджет и публикует рабочий API', async () => {
    window.history.replaceState({}, '', '/?kalka')

    await load()

    expect(hosts()).toHaveLength(1)
    expect(window.__kalka?.version).toBeTruthy()
    // Не временная заглушка из boot(): настоящий unmount удаляет host-элемент.
    window.__kalka?.unmount()
    expect(hosts()).toHaveLength(0)
  })

  it('повторное исполнение при уже занятом window.__kalka не поднимает второй виджет', async () => {
    window.history.replaceState({}, '', '/?kalka')
    await load()

    vi.resetModules()
    await load()

    expect(hosts()).toHaveLength(1)
  })

  it('два подключения до готовности документа дают один виджет', async () => {
    window.history.replaceState({}, '', '/?kalka')
    pretendLoading()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await load()
    vi.resetModules()
    // window.__kalka между импортами намеренно не сбрасывается: это имитация
    // двух тегов <script> в <head>, оба отрабатывают до DOMContentLoaded.
    await load()

    document.dispatchEvent(new Event('DOMContentLoaded'))

    expect(hosts()).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[1]).toBe('скрипт подключён дважды, вторая загрузка пропущена')
  })

  it('unmount() убирает и host-элемент, и window.__kalka', async () => {
    window.history.replaceState({}, '', '/?kalka')
    await load()

    window.__kalka?.unmount()

    expect(hosts()).toHaveLength(0)
    expect(window.__kalka).toBeUndefined()
  })

  it('после unmount() виджет поднимается снова', async () => {
    window.history.replaceState({}, '', '/?kalka')
    await load()
    window.__kalka?.unmount()

    vi.resetModules()
    await load()

    expect(hosts()).toHaveLength(1)
  })

  it('на загружающемся документе монтирование откладывается до DOMContentLoaded', async () => {
    window.history.replaceState({}, '', '/?kalka')
    pretendLoading()

    await load()
    expect(hosts()).toHaveLength(0)

    document.dispatchEvent(new Event('DOMContentLoaded'))
    expect(hosts()).toHaveLength(1)
  })

  it('отмена до готовности документа отменяет отложенное монтирование', async () => {
    window.history.replaceState({}, '', '/?kalka')
    pretendLoading()
    await load()

    window.__kalka?.unmount()
    document.dispatchEvent(new Event('DOMContentLoaded'))

    expect(window.__kalka).toBeUndefined()
    expect(hosts()).toHaveLength(0)
  })

  it('сбой постановки ожидания готовности не оставляет блокировку', async () => {
    window.history.replaceState({}, '', '/?kalka')
    pretendLoading()
    vi.spyOn(document, 'addEventListener').mockImplementationOnce(() => {
      throw new Error('не удалось подписаться на готовность документа')
    })

    await expect(load()).resolves.toBeUndefined()

    expect(window.__kalka).toBeUndefined()
    expect(hosts()).toHaveLength(0)
  })
})
