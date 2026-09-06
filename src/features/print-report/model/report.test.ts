import { describe, expect, it } from 'vitest'

import type { Entry, EntryType, Style } from 'shared/model/format'
import type { Cutout } from 'shared/model/layer'
import { buildReport } from './report'
import type { ReportInput } from './report'

/*
 * Документ отчёта — опись правок.
 *
 * ── Про запрещённые техтермины ──────────────────────────────────────────────
 *
 * FR-36 требует, чтобы читатель не видел технических терминов. Список взят
 * из `app/ui/Root.test.tsx`, но с ОДНИМ изъятием: слово `json` из него убрано.
 * Причина простая и проверяемая по самому документу: шапка описи называет файл
 * обмена по имени, а имя оканчивается на `.json`. Изъятие ровно одно и касается
 * только имени файла — «формат», «селектор», «якорь», «DOM» в документе
 * по-прежнему запрещены целиком.
 *
 * ── Про слова снятого устройства ────────────────────────────────────────────
 *
 * Отдельным списком проверяются слова, которыми прежний документ распределял
 * поручения и оценивал объём работ. Это не техтермины, и FR-36 их не запрещает;
 * их запретил пользователь, и запрет надо держать машиной, а не памятью.
 */
const FORBIDDEN = ['селектор', 'якорь', 'dom', 'формат'] as const

/** Слова снятого устройства: документ больше никого ни к чему не обязывает. */
const RETIRED = [
  'требует решения',
  'требуют решения',
  'правки текста',
  'замечание',
  'оформление',
  'здесь',
  'прототип',
] as const

function entryOf(
  id: string,
  type: EntryType,
  extra: Partial<Entry> & { style?: Style } = {},
): Entry {
  return {
    id,
    type,
    route: '/',
    path: 'main > p',
    tag: 'p',
    was: 'Было так',
    now: type === 'comment' ? 'Убрать это' : 'Стало так',
    style: {},
    // У записи типа `comment` заполнено РОВНО ОДНО из `rect` / `point` —
    // это инвариант формата, который обеспечивает `createCommentEntry`.
    // Фикстура его соблюдает: без геометрии инструмент не определяется,
    // и проверки вида правки шли бы мимо реальных записей.
    ...(type === 'comment' ? { rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.3 } } : {}),
    nearestHeading: '',
    contextBefore: '',
    contextAfter: '',
    occurrencesOnPage: 1,
    wasHtml: '<p>Было так</p>',
    anchor: { selector: 'p', xpath: '/html/body/p', snippet: 'Было так', index: 0 },
    viewport: { w: 1440, h: 900 },
    at: '2026-09-06T10:00:00.000Z',
    ...extra,
  }
}

function cutoutOf(): Cutout {
  return {
    html: '<p style="color:rgb(0,0,0)">Было так</p>',
    width: 600,
    height: 300,
    // Полоса описью НЕ читается: она посчитана под прежнюю широкую колонку.
    // Поле остаётся в вырезке ради совместимости уже сохранённых записей.
    band: { y: 30, h: 100 },
    anchorBox: { x: 40, y: 60, w: 320, h: 40 },
    fontFaces: ['@font-face{font-family:"Inter";src:url(https://cdn.test/i.woff2)}'],
    at: '2026-09-06T10:00:00.000Z',
  }
}

function inputOf(entries: Entry[], over: Partial<ReportInput> = {}): ReportInput {
  return {
    entries,
    numbers: new Map(entries.map((entry, index) => [entry.id, index + 1])),
    cutoutOf: () => cutoutOf(),
    site: 'https://prototype.test',
    fileName: 'kalka-prototype.test-2026-09-06-1015.json',
    now: new Date('2026-09-06T10:20:00'),
    doc: document,
    ...over,
  }
}

/** Разбор собранного документа: структурные свойства проверяются по дереву. */
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

