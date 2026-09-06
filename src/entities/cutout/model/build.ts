import { CUTOUT_MAX_BYTES } from 'shared/config/constants'
import { createLogger } from 'shared/lib/log'
import type { AnchorBox, Band, Cutout } from 'shared/model/layer'
import { backgroundBehind, parseRgba, toCss } from './color'

const log = createLogger('cutout:build')

/*
 * Сборка снимка места правки — «вырезки».
 *
 * Вырезка это КЛОН элемента чужой страницы с вкомпилированными вычисленными
 * стилями, вклеиваемый в отчёт как вёрстка, а не как растр. Растровый путь
 * (snapdom и родня) отвергнут: 52 КБ gzip при бюджете виджета в 100 КБ.
 *
 * ── Почему вкомпилированные стили, а не ссылка на таблицы носителя ──────────
 *
 * Документ отчёта живёт в отдельном `<iframe>` и правил носителя не видит.
 * `getComputedStyle` отдаёт ИСПОЛЬЗОВАННЫЕ значения: проценты уже сведены
 * к пикселям, каскадные переменные разрешены, состояние медиазапросов —
 * то самое, что было у рецензента на его ширине окна. Поэтому отдельная
 * «сборка в контейнере шириной вьюпорта» не нужна: ширина вьюпорта уже вошла
 * в каждое значение, а хранить её вторым числом значило бы завести источник
 * правды, который однажды разойдётся с первым.
 *
 * ── Масштабирование живёт в отчёте, а не здесь ──────────────────────────────
 *
 * Кадр снимается в натуральную величину, а ужимает его отчёт — только он знает
 * ширину своей колонки. Заодно это единственный способ не сломать метку:
 * `anchorBox` и доли считаются в пикселях НЕСЖАТОГО кадра, и метка ужимается
 * вместе с картинкой одним преобразованием.
 *
 * ── Куда именно встаёт подменённое содержимое (`replaceContent`) ────────────
 *
 * Подмена нужна съёмке В МОМЕНТ ОТЧЁТА: элемент правки текста несёт «стало»,
 * а на картинке должно быть «было». Всё сказанное ниже касается только этого
 * случая; съёмки в момент правки оно не трогает.
 *
 * Содержимое подменяется у ЯКОРЯ — точнее, у его двойника в клоне, — а не
 * у корня кадра. Разница появилась вместе с кадром во всю ширину страницы:
 * кадр совпадает с якорем только у полноширинного элемента, а обычно это
 * секция-предок. Подмени содержимое кадра — и на бумагу приедет голый фон
 * секции с одной строкой в углу вместо вёрстки места, причём метка останется
 * стоять там, где элемент был на живой странице. Найдено печатью 2026-09-06:
 * дефект просыпался на ВТОРОМ отчёте, потому что первый берёт картинку
 * из буфера и подмены не делает вовсе.
 *
 * Двойник ищется путём индексов `.children` от кадра до якоря, снятым
 * с ЖИВОГО дерева. Опора та же, на которой уже держатся перенос стилей
 * и абсолютизация картинок: `cloneNode(true)` сохраняет порядок детей.
 *
 * ── Две честные оговорки про подмену ────────────────────────────────────────
 *
 * 1. Подставленное поддерево ТЕРЯЕТ вкомпилированные стили вложенных узлов.
 *    Перенос стилей обходит живое дерево и клон парами и потому идёт ДО
 *    подмены — после неё соответствие узлов рассыпалось бы. Унаследованные
 *    с якоря шрифт, размер, цвет и межстрочный интервал остаются,
 *    а разметка внутри (`<b>`, `<i>`, ссылка, список) отрисуется собственным
 *    видом браузера. Для строки текста это обычно незаметно, но
 *    пиксель-в-пиксель не обещается.
 *
 * 2. Высота видимой полосы отсчитывается от ЖИВОГО элемента, то есть от текста
 *    «стало». Если «было» заметно длиннее, нижний край подставленного текста
 *    уйдёт за полосу. Померить клон нельзя: он отсоединён от документа
 *    и размеров не имеет вовсе.
 *
 *    Запас полосы это смягчает, но не снимает: полоса шире якоря на две-три
 *    строки сверху и снизу, и правка, выросшая на строку-другую, целиком
 *    в неё попадает. Целиком проблема закрылась бы только замером клона,
 *    приложенного за экраном, — это переделка съёмки, и она не сделана.
 */

