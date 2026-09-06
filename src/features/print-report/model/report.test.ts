import { describe, expect, it } from 'vitest'

import type { Entry, EntryType, Style } from 'shared/model/format'
import type { Cutout } from 'shared/model/layer'
import { buildReport } from './report'
import type { ReportInput } from './report'

/*
 * Документ отчёта.
 *
 * ── Про запрещённые слова ───────────────────────────────────────────────────
 *
 * FR-36 требует, чтобы читатель не видел технических терминов. Список взят
 * из `app/ui/Root.test.tsx`, но с ОДНИМ изъятием: слово `json` из него убрано,
 * потому что имя файла обмена оканчивается на `.json`, а назвать этот файл
 * документ обязан — это единственное смягчение риска «менеджер отправит
 * разработчику один PDF, и применять правки станет нечем». Изъятие ровно одно
 * и касается только имени файла: «формат», «селектор», «якорь», «DOM»
 * в документе по-прежнему запрещены целиком.
 */
const FORBIDDEN = ['селектор', 'якорь', 'dom', 'формат'] as const

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
    // Полоса охватывает якорь с запасом 30px сверху и снизу.
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

describe('buildReport', () => {
  it('раздел «Требует решения» стоит ВПЕРЕДИ «Правок текста»', () => {
    // Порядок подчинён читателю-менеджеру: вперёд то, что требует решения
    // человека, назад то, что агент применит сам.
    const html = buildReport(inputOf([entryOf('t1', 'text-override'), entryOf('c1', 'comment')]))

    // Ищутся именно ЗАГОЛОВКИ разделов: слова «правки текста» встречаются
    // и в рамке под шапкой, где они говорят совсем о другом — откуда правки
    // берутся, — и поиск по голой строке нашёл бы её первой.
    const person = html.indexOf('part__title">Требует решения')
    const agent = html.indexOf('part__title">Правки текста')

    expect(person).toBeGreaterThan(-1)
    expect(agent).toBeGreaterThan(-1)
    expect(person).toBeLessThan(agent)
  })

  it('порядок страниц устойчив: он не зависит от того, где стоял рецензент', () => {
    // На экране список поднимает текущую страницу наверх, и это правильно там.
    // В документе «текущая» — та, где рецензент случайно оказался в момент
    // печати: два прогона по одному набору дали бы разные документы, и сослаться
    // на «третью страницу отчёта» в переписке стало бы нельзя.
    const entries = [
      entryOf('a', 'comment', { route: '/about' }),
      entryOf('b', 'comment', { route: '/price' }),
      entryOf('c', 'comment', { route: '/about' }),
    ]

    const html = buildReport(inputOf(entries))

    expect(html.indexOf('/about')).toBeLessThan(html.indexOf('/price'))
    // Функция вообще не принимает текущий маршрут — подставить его некуда,
    // и это и есть гарантия устойчивости.
    expect(buildReport(inputOf(entries))).toBe(html)
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

    const html = buildReport(inputOf(entries, { numbers }))

    expect(html).toContain('>7<')
    expect(html).toContain('>3<')
    expect(html).not.toContain('>1<')
  })

  it('правка текста с пожеланием оформления несёт помеченную строку', () => {
    // `resolveType` даёт `text-override`, как только изменился текст, а `style`
    // пишется независимо от типа. Отправь такую запись целиком в «Правки
    // текста» — и пожелание, которого агент не применит, утонет в разделе
    // «сделают без вас».
    const entry = entryOf('t1', 'text-override', { style: { fontSize: '28px' } })

    const html = buildReport(inputOf([entry]))

    expect(html).toContain('row--person')
    expect(html).toContain('Требует решения')
    expect(html).toContain('размер 28px')
  })

  it('такая запись учитывается в счётчике «требует решения»', () => {
    const html = buildReport(
      inputOf([
        entryOf('t1', 'text-override', { style: { color: 'тёмный' } }),
        entryOf('t2', 'text-override'),
      ]),
    )

    expect(html).toContain('2 правки, из них 1 требует решения')
  })

  it('запись без вырезки помечена ЯВНО, а не пропущена молча', () => {
    // Читатель обязан различать «картинки нет» и «места нет»: молчаливый
    // пропуск выглядел бы как недоделанный документ, а выброшенная запись
    // молча потеряла бы правку заказчика.
    const html = buildReport(inputOf([entryOf('t1', 'text-override')], { cutoutOf: () => null }))

    expect(html).toContain('Показать это место картинкой не удалось')
    expect(html).toContain('Было так')
  })

  it('называет файл обмена по имени и говорит, что правки берутся из него', () => {
    const html = buildReport(inputOf([entryOf('t1', 'text-override')]))

    expect(html).toContain('kalka-prototype.test-2026-09-06-1015.json')
    expect(html).toContain('отправьте его вместе с этим документом')
  })

  it('без выгрузки имя НЕ выдумывается: документ говорит, что файла ещё нет', () => {
    // Названное имя несуществующего файла хуже отсутствия имени: оно выглядит
    // достоверно и отправляет менеджера искать то, чего нет.
    const html = buildReport(inputOf([entryOf('t1', 'text-override')], { fileName: null }))

    expect(html).toContain('ещё не выгружен')
    expect(html).not.toContain('.json')
  })

  it('несёт шрифтовые правила вырезок и не повторяет их дважды', () => {
    // Без правил объявленное семейство подменяется системным, метрики
    // расходятся, и перенос строки уезжает — а отчёт для того и делается,
    // чтобы «было/стало» выглядело как на сайте.
    const html = buildReport(inputOf([entryOf('t1', 'text-override'), entryOf('t2', 'text-override')]))

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

  it('при ПОЛНОМ отсутствии картинок объясняет это один раз в шапке', () => {
    // Шесть одинаковых пометок «показать не удалось» подряд читаются не как
    // «эти места не снялись», а как «отчёт сломан». Проверено на живом
    // человеке: получив такой документ, он решил, что кнопка не работает.
    const html = buildReport(
      inputOf([entryOf('t1', 'text-override'), entryOf('t2', 'text-override')], {
        cutoutOf: () => null,
      }),
    )

    expect(html).toContain('В этом документе нет картинок мест')
    // Выход называется тот, который действительно работает: картинка снимается
    // и в момент печати, если место есть на открытой странице, — значит совет
    // «внесите правку заново» стал ложным, а «откройте ту страницу» верен.
    expect(html).toContain('откройте страницу')
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
    expect(html).toContain('Показать это место картинкой не удалось')
  })

  it('пустой набор объяснения про картинки не несёт', () => {
    // Правок нет вовсе — говорить «нет картинок» не о чем.
    expect(buildReport(inputOf([]))).not.toContain('В этом документе нет картинок мест')
  })

  it('пустой набор даёт документ, а не пустую строку', () => {
    const html = buildReport(inputOf([]))

    expect(html).toContain('Правок нет')
    expect(html).toContain('Правки к прототипу')
  })
})
