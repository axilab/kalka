import type { JSX } from 'preact'
import type { PendingRemoval } from 'features/remove-entry'
import type { Entry } from 'shared/model/format'
import { EntryRow } from './EntryRow'
import { UndoStrip } from './UndoStrip'

/*
 * Группа правок одной страницы сайта-носителя (FR-32).
 *
 * Группировка по `entry.route` — то, чем правки привязаны к странице.
 * Порядок групп задаёт `EntryList`: текущая страница первой, остальные —
 * в порядке первого появления записи.
 */

export interface EntryGroupProps {
  /** Маршрут страницы: он же заголовок группы. */
  route: string
  entries: readonly Entry[]
  /** Это страница, на которой сейчас находится носитель. */
  here: boolean
  /**
   * Измеритель полосы, занятой интерфейсом. Группа его не вызывает и не
   * толкует — только проводит от списка к строке, где он и нужен.
   */
  covered?: () => DOMRectReadOnly | null
  /**
   * Сквозные номера записей. Группа их не считает и не толкует — только
   * проводит от списка к строке: считать здесь означало бы считать заново
   * в каждой группе.
   */
  numbers?: ReadonlyMap<string, number>
  /**
   * Записи, удалённые и ждущие отката, — по идентификатору.
   *
   * Группа их не считает и не толкует, ровно как номера: она только знает,
   * что на месте такой записи рисуется полоса отмены, а не строка. Сама запись
   * приходит в `entries` наравне с прочими — иначе полосе негде было бы встать
   * на своё место, а список прыгал бы в момент нажатия.
   */
  removals?: ReadonlyMap<string, PendingRemoval>
}

export function EntryGroup({
  route,
  entries,
  here,
  covered,
  numbers,
  removals,
}: EntryGroupProps): JSX.Element {
  // Удалённая запись из СЧЁТА выбывает сразу, хотя её полоса ещё на экране:
  // число в шапке группы отвечает на вопрос «сколько правок на этой странице»,
  // а удалённая правка — уже не правка. Тем же порядком уходит и её номер:
  // `numbering()` считает номера из набора, которого в ней больше нет.
  const counted = entries.filter((entry) => !removals?.has(entry.id)).length

  return (
    <div class="kalka-group">
      <p class="kalka-group__head">
        {/* Адрес страницы и число правок в ней: по этим двум величинам человек
            решает, куда идти дальше. */}
        <span class="kalka-group__route">{route || '/'}</span>
        {here && <span class="kalka-group__here">эта страница</span>}
        <span class="kalka-group__count">{counted}</span>
      </p>

      {entries.map((entry) => {
        const removal = removals?.get(entry.id)
        // Ключ у полосы ТОТ ЖЕ, что у строки: это одно и то же место списка
        // в двух состояниях, и разные ключи заставили бы Preact размонтировать
        // строку и смонтировать полосу как соседей — с прыжком раскладки
        // ровно там, где его быть не должно.
        return removal ? (
          <UndoStrip
            key={entry.id}
            id={entry.id}
            imported={removal.imported}
            until={removal.until}
          />
        ) : (
          <EntryRow
            key={entry.id}
            entry={entry}
            here={here}
            covered={covered}
            number={numbers?.get(entry.id)}
          />
        )
      })}
    </div>
  )
}
