import type { Entry } from 'shared/model/format'
import type { AppliedEntry } from 'shared/model/layer'
import { createLogger } from 'shared/lib/log'
import { normalize } from 'shared/lib/normalize'
import { resolveAnchor } from './resolve'

const log = createLogger('anchor:drift')

/**
 * Сошёлся ли текущий текст элемента с исходным текстом правки.
 *
 * Сравнение строгое, но по нормализованному тексту: вёрстка свободно меняет
 * пробелы, переносы и NBSP, не меняя смысла, и считать это расхождением значит
 * помечать уехавшими почти все правки после любой пересборки.
 *
 * Порога похожести здесь нет и не будет. Соблазн сравнивать по расстоянию
 * Левенштейна и считать 90% успехом превращает бинарный объяснимый ответ
 * в настраиваемое число, всегда либо слишком строгое, либо слишком мягкое,
 * и главное — СКРЫВАЕТ от человека сам факт того, что текст изменился.
 * Изменился текст — это ровно тот случай, ради которого существует `drifted`.
 */
export function matchesWas(el: Element, was: string): boolean {
  return normalize(el.textContent ?? '') === normalize(was)
}

/**
 * Куда легла запись на этой странице: `applied`, `drifted` или `lost`.
 *
 * Три состояния, а не два: `drifted` означает «вероятно, вот это место,
 * проверьте глазами», `lost` — «ищите руками, вот исходный текст».
 * Разработчику это разные задачи (FR-20, цель Ц4).
 *
 * Здесь нет ветки «запись чужого маршрута»: такая запись до сверки вообще
 * не доходит — её отбрасывает движок наложения. Смешивать «правка для другой
 * страницы» и «правка, потерявшая своё место» запрещено.
 */
export function applyStatus(entry: Entry, root: Document): AppliedEntry {
  const found = resolveAnchor(entry.anchor, entry.was, root)

  if ('status' in found) {
    // Молчаливая потеря — прямое нарушение цели Ц4, поэтому уровень info,
    // а не debug: это событие, которое должно быть видно.
    log.info('место правки не найдено', { id: entry.id, маршрут: entry.route })
    return { entry, status: 'lost' }
  }

  if (!found.exact) {
    log.info('место правки найдено неточно', {
      id: entry.id,
      маршрут: entry.route,
      уровень: found.method,
    })
    return { entry, status: 'drifted', element: found.element, method: found.method }
  }

  log.debug('место правки найдено', { id: entry.id, уровень: found.method })
  return { entry, status: 'applied', element: found.element, method: found.method }
}
