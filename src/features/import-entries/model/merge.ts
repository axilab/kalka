import { entryStore } from 'entities/entry'
import type { ImportedFile } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import type { EntryOrigin } from 'shared/model/layer'
import { createId } from 'shared/lib/id'
import { createLogger } from 'shared/lib/log'

const log = createLogger('import:merge')

/*
 * Слияние разобранного файла с уже лежащим набором (FR-33).
 *
 * Импорт НАКАПЛИВАЕТ, а не заменяет: загрузка второго файла добавляет записи
 * к первым. Замена молча уничтожила бы работу первого рецензента, а разбор
 * двух файлов подряд — это обычный сценарий разработчика, а не редкость.
 */

/** Что случилось при слиянии. Все три числа называются человеку словами. */
export interface MergeReport {
  /** Сколько записей действительно добавлено в набор. */
  added: number
  /** Сколько отсеяно как уже виденные: этот файл загружали раньше. */
  duplicates: number
  /** Скольким пришлось выдать новый локальный `id` из-за столкновения. */
  renumbered: number
}

/**
 * Кладёт записи файла в хранилище, отсеивая виденные.
 *
 * Порядок и его причины:
 *
 * 1. Ключ дедупликации — пара (`file.author`, `entry.id`), а не голый `id`
 *    (решение 4). `id` уникален лишь ВНУТРИ одного файла, и два рецензента
 *    могут прислать записи с одинаковым `id`; дедупликация по голому `id`
 *    молча потеряла бы правку второго — прямое нарушение цели Ц4.
 *
 * 2. Столкновение `id` в хранилище разрешается ПЕРЕНУМЕРАЦИЕЙ входящей записи,
 *    а не сменой ключа хранилища (решение 7). Хранилище индексирует записи
 *    по `id`, по нему же движок ставит метку `data-kalka-applied`, ищет уже
 *    наложенный элемент и хранит статус. Сделать ключом пару значило бы
 *    переписать движок, слой меток и метку в чужом DOM ради случая, который
 *    на практике почти не встречается. Идентификаторы непрозрачны и ни на что,
 *    кроме различения записей, не влияют, поэтому перенумерация ничего
 *    не ломает; исходный `id` остаётся в `EntryOrigin.sourceId` и продолжает
 *    служить ключом дедупликации.
 *
 * 3. Всё накопленное уходит ОДНИМ `addMany` (решение 18): одно уведомление,
 *    одна ревизия. Цикл из `upsert` дал бы сорок проходов наложения на импорте
 *    сорока правок.
 *
 * Ни имя автора, ни тексты правок в лог не уходят (решение 22).
 */
export function mergeImported(file: ImportedFile): MergeReport {
  const report: MergeReport = { added: 0, duplicates: 0, renumbered: 0 }
  const importedAt = new Date().toISOString()
  const items: { entry: Entry; origin: EntryOrigin }[] = []

  // Занятые `id` считаются с учётом уже собранной пачки: внутри одного файла
  // столкновений быть не должно, но чужой файл — это что угодно, и два
  // одинаковых `id` в нём ничем не запрещены.
  const taken = new Set(entryStore.list().map((entry) => entry.id))

  for (const entry of file.entries) {
    const sourceId = entry.id

    if (entryStore.hasOrigin(file.author, sourceId)) {
      report.duplicates += 1
      continue
    }

    let id = sourceId
    if (taken.has(id)) {
      id = createId()
      report.renumbered += 1
    }
    taken.add(id)

    items.push({
      entry: { ...entry, id },
      origin: { author: file.author, sourceId, importedAt },
    })
    report.added += 1
  }

  entryStore.addMany(items)

  log.debug('слияние выполнено', {
    добавлено: report.added,
    дубликатов: report.duplicates,
    перенумеровано: report.renumbered,
  })

  return report
}
