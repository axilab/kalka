import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isInsideKalka,
  isTextElement,
  onDocumentReady,
  pickTarget,
  scrollToElement,
  usesTextPath,
  writeTextNodes,
} from './dom'
import { normalize } from './normalize'

describe('isInsideKalka', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('видит свой узел внутри открытого shadow root через composedPath', () => {
    const host = document.createElement('div')
    host.setAttribute('data-kalka-root', '')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const button = document.createElement('button')
    shadow.append(button)

    let inside: boolean | null = null
    document.addEventListener('click', (event) => {
      inside = isInsideKalka(event)
    })

    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))

    expect(inside).toBe(true)
  })

  it('обычный элемент страницы своим не считается', () => {
    const outside = document.createElement('div')
    document.body.append(outside)

    let inside: boolean | null = null
    document.addEventListener('click', (event) => {
      inside = isInsideKalka(event)
    })

    outside.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))

    expect(inside).toBe(false)
  })
})

describe('onDocumentReady', () => {
  const original = Object.getOwnPropertyDescriptor(document, 'readyState')

  afterEach(() => {
    if (original) Object.defineProperty(document, 'readyState', original)
    else Reflect.deleteProperty(document, 'readyState')
  })

  function pretendLoading(): void {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true })
  }

  it('на готовом документе вызывает колбэк синхронно', () => {
    const run = vi.fn()

    onDocumentReady(run)

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('на загружающемся документе ждёт DOMContentLoaded', () => {
    pretendLoading()
    const run = vi.fn()

    onDocumentReady(run)
    expect(run).not.toHaveBeenCalled()

    document.dispatchEvent(new Event('DOMContentLoaded'))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('отмена снимает ожидание готовности', () => {
    pretendLoading()
    const run = vi.fn()

    const cancel = onDocumentReady(run)
    cancel()
    document.dispatchEvent(new Event('DOMContentLoaded'))

    expect(run).not.toHaveBeenCalled()
  })
})

/*
 * Прокрутка к месту правки с поправкой на занятую интерфейсом полосу.
 *
 * До ящика поправки не требовалось вовсе: виджет занимал угол. Ящик занимает
 * полосу у правого края, и запись, чей элемент лежит в правой части страницы,
 * оказывается ровно под ним — прокрутка отработает, подсветка встанет,
 * а человек не увидит ни того, ни другого.
 */
describe('scrollToElement: поправка на перекрытие', () => {
  const WIDTH = 1000
  const HEIGHT = 800
  /** Ящик занимает правую полосу во всю высоту. */
  const DRAWER = new DOMRect(600, 0, 400, HEIGHT)

  let scrolledTo: number | null

  /** Элемент с заданным прямоугольником и предсказуемой прокруткой. */
  function elementAt(left: number, top: number, width = 200, height = 40): Element {
    const el = document.createElement('div')
    document.body.append(el)
    el.getBoundingClientRect = (): DOMRect => new DOMRect(left, top, width, height)
    el.scrollIntoView = (): void => {}
    return el
  }

  beforeEach(() => {
    document.body.innerHTML = ''
    window.innerWidth = WIDTH
    window.innerHeight = HEIGHT
    window.scrollX = 0
    scrolledTo = null
    // Документ шире экрана: иначе двигать цель некуда, и поправка законно молчит.
    vi.spyOn(document.documentElement, 'scrollWidth', 'get').mockReturnValue(2000)
    window.scrollTo = ((options: ScrollToOptions) => {
      scrolledTo = options.left ?? null
    }) as typeof window.scrollTo
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('без переданной полосы горизонтальную прокрутку не трогает', () => {
    // Ровно прежнее поведение: параметра нет — виджет ведёт себя как до ящика.
    scrollToElement(elementAt(700, 100))

    expect(scrolledTo).toBeNull()
  })

  it('уводит цель из-под ящика', () => {
    scrollToElement(elementAt(700, 100), DRAWER)

    expect(scrolledTo).not.toBeNull()
    // После сдвига правый край цели встаёт левее ящика с зазором.
    const rightAfter = 700 + 200 - (scrolledTo ?? 0)
    expect(rightAfter).toBeLessThanOrEqual(DRAWER.left)
  })

  it('не двигает цель, часть которой уже видна слева от ящика', () => {
    // Широкий элемент, начинающийся в свободной части: выталкивать его влево
    // до потери начала — хуже, чем оставить как есть.
    scrollToElement(elementAt(100, 100, 700), DRAWER)

    expect(scrolledTo).toBeNull()
  })

  it('не двигает цель, которая ящика не касается', () => {
    scrollToElement(elementAt(100, 100), DRAWER)

    expect(scrolledTo).toBeNull()
  })

  it('считает вертикаль по БУДУЩЕМУ положению цели, а не по нынешнему', () => {
    // Цель далеко за нижним краем экрана: поправка выдаётся до прокрутки,
    // и проверка пересечения по нынешнему положению не сработала бы вовсе.
    scrollToElement(elementAt(700, HEIGHT * 5), DRAWER)

    expect(scrolledTo).not.toBeNull()
  })

  it('не уводит левый край цели за экран', () => {
    scrollToElement(elementAt(650, 100, 900), DRAWER)

    // Сдвиг ограничен так, чтобы начало текста осталось видно.
    expect(650 - (scrolledTo ?? 0)).toBeGreaterThanOrEqual(0)
  })
})

/*
 * Выбор правимого элемента: где кончается «абзац с разметкой» и начинается
 * «контейнер с самостоятельными блоками».
 *
 * ── Случай, ради которого эти проверки заведены ─────────────────────────────
 *
 * На боевом прототипе заказчика карточка товара несёт ряд чипов:
 *
 *   <div class="flex flex-wrap gap-2">
 *     <span>10 Мбит/с</span><span>Домашний</span><span>Офисный</span>
 *   </div>
 *
 * Нажатие на «10 Мбит/с» открывало правку со строкой
 * «10 Мбит/сДомашнийОфисныйПромышленный»: подъём до самого внешнего
 * текстового элемента забирал контейнер целиком, потому что «строчность»
 * ребёнка определялась ИМЕНЕМ ТЕГА, а `span` в списке строчных. Визуально это
 * четыре отдельные плашки, и текст у каждой свой.
 */
describe('isTextElement: тег против раскладки', () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
  })

  afterEach(() => host.remove())

  it('ряд чипов во flex-контейнере абзацем НЕ считается', () => {
    host.innerHTML =
      '<div id="чипы" style="display:flex"><span>10 Мбит/с</span><span>Домашний</span></div>'
    const чипы = host.querySelector('#чипы')

    // Дети — `span`, но раскладывает их контейнер боксами: каждый чип
    // самостоятелен, и текст у него свой.
    expect(isTextElement(чипы as Element)).toBe(false)
  })

  it('grid-контейнер — то же самое', () => {
    host.innerHTML = '<div id="сетка" style="display:grid"><span>ячейка</span></div>'

    expect(isTextElement(host.querySelector('#сетка') as Element)).toBe(false)
  })

  it('абзац с разметкой внутри текстовым элементом остаётся', () => {
    host.innerHTML = '<p id="абзац">обычный <strong>абзац</strong> с разметкой</p>'

    // Это ровно тот случай, ради которого подъём и существует: правится абзац
    // целиком, а не одно выделенное слово.
    expect(isTextElement(host.querySelector('#абзац') as Element)).toBe(true)
  })

  it('строчно-блочный значок внутри абзаца тянет за собой запрет подъёма', () => {
    host.innerHTML =
      '<p id="абзац">текст <span style="display:inline-block">значок</span></p>'

    // `inline-block` — собственный бокс: значок не часть строки, а вставка
    // рядом с ней, и объединять их в одну правку неверно.
    expect(isTextElement(host.querySelector('#абзац') as Element)).toBe(false)
  })

  it('скрытая подпись внутри абзаца правку не отнимает', () => {
    host.innerHTML =
      '<p id="абзац">цена <span style="display:none">рублей</span> 500</p>'

    /*
     * Подпись для программы чтения с экрана бокса не создаёт и абзац не рвёт.
     * Посчитай её блоком — и абзац перестал бы быть правимым, а подъём ушёл бы
     * к предку, забрав половину страницы: та же поломка, что с чипами,
     * только с другой стороны.
     */
    expect(isTextElement(host.querySelector('#абзац') as Element)).toBe(true)
  })

  it('сам чип текстовым элементом является', () => {
    host.innerHTML = '<div style="display:flex"><span id="чип">10 Мбит/с</span></div>'

    expect(isTextElement(host.querySelector('#чип') as Element)).toBe(true)
  })
})

/*
 * Выбор цели правки: граница против подъёма.
 *
 * Тестов выбора цели в проекте не было вовсе — `pickFrom` наружу не торчит,
 * а `findTextTarget` требует события с рабочим `composedPath()`, которое jsdom
 * синтезирует криво. Веха «правка текста в кнопках и ссылках» вынесла чистое
 * ядро `pickTarget`, и проверяется оно здесь.
 *
 * ВАЖНО про jsdom: у него нет таблицы стилей по умолчанию, `getComputedStyle`
 * возвращает пустой `display` для всего, что не задано инлайном, и
 * `displayOf` в таких случаях отвечает `null` — вызывающие откатываются
 * к поведению по тегам. Поэтому случаи, которые ЗАВИСЯТ от вычисленного
 * `display` (кнопка `inline-flex`, nav-ссылка `flex`), здесь непроверяемы
 * и уходят на стенд `dev/interactive.html`. Обходить это подстановкой
 * инлайновых стилей — значит проверять не то поведение, которое будет
 * в браузере.
 */
describe('pickTarget: граница правки', () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
  })

  afterEach(() => host.remove())

  function target(selector: string): Element | null {
    return pickTarget(host.querySelector(selector) as Element).element
  }

  it('кнопка со значком внутри становится целью', () => {
    host.innerHTML = '<button id="кнопка"><svg id="значок"></svg>Оформить заказ</button>'

    // Значок — собственный бокс, и до вехи `isTextElement` отсекал такую
    // кнопку целиком. Граница спрашивается раньше и до предиката не доходит.
    expect(target('#значок')).toBe(host.querySelector('#кнопка'))
  })

  it('ссылка внутри абзаца становится целью, а не абзац', () => {
    host.innerHTML = '<p id="абзац">Смотри <a id="ссылка">прайс</a> здесь</p>'

    expect(target('#ссылка')).toBe(host.querySelector('#ссылка'))
  })

  it('клик по выделенному слову ВНУТРИ ссылки открывает ссылку целиком', () => {
    host.innerHTML = '<p id="абзац">Смотри <a id="ссылка">Перейти <b id="слово">к прайсу</b></a></p>'

    /*
     * Случай проверяет НАПРАВЛЕНИЕ остановки подъёма. В главный цикл он
     * не попадает вовсе: `isTextElement(<b>)` истинен сразу, и дальше работает
     * `climbToOutermost`. Останавливайся подъём ПЕРЕД границей — целью стало бы
     * слово, и ошибка прошла бы незамеченной.
     */
    expect(target('#слово')).toBe(host.querySelector('#ссылка'))
  })

  it('ссылка отдельным блоком становится целью', () => {
    host.innerHTML = '<div><a id="ссылка">Перейти к прайсу</a></div>'

    expect(target('#ссылка')).toBe(host.querySelector('#ссылка'))
  })

  it('абзац без интерактивных детей ведёт себя как до вехи', () => {
    host.innerHTML = '<p id="абзац">обычный <strong id="слово">абзац</strong> с разметкой</p>'

    expect(target('#слово')).toBe(host.querySelector('#абзац'))
  })

  it('span внутри абзаца по-прежнему поднимается до абзаца', () => {
    host.innerHTML = '<p id="абзац">цена <span id="сумма">500</span> рублей</p>'

    expect(target('#сумма')).toBe(host.querySelector('#абзац'))
  })

  it('role="button" на div делает целью этот div', () => {
    host.innerHTML = '<div id="псевдокнопка" role="button"><span id="текст">Показать ещё</span></div>'

    expect(target('#текст')).toBe(host.querySelector('#псевдокнопка'))
  })

  it('граница с пустым текстом целью не становится, подъём продолжается', () => {
    host.innerHTML = '<p id="абзац">Смотри <a id="значковая"><svg id="значок"></svg></a> здесь</p>'

    // Кнопка из одного значка править нечего: пустая граница пропускается,
    // и целью становится абзац вокруг.
    expect(target('#значок')).toBe(host.querySelector('#абзац'))
  })
})