export interface CutoutInput {
  /**
   * Элемент-якорь записи. От его bounding box отсчитываются доли рамки
   * и указателя (`shared/lib/geometry`), поэтому его положение в кадре
   * запоминается отдельно.
   */
  anchor: Element
  /**
   * Что попадает в кадр.
   *
   * Предок во всю ширину страницы: место узнают по окружению, а не по строке,
   * вырванной из вёрстки. По вертикали кадр обрезается полосой — см. `bandPad`.
   */
  frame: Element
  /**
   * Запас видимой полосы над якорем и под ним, px.
   *
   * Кадр во всю ширину почти всегда высок — это секция целиком, — и показывать
   * его целиком незачем: отчёт покажет полосу вокруг якоря с этим запасом.
   */
  bandPad: number
  /**
   * Чем заменить содержимое ЯКОРЯ в КЛОНЕ. Не кадра: кадр это обычно секция
   * вокруг, и подмена в нём стёрла бы всю вёрстку места.
   *
   * Нужно съёмке в момент отчёта: элемент правки текста несёт «стало», а на
   * картинке должно быть «было». Живой элемент при этом не трогается вовсе —
   * подмена идёт в отсоединённом клоне.
   *
   * Куда именно встаёт содержимое и обе оговорки про него — в шапке файла.
   * Не передано — кадр показывает то, что в элементе сейчас.
   */
  replaceContent?: Node
}

/**
 * Свойства, переносимые в клон.
 *
 * Список ЗАКРЫТЫЙ, а не «всё, что отдал `getComputedStyle`». Полный перебор —
 * это около 340 свойств на узел, то есть десятки килобайт на карточку из
 * десятка узлов: буфер и потолок `CUTOUT_MAX_BYTES` съедались бы значениями
 * вроде `animation-timing-function`, ничего не решающими на неподвижной
 * бумаге.
 *
 * Отобрано по одному признаку: влияет ли свойство на то, как место выглядит
 * НА ПЕЧАТИ. Поэтому здесь нет анимаций, переходов, курсоров, прокрутки
 * и всего, что существует только во взаимодействии.
 */
const COPIED_PROPERTIES = [
  // Раскладка: без неё карточка рассыпается в вертикальный список.
  'box-sizing',
  'display',
  'position',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'justify-content',
  'align-items',
  'align-self',
  'grid-template-columns',
  'grid-template-rows',
  'grid-column',
  'grid-row',
  'gap',
  'overflow',
  'float',
  'clear',
  'vertical-align',
  'object-fit',
  // Текст: ради него вырезка и делается — «было/стало» обязано выглядеть
  // как на сайте, иначе спор о переносе строки решать нечем.
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-decoration',
  'text-transform',
  'text-indent',
  'white-space',
  'color',
  // Оформление: фон нужен самопроверке по контрасту, рамки и тени — узнаванию.
  'background-color',
  'background-image',
  'background-size',
  'background-position',
  'background-repeat',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-style',
  'border-color',
  'border-radius',
  'box-shadow',
  'opacity',
] as const

/** Схемы, с которыми ссылка попадает в отчёт. Список из `entities/entry`. */
const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/** Узлы, которым в печатном документе делать нечего. */
const DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'])

/** Размер строки в байтах: потолок назначен в байтах, а не в знаках. */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/**
 * Переносит вычисленные стили с живого дерева на клон, обходя оба разом.
 *
 * Обход ПАРАМИ, а не поиск соответствия по селектору: клон отсоединён от
 * документа, вычисленных стилей у него нет вовсе, и спросить их можно только
 * у оригинала. Порядок детей у `cloneNode(true)` совпадает с оригиналом —
 * это единственное, на чём держится сопоставление.
 */
function inlineStyles(live: Element, clone: Element): void {
  const view = live.ownerDocument.defaultView
  if (view === null) return

  const computed = view.getComputedStyle(live)
  const declarations: string[] = []
  for (const property of COPIED_PROPERTIES) {
    const value = computed.getPropertyValue(property)
    if (value !== '') declarations.push(`${property}:${value}`)
  }

  if (clone instanceof HTMLElement || clone instanceof SVGElement) {
    clone.setAttribute('style', declarations.join(';'))
  }

  const liveChildren = live.children
  const cloneChildren = clone.children
  for (let i = 0; i < liveChildren.length && i < cloneChildren.length; i++) {
    const liveChild = liveChildren[i]
    const cloneChild = cloneChildren[i]
    if (liveChild !== undefined && cloneChild !== undefined) inlineStyles(liveChild, cloneChild)
  }
}

