import { render } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { flushRemovals } from 'features/remove-entry'
import * as importing from 'features/import-entries'
import { entryStore } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import { IMPORT_REPORT_MS, UNDO_REMOVE_MS } from 'shared/config/constants'
import { EntryList } from './EntryList'

/*
 * Список разбора: удаление правки и откат (веха «Быстрые действия»).
 *
 * Здесь закрепляется то, что видно только в собранном списке и не проверяется
 * ни хранилищем, ни слайсом отката по отдельности: полоса отмены встаёт
 * НА МЕСТО удалённой строки, а не в конец группы и не поверх ящика. На этом
 * держится обещание «список не прыгает» — ни в момент нажатия, ни при отмене.
 */

const ROUTE = '/цены'

function entryOf(id: string, was: string): Entry {
  return {
    id,
    type: 'text-override',
    route: ROUTE,
    path: 'main > p',
    tag: 'p',
    was,
    now: `${was} — исправлено`,
    style: {},
    nearestHeading: '',
    contextBefore: '',
    contextAfter: '',
    occurrencesOnPage: 1,
    wasHtml: `<p>${was}</p>`,
    anchor: { selector: 'p', xpath: '/html/body/p', snippet: was, index: 0 },
    viewport: { w: 1440, h: 900 },
    at: '2026-09-06T10:00:00.000Z',
  }
}

let container: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.append(container)

  entryStore.setRoute(ROUTE)
  entryStore.seed([entryOf('a', 'Первая'), entryOf('b', 'Вторая'), entryOf('c', 'Третья')])
  render(<EntryList />, container)
  flushEffects()
})

afterEach(() => {
  render(null, container)
  // Очередь эффектов Preact — модульная и переживает тест. Не дай ей
  // дренироваться здесь — и в СЛЕДУЮЩЕМ тесте эффекты не встанут в кадр вовсе:
  // список отрисуется, но ни на что не подпишется.
  flushEffects()
  container.remove()
  flushRemovals()
  vi.useRealTimers()
  entryStore.seed([])
})

/**
 * Прогоняет эффекты Preact.
 *
 * Обязательно, и вот почему: подписки списка на хранилище и на буфер удалённых
 * записей поднимаются в `useEffect`, а Preact ставит эффекты в кадр отрисовки.
 * Кадров в jsdom нет, и остаётся запасной таймер — без его прокрутки список
 * отрисован, но НИ НА ЧТО НЕ ПОДПИСАН, и проверка удаления показала бы, что
 * ничего не произошло, хотя произошло всё.
 */
function flushEffects(): void {
  vi.advanceTimersByTime(100)
}

/** Что стоит в списке сверху вниз: текст правки либо полоса отмены. */
function rows(): string[] {
  return [...container.querySelectorAll('.kalka-entry__now, .kalka-undo')].map((node) =>
    node.classList.contains('kalka-undo') ? 'отмена' : (node.textContent ?? ''),
  )
}

/** Preact обновляет состояние в микрозадаче — ждём её, а не таймер. */
async function press(name: string): Promise<void> {
  const button = [...container.querySelectorAll('button')].find(
    (item) => (item.textContent?.trim() || item.getAttribute('aria-label')) === name,
  )
  button?.click()
  await Promise.resolve()
}

/** Кнопка удаления у записи с указанным текстом «стало». Она первая в плашке. */
async function deleteRow(now: string): Promise<void> {
  const row = [...container.querySelectorAll('.kalka-entry')].find(
    (item) => item.querySelector('.kalka-entry__now')?.textContent === now,
  )
  row?.querySelector<HTMLButtonElement>('.kalka-entry__actions button')?.click()
  await Promise.resolve()
}