describe('usesTextPath: структура берётся из wasHtml', () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
  })

  afterEach(() => host.remove())

  it('кнопка со счётчиком в span идёт путём разметки', () => {
    host.innerHTML = '<button id="кнопка">Купить <span class="count">3</span></button>'
    const кнопка = host.querySelector('#кнопка') as Element

    expect(usesTextPath(кнопка, кнопка.innerHTML)).toBe(false)
  })

  it('кнопка со значком идёт текстовым путём', () => {
    host.innerHTML = '<button id="кнопка"><svg></svg>Купить</button>'
    const кнопка = host.querySelector('#кнопка') as Element

    // `<svg>` в `textContent` не даёт ничего: править тут нечего, кроме строки.
    expect(usesTextPath(кнопка, кнопка.innerHTML)).toBe(true)
  })

  it('счётчик остаётся путём разметки, даже когда живой элемент уже без span', () => {
    host.innerHTML = '<button id="кнопка">Купить 3</button>'
    const кнопка = host.querySelector('#кнопка') as Element

    /*
     * Тест на НЕОБРАТИМУЮ ПОТЕРЮ чужой вёрстки. Путь разметки сам приводит
     * кнопку со счётчиком к такому виду: санитайзер `<span>` не пропускает.
     * Спроси предикат у живого элемента — он ответит «текстовый путь»,
     * восстановление перестанет возвращать `wasHtml`, и `<span class="count">`
     * не вернётся ни при переприменении, ни при снятии слоя.
     */
    expect(usesTextPath(кнопка, 'Купить <span class="count">3</span>')).toBe(false)
  })

  it('не-граница текстовым путём не идёт никогда', () => {
    host.innerHTML = '<p id="абзац">просто текст</p>'
    const абзац = host.querySelector('#абзац') as Element

    expect(usesTextPath(абзац, абзац.innerHTML)).toBe(false)
  })
})