/**
 * Вкомпилировывает в кадр фон, который его красит.
 *
 * ── Зачем это отдельным шагом ───────────────────────────────────────────────
 *
 * Фон элемента чаще всего рисует не он сам, а СЕКЦИЯ-ПРЕДОК, в кадр не попавшая:
 * у абзаца внутри тёмной секции собственный `background-color` прозрачен.
 * Перенеси мы только вычисленные стили самого кадра — и на белой бумаге отчёта
 * такой абзац приедет светлым текстом по белому, то есть нечитаемым.
 *
 * Найдено ручным прогоном на стенде 2026-09-06: абзац из тёмной секции прошёл
 * самопроверку (она мерила фон предка НА СТРАНИЦЕ — и мерила верно) и приехал
 * в документ бледно-голубым по белому. Дефект был не в проверке, а здесь:
 * кадр не уносил фон с собой, и проверка оказывалась права про страницу
 * и неправа про бумагу.
 *
 * Фон берётся той же функцией, которой пользуется самопроверка, — иначе они
 * однажды разойдутся, и вернётся ровно этот дефект.
 */
function paintBackground(live: Element, clone: Element): void {
  const view = live.ownerDocument.defaultView
  if (view === null || !(clone instanceof HTMLElement)) return

  const own = parseRgba(view.getComputedStyle(live).backgroundColor)
  // Свой непрозрачный фон уже перенесён вместе с остальными стилями.
  if (own !== null && own.a > 0) return

  clone.style.backgroundColor = toCss(backgroundBehind(live))
}

/**
 * Раздвигает кадр до ПОЛНОЙ ШИРИНЫ СТРАНИЦЫ холстом.
 *
 * ── Зачем, если предок и так искался во всю ширину ──────────────────────────
 *
 * Потому что находится он не всегда. Блок, лежащий прямо в `<body>` без секции
 * вокруг, полной ширины не достигает: его единственный предок во всю ширину —
 * сам `<body>`, а его кадром брать нельзя, он тащит шапку сайта и подвал.
 * Прототип обычно смешивает оба случая, и тогда соседние картинки одного
 * документа уезжают в разный масштаб — 0.43 у секции против 0.73 у блока.
 * Читатель видит это как разнобой и решает, что часть картинок «крупнее»
 * не по смыслу, а случайно.
 *
 * Холст снимает разнобой: ширина у всех вырезок одна — ширина страницы, —
 * а найденный элемент стоит в холсте ровно там, где стоял на странице.
 * Пустые поля по краям красятся тем же фоном, что лежит за элементом, поэтому
 * на бумаге они выглядят продолжением страницы, а не белой дырой.
 *
 * Байтов это почти не стоит: добавляется один узел, а не клон `<body>`.
 */
function widenToPage(
  clone: Element,
  live: Element,
  frameBox: DOMRect,
  pageWidth: number,
): Element {
  const doc = live.ownerDocument
  const canvas = doc.createElement('div')
  // Фон спрашивается у ЖИВОГО элемента: клон отсоединён, вычисленных стилей
  // у него нет вовсе, и `backgroundBehind` вернул бы по нему бумагу.
  // Отступ ставится ПОЛЕМ ХОЛСТА, а не полем клона. У клона поля только что
  // сняты (`dropOuterMargins`), и вернуть одно из них значило бы спорить с этим
  // решением через сокращённую запись `margin` — а как сложатся сокращённая
  // и отдельная записи, зависит от порядка и от браузера. У холста своих полей
  // нет вовсе, спорить не с чем.
  canvas.setAttribute(
    'style',
    `box-sizing:border-box;position:relative;width:${pageWidth}px;` +
      `height:${frameBox.height}px;padding-left:${frameBox.left}px;` +
      `background-color:${toCss(backgroundBehind(live))}`,
  )

  canvas.appendChild(clone)
  return canvas
}

