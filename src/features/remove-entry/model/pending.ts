import { cutoutBuffer } from 'entities/cutout'
import { entryStore } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import type { EntryOrigin } from 'shared/model/layer'
import { UNDO_REMOVE_MS } from 'shared/config/constants'
import { createLogger } from 'shared/lib/log'

const log = createLogger('remove-entry')

/*
 * Удаление правки из списка разбора с откатом.
 *
 * ── Почему это отдельный слайс, а не метод хранилища ─────────────────────────
 *
 * Удаление в хранилище уже есть и не меняется: `entryStore.remove` снимает
 * запись сразу, страница возвращает исходный текст, метка исчезает, номера
 * сдвигаются. Здесь живёт только ОТКАТ — буфер удалённых записей, который
 * держит их пять секунд и умеет поставить обратно.
 *
 * В `entities/entry` этому буферу не место, и причина не в эстетике. Слой
 * записей — это то, что уходит в снимок и в файл обмена; удалённая правка,
 * ждущая отмены, не должна попасть ни туда, ни туда. Она вообще не предметное
 * понятие слоя правок, а состояние ОДНОГО ДЕЙСТВИЯ человека, живущее пять
 * секунд. Именно такие вещи и лежат в `features`.
 *
 * ── Почему буфер не в компоненте строки ─────────────────────────────────────
 *
 * Строка списка размонтируется в тот же миг, когда запись уходит из хранилища:
 * `EntryList` рисует то, что вернул `entryStore.list()`. Держи откат в строке —
 * он умер бы вместе с ней, не дожив до первого кадра.
 *
 * ── Подписка ────────────────────────────────────────────────────────────────
 *
 * Своя, а не через `entryStore.subscribe`: буфер меняется и тогда, когда набор
 * записей неподвижен — на истечении таймера удалённая запись просто уходит
 * из буфера, и хранилищу об этом сказать нечего. Приём тот же, что у самого
 * хранилища: множество слушателей и снятие возвращаемой функцией.
 */

/** Запись, ждущая отката, вместе со всем, что нужно вернуть её на место. */
interface Pending {
  entry: Entry
  /** Автор чужой правки. `undefined` — правка своя. */
  origin: EntryOrigin | undefined
  /** Место в наборе на момент удаления: туда её и вернёт отмена. */
  index: number
  /** Когда окно закроется. Нужно полосе обратного отсчёта — см. `PendingRemoval`. */
  until: number
  timer: number
}

/** Что видно списку: сама запись и признак, чья она. */
export interface PendingRemoval {
  id: string
  entry: Entry
  /** Место в наборе: список ставит полосу отмены туда, где стояла строка. */
  index: number
  /** Чужая правка: у неё другая фраза — в файле автора она осталась. */
  imported: boolean
  /**
   * Момент, когда окно отката закроется, — метка времени, а не остаток.
   *
   * Именно метка: остаток пришлось бы пересчитывать на каждой отрисовке
   * и обновлять таймером, а метка не устаревает. Полоса обратного отсчёта
   * вычитает из неё текущее время в момент, когда её рисуют, и потому
   * показывает верный остаток даже если её перерисовали посреди отсчёта.
   */
  until: number
}

const pending = new Map<string, Pending>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * Окончательное удаление: запись покидает буфер, вырезка снимается.
 *
 * Вырезка снимается ЗДЕСЬ, а не в момент нажатия: печатный отчёт берёт из
 * буфера картинку места правки, и сними её сразу — отменённая правка вернулась
 * бы в список без своей картинки, а отчёт молча напечатал бы её без места.
 * Тем же порядком это делает `features/edit-text`, когда правку сводят
 * к оригиналу: сначала запись, потом вырезка.
 */
function commit(id: string): void {
  const item = pending.get(id)
  if (!item) return

  clearTimeout(item.timer)
  pending.delete(id)
  cutoutBuffer.drop(id)

  log.info('удаление правки подтверждено', { id, ждут: pending.size })
  notify()
}

/**
 * Удаляет запись сразу и открывает окно отката.
 *
 * Сразу, а не после вопроса «точно?»: спрашивать до — значит спрашивать
 * сорок раз ради одного промаха. Работу бережёт откат, а не подтверждение.
 */
export function removeWithUndo(id: string): void {
  const entry = entryStore.get(id)
  if (entry === undefined) {
    log.warn('удалять нечего: записи нет в наборе', { id })
    return
  }

  // Место и автор снимаются ДО удаления: `entryStore.remove` стирает
  // происхождение вместе с записью, и после вызова вернуть его будет неоткуда.
  const index = entryStore.list().findIndex((item) => item.id === id)
  const origin = entryStore.originOf(id)

  // Повторное нажатие по уже удаляемой записи невозможно — её строки в списке
  // нет, — но буфер обязан пережить и его: второй таймер на тот же ключ
  // потерял бы первый и оставил бы запись в буфере навсегда.
  const existing = pending.get(id)
  if (existing) clearTimeout(existing.timer)

  entryStore.remove(id)

  pending.set(id, {
    entry,
    origin,
    index,
    until: Date.now() + UNDO_REMOVE_MS,
    timer: window.setTimeout(() => commit(id), UNDO_REMOVE_MS),
  })

  log.info('правка удалена, откат открыт', { id, место: index, чужая: origin !== undefined })
  notify()
}

/** Возвращает удалённую запись на её место вместе с автором. */
export function undoRemove(id: string): void {
  const item = pending.get(id)
  if (!item) {
    // Окно отката закрылось, пока человек вёл к нему курсор. Молчать нельзя
    // только на экране — там полоса уже исчезла сама; здесь довольно записи.
    log.debug('откат не выполнен: окно уже закрыто', { id })
    return
  }

  clearTimeout(item.timer)
  pending.delete(id)
  entryStore.insertAt(item.index, item.entry, item.origin)

  log.info('удаление правки отменено', { id, место: item.index })
  notify()
}

/** Записи, ждущие отката, в порядке их мест в наборе. */
export function pendingRemovals(): readonly PendingRemoval[] {
  return [...pending.entries()]
    .map(([id, item]) => ({
      id,
      entry: item.entry,
      index: item.index,
      imported: item.origin !== undefined,
      until: item.until,
    }))
    .sort((a, b) => a.index - b.index)
}

/**
 * Закрывает все окна отката немедленно, подтверждая удаления.
 *
 * ПОДТВЕРЖДАЕТ, а не отменяет, и направление здесь единственно верное: записи
 * уже сняты с хранилища и со страницы в момент нажатия. Отменить их при
 * демонтаже значило бы вернуть человеку правки, которые он на глазах удалил.
 *
 * Зовётся при размонтировании списка — то есть при полном демонтаже «Кальки»,
 * а не при закрытии ящика: закрытый ящик прячется, а не размонтируется.
 */
export function flushRemovals(): void {
  for (const id of [...pending.keys()]) commit(id)
}

/** Подписка на изменения буфера. Возвращает снятие. */
export function subscribeRemovals(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
