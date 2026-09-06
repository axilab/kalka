import { hasTextOnPage } from 'entities/anchor'
import { classifyArrival, entryStore, plainNow } from 'entities/entry'
import type { VerifyStatus } from 'shared/model/layer'

/*
 * Один проход проверки после передеплоя (FR-35).
 *
 * Слой `features` выше обоих entities, поэтому импорт и `entities/anchor`,
 * и `entities/entry` здесь легален: соседними слайсами одного слоя они друг
 * друга не видят, а проходу нужны оба сразу — статус наложения из одного
 * и поиск текста по странице из другого.
 *
 * Классификация исхода живёт в `entities/entry/model/verify.ts` и здесь
 * не повторяется: там она чистая функция, проверяемая таблицей входов, а тут
 * был бы код, который проверить можно только руками на стенде.
 *
 * Своего логгера у прохода нет намеренно: он возвращает сводку, а пишет её
 * вызывающий (`model/mode.ts`). Иначе одна и та же сводка печаталась бы дважды
 * на каждый проход.
 */

/** Сводка прохода: то, что попадает в лог вместо текстов правок. */
export interface VerifySummary {
  arrived: number
  'not-arrived': number
  unclear: number
  /** Сколько записей проверено всего. */
  checked: number
}

/**
 * Пересчитывает исходы проверки для всех подходящих записей.
 *
 * Проверяются ТОЛЬКО записи типа `text-override` и ТОЛЬКО текущего маршрута
 * (решение 11 плана вехи):
 *
 *   `style-wish` и `comment` агент не применяет по определению (PRD, «Границы»),
 *   и «доехать» им некуда — в списке они остаются задачами человеку без
 *   цветовой пометки.
 *
 *   Записи чужих маршрутов не проверяются: их места на этой странице нет,
 *   и красить их в «непонятно» значило бы смешивать «правка для другой
 *   страницы» с «правка потеряла место» — ровно то смешение, которое запрещено
 *   комментарием в `entities/anchor/model/drift.ts`.
 *
 * Записи без статуса пропускаются: проход наложения ещё не дошёл до них,
 * и исхода у них пока нет — придумывать его нельзя.
 */
export function runVerifyPass(root: Document = document): VerifySummary {
  const route = entryStore.route()
  const summary: VerifySummary = { arrived: 0, 'not-arrived': 0, unclear: 0, checked: 0 }

  for (const entry of entryStore.list()) {
    if (entry.type !== 'text-override') continue
    if (entry.route !== route) continue

    const status = entryStore.statusOf(entry.id)?.status
    if (status === undefined) continue

    // Спрашиваем страницу ТОЛЬКО при `lost`: в остальных случаях ответ
    // на исход не влияет (см. таблицу в `entities/entry/model/verify.ts`),
    // а обход страницы стоит времени на каждой записи в каждом проходе.
    const nowOnPage = status === 'lost' ? hasTextOnPage(plainNow(entry, root), root) : false

    const verdict: VerifyStatus = classifyArrival(status, nowOnPage)
    // Уведомляет только при фактической смене исхода — это условие
    // незацикливания, см. `setVerify` в хранилище.
    entryStore.setVerify(entry.id, verdict)

    summary[verdict] += 1
    summary.checked += 1
  }

  return summary
}
