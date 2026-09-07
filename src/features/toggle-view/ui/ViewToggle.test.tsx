import { h, render } from 'preact'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { entryStore } from 'entities/entry'
import { ViewToggle } from './ViewToggle'

/*
 * Проверки держатся на ДОСТУПНОМ ИМЕНИ кнопки, а не на её тексте.
 *
 * На рейке кнопка компактная, текста в ней нет вовсе — подпись живёт
 * `aria-label` и всплывающей расшифровкой. Имя при этом и есть то, чем
 * состояние сообщается человеку: «Вид: с правками» против «Вид: оригинал».
 *
 * Теневой корень здесь не нужен: компонент чужой страницы не трогает
 * и живёт целиком внутри собственной разметки.
 */

let container: HTMLDivElement

/**
 * Флаг вида сбрасывается ДО отрисовки и повторяется на выходе.
 *
 * `entryStore` — модульный синглтон на весь файл, а половина проверок здесь
 * оставляет `showOriginal === true`. Без сброса следующий тест начинался бы
 * в «оригинале» и падал бы на ровном месте.
 */
function resetView(): void {
  entryStore.setShowOriginal(false)
}

beforeEach(() => {
  resetView()
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  render(null, container)
  container.remove()
  resetView()
})

function button(): HTMLButtonElement | null {
  return container.querySelector('button')
}

/** Доступное имя: видимый текст, а если его нет — `aria-label`. */
function name(): string {
  const el = button()
  if (!el) return ''
  const text = el.textContent?.trim() ?? ''
  return text || (el.getAttribute('aria-label') ?? '')
}

/** Preact обновляет состояние в микрозадаче — ждём её, а не таймер. */
async function press(): Promise<void> {
  button()?.click()
  await Promise.resolve()
}

/**
 * Прогоняет эффекты Preact.
 *
 * Подписка на хранилище поднимается в `useEffect`, а Preact ставит эффекты
 * в кадр отрисовки. Кадр в jsdom двигает таймер: без ожидания кнопка
 * отрисована, но ни на что не подписана.
 */
async function flushEffects(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30))
}

describe('ViewToggle', () => {
  it('цикл замкнут на двух состояниях', async () => {
    render(h(ViewToggle, { compact: true }), container)
    await flushEffects()

    expect(name()).toBe('Вид: с правками')

    await press()
    expect(name()).toBe('Вид: оригинал')
    expect(entryStore.showOriginal()).toBe(true)

    // Второе нажатие возвращает в начало: из состояния, в которое нельзя
    // вернуться нажатием, человек выбирается только перезагрузкой.
    await press()
    expect(name()).toBe('Вид: с правками')
    expect(entryStore.showOriginal()).toBe(false)
  })

  it('подпись и доступное имя меняются вместе с состоянием', async () => {
    // Полная, не компактная кнопка: подпись здесь видимый текст, и проверяется
    // именно она — на рейке то же значение уезжает в `aria-label`.
    render(h(ViewToggle, { compact: false }), container)
    await flushEffects()

    expect(button()?.textContent?.trim()).toBe('Вид: с правками')

    await press()
    expect(button()?.textContent?.trim()).toBe('Вид: оригинал')
  })

  it('при `disabled` нажатие вид не меняет', async () => {
    render(h(ViewToggle, { compact: true, disabled: true }), container)
    await flushEffects()

    expect(button()?.disabled).toBe(true)

    await press()
    expect(entryStore.showOriginal()).toBe(false)
    expect(name()).toBe('Вид: с правками')
  })

  it('подхватывает флаг, изменённый хранилищем мимо кнопки', async () => {
    /*
     * Это путь режима проверки: он ставит `showOriginal` сам, не трогая кнопку.
     * Без подписки на хранилище кнопка осталась бы с подписью «с правками»
     * на странице, показывающей оригинал, — и отвалиться подписка может тихо.
     */
    render(h(ViewToggle, { compact: true }), container)
    await flushEffects()

    entryStore.setShowOriginal(true)
    await flushEffects()

    expect(name()).toBe('Вид: оригинал')
  })
})