describe('buildReport', () => {
  it('вид правки назван ИНСТРУМЕНТОМ, которым она сделана', () => {
    // Прежний документ называл вид по адресату и тем распределял поручения.
    // Опись называет инструмент — ровно то слово, что стоит у той же записи
    // в списке разбора на экране.
    const html = buildReport(
      inputOf([
        entryOf('t1', 'text-override'),
        entryOf('s1', 'style-wish', { style: { fontSize: '44px' } }),
        entryOf('a1', 'comment'),
        entryOf('p1', 'comment', { rect: undefined, point: { x: 0.5, y: 0.5 } }),
      ]),
    )

    const heads = [...parse(html).querySelectorAll('.edit__head')].map((el) => el.textContent)

    // Пожелание по размеру и цвету создаёт тот же редактор, что и правку
    // текста, — инструмент у них один, и раздваивать его нельзя.
    expect(heads).toEqual(['Текст · /', 'Текст · /', 'Область · /', 'Указатель · /'])
  })

  it('в документе нет слов снятого устройства', () => {
    // Прямая проверка требования пользователя: документ отражает правки
    // и ничего не предписывает. Слова, которыми он раньше распределял работу,
    // обязаны исчезнуть целиком, а не переехать в другую формулировку.
    const html = buildReport(
      inputOf([
        entryOf('t1', 'text-override', { style: { fontSize: '28px' } }),
        entryOf('s1', 'style-wish', { style: { color: 'тёмный' } }),
        entryOf('c1', 'comment'),
      ]),
    )

    const text = html.toLowerCase()
    for (const word of RETIRED) expect(text).not.toContain(word)
  })

  it('пожелание по размеру и цвету печатается СЛОВАМИ отдельной строкой', () => {
    // Правка текста с пожеланием несёт два независимых факта сразу. Подмешай
    // пожелание в «стало» — и один из двух потеряется: читатель увидит либо
    // новый текст, либо просьбу сделать его крупнее, но не обе.
    const html = buildReport(
      inputOf([
        entryOf('t1', 'text-override', { style: { fontSize: '44px', color: '#1a3d7c' } }),
      ]),
    )

    const row = parse(html).querySelector('.row')
    expect(row?.querySelector('.edit__now')?.textContent).toBe('Стало так')
    expect(row?.querySelector('.edit__wish')?.textContent).toBe('размер 44px, цвет #1a3d7c')
  })

  it('называет файл обмена нейтральной строкой в шапке', () => {
    // Рамка с указанием, что с файлом делать, снята: документ ничего не
    // предписывает. Имя при этом обязано остаться — без него файл на диске
    // не с чем сопоставить.
    const meta = parse(buildReport(inputOf([entryOf('t1', 'text-override')]))).querySelector(
      '.head__meta',
    )

    expect(meta?.textContent).toContain('kalka-prototype.test-2026-09-06-1015.json')
  })

  it('без выгрузки имени просто НЕТ, и оно не выдумывается', () => {
    // Названное имя несуществующего файла хуже отсутствия имени: оно выглядит
    // достоверно и отправляет читателя искать то, чего нет.
    const html = buildReport(inputOf([entryOf('t1', 'text-override')], { fileName: null }))

    expect(html).not.toContain('.json')
    // И никакой строки взамен: молчание здесь честнее объяснения.
    expect(html).not.toContain('не выгружен')
  })

  it('правки с разных страниц стоят одной описью, и каждая называет свою', () => {
    // Разделов и групп по страницам нет вовсе. Маршрут при этом не теряется:
    // он стоит в служебной строке своей же записи.
    const entries = [
      entryOf('a', 'comment', { route: '/about' }),
      entryOf('b', 'comment', { route: '/price' }),
      entryOf('c', 'comment', { route: '/about' }),
    ]

    const doc = parse(buildReport(inputOf(entries)))

    expect(doc.querySelectorAll('.list').length).toBe(1)
    expect([...doc.querySelectorAll('.edit__head')].map((el) => el.textContent)).toEqual([
      'Область · /about',
      'Область · /price',
      'Область · /about',
    ])
  })

  it('шапка таблицы объявлена в thead: браузер повторит её на втором листе', () => {
    // Опись из десятка правок уезжает на второй лист, и там колонки без
    // подписей опознавать нечем.
    const head = parse(buildReport(inputOf([entryOf('t1', 'text-override')]))).querySelector(
      '.list thead tr',
    )

    expect([...(head?.children ?? [])].map((el) => el.textContent)).toEqual([
      '№',
      'Место',
      'Правка',
    ])
  })

  it('метка лежит СНАРУЖИ масштабируемого узла, а не внутри него', () => {
    // Стык двух решений: окно и масштаб считает документ, геометрию метки —
    // `mark.ts`, и встречаются они только здесь. Внутри узла рамка метки в 2 px
    // ужалась бы вместе с картинкой и с бумаги исчезла.
    const doc = parse(buildReport(inputOf([entryOf('t1', 'text-override')])))

    expect(doc.querySelector('.place__shot .mark')).toBeNull()
    expect(doc.querySelector('.place > .mark')).not.toBeNull()
    // И геометрия у неё в процентах окна, а не в пикселях кадра.
    expect(doc.querySelector('.place > .mark')?.getAttribute('style')).toContain('%')
  })

  it('сквозная нумерация берётся готовой и заново не считается', () => {
    // Номер в документе обязан совпадать с номером метки на странице
    // и с номером записи в списке разбора: это единственная ниточка
    // между бумагой и экраном.
    const entries = [entryOf('t1', 'text-override'), entryOf('c1', 'comment')]
    const numbers = new Map([
      ['t1', 7],
      ['c1', 3],
    ])

    const doc = parse(buildReport(inputOf(entries, { numbers })))

    expect([...doc.querySelectorAll('.tag__no')].map((el) => el.textContent)).toEqual(['7', '3'])
  })

  it('запись без вырезки помечена ЯВНО, а не пропущена молча', () => {
    // Читатель обязан различать «картинки нет» и «места нет»: молчаливый
    // пропуск выглядел бы как недоделанный документ, а выброшенная запись
    // молча потеряла бы правку заказчика.
    const html = buildReport(inputOf([entryOf('t1', 'text-override')], { cutoutOf: () => null }))

    expect(html).toContain('Картинки этого места нет')
    expect(html).toContain('Было так')
  })

  it('несёт шрифтовые правила вырезок и не повторяет их дважды', () => {
    // Без правил объявленное семейство подменяется системным, метрики
    // расходятся, и перенос строки уезжает — а отчёт для того и делается,
    // чтобы «было/стало» выглядело как на сайте.
    const html = buildReport(
      inputOf([entryOf('t1', 'text-override'), entryOf('t2', 'text-override')]),
    )

    const rule = '@font-face{font-family:"Inter"'
    expect(html).toContain(rule)
    expect(html.split(rule).length - 1).toBe(1)
  })

  it('печатает фоны: без этого вырезка приедет белым листом', () => {
    expect(buildReport(inputOf([entryOf('t1', 'text-override')]))).toContain(
      'print-color-adjust: exact',
    )
  })

  it('в документе нет запрещённых техтерминов (FR-36)', () => {
    const html = buildReport(
      inputOf([
        entryOf('t1', 'text-override', { style: { fontSize: '28px' } }),
        entryOf('s1', 'style-wish', { style: { color: 'тёмный' } }),
        entryOf('c1', 'comment'),
      ]),
    )

    // Имя файла из проверки изымается: оно оканчивается на `.json`, а назвать
    // его документ обязан. Изъятие ровно одно и только про имя.
    const withoutFileName = html.replace(/kalka-[^\s<"]+/g, '')
    const text = withoutFileName.toLowerCase()

    for (const word of FORBIDDEN) expect(text).not.toContain(word)
  })

  it('при ПОЛНОМ отсутствии картинок объясняет причину — и только причину', () => {
    // Шесть одинаковых пометок подряд читаются не как «эти места не снялись»,
    // а как «отчёт сломан». Проверено на живом человеке: получив такой документ,
    // он решил, что кнопка не работает.
    const html = buildReport(
      inputOf([entryOf('t1', 'text-override'), entryOf('t2', 'text-override')], {
        cutoutOf: () => null,
      }),
    )

    expect(html).toContain('В этом документе нет картинок мест')
    // Причина названа, а указания, что теперь делать, нет: документ отражает
    // правки, а не распоряжается читателем.
    expect(html).not.toContain('откройте')
    expect(html).not.toContain('напечатайте')
    // Правки при этом на месте: объяснение не заменяет их собой.
    expect(html).toContain('Было так')
  })

  it('при частичном отсутствии картинок объяснения НЕТ', () => {
    // Одна запись без вырезки среди прочих — штатная деградация. Объяснять её
    // значит пугать читателя там, где всё исправно.
    const html = buildReport(
      inputOf([entryOf('t1', 'text-override'), entryOf('t2', 'text-override')], {
        cutoutOf: (id) => (id === 't1' ? cutoutOf() : null),
      }),
    )

    expect(html).not.toContain('В этом документе нет картинок мест')
    expect(html).toContain('Картинки этого места нет')
  })

  it('пустой набор объяснения про картинки не несёт', () => {
    // Правок нет вовсе — говорить «нет картинок» не о чем.
    expect(buildReport(inputOf([]))).not.toContain('В этом документе нет картинок мест')
  })

  it('пустой набор даёт документ, а не пустую строку', () => {
    const html = buildReport(inputOf([]))

    expect(html).toContain('Правок нет')
    expect(html).toContain('<h1 class="head__title">Правки</h1>')
    // Пустой таблицы с одной шапкой при этом не появляется.
    expect(html).not.toContain('<table')
  })
})
