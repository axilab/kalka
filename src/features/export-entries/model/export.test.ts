import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { entryStore } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import * as files from 'shared/api/files'
import { exportEntries } from './export'

/*
 * Выгрузка одним файлом.
 *
 * Раньше файлов было два: файл обмена и читаемая таблица. Таблицу заменил
 * печатный отчёт — он показывает не только «было/стало» строками, но и картинку
 * места каждой правки. Здесь закрепляются два следствия этой замены, каждое
 * из которых легко потерять при правке:
 *
 *   1. скачивается РОВНО один файл — не «хотя бы один»;
 *   2. набор помечается выгруженным при успехе этого одного файла. Прежнее
 *      условие «и вторая загрузка тоже встала» отменяло пометку, когда файл
 *      обмена уже лежал на диске, — виджет говорил «не выгружено»
 *      про выгруженное, ровно в том месте, ради которого сделана FR-25.
 */

function entryOf(id: string): Entry {
  return {
    id,
    type: 'text-override',
    route: '/',
    path: 'main > p',
    tag: 'p',
    was: 'Было так',
    now: 'Стало так',
    style: {},
    nearestHeading: '',
    contextBefore: '',
    contextAfter: '',
    occurrencesOnPage: 1,
    wasHtml: '<p>Было так</p>',
    anchor: { selector: 'p', xpath: '/html/body/p', snippet: 'Было так', index: 0 },
    viewport: { w: 1440, h: 900 },
    at: '2026-09-06T10:00:00.000Z',
  }
}

let parent: HTMLDivElement

beforeEach(() => {
  localStorage.clear()
  entryStore.seed([])
  parent = document.createElement('div')
  document.body.appendChild(parent)
})

afterEach(() => {
  parent.remove()
  vi.restoreAllMocks()
})

describe('exportEntries', () => {
  it('скачивает РОВНО один файл — файл обмена', () => {
    const download = vi.spyOn(files, 'downloadText').mockReturnValue(true)
    entryStore.seed([entryOf('a1')])

    expect(exportEntries(parent)).toBe(true)

    expect(download).toHaveBeenCalledTimes(1)
    expect(download.mock.calls[0]?.[0].name).toMatch(/\.json$/)
    expect(download.mock.calls[0]?.[0].mime).toContain('application/json')
  })

  it('имя рецензента в файл не уходит: поле есть, значение пусто', () => {
    entryStore.seed([entryOf('a1')])
    const spy = vi.spyOn(files, 'downloadText').mockReturnValue(true)

    exportEntries(parent)

    const file = JSON.parse(spy.mock.calls[0]?.[0].text ?? '{}') as { author?: unknown }

    /*
     * Поле остаётся в файле и остаётся пустым — оба условия существенны.
     *
     * Пустое: имени у продукта больше нет. Правки снимает один человек,
     * различать авторов незачем, и вопрос перед каждой выгрузкой стоил
     * внимания, не давая ничего.
     *
     * Остаётся: имена полей — часть контракта `format: 1`. Удаление
     * потребовало бы `format: 2`, а разбор чужой версии отказывает целиком —
     * все уже выгруженные файлы перестали бы загружаться ради вычеркнутой
     * строки.
     */
    expect(file).toHaveProperty('author')
    expect(file.author).toBe('')
  })

  it('помечает набор выгруженным при успехе', () => {
    vi.spyOn(files, 'downloadText').mockReturnValue(true)
    entryStore.seed([entryOf('a1')])

    exportEntries(parent)

    expect(entryStore.exportedAt()).not.toBeNull()
  })

  it('при сорванной загрузке набор НЕ помечается выгруженным', () => {
    // Сказать «выгружено», когда файла на диске нет, значит соврать ровно
    // в том месте, ради которого сделана FR-25.
    vi.spyOn(files, 'downloadText').mockReturnValue(false)
    entryStore.seed([entryOf('a1')])

    expect(exportEntries(parent)).toBe(false)
    expect(entryStore.exportedAt()).toBeNull()
  })

  it('пустой набор отклоняется без загрузки', () => {
    // Файл из нуля записей формально валиден и практически бессмысленен:
    // он выглядит как «рецензент ничего не нашёл», хотя означает
    // «рецензент промахнулся мимо кнопки».
    const download = vi.spyOn(files, 'downloadText').mockReturnValue(true)

    expect(exportEntries(parent)).toBe(false)
    expect(download).not.toHaveBeenCalled()
  })
})
