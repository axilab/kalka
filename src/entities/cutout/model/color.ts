/*
 * Цвет и фон вырезки.
 *
 * Общий словарь для сборки и самопроверки, и это не вынос ради опрятности.
 * Обе стороны обязаны отвечать на ОДИН вопрос — «какой фон вырезка получит
 * в отчёте» — и отвечать одинаково. Разойдись они, самопроверка стала бы врать
 * в самую опасную сторону: пропускать нечитаемые картинки, потому что мерила
 * не тот фон, который в документ приедет.
 *
 * Ровно это и случилось на ручном прогоне 2026-09-06: проверка мерила фон
 * предка НА СТРАНИЦЕ, сборка фон в кадр не переносила, и абзац из тёмной секции
 * приехал бледно-голубым по белой бумаге, пройдя проверку насквозь.
 */

/** Разобранный цвет. `a` — альфа от 0 до 1. */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** Фон, когда непрозрачного предка не нашлось до самого корня: бумага белая. */
export const PAPER: Rgba = { r: 255, g: 255, b: 255, a: 1 }

/**
 * Разбор `rgb(...)` / `rgba(...)` из вычисленного стиля.
 *
 * `null` на всём остальном — и это ветка не про экзотику, а про честность:
 * браузер может отдать `color(srgb ...)` или `oklch(...)`, и посчитать по ним
 * яркость этой функцией нельзя. Соврать числом хуже, чем признать, что цвет
 * не разобран.
 */
export function parseRgba(value: string): Rgba | null {
  const numbers = value.match(/-?\d*\.?\d+/g)
  if (numbers === null || numbers.length < 3) return null

  const [r, g, b, a] = numbers.map(Number)
  if (r === undefined || g === undefined || b === undefined) return null

  return { r, g, b, a: a ?? 1 }
}

/** Запись цвета для подстановки в разметку вырезки. */
export function toCss({ r, g, b, a }: Rgba): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/** Относительная яркость по WCAG 2.x. */
export function luminance({ r, g, b }: Rgba): number {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Контраст двух цветов по WCAG: от 1 (неразличимы) до 21. */
export function contrastOf(text: Rgba, background: Rgba): number {
  const a = luminance(text)
  const b = luminance(background)
  const light = Math.max(a, b)
  const dark = Math.min(a, b)

  return (light + 0.05) / (dark + 0.05)
}

/**
 * Фон ближайшего непрозрачного предка — включая сам элемент.
 *
 * Это и есть тот фон, который вырезка ОБЯЗАНА унести с собой в отчёт: у самого
 * кадра фона может не быть вовсе, а красит его секция-предок, в кадр не
 * попавшая. Поэтому функция зовётся дважды за съёмку — сборкой, чтобы фон
 * записать, и проверкой, чтобы посчитать по нему контраст.
 *
 * Приём разбирает тёмные секции верно и проваливается там, где фон рисуют
 * не предки, а СОСЕДНИЕ абсолютно позиционированные слои: тогда он возвращает
 * белый ближайшего предка, а текст поверх фотографии белый — и вырезка выходит
 * белым по белому. Этот класс вёрстки не чинится, а ловится проверкой контраста
 * и честно деградирует в текст.
 */
export function backgroundBehind(el: Element): Rgba {
  const view = el.ownerDocument.defaultView
  if (view === null) return PAPER

  let node: Element | null = el
  while (node !== null) {
    const parsed = parseRgba(view.getComputedStyle(node).backgroundColor)
    // Полностью прозрачный фон не красит ничего: за ним видно предка.
    if (parsed !== null && parsed.a > 0) return parsed
    node = node.parentElement
  }

  return PAPER
}