/**
 * Снимает поля с КОРНЯ кадра.
 *
 * ── Почему это не косметика ─────────────────────────────────────────────────
 *
 * `getComputedStyle` отдаёт ИСПОЛЬЗОВАННОЕ значение полей, а не объявленное.
 * У блока с `margin: 0 auto` это настоящие пиксели центрирования на ширине окна
 * рецензента — на 1440 это под три сотни. У заголовка это его верхнее поле.
 * Перенеси их в клон — и содержимое уедет внутри кадра вправо и вниз, потому
 * что размер кадра снят с `getBoundingClientRect`, а он полей НЕ включает.
 * Кадр обрезает по себе, и наружу выходит либо срезанная наполовину карточка,
 * либо пустая полоска вместо строки текста.
 *
 * Найдено печатью на стенде 2026-09-06: испортились все три картинки документа,
 * причём в jsdom дефект не воспроизводится вовсе — там нет раскладки,
 * и `margin: auto` остаётся `auto`, а не превращается в пиксели.
 *
 * Снимаются поля ТОЛЬКО у корня: положение кадра на чужой странице к отчёту
 * отношения не имеет. Поля детей остаются — на них держится расстояние между
 * строками карточки, и они уже вошли в высоту кадра.
 */
function dropOuterMargins(clone: Element): void {
  if (clone instanceof HTMLElement || clone instanceof SVGElement) {
    clone.style.margin = '0'
  }
}

/**
 * Путь от кадра до якоря индексами `.children`. `null` — якорь не в кадре.
 *
 * Считается по ЖИВОМУ дереву и применяется к клону: клон отсоединён, искать
 * в нём по селектору нечем — класс с него ещё и снимается чисткой. Порядок
 * детей у `cloneNode(true)` совпадает с оригиналом, и на этом же держатся
 * перенос стилей и абсолютизация картинок.
 *
 * Индексы по `.children`, а не по `childNodes`: два обхода выше считают ими же,
 * и разойтись счёт не имеет права. Текстовые узлы между кадром и якорем на
 * нумерацию элементов не влияют.
 *
 * Пустой путь у `anchor === frame` — законный ответ: подменяется сам кадр,
 * как было до кадра во всю ширину.
 */
function pathToAnchor(frame: Element, anchor: Element): number[] | null {
  const path: number[] = []

  let node: Element = anchor
  while (node !== frame) {
    const parent = node.parentElement
    if (parent === null) return null

    const index = [...parent.children].indexOf(node)
    if (index < 0) return null

    path.unshift(index)
    node = parent
  }

  return path
}

/** Узел по пути индексов. `null` — путь не разрешился. */
function nodeByPath(root: Element, path: readonly number[]): Element | null {
  let node: Element = root
  for (const index of path) {
    const child = node.children[index]
    if (child === undefined) return null
    node = child
  }
  return node
}

/** Абсолютный адрес картинки: относительный в чужом документе не разрешится. */
function absolutizeImages(live: Element, clone: Element): void {
  if (live instanceof HTMLImageElement && clone instanceof HTMLImageElement) {
    // `currentSrc` — то, что браузер РЕАЛЬНО выбрал из `srcset` на ширине
    // рецензента. Сам `srcset` в отчёт не переносится: он выбирал бы заново
    // по ширине бумажной колонки и мог бы принести другую картинку.
    const chosen = live.currentSrc !== '' ? live.currentSrc : live.src
    if (chosen !== '') clone.setAttribute('src', chosen)
    clone.removeAttribute('srcset')
    clone.removeAttribute('loading')
  }

  const liveChildren = live.children
  const cloneChildren = clone.children
  for (let i = 0; i < liveChildren.length && i < cloneChildren.length; i++) {
    const liveChild = liveChildren[i]
    const cloneChild = cloneChildren[i]
    if (liveChild !== undefined && cloneChild !== undefined) absolutizeImages(liveChild, cloneChild)
  }
}

/** Разрешена ли схема адреса. Неразбираемый адрес считается неразрешённым. */
function allowedUrl(value: string, base: string): boolean {
  try {
    return ALLOWED_URL_SCHEMES.has(new URL(value, base).protocol)
  } catch {
    return false
  }
}

/**
 * Вшитая картинка: `data:` с типом изображения у САМОГО `<img>`.
 *
 * ── Почему исключение из белого списка схем ─────────────────────────────────
 *
 * Прототипы держат мелкие значки и логотипы вшитыми в разметку, а не файлами.
 * Отбрось такой адрес заодно со всеми `data:` — и в отчёт приедет карточка
 * с пустыми рамками вместо картинок. Найдено печатью на стенде 2026-09-06:
 * обе картинки карточки вышли битыми значками.
 *
 * ── Почему это не дыра ──────────────────────────────────────────────────────
 *
 * Разрешение узкое дважды. Только тег `IMG`: у `<iframe>`, `<object>`
 * и `<embed>` тот же атрибут `src`, и `data:text/html` в них исполняется —
 * этим и опасен `data:`. И только тип `image/`: картинка, загруженная тегом
 * `<img>`, живёт в защищённом статическом режиме, где не исполняются скрипты
 * и не грузится ничего внешнего, даже когда внутри SVG.
 *
 * Ссылкам (`href`) исключение не даётся вовсе: там `data:` открывает документ
 * в origin прототипа, и это ровно то, что запрещает белый список.
 */