describe('writeTextNodes', () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
  })

  afterEach(() => host.remove())

  it('меняет текст, а значок оставляет на месте', () => {
    host.innerHTML = '<button id="кнопка"><svg id="значок"></svg>Оформить заказ</button>'
    const кнопка = host.querySelector('#кнопка') as Element

    writeTextNodes(кнопка, 'Купить сейчас')

    // Проверяется не только подставленное, но и УЦЕЛЕВШЕЕ: правило
    // профилактики патча 2026-09-06-21.55.
    expect(normalize(кнопка.textContent ?? '')).toBe('Купить сейчас')
    expect(кнопка.querySelector('#значок')).not.toBeNull()
  })

  it('лишние прямые текстовые узлы очищает, а элементы-дети не трогает', () => {
    host.innerHTML = '<a id="ссылка">Перейти <b id="жирное">туда</b> сейчас</a>'
    const ссылка = host.querySelector('#ссылка') as Element

    writeTextNodes(ссылка, 'Открыть прайс')

    // Хвостовой текстовый узел очищен, `<b>` уцелел: строка кладётся
    // в ПЕРВЫЙ прямой текстовый узел, остальные прямые гасятся.
    expect(normalize(ссылка.textContent ?? '')).toBe('Открыть прайстуда')
    expect(ссылка.querySelector('#жирное')).not.toBeNull()
  })

  it('без прямых текстовых узлов заводит свой', () => {
    host.innerHTML = '<button id="кнопка"><svg id="значок"></svg></button>'
    const кнопка = host.querySelector('#кнопка') as Element

    writeTextNodes(кнопка, 'Купить')

    expect(normalize(кнопка.textContent ?? '')).toBe('Купить')
    expect(кнопка.querySelector('#значок')).not.toBeNull()
  })
})
