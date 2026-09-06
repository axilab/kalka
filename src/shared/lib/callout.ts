/*
 * Геометрия выноски: где поставить окно относительно правимого места.
 *
 * ── Почему модуль лежит здесь, а не в слайсе виджета ────────────────────────
 *
 * Потребителей два — окно правки (`widgets/text-editor`) и окно замечания
 * (`widgets/mark-layer`), — а слайсы одного слоя друг друга не импортируют.
 * Правило машинное: его проверяет линтер, и размещение внутри виджета упало бы
 * на `npm run lint`. Прецедент рядом: `shared/lib/geometry` уехал сюда по той
 * же причине.
 *
 * ── Вьюпортные координаты ───────────────────────────────────────────────────
 *
 * ВЕСЬ ФАЙЛ РАБОТАЕТ ВО ВЬЮПОРТНОЙ СИСТЕМЕ, как и `shared/lib/geometry`:
 * на вход приходит `getBoundingClientRect()`, на выход — числа для
 * `position: fixed`. `scrollX`/`scrollY` здесь не встречается ни разу,
 * и смешать две системы негде.
 *
 * ── Что решает эта арифметика ───────────────────────────────────────────────
 *
 * Окно правки стояло в углу экрана, и человек набирал текст в окне, отстоящем
 * от правимого абзаца на ширину монитора. Окно замечания было прибито к левому
 * нижнему углу и точно так же стояло вдали от метки, к которой относится.
 * Выноска ставит окно у того места, о котором оно говорит.
 */

import { createLogger } from './log'

const log = createLogger('callout')

/** Зазор между якорем и окном: впритык окно читается как часть правимого места. */
const GAP = 8

/** Отступ от краёв вьюпорта: окно, прижатое к краю, выглядит обрезанным. */
const MARGIN = 16

export interface CalloutAnchor {
  /** Прямоугольник места, к которому относится окно, во вьюпортных координатах. */
  anchor: DOMRectReadOnly
  /** Натуральный размер окна: измеренный, а не желаемый. */
  size: { readonly width: number; readonly height: number }
  /**
   * Полоса у правого края, занятая интерфейсом.
   *
   * ЧИСЛО, измеренное вызывающим, а не имя класса и не константа: рейка
   * занимает крайние пиксели всегда, ящик добавляет свои только когда открыт,
   * а на узком экране раскладка меняется целиком. Модуль про рейку и ящик
   * не знает и знать не должен.
   */
  reservedRight: number
}

export interface CalloutPlacement {
  left: number
  top: number
  /** Сколько места осталось окну по высоте и ширине: больше него не расти. */
  maxHeight: number
  maxWidth: number
  /** С какой стороны от якоря встало окно. */
  side: 'below' | 'above'
  /** Пришлось ли перевернуть вверх из-за нехватки места снизу. */
  flipped: boolean
}

/**
 * Считает место для окна-выноски у якоря.
 *
 * Снизу по умолчанию — читается как продолжение правимой строки. Не влезло
 * снизу — переворачивается вверх. Не влезло ни там, ни там — встаёт туда,
 * где просторнее, и получает потолок высоты: обрезанное окно с прокруткой
 * лучше окна, уехавшего заголовком за край экрана.
 *
 * По горизонтали окно начинается от левого края якоря и прижимается внутрь
 * у краёв: справа — с учётом полосы, занятой интерфейсом, иначе правка
 * у правого края уезжала бы под рейку.
 */
export function placeCallout({ anchor, size, reservedRight }: CalloutAnchor): CalloutPlacement {
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight

  // ── Вертикаль ─────────────────────────────────────────────────────────────
  const spaceBelow = viewportH - anchor.bottom - GAP - MARGIN
  const spaceAbove = anchor.top - GAP - MARGIN

  let side: 'below' | 'above'
  let maxHeight: number
  let top: number

  if (size.height <= spaceBelow) {
    side = 'below'
    maxHeight = spaceBelow
    top = anchor.bottom + GAP
  } else if (size.height <= spaceAbove) {
    side = 'above'
    maxHeight = spaceAbove
    top = anchor.top - GAP - size.height
  } else if (spaceBelow >= spaceAbove) {
    // Не влезло никуда: снизу просторнее.
    side = 'below'
    maxHeight = Math.max(spaceBelow, 0)
    top = anchor.bottom + GAP
  } else {
    // Не влезло никуда: сверху просторнее. Окно прижимается к верхнему краю
    // и живёт под потолком — заголовок обязан остаться на виду.
    side = 'above'
    maxHeight = Math.max(spaceAbove, 0)
    top = MARGIN
  }

  top = Math.max(top, MARGIN)

  // ── Горизонталь ───────────────────────────────────────────────────────────
  const rightLimit = viewportW - reservedRight - MARGIN
  const maxWidth = Math.max(rightLimit - MARGIN, 0)

  let left = anchor.left
  if (left + size.width > rightLimit) left = rightLimit - size.width
  left = Math.max(left, MARGIN)

  return { left, top, maxHeight, maxWidth, side, flipped: side === 'above' }
}

/**
 * Сообщает о постановке окна — но только когда есть о чём.
 *
 * Считается выноска на каждом кадре прокрутки, и лог оттуда залил бы консоль
 * и испортил плавность чужой страницы. Поэтому строка выходит на открытии
 * и на смене стороны: именно это и спрашивают при отладке на чужой вёрстке —
 * «куда оно встало» и «почему перевернулось».
 *
 * Возвращает новое запомненное значение: хранит его вызывающий, в `ref`.
 */
export function logPlacement(
  what: string,
  placement: CalloutPlacement,
  previous: 'below' | 'above' | null,
): 'below' | 'above' {
  if (previous === placement.side) return placement.side

  log.debug(what, {
    сторона: placement.side === 'below' ? 'снизу' : 'сверху',
    перевёрнуто: placement.flipped,
    первая: previous === null,
  })
  return placement.side
}
