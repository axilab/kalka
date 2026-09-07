import { h, render } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { entryStore } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import { ROOT_ATTRIBUTE } from 'shared/config/constants'
import * as files from 'shared/api/files'
import { Root } from './Root'

/*
 * Проверки автомата `view / edit / review` и требований, которые он обязан
 * держать во всех трёх состояниях.
 *
 * ── Почему здесь нет проверок «панель ровно одна» ───────────────────────────
 *
 * Панелей режима больше нет. Рейка видна всегда, а разница между состояниями
 * выражается ящиком и выбранным инструментом — их и проверяем. Прежний хелпер
 * `panels()` считал `.kalka-panel`, и после рефакторинга он всегда возвращал бы
 * ноль, то есть проходил бы, ничего не охраняя.
 *
 * ── Почему поиск идёт по доступным именам ───────────────────────────────────
 *
 * У кнопок рейки текста нет вовсе: помещается только иконка. Имя — единственное,
 * чем такая кнопка себя называет, и единственное, на что здесь можно опереться.
 * Заодно это делает проверки нечувствительными к перестановке кнопок: требование
 * FR-21 про доступность тумблеров, а не про их порядок.
 */

/** FR-36: рецензент не видит технических слов ни в одном состоянии. */
const FORBIDDEN = ['селектор', 'якорь', 'dom', 'json', 'формат', 'импорт'] as const

let container: HTMLDivElement

/*
 * Флаги вида сбрасываются ДО отрисовки, и оба.
 *
 * `entryStore` — модульный синглтон на весь файл, а проверки этого файла
 * оставляют после себя и `showOriginal === true` (вид «оригинал»), и
 * `verifyMode === true` (режим проверки). Утёкший флаг рисует следующий тест
 * с погашенной палитрой и без меток — и падает не тот тест, который сломали.
 *
 * Сброс идёт первой строкой, а не последней: ниже стоит `render`, и после него
 * первый же кадр прочитал бы утёкшее значение. Повторяется в `afterEach` —
 * образец в проекте именно такой (`app/lib/overlay/engine.test.ts`).
 */
function resetView(): void {
  entryStore.setShowOriginal(false)
  entryStore.setVerifyMode(false)
}

beforeEach(() => {
  resetView()
  container = document.createElement('div')
  /*
   * Контейнер помечается ТЕМ ЖЕ атрибутом, что и настоящий host-элемент.
   *
   * Без него инструмент «Текст», включённый в тесте, перехватывает клики
   * по кнопкам самой «Кальки»: `watchPicking` отличает свои клики от чужих
   * ровно по этому атрибуту в `composedPath`, а в голом `div` его нет.
   * Проверено: третье нажатие на вход в разбор не доходило до обработчика
   * вовсе, зато в логе появлялось «элемент выбран».
   *
   * То есть это не поблажка тесту, а воспроизведение того, что в жизни
   * обеспечивает монтирование: виджет всегда живёт внутри своего host.
   */
  container.setAttribute(ROOT_ATTRIBUTE, '')
  document.body.append(container)
  render(h(Root, {}), container)
})

afterEach(() => {
  render(null, container)
  container.remove()
  resetView()
})

function buttons(): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')]
}

/** Доступное имя: видимый текст, а если его нет — `aria-label`. */
function accessibleName(button: HTMLButtonElement): string {
  const text = button.textContent?.trim() ?? ''
  return text || (button.getAttribute('aria-label') ?? '')
}

function names(): string[] {
  return buttons().map(accessibleName)
}

function byName(name: string): HTMLButtonElement | undefined {
  return buttons().find((button) => accessibleName(button) === name)
}

/** Preact обновляет состояние в микрозадаче — ждём её, а не таймер. */
async function press(name: string): Promise<void> {
  byName(name)?.click()
  await Promise.resolve()
}

/**
 * Прогоняет эффекты Preact.
 *
 * Нужно там, где кнопка перерисовывается ОТ ПОДПИСКИ НА ХРАНИЛИЩЕ, а не от
 * собственного состояния `Root`: подписка поднимается в `useEffect`, а Preact
 * ставит эффекты в кадр отрисовки. Кадр в jsdom двигает таймер, и без ожидания
 * кнопка отрисована, но ни на что не подписана — нажатие меняет хранилище,
 * а подпись остаётся прежней.
 */
async function flushEffects(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30))
}

/** Открыт ли ящик — по состоянию кнопки входа, а не по разметке внутри него. */
function drawerOpen(): boolean {
  return byName('Разбор')?.getAttribute('aria-expanded') === 'true'
}

/** Доступные имена выбранных инструментов. Их обязан быть ровно один или ноль. */
function pressedTools(): string[] {
  return buttons()
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map(accessibleName)
}

