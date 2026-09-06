/*
 * Доли bounding box: геометрия областей и указателей (FR-18).
 *
 * ВЕСЬ ФАЙЛ РАБОТАЕТ ВО ВЬЮПОРТНОЙ СИСТЕМЕ КООРДИНАТ, и это первое, что нужно
 * знать перед его правкой. `getBoundingClientRect()`, `clientX/clientY`
 * и `position: fixed` слоя меток уже в ней — поэтому `scrollX`/`scrollY`
 * не встречается здесь ни разу, и смешать две системы негде.
 *
 * Если слой меток когда-нибудь станет `position: absolute`, вся геометрия
 * переезжает в координаты документа ЦЕЛИКОМ: половинчатый переход ломает всё
 * (kalka-anchoring/references/geometry.md, «Две системы координат»).
 *
 * Почему доли, а не пиксели. Рецензент обводит блок на мониторе 1440×900
 * и получает рамку в абсолютных координатах. Разработчик открывает тот же
 * прототип на 1920×1080 — вёрстка перекомпоновалась, блок уехал, а рамка
 * осталась на старом месте и указывает в пустоту. Доля от bounding box
 * элемента-якоря переживает и смену размера окна, и перекомпоновку: она
 * отвечает не «где на экране», а «где внутри вот этого элемента».
 *
 * Собственного механизма привязки у области нет: элемент-якорь ищется теми же
 * тремя уровнями, что и у текстовой правки (`entities/anchor`), и лежит
 * в поле `anchor` записи. Здесь — только арифметика долей.
 */

import type { PointAnchor, RectAnchor } from 'shared/model/format'
import { createLogger } from 'shared/lib/log'
import { safely } from 'shared/lib/safe'

const log = createLogger('geometry')

/**
 * Прижимает долю к отрезку 0..1.
 *
 * Нужен потому, что рецензент имеет полное право начать рисовать внутри
 * элемента и увести курсор наружу. Отрицательная доля или доля больше единицы
 * арифметически валидна и как хранимое значение бессмысленна: при
 * восстановлении она дала бы рамку за пределами своего блока.
 */
export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * Четыре доли нарисованной рамки от bounding box элемента-якоря.
 *
 * `width`/`height` у `DOMRect` включают `padding` и `border-width` — ровно то,
 * что видит рецензент, обводя блок; дополнительных поправок не требуется.
 */
export function captureRect(el: Element, drawn: DOMRectReadOnly): RectAnchor {
  const box = el.getBoundingClientRect()

  // Вырожденный элемент — отдельная ветка ДО всякого деления: делением
  // получились бы Infinity и NaN, которые тихо испортили бы запись, а всплыли
  // бы месяцем позже невидимой рамкой. Вся площадь элемента — честный ответ
  // на вопрос «какая доля», когда площади нет.
  if (box.width === 0 || box.height === 0) return { x: 0, y: 0, w: 1, h: 1 }

  return {
    x: clamp01((drawn.left - box.left) / box.width),
    y: clamp01((drawn.top - box.top) / box.height),
    w: clamp01(drawn.width / box.width),
    h: clamp01(drawn.height / box.height),
  }
}

/** Две доли точки от bounding box элемента-якоря. См. captureRect. */
export function capturePoint(el: Element, x: number, y: number): PointAnchor {
  const box = el.getBoundingClientRect()
  if (box.width === 0 || box.height === 0) return { x: 0, y: 0 }

  return {
    x: clamp01((x - box.left) / box.width),
    y: clamp01((y - box.top) / box.height),
  }
}

/**
 * Размер кадра, от которого отсчитываются доли. Не `DOMRect`: у кадра вырезки
 * нет ни положения на экране, ни самого экрана.
 */
export interface Box {
  w: number
  h: number
}