describe('EntryList: удаление и откат', () => {
  it('полоса отмены встаёт НА МЕСТО удалённой строки', async () => {
    await deleteRow('Вторая — исправлено')

    expect(rows()).toEqual(['Первая — исправлено', 'отмена', 'Третья — исправлено'])
  })

  it('удалённая правка выбывает из счёта группы сразу', async () => {
    expect(container.querySelector('.kalka-group__count')?.textContent).toBe('3')

    await deleteRow('Вторая — исправлено')

    // Полоса на экране, но правкой удалённая запись быть перестала.
    expect(container.querySelector('.kalka-group__count')?.textContent).toBe('2')
  })

  it('номера соседей сдвигаются, пока полоса ещё на экране', async () => {
    await deleteRow('Первая — исправлено')

    const numbers = [...container.querySelectorAll('.kalka-entry__number')].map(
      (node) => node.textContent,
    )
    expect(numbers).toEqual(['1', '2'])
  })

  it('строка несёт значок инструмента, которым сделана правка', async () => {
    const значки = [...container.querySelectorAll('.kalka-entry__type svg')]

    /*
     * Значок стоит В ОДНОЙ рамке с номером, а не отдельным блоком: номер
     * говорит, где это на странице, значок — чем это сделано, и вместе они
     * одна бирка. Проверяется именно вложенность: разнеси их — и запись
     * станет двухэтажной, чего вариант и избегал.
     */
    expect(значки).toHaveLength(3)
    for (const значок of значки) {
      expect(значок.closest('.kalka-entry__mark')).not.toBeNull()
      expect(значок.closest('.kalka-entry__mark')?.querySelector('.kalka-entry__number')).not.toBeNull()
    }
  })

  it('тип назван словом: значок программа чтения с экрана не прочтёт', async () => {
    // Иконки помечены `aria-hidden`, и без слова тип существовал бы только
    // для зрячих. Слово берётся из общего словаря `TOOL_LABELS` — того же,
    // которым подписаны кнопки инструментов на рейке.
    const тексты = [...container.querySelectorAll('.kalka-visually-hidden')].map(
      (node) => node.textContent,
    )

    expect(тексты).toContain('Текст, ')
  })

  it('«Вернуть» ставит строку обратно на своё место', async () => {
    await deleteRow('Вторая — исправлено')
    await press('Вернуть')

    expect(rows()).toEqual([
      'Первая — исправлено',
      'Вторая — исправлено',
      'Третья — исправлено',
    ])
  })

  it('по истечении окна полоса уходит сама, без чужой перерисовки', async () => {
    await deleteRow('Вторая — исправлено')
    vi.advanceTimersByTime(UNDO_REMOVE_MS)
    await Promise.resolve()

    // Ровно то, ради чего у списка вторая подписка: набор записей после
    // истечения окна не менялся, и уведомления хранилища здесь не будет.
    expect(rows()).toEqual(['Первая — исправлено', 'Третья — исправлено'])
  })

  it('у своей правки полоса не обещает работы в чужом файле', async () => {
    await deleteRow('Вторая — исправлено')

    expect(container.querySelector('.kalka-undo__text')?.textContent).toBe('Правка удалена')
  })

  it('у чужой правки полоса говорит, что у автора она осталась', async () => {
    entryStore.addMany([
      {
        entry: entryOf('d', 'Чужая'),
        origin: { author: 'Ирина Со', sourceId: 'x1', importedAt: '2026-09-06T11:00:00.000Z' },
      },
    ])
    await Promise.resolve()

    await deleteRow('Чужая — исправлено')

    expect(container.querySelector('.kalka-undo__text')?.textContent).toBe(
      'Чужая правка убрана — у автора она осталась',
    )
  })
})


/*
 * Отчёт о загрузке: удачный гаснет сам, отказ остаётся.
 *
 * Это одно требование в двух половинах, и обе легко потерять. Убери таймер —
 * и «Загружено 4 правки» останется под кнопкой навсегда, сообщая о событии
 * десятиминутной давности. Распространи таймер на отказ — и человек, отведя
 * глаза, увидит пустой список без объяснения и решит, что загрузка прошла.
 */
describe('EntryList: отчёт о загрузке', () => {
  /** Прогоняет выбор файла через настоящий обработчик списка. */
  async function загрузить(outcome: importing.ImportOutcome): Promise<void> {
    vi.spyOn(importing, 'importFromFile').mockResolvedValue(outcome)

    const picker = container.querySelector<HTMLInputElement>('.kalka-list__picker')
    if (!picker) throw new Error('в списке нет поля выбора файла')

    const file = new File(['{}'], 'правки.json', { type: 'application/json' })
    Object.defineProperty(picker, 'files', { value: [file], configurable: true })
    picker.dispatchEvent(new Event('change', { bubbles: true }))

    // Обработчик асинхронный: ждём и его, и перерисовку после `setReport`.
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
  }

  function отчёт(): string | null {
    return container.querySelector('.kalka-list__report')?.textContent ?? null
  }

  it('удачный отчёт гаснет сам и несёт полосу отсчёта', async () => {
    await загрузить({ ok: true, report: { added: 4, duplicates: 1, renumbered: 0 }, skipped: 0 })

    expect(отчёт()).toContain('Загружено 4 правки')
    expect(container.querySelector('.kalka-countdown')).not.toBeNull()

    vi.advanceTimersByTime(IMPORT_REPORT_MS)
    await Promise.resolve()

    expect(отчёт()).toBeNull()
  })

  it('«новых правок нет» — это успех, и он тоже гаснет', async () => {
    await загрузить({ ok: true, report: { added: 0, duplicates: 3, renumbered: 0 }, skipped: 0 })

    expect(отчёт()).toContain('Новых правок нет')

    vi.advanceTimersByTime(IMPORT_REPORT_MS)
    await Promise.resolve()

    expect(отчёт()).toBeNull()
  })

  it('отказ НЕ гаснет и полосы отсчёта не несёт', async () => {
    await загрузить({ ok: false, reason: 'unreadable' })

    expect(отчёт()).toContain('Не удалось прочитать файл')
    expect(container.querySelector('.kalka-countdown')).toBeNull()

    // Втрое дольше срока показа удачного отчёта: сообщение о несделанной
    // работе обязано дождаться следующей попытки.
    vi.advanceTimersByTime(IMPORT_REPORT_MS * 3)
    await Promise.resolve()

    expect(отчёт()).toContain('Не удалось прочитать файл')
  })
})
