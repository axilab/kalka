import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { captureAgentContext } from './capture'

/*
 * Словарь опознания элементов в человекочитаемом пути (FR-43).
 *
 * Веха «правка текста в кнопках и ссылках» впервые делает целью интерактивные
 * элементы, и путь до них обязан их называть. Приём взят из `identifyElement`
 * репозитория agentation, но словарь остаётся русским и без технических
 * терминов (FR-36): рецензент не видит ни `role`, ни имён тегов.
 *
 * `buildPath` наружу не выходит — публичный API слайса ровно одна функция,
 * и проверяется путь через неё.
 */

let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => host.remove())

function путь(selector: string): string {
  return captureAgentContext(host.querySelector(selector) as Element).path
}

describe('метки звеньев пути', () => {
  it('подпись поля называется подписью поля', () => {
    host.innerHTML = '<label id="цель">Ваше имя</label>'

    expect(путь('#цель')).toContain('подпись поля')
  })

  it('div с role="button" называется кнопкой', () => {
    // По тегу такое звено метки не получало вовсе и в путь не попадало,
    // хотя на живых страницах встречается не реже настоящей кнопки.
    host.innerHTML = '<div id="цель" role="button">Показать ещё</div>'

    expect(путь('#цель')).toContain('кнопка')
  })

  it('role="tab" на кнопке даёт вкладку, а не кнопку', () => {
    /*
     * Ровно тот случай, ради которого атрибут спрашивается ПЕРВЫМ.
     * `ROLE_BY_TAG` знает `BUTTON`, и при проверке тега первым такой элемент
     * навсегда остался бы «кнопкой», хотя вкладка здесь точнее.
     */
    host.innerHTML = '<button id="цель" role="tab">Доставка</button>'

    const path = путь('#цель')
    expect(path).toContain('вкладка')
    expect(path).not.toContain('кнопка')
  })

  it('role="menuitem" называется пунктом меню', () => {
    host.innerHTML = '<div id="цель" role="menuitem">Настройки</div>'

    expect(путь('#цель')).toContain('пункт меню')
  })

  it('обычная кнопка по-прежнему кнопка', () => {
    // Невырожденная пара: неизвестное или отсутствующее значение атрибута
    // падает на тег, и прежние метки не меняются.
    host.innerHTML = '<button id="цель">Оформить заказ</button>'

    expect(путь('#цель')).toContain('кнопка')
  })

  it('неизвестное значение role падает на тег', () => {
    host.innerHTML = '<li id="цель" role="presentation">Первый</li>'

    expect(путь('#цель')).toContain('пункт списка')
  })

  it('aria-label остаётся СТАРШЕ обоих словарей', () => {
    // Порядок этих двух источников веха не трогает: человекочитаемая подпись,
    // написанная носителем, точнее любой нашей метки по назначению.
    host.innerHTML = '<div id="цель" role="button" aria-label="Развернуть отзывы">…</div>'

    const path = путь('#цель')
    expect(path).toContain('Развернуть отзывы')
    expect(path).not.toContain('кнопка')
  })

  it('звено без метки в путь не попадает', () => {
    // Правило не ослабляется: имя обёртки не сообщает ничего, а звено
    // расходует.
    host.innerHTML = '<div id="обёртка"><button id="цель">Купить</button></div>'

    expect(путь('#цель')).toBe('кнопка')
  })
})