describe('Root', () => {
  it('открывается в состоянии «Просмотр»: рейка видна, ящик закрыт, инструмент не выбран', () => {
    expect(container.querySelector('.kalka-rail')).not.toBeNull()
    expect(drawerOpen()).toBe(false)
    expect(pressedTools()).toEqual([])
  })

  // FR-21 и FR-25: тумблеры вида и счётчик доступны во всех трёх состояниях.
  // Решение принимается в одном месте — в `Root`, — и проверка здесь же.
  it('рейка несёт инструменты, вид страницы и вход в разбор', () => {
    const set = new Set(names())
    expect(set).toContain('Текст')
    expect(set).toContain('Область')
    expect(set).toContain('Указатель')
    // Кнопка вида ОДНА, и состояний у неё два: «с правками» и «оригинал».
    // Третьего, «где изменения», нет намеренно — `docs/adr/0001`.
    expect(set).toContain('Вид: с правками')
    expect(set).toContain('Разбор')
  })

  it('вид страницы обходит два состояния и возвращается в начало', async () => {
    /*
     * Замкнутость цикла — не украшение: из состояния, в которое нельзя
     * вернуться нажатием, человек выбирается только перезагрузкой. У двух
     * состояний цикл замыкается вторым нажатием, и проверяются оба шага.
     */
    await flushEffects()
    expect(byName('Вид: с правками')).toBeDefined()

    await press('Вид: с правками')
    expect(byName('Вид: оригинал')).toBeDefined()

    await press('Вид: оригинал')
    expect(byName('Вид: с правками')).toBeDefined()
  })

  it('выбор инструмента переводит в «Правку», снятие — обратно в «Просмотр»', async () => {
    await press('Текст')
    expect(pressedTools()).toEqual(['Текст'])
    expect(drawerOpen()).toBe(false)

    await press('Текст')
    expect(pressedTools()).toEqual([])
    expect(drawerOpen()).toBe(false)
  })

  /*
   * FR-21: «оригинал» — это страница без следов «Кальки», и словарь обещает
   * про него «править нельзя». Обещание исполняется в двух местах с разными
   * работами: перехват страницы не включается вовсе (`widgets/mark-layer`),
   * а рейка приводит в порядок интерфейс — это и проверяется здесь.
   */
  it('вид «оригинал» снимает инструмент и гасит палитру', async () => {
    await flushEffects()
    await press('Область')
    expect(pressedTools()).toEqual(['Область'])

    // Цикл видов: с правками → оригинал. Одно нажатие.
    await press('Вид: с правками')
    await flushEffects()

    expect(byName('Вид: оригинал')).toBeDefined()
    // Нажимаемая кнопка инструмента в этом виде обещала бы работу, которой
    // не будет, — тот же обман, что и мёртвый «Экспорт» при пустом наборе.
    expect(pressedTools()).toEqual([])
    expect(byName('Текст')?.disabled).toBe(true)
    expect(byName('Область')?.disabled).toBe(true)
    expect(byName('Указатель')?.disabled).toBe(true)
  })

  it('выбранный инструмент ровно один', async () => {
    await press('Текст')
    await press('Область')

    expect(pressedTools()).toEqual(['Область'])
  })

  it('открытие разбора не снимает инструмент, и он продолжает работать', async () => {
    await press('Текст')
    await press('Разбор')

    expect(drawerOpen()).toBe(true)
    // Инструмент переживает разбор: это и есть отличие `review` от прежнего
    // режима, в котором панель «Правка» просто исчезала.
    expect(pressedTools()).toEqual(['Текст'])
  })

  it('закрытие ящика возвращает в «Правку» при выбранном инструменте', async () => {
    await press('Текст')
    await press('Разбор')
    await press('Разбор')

    expect(drawerOpen()).toBe(false)
    expect(pressedTools()).toEqual(['Текст'])
  })

  it('закрытие ящика возвращает в «Просмотр», когда инструмент не выбран', async () => {
    await press('Разбор')
    await press('Разбор')

    expect(drawerOpen()).toBe(false)
    expect(pressedTools()).toEqual([])
  })

  it('закрытый ящик не участвует в обходе с клавиатуры', async () => {
    const drawer = container.querySelector('#kalka-drawer')
    expect(drawer).not.toBeNull()

    // Ящик СМОНТИРОВАН всегда — иначе с ним уходили бы режим проверки и отчёт
    // о загрузке, — но закрытый скрыт `hidden`, а не сдвигом: сдвинутый
    // остался бы в обходе, и человек уходил бы табуляцией в невидимый список.
    expect(drawer?.hasAttribute('hidden')).toBe(true)

    await press('Разбор')
    expect(container.querySelector('#kalka-drawer')?.hasAttribute('hidden')).toBe(false)
  })

  it('вход в разбор объявляет, чем управляет', async () => {
    const enter = byName('Разбор')
    expect(enter?.getAttribute('aria-controls')).toBe('kalka-drawer')
    expect(enter?.getAttribute('aria-expanded')).toBe('false')

    await press('Разбор')
    expect(byName('Разбор')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('«Экспорт» скачивает файл сразу, ничего не спрашивая и не открывая', async () => {
    const entry: Entry = {
      id: 'a1',
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
    entryStore.seed([entry])
    const download = vi.spyOn(files, 'downloadText').mockReturnValue(true)

    await press('Разбор')
    await press('Экспорт')

    /*
     * Между нажатием и файлом не осталось НИЧЕГО: ни списка того, что уйдёт,
     * ни поля имени, ни второй кнопки «Скачать». Выбирать в выгрузке нечего —
     * уходит всегда весь набор, — а сколько его, сказано строкой над кнопкой.
     *
     * Проверяется и отсутствие промежуточной панели: вернуть её случайной
     * правкой `Root` легко, и внешне это выглядело бы как «стало подробнее».
     */
    expect(download).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain('Что уйдёт в файлы')
    expect(byName('Скачать')).toBeUndefined()

    // Родитель временного якоря — узел ВНУТРИ виджета: в чужой DOM при
    // выгрузке не добавляется ни одного узла (см. шапку `shared/api/files.ts`).
    const parent = download.mock.calls[0]?.[0].parent
    expect(parent && container.contains(parent)).toBe(true)

    entryStore.seed([])
  })

  it('технических терминов нет ни в одном состоянии (FR-36)', async () => {
    const check = (): void => {
      const text = (container.textContent ?? '').toLowerCase()
      for (const word of FORBIDDEN) expect(text).not.toContain(word)
    }

    check()
    await press('Текст')
    check()
    await press('Разбор')
    check()
  })
})