function inlineImage(node: Element, name: string, value: string): boolean {
  return node.tagName === 'IMG' && name === 'src' && /^data:image\//i.test(value.trim())
}

/**
 * Чистка клона.
 *
 * ── Почему это не украшательство ────────────────────────────────────────────
 *
 * Документ отчёта уезжает в `<iframe srcdoc>`, а такой iframe ТОГО ЖЕ origin,
 * что страница-носитель. Уцелевший `onerror` у картинки или `onclick` у ссылки
 * исполнится в origin прототипа прямо в печатном документе, и изоляции
 * теневого корня там уже нет. Тот же довод, по которому `entities/entry`
 * держит белый список схем ссылок и снимает атрибуты поштучно; свой проход
 * здесь потому, что соседние слайсы одного слоя друг друга не импортируют.
 */
function clean(clone: Element, base: string): void {
  for (const node of [...clone.querySelectorAll('*')].reverse()) {
    if (DROPPED_TAGS.has(node.tagName)) {
      node.remove()
      continue
    }
    scrubAttributes(node, base)
  }
  scrubAttributes(clone, base)
}

function scrubAttributes(node: Element, base: string): void {
  for (const attribute of [...node.attributes]) {
    const name = attribute.name.toLowerCase()

    // Стили уже инлайновые, а класс носителя в отчёте всё равно не к чему
    // применить: таблиц стилей сайта в документе отчёта нет.
    if (name === 'class') {
      node.removeAttribute(attribute.name)
      continue
    }

    // Любой обработчик события, а не перечисленные поимённо: список `onclick`,
    // `onerror`, `onload` устареет на первом же новом событии, а префикс — нет.
    if (name.startsWith('on')) {
      node.removeAttribute(attribute.name)
      continue
    }

    if (
      (name === 'href' || name === 'src') &&
      !allowedUrl(attribute.value, base) &&
      !inlineImage(node, name, attribute.value)
    ) {
      node.removeAttribute(attribute.name)
    }
  }
}

/**
 * Правила `@font-face` носителя.
 *
 * Без них объявленное семейство молча подменяется системным: в изолированном
 * документе `document.fonts` пуст, метрики расходятся, и трёх процентов разницы
 * хватает, чтобы сместить перенос строки.
 *
 * Каждая таблица читается ОТДЕЛЬНО и под защитой: обращение к `cssRules`
 * у таблицы с другого origin бросает `SecurityError`, а шрифты как раз обычно
 * и раздаются с CDN — то есть отказ приходится ровно на тот случай, ради
 * которого правила и собираются. Довод «печать идёт с того же origin»
 * относится к origin ДОКУМЕНТА отчёта, а не к origin таблицы стилей. Пустой
 * ответ съёмку не отменяет: шрифт подменится системным, и это честная
 * деградация, а не отказ.
 */
function collectFontFaces(doc: Document): string[] {
  const rules: string[] = []
  let blocked = 0

  for (const sheet of [...doc.styleSheets]) {
    try {
      for (const rule of [...sheet.cssRules]) {
        if (rule.constructor.name === 'CSSFontFaceRule') rules.push(rule.cssText)
      }
    } catch {
      blocked += 1
    }
  }

  if (blocked > 0) log.warn('таблицы стилей недоступны, шрифты неполны', { таблиц: blocked })
  return rules
}

/**
 * Снимок места правки. `null` — снять не удалось, отчёт покажет текст
 * с явной пометкой.
 *
 * В лог не уходят ни текст элемента, ни разметка, ни адрес сайта: это
 * содержимое чужой страницы (тот же запрет, что в `shared/api/storage.ts`).
 */
