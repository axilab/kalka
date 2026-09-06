import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CUTOUT_MAX_BYTES } from 'shared/config/constants'
import { buildCutout } from './build'

/*
 * Сборка вырезки.
 *
 * Самое существенное здесь — ЧИСТКА. Документ отчёта уезжает в `<iframe srcdoc>`,
 * а такой iframe того же origin, что страница-носитель: уцелевший `onerror`
 * у картинки исполнится в origin прототипа прямо в печатном документе,
 * и изоляции теневого корня там уже нет.
 */

let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  host.remove()
  vi.restoreAllMocks()
})

/** Элемент с ненулевым bounding box: jsdom сам размеров не считает. */
function sized(el: Element, box: { x: number; y: number; w: number; h: number }): Element {
  el.getBoundingClientRect = () => new DOMRect(box.x, box.y, box.w, box.h)
  return el
}

function put(html: string, box = { x: 0, y: 0, w: 320, h: 40 }): Element {
  host.innerHTML = html
  const el = host.firstElementChild
  if (el === null) throw new Error('нечего снимать')
  return sized(el, box)
}

describe('buildCutout', () => {
  it('вкомпилировывает вычисленные стили в клон', () => {
    // Документ отчёта правил носителя не видит вовсе: без инлайновых стилей
    // вырезка приехала бы голым текстом, и «было/стало» перестало бы выглядеть
    // как на сайте.
    const el = put('<p style="color: rgb(10, 20, 30)">Строка</p>')

    const cutout = buildCutout({ anchor: el, frame: el, bandPad: 0 })

    // Проверяется перенос значения, а не полнота набора свойств: jsdom считает
    // далеко не все, и ассерт на его пробелы проверял бы jsdom, а не нас.
    // Пробелы в записи стиля тоже не проверяются: их расставляет CSSOM,
    // и они меняются от одного обращения к `clone.style`.
    expect(cutout?.html.replace(/\s+/g, '')).toContain('color:rgb(10,20,30)')
    expect(cutout?.html).toContain('style=')
  })

  it('уносит с собой фон СЕКЦИИ-ПРЕДКА, если своего у кадра нет', () => {
    // Фон элемента чаще всего рисует не он сам, а секция-предок, в кадр
    // не попавшая. Не унеси кадр этот фон — светлый текст из тёмной секции
    // приедет на белую бумагу нечитаемым, пройдя самопроверку насквозь
    // (она мерит фон предка НА СТРАНИЦЕ и мерит верно).
    // Найдено ручным прогоном на стенде 2026-09-06.
    host.innerHTML =
      '<section style="background-color: rgb(16, 24, 64)">' +
      '<p style="color: rgb(201, 210, 245)">Строка</p></section>'
    const el = sized(host.querySelector('p') as Element, { x: 0, y: 0, w: 320, h: 40 })

    const html = buildCutout({ anchor: el, frame: el, bandPad: 0 })?.html.replace(/\s+/g, '') ?? ''

    expect(html).toContain('background-color:rgb(16,24,64)')
  })

  it('свой непрозрачный фон кадра не подменяется фоном предка', () => {
    host.innerHTML =
      '<section style="background-color: rgb(16, 24, 64)">' +
      '<p style="background-color: rgb(255, 255, 255)">Строка</p></section>'
    const el = sized(host.querySelector('p') as Element, { x: 0, y: 0, w: 320, h: 40 })

    const html = buildCutout({ anchor: el, frame: el, bandPad: 0 })?.html.replace(/\s+/g, '') ?? ''

    expect(html).toContain('background-color:rgb(255,255,255)')
    expect(html).not.toContain('background-color:rgb(16,24,64)')
  })

  it('снимает класс: применить его в отчёте всё равно не к чему', () => {
    const el = put('<p class="hero__title">Строка</p>')

    expect(buildCutout({ anchor: el, frame: el, bandPad: 0 })?.html).not.toContain('hero__title')
  })

  it('вырезает script, style и noscript', () => {
    const el = put(
      '<div><p>Строка</p><script>alert(1)</script><style>p{color:red}</style>' +
        '<noscript>без скриптов</noscript></div>',
    )

    const html = buildCutout({ anchor: el, frame: el, bandPad: 0 })?.html ?? ''

    expect(html).not.toContain('alert(1)')
    expect(html).not.toContain('<style')
    expect(html).not.toContain('noscript')
    expect(html).toContain('Строка')
  })

  it('снимает ЛЮБЫЕ обработчики событий, а не перечисленные поимённо', () => {
    // Список `onclick`/`onerror`/`onload` устарел бы на первом же новом
    // событии; префикс `on` — нет.
    const el = put(
      '<div onclick="alert(1)"><img onerror="alert(2)" src="/a.png">' +
        '<span onmouseenter="alert(3)">Строка</span></div>',
    )

    const html = buildCutout({ anchor: el, frame: el, bandPad: 0 })?.html ?? ''

    expect(html).not.toContain('onclick')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('onmouseenter')
    expect(html).not.toContain('alert(')
  })

  it('снимает ссылки со схемой вне http, https и mailto', () => {
    const el = put('<div><a href="javascript:alert(1)">Ссылка</a></div>')

    const html = buildCutout({ anchor: el, frame: el, bandPad: 0 })?.html ?? ''

    expect(html).not.toContain('javascript:')
    expect(html).toContain('Ссылка')
  })

  it('обычную ссылку оставляет: она часть места правки', () => {
    const el = put('<div><a href="https://example.test/a">Ссылка</a></div>')

    expect(buildCutout({ anchor: el, frame: el, bandPad: 0 })?.html).toContain('https://example.test/a')
  })

  it('возвращает null при превышении потолка размера', () => {
    // Честная деградация: секция в сотни узлов не влезет в колонку отчёта
    // читаемой, и страница нечитаемой мелочи хуже пометки «показать не удалось».
    const el = put(`<p>${'очень длинная строка текста. '.repeat(3000)}</p>`)

    const cutout = buildCutout({ anchor: el, frame: el, bandPad: 0 })

    expect(cutout).toBeNull()
    expect(CUTOUT_MAX_BYTES).toBeGreaterThan(0)
  })

  it('возвращает null у вырожденного кадра: снимать нечего', () => {
    const el = put('<p>Строка</p>', { x: 0, y: 0, w: 0, h: 0 })

    expect(buildCutout({ anchor: el, frame: el, bandPad: 0 })).toBeNull()
  })

  it('запоминает положение якоря ВНУТРИ широкого кадра', () => {
    // Несущее свойство для метки: доли рамки отсчитываются от bounding box
    // ЯКОРЯ, а кадр замечания шире якоря. Без этого поля метка промахнулась бы
    // ровно у того типа записи, весь смысл которого «вот это здесь».
    host.innerHTML = '<section><p>Строка</p></section>'
    const frame = sized(host.firstElementChild as Element, { x: 100, y: 200, w: 600, h: 300 })
    const anchor = sized(frame.firstElementChild as Element, { x: 140, y: 260, w: 320, h: 40 })

    const cutout = buildCutout({ anchor, frame, bandPad: 0 })

    // Вырезка всегда шириной со СТРАНИЦУ, а кадр стоит в ней на своём месте.
    // Иначе соседние картинки одного документа уезжают в разный масштаб:
    // секция во всю ширину даёт 0.43, а блок прямо в <body> — 0.73, и читатель
    // видит разнобой, которого в вёрстке нет.
    expect(cutout?.width).toBe(window.innerWidth)
    expect(cutout?.height).toBe(300)
    expect(cutout?.html.replace(/\s+/g, '')).toContain('padding-left:100px')
    // Якорь — в координатах ХОЛСТА: по горизонтали от левого края страницы,
    // по вертикали от верха кадра.
    expect(cutout?.anchorBox).toEqual({ x: 140, y: 60, w: 320, h: 40 })
  })

  it('полоса охватывает якорь с запасом сверху и снизу', () => {
    // Кадр берётся во всю ширину страницы и потому высок — это секция целиком.
    // Показывать её целиком незачем: отчёт показывает полосу вокруг якоря.
    host.innerHTML = '<section><p>Строка</p></section>'
    const frame = sized(host.firstElementChild as Element, { x: 0, y: 0, w: 1440, h: 900 })
    const anchor = sized(frame.firstElementChild as Element, { x: 0, y: 300, w: 320, h: 40 })

    const cutout = buildCutout({ anchor, frame, bandPad: 32 })

    expect(cutout?.band).toEqual({ y: 268, h: 104 })
  })

  it('полоса не вылезает за края кадра', () => {
    // Уехавшая полоса показала бы пустоту вместо места правки: сверху — выше
    // верха кадра, снизу — ниже его низа.
    host.innerHTML = '<section><p>Строка</p></section>'
    const frame = sized(host.firstElementChild as Element, { x: 0, y: 0, w: 1440, h: 60 })
    const anchor = sized(frame.firstElementChild as Element, { x: 0, y: 10, w: 320, h: 40 })

    const cutout = buildCutout({ anchor, frame, bandPad: 200 })

    // Верх упёрся в ноль, низ — в высоту кадра.
    expect(cutout?.band).toEqual({ y: 0, h: 60 })
  })

  it('когда кадр и есть якорь, по вертикали он в нуле, а по горизонтали — на месте', () => {
    const el = put('<p>Строка</p>', { x: 50, y: 60, w: 320, h: 40 })

    const cutout = buildCutout({ anchor: el, frame: el, bandPad: 0 })

    expect(cutout?.anchorBox).toEqual({ x: 50, y: 0, w: 320, h: 40 })
  })

  it('недоступная таблица стилей не роняет съёмку', () => {
    // Обращение к `cssRules` у таблицы с другого origin бросает SecurityError,
    // а шрифты обычно и раздаются с CDN — то есть отказ приходится ровно
    // на тот случай, ради которого правила и собираются. Виджет — гость,
    // и падать здесь он не имеет права (NFR-06).
    const el = put('<p>Строка</p>')
    vi.spyOn(document, 'styleSheets', 'get').mockReturnValue({
      *[Symbol.iterator]() {
        yield {
          get cssRules(): never {
            throw new Error('SecurityError')
          },
        }
      },
    } as unknown as StyleSheetList)

    const cutout = buildCutout({ anchor: el, frame: el, bandPad: 0 })

    expect(cutout).not.toBeNull()
    expect(cutout?.fontFaces).toEqual([])
  })

  it('вшитая картинка доезжает, а вшитый документ и ссылка — нет', () => {
    // Прототипы держат значки и логотипы вшитыми в разметку. Отбрось такой
    // адрес заодно со всеми `data:` — и карточка приедет с пустыми рамками
    // вместо картинок (найдено печатью на стенде 2026-09-06). Разрешение узкое:
    // только тег IMG и только тип image/ — `data:text/html` в кадре исполнился
    // бы в origin прототипа.
    host.innerHTML =
      '<div>' +
      '<img src="data:image/svg+xml;utf8,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'/%3E" />' +
      '<img src="data:text/html,%3Cscript%3Ealert(1)%3C/script%3E" />' +
      '<iframe src="data:image/svg+xml,x"></iframe>' +
      '<a href="data:image/svg+xml,x">ссылка</a>' +
      '</div>'
    const el = sized(host.firstElementChild as Element, { x: 0, y: 0, w: 320, h: 40 })

    const html = buildCutout({ anchor: el, frame: el, bandPad: 0 })?.html ?? ''

    expect(html).toContain('data:image/svg+xml;utf8')
    expect(html).not.toContain('data:text/html')
    // У кадра и рамки тот же атрибут `src`, но исключение им не даётся.
    expect(html).not.toMatch(/<iframe[^>]*src=/)
    expect(html).not.toMatch(/<a[^>]*href=/)
  })

  it('поля КОРНЯ кадра снимаются, поля детей остаются', () => {
    // `getComputedStyle` отдаёт использованное значение полей: у блока
    // с `margin: 0 auto` это пиксели центрирования на ширине окна рецензента.
    // Перенеси их в клон — и содержимое уедет внутри кадра, размер которого
    // снят с bounding box, а он полей не включает. Найдено печатью на стенде
    // 2026-09-06: испортились все три картинки документа.
    host.innerHTML =
      '<div style="margin: 0 274px"><p style="margin: 12px 0">Строка</p></div>'
    const el = sized(host.firstElementChild as Element, { x: 0, y: 0, w: 892, h: 40 })
    sized(el.firstElementChild as Element, { x: 0, y: 0, w: 860, h: 20 })

    const html = buildCutout({ anchor: el, frame: el, bandPad: 0 })?.html.replace(/\s+/g, '') ?? ''

    // Поля страницы сняты: 274 пикселя центрирования в разметку не попали.
    // Осталось только левое поле, которым холст ставит кадр на его место,
    // а у этого кадра оно нулевое.
    expect(html).not.toContain('274px')
    expect(html).toContain('margin:0px')
    // А у ребёнка остались: на них держится расстояние между строками.
    expect(html).toContain('margin-top:12px')
  })

  it('подставляет переданное содержимое вместо содержимого кадра', () => {
    // Нужно съёмке в момент отчёта: элемент правки текста несёт «стало»,
    // а на картинке должно быть «было».
    const el = put('<p>Стало так</p>')
    const replaceContent = document.createDocumentFragment()
    replaceContent.append(document.createTextNode('Было так'))

    const cutout = buildCutout({ anchor: el, frame: el, bandPad: 0, replaceContent })

    expect(cutout?.html).toContain('Было так')
    expect(cutout?.html).not.toContain('Стало так')
  })

  it('подмена идёт в ЯКОРЬ, а не в корень кадра', () => {
    // Ровно тот случай, что бывает в жизни и не бывает в остальных тестах
    // подмены: кадр НЕ равен якорю. С тех пор как кадр берётся во всю ширину
    // страницы, он равен якорю только у полноширинного элемента, а обычно это
    // секция-предок. Подмени содержимое кадра — и в отчёт приедет голый фон
    // секции с одной строкой в углу вместо вёрстки места.
    host.innerHTML =
      '<section><header><h2>Стало так</h2></header><p>Соседний абзац</p></section>'
    const frame = sized(host.firstElementChild as Element, { x: 0, y: 0, w: 1200, h: 400 })
    const anchor = sized(host.querySelector('h2') as Element, { x: 40, y: 20, w: 300, h: 40 })
    const replaceContent = document.createDocumentFragment()
    replaceContent.append(document.createTextNode('Было так'))

    const html = buildCutout({ anchor, frame, bandPad: 0, replaceContent })?.html ?? ''

    expect(html).toContain('Было так')
    expect(html).not.toContain('Стало так')
    // Главное: окружение места правки уцелело. Без этого картинка отвечает
    // на «где это на странице» пустотой.
    expect(html).toContain('Соседний абзац')
  })

  it('подмена не стирает кадр, когда якорь в нём не лежит', () => {
    // Вырожденный случай: звать так не должны, но если позвали — картинка
    // с непокрашенным «стало» честнее пустой секции. Стереть содержимое кадра
    // тут значит потерять и место, и текст разом.
    host.innerHTML = '<section><p>Соседний абзац</p></section>'
    const frame = sized(host.firstElementChild as Element, { x: 0, y: 0, w: 1200, h: 400 })
    const stranger = sized(document.createElement('h2'), { x: 40, y: 20, w: 300, h: 40 })
    const replaceContent = document.createDocumentFragment()
    replaceContent.append(document.createTextNode('Было так'))

    const html = buildCutout({ anchor: stranger, frame, bandPad: 0, replaceContent })?.html ?? ''

    expect(html).toContain('Соседний абзац')
  })

  it('живой элемент при подмене НЕ меняется', () => {
    // Прямая проверка того, что страница носителя не трогается вовсе: подмена
    // идёт в отсоединённом клоне. Ошибись здесь — и печать отчёта переписала бы
    // чужую страницу на глазах у рецензента.
    const el = put('<p>Стало так</p>')
    const replaceContent = document.createDocumentFragment()
    replaceContent.append(document.createTextNode('Было так'))

    buildCutout({ anchor: el, frame: el, bandPad: 0, replaceContent })

    expect(el.textContent).toBe('Стало так')
  })

  it('чистка проходит и по подставленному содержимому', () => {
    // Подмена стоит ДО чистки не случайно: содержимое приезжает из хранилища
    // и доверенным не является, а документ уезжает в iframe того же origin,
    // что страница-носитель.
    const el = put('<p>Стало так</p>')
    const replaceContent = document.createDocumentFragment()
    const injected = document.createElement('img')
    injected.setAttribute('src', 'https://example.test/p.png')
    injected.setAttribute('onerror', 'alert(1)')
    const link = document.createElement('a')
    link.setAttribute('href', 'javascript:alert(1)')
    link.textContent = 'ссылка'
    replaceContent.append(injected, link)

    const html = buildCutout({ anchor: el, frame: el, bandPad: 0, replaceContent })?.html ?? ''

    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('https://example.test/p.png')
  })
})