/**
 * Доли рамки → пиксели ВНУТРИ кадра известного размера, начало отсчёта — угол
 * кадра.
 *
 * Чистая арифметика без обращения к `getBoundingClientRect`, и это вся причина
 * существования функции. `restoreRect` ниже завязан на живой элемент в текущем
 * документе, а отчёту нужен тот же расчёт для вырезки, которой в DOM нет вовсе:
 * там есть только снятый кадр и его размер. Заводить второй пересчёт долей
 * рядом с этим значило бы получить два ответа на один вопрос — и однажды
 * увидеть метку на бумаге не там, где она стоит на экране.
 */
export function rectFromBox(rect: RectAnchor, box: Box): DOMRect {
  return new DOMRect(rect.x * box.w, rect.y * box.h, rect.w * box.w, rect.h * box.h)
}

/** Доли точки → пиксели внутри кадра. См. `rectFromBox`. */
export function pointFromBox(point: PointAnchor, box: Box): DOMRect {
  return new DOMRect(point.x * box.w, point.y * box.h, 0, 0)
}

/**
 * Обратный пересчёт долей в вьюпортные координаты.
 *
 * `null` при нулевом bounding box, то есть у скрытого элемента (`display: none`,
 * свёрнутый аккордеон, неактивная вкладка). Возврат `null`, а НЕ нулевого
 * прямоугольника: «нечего рисовать» и «нарисовать точку в углу экрана» — разные
 * вещи, и вызывающий обязан их различать. Скрытый якорь при этом не делает
 * запись потерянной: место нашлось, оно просто сейчас не показано.
 *
 * Пересчитывается при КАЖДОЙ отрисовке, а не один раз: bounding box меняется
 * при прокрутке, ресайзе окна и любой перекомпоновке носителя.
 *
 * Ветка нулевого bounding box живёт ЗДЕСЬ, а не в `rectFromBox`: «элемент скрыт»
 * — это свойство живой страницы, а у кадра вырезки скрытости не бывает вовсе.
 */
export function restoreRect(rect: RectAnchor, el: Element): DOMRect | null {
  const box = el.getBoundingClientRect()
  if (box.width === 0 || box.height === 0) return null

  const local = rectFromBox(rect, { w: box.width, h: box.height })
  return new DOMRect(box.left + local.x, box.top + local.y, local.width, local.height)
}

/**
 * Обратный пересчёт точки. Возвращает вырожденный прямоугольник нулевого
 * размера в месте точки: слою меток нужна одна и та же форма ответа для рамки
 * и для точки, а размер самой метки задают стили, а не геометрия.
 */
export function restorePoint(point: PointAnchor, el: Element): DOMRect | null {
  const box = el.getBoundingClientRect()
  if (box.width === 0 || box.height === 0) return null

  const local = pointFromBox(point, { w: box.width, h: box.height })
  return new DOMRect(box.left + local.x, box.top + local.y, 0, 0)
}

/**
 * Наблюдение за изменением раскладки: прокрутка и ресайз.
 * Возвращает ПОЛНОЕ снятие — слушатель снят с тем же `capture`, наблюдатель
 * отключён.
 *
 * `capture: true` обязателен: событие `scroll` внутреннего контейнера
 * не всплывает, и слушатель на `window` без фазы перехвата его не увидит —
 * метка внутри блока с `overflow: auto` отрывалась бы от своего места.
 * `passive: true` — потому что плавность прокрутки чужой страницы виджет
 * портить не имеет права.
 *
 * Обработчики обёрнуты `safely`: исключение виджета не имеет права уйти
 * в код носителя посреди его собственной прокрутки (NFR-06).
 */
export function watchLayout(onChange: () => void): () => void {
  const handle = safely(log, 'изменение раскладки', onChange)

  window.addEventListener('scroll', handle, { passive: true, capture: true })

  // ResizeObserver есть не везде (в частности, его нет в старых движках):
  // без него остаётся прокрутка, и это лучше, чем упавший слой меток.
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(handle) : null
  observer?.observe(document.body)

  log.debug('наблюдение за раскладкой включено', { наблюдательРазмера: observer !== null })

  return (): void => {
    window.removeEventListener('scroll', handle, { capture: true })
    observer?.disconnect()
    log.debug('наблюдение за раскладкой снято')
  }
}
