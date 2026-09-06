import { resolveAnchor } from 'entities/anchor'
import { entryStore } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import { APPLIED_ATTRIBUTE } from 'shared/config/constants'
import { createLogger } from 'shared/lib/log'
import { currentRoute } from 'shared/lib/route'

const log = createLogger('edit-text:find')

/**
 * Уже существующая правка на месте клика — или `null`, если место ещё не правили.
 *
 * Два шага и именно в этом порядке (решение 7).
 *
 * Шаг 1 — метка `data-kalka-applied` на элементе или его предке. Движок ставит
 * её только после успешного наложения, поэтому шаг самый дешёвый и самый точный.
 * Предок проверяется тоже: правка накладывается на элемент целиком, а кликнуть
 * рецензент может по строчному узлу внутри него.
 *
 * Шаг 2 — перебор записей текущего маршрута с разрешением якоря. Он ОБЯЗАТЕЛЕН,
 * потому что метки законно нет в трёх случаях: запись типа `style-wish` в DOM
 * не применяется вовсе, страница показана в оригинале (FR-21), и запись
 * помечена `lost`. Без второго шага повторный клик по такому месту создал бы
 * ВТОРУЮ запись на тот же элемент — прямое нарушение FR-10.
 */
export function findEntryFor(el: Element): Entry | null {
  const marked = el.closest(`[${APPLIED_ATTRIBUTE}]`)
  const markedId = marked?.getAttribute(APPLIED_ATTRIBUTE)
  if (markedId) {
    const byMark = entryStore.get(markedId)
    if (byMark) {
      log.debug('правка найдена', { id: byMark.id, шаг: 'метка наложения' })
      return byMark
    }
  }

  // Документ берётся у самого элемента, а не из глобали: слайс инструмента
  // к чужому DOM не обращается — он лишь передаёт дальше то, что ему дали
  // (ARCHITECTURE.md, решение 1).
  const root = el.ownerDocument
  const route = currentRoute()
  for (const entry of entryStore.list()) {
    if (entry.route !== route) continue

    const found = resolveAnchor(entry.anchor, entry.was, root)
    if ('status' in found) continue
    if (found.element !== el) continue

    log.debug('правка найдена', { id: entry.id, шаг: 'разрешение якоря' })
    return entry
  }

  log.debug('место ещё не правили')
  return null
}