export function buildCutout({
  anchor,
  frame,
  bandPad,
  replaceContent,
}: CutoutInput): Cutout | null {
  const startedAt = performance.now()
  const frameBox = frame.getBoundingClientRect()

  log.debug('съёмка вырезки', {
    тег: frame.tagName.toLowerCase(),
    ширина: Math.round(frameBox.width),
    высота: Math.round(frameBox.height),
    узлов: frame.querySelectorAll('*').length + 1,
    подмена: replaceContent !== undefined,
  })

  // Вырожденный кадр — скрытый элемент: свёрнутый аккордеон, неактивная
  // вкладка. Снимать нечего, и пустая картинка хуже честной пометки.
  if (frameBox.width === 0 || frameBox.height === 0) {
    log.warn('кадр нулевого размера, вырезка не снята', { тег: frame.tagName.toLowerCase() })
    return null
  }

  const doc = frame.ownerDocument
  // Путь снимается с живого дерева ДО клонирования и до чистки: клон
  // отсоединён, а чистка снимет с узлов классы, по которым его было бы
  // искать. Разбор — в шапке `pathToAnchor`.
  const anchorPath = replaceContent === undefined ? null : pathToAnchor(frame, anchor)

  const clone = frame.cloneNode(true)
  if (!(clone instanceof Element)) return null

  inlineStyles(frame, clone)
  // Сразу после переноса стилей и до всего остального: поля корня пришли вместе
  // с ними и врут про кадр — разбор в шапке `dropOuterMargins`.
  dropOuterMargins(clone)
  paintBackground(frame, clone)
  absolutizeImages(frame, clone)

  // Подмена содержимого стоит ИМЕННО ЗДЕСЬ, и оба соседа выбраны не случайно.
  // После переноса стилей и абсолютизации: те два прохода обходят живое дерево
  // и клон парами, и подменённое поддерево сломало бы соответствие узлов.
  // До чистки: снятие обработчиков событий и запрет чужих схем обязаны пройти
  // и по подставленному содержимому тоже — оно приезжает из хранилища
  // и доверенным не является.
  //
  // Цель подмены — двойник ЯКОРЯ, а не корень клона: кадр это обычно секция
  // вокруг. Не нашёлся — не подменяем вовсе. Картинка покажет «стало» вместо
  // «было», и это расхождение с подписью под ней; но стереть содержимое кадра
  // значило бы потерять и место, и текст разом, а место — единственное, чего
  // нет в строках «Было/Стало».
  if (replaceContent !== undefined) {
    const target = anchorPath === null ? null : nodeByPath(clone, anchorPath)

    if (target === null) {
      log.warn('место правки в кадре не найдено, показано текущее содержимое', {
        тег: frame.tagName.toLowerCase(),
      })
    } else {
      target.replaceChildren(replaceContent)
    }
  }

  clean(clone, doc.baseURI)

  // Холст во всю ширину страницы ставится ПОСЛЕ чистки: он наш, а не носителя,
  // и чистить в нём нечего — а попади он под чистку, с него слетел бы стиль,
  // которым он и держит ширину.
  const pageWidth = doc.documentElement.clientWidth || doc.defaultView?.innerWidth || frameBox.width
  const canvas = widenToPage(clone, frame, frameBox, pageWidth)

  const html = canvas.outerHTML
  const bytes = byteLength(html)

  if (bytes > CUTOUT_MAX_BYTES) {
    log.warn('вырезка не влезла в потолок', { байт: bytes, потолок: CUTOUT_MAX_BYTES })
    return null
  }

  // Координаты якоря отсчитываются от ХОЛСТА, а не от кадра: холст и есть
  // теперь вырезка, и метка ставится в его системе координат. По горизонтали
  // левый край холста совпадает с левым краем страницы, поэтому `left`
  // элемента берётся как есть.
  const anchorRect = anchor.getBoundingClientRect()
  const anchorBox: AnchorBox = {
    x: anchorRect.left,
    y: anchorRect.top - frameBox.top,
    w: anchorRect.width,
    h: anchorRect.height,
  }

  // Полоса считается ОТ ЯКОРЯ, а не от кадра: кадр это секция целиком, и его
  // середина к правке отношения не имеет. Края подрезаются по кадру — уехать
  // выше его верха или ниже низа полоса не имеет права, иначе отчёт покажет
  // пустоту вместо места.
  const bandTop = Math.max(0, anchorBox.y - bandPad)
  const band: Band = {
    y: bandTop,
    h: Math.min(frameBox.height - bandTop, anchorBox.h + bandPad * 2),
  }

  const fontFaces = collectFontFaces(doc)

  log.debug('вырезка собрана', {
    байт: bytes,
    мс: Math.round((performance.now() - startedAt) * 10) / 10,
    шрифтовыхПравил: fontFaces.length,
  })

  return {
    html,
    width: pageWidth,
    height: frameBox.height,
    band,
    anchorBox,
    fontFaces,
    at: new Date().toISOString(),
  }
}
