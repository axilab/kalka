import { pointFromBox, rectFromBox } from 'shared/lib/geometry'
import type { Entry } from 'shared/model/format'
import type { Cutout } from 'shared/model/layer'

/*
 * Метка поверх вырезки.
 *
 * ── Зачем она вообще ────────────────────────────────────────────────────────
 *
 * Номер метки на картинке обязан совпадать с номером записи в списке разбора
 * и с номером метки на живой странице. Это единственная ниточка между бумагой
 * и экраном: по номеру разработчик находит место на прототипе, а менеджер —
 * строку в документе. Нумерация приходит готовой из `entities/entry` и заново
 * здесь НЕ пересчитывается.
 *
 * ── Почему считается от `anchorBox`, а не от всего кадра ────────────────────
 *
 * `captureRect`/`capturePoint` хранят доли от bounding box ЭЛЕМЕНТА-ЯКОРЯ,
 * а кадр замечания — широкий, снятый с большего элемента: без окрестности
 * «это убрать» не опознать. Подставь доли в размер всего кадра — и метка
 * промахнётся ровно у того типа записи, весь смысл которого «вот это здесь».
 * У узких кадров правок текста `anchorBox` совпадает со всем кадром, и формула
 * та же — то есть частный случай обрабатывается общим правилом, а не веткой.
 *
 * ── Почему в НЕСЖАТЫХ пикселях ──────────────────────────────────────────────
 *
 * Кадр ужимает документ отчёта под ширину своей колонки. Метка лежит внутри
 * того же масштабируемого узла и ужимается вместе с картинкой одним
 * преобразованием — значит считать её надо в координатах кадра до сжатия.
 * Считай мы в сжатых, масштаб пришлось бы применять дважды.
 */

/** Прямоугольник метки в пикселях несжатого кадра. `null` — рисовать нечего. */
function boxOf(entry: Entry, cutout: Cutout): DOMRect | null {
  const { anchorBox } = cutout
  const box = { w: anchorBox.w, h: anchorBox.h }

  // Вырожденный якорь: доли от нулевого размера дали бы нулевую метку в углу,
  // и это хуже её отсутствия — читатель принял бы её за указание на угол.
  if (anchorBox.w === 0 || anchorBox.h === 0) return null

  if (entry.rect) return rectFromBox(entry.rect, box)
  if (entry.point) return pointFromBox(entry.point, box)

  // У правки текста своей геометрии нет: правился сам элемент, и обвести надо
  // его целиком. Именно это и означает `anchorBox`.
  return new DOMRect(0, 0, anchorBox.w, anchorBox.h)
}

/**
 * Разметка метки поверх вырезки: рамка области либо кружок указателя,
 * и номер записи на ней.
 *
 * Пустая строка — метку рисовать не по чему. Картинка при этом остаётся:
 * место она показывает и без рамки, а выдуманная метка увела бы читателя
 * не туда.
 */
export function markUp(entry: Entry, number: number, cutout: Cutout): string {
  const box = boxOf(entry, cutout)
  if (box === null) return ''

  const { anchorBox } = cutout
  const left = Math.round(anchorBox.x + box.x)
  const top = Math.round(anchorBox.y + box.y)
  const label = `<span class="mark__no">${number}</span>`

  if (entry.point) {
    return `<div class="mark mark--point" style="left:${left}px;top:${top}px">${label}</div>`
  }

  const width = Math.round(box.width)
  const height = Math.round(box.height)
  return (
    `<div class="mark mark--rect" ` +
    `style="left:${left}px;top:${top}px;width:${width}px;height:${height}px">${label}</div>`
  )
}
