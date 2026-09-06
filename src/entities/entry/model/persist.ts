import type { Entry } from 'shared/model/format'
import type { EntryOrigin } from 'shared/model/layer'
import {
  BROKEN_ENTRIES_KEY,
  ENTRIES_KEY,
  PERSIST_DEBOUNCE_MS,
  STORAGE_FORMAT,
} from 'shared/config/constants'
import { read, write } from 'shared/api/storage'
import { debounce } from 'shared/lib/debounce'
import { createLogger } from 'shared/lib/log'
import { isObject, isString, readEntry } from './read'
import { entryStore } from './store'

const log = createLogger('entry:persist')

/*
 * Снимок набора правок в localStorage (FR-23, FR-24).
 *
 * Разбор и сборка живут ЗДЕСЬ, а не в `shared/api/storage.ts`: тот знает про
 * строки и `try/catch`, про форму записи он знать не имеет права — иначе
 * внешняя граница начнёт понимать предметную область, и починка формата записи
 * будет править файл, который к записям отношения не имеет.
 *
 * Само хранилище (`model/store.ts`) о localStorage тоже не знает: оно остаётся
 * проверяемым без браузера, а запись подписывается на него снаружи.
 *
 * В лог не уходит ни `was`, ни `now`, ни сырое содержимое ключа — только
 * количества, длины и `id` (решение 18 плана вехи).
 */

/**
 * Форма снимка в хранилище. Внутренний тип: наружу не выходит и в файл обмена
 * не превращается.
 *
 * Это НЕ `ExchangeFile`. Поля `site`, `author` и `about` — свойства момента
 * экспорта, а не хранимого состояния: `site` вычисляется из адреса при экспорте,
 * `about` — константа, `author` живёт своим ключом. Хранить их в снимке значило
 * бы завести три места, где одно и то же значение может разойтись.
 *
 * Номер `format` при этом тот же, что у файла обмена, намеренно: версия
 * описывает форму ЗАПИСЕЙ, а записи в обоих местах одни и те же.
 */
export interface Snapshot {
  format: number
  exportedAt: string | null
  entries: Entry[]
  /**
   * Происхождение импортированных записей: `id` → чей файл её принёс (FR-33).
   *
   * Поле НЕОБЯЗАТЕЛЬНОЕ, и `STORAGE_FORMAT` из-за него НЕ повышается: добавление
   * необязательного поля старую версию не ломает — снимок без `origins`
   * читается как набор без импортированных правок, и это правда, а не потеря
   * данных. Повышать номер имело бы смысл, если бы старый снимок стал
   * нечитаемым; он не стал.
   *
   * В файл обмена это поле не попадает никогда: там автор живёт в шапке
   * (`ExchangeFile.author`), а снимок — не файл обмена, и рантаймовые свойства
   * набора в нём законны.
   */
  origins?: Record<string, EntryOrigin>
}

/** Что вернул разбор сырой строки: годный снимок либо причина отказа. */
export type ParseResult = Snapshot | 'broken' | 'future'

/*
 * Разбор ОДНОЙ записи живёт в `model/read.ts`, а не здесь: ровно ту же форму
 * имеет запись файла обмена, и второй валидатор рядом с первым разошёлся бы
 * с ним на первой же правке формата (см. шапку `read.ts`).
 */

/**
 * Карта происхождения из снимка. Негодные значения отбрасываются ПОШТУЧНО.
 *
 * Негодное происхождение НЕ отбрасывает саму запись: правка дороже сведений
 * о том, откуда она пришла. Потерянное происхождение делает импортированную
 * запись «своей» — она начнёт считаться в вопросе при закрытии вкладки
 * и сможет прийти второй раз при повторном импорте. Оба исхода безобидны
 * рядом с потерей самой правки.
 */
function readOrigins(value: unknown): Map<string, EntryOrigin> {
  const result = new Map<string, EntryOrigin>()
  if (!isObject(value)) return result

  for (const [id, raw] of Object.entries(value)) {
    if (!isObject(raw)) continue
    const { author, sourceId, importedAt } = raw
    if (!isString(author) || !isString(sourceId) || !isString(importedAt)) continue
    result.set(id, { author, sourceId, importedAt })
  }

  return result
}

/**
 * Разбирает сырое содержимое ключа.
 *
 * Вынесена отдельной функцией намеренно: это ровно тот код, который проверяется
 * таблицей входов, а не руками на стенде. Сюда приходит содержимое чужого
 * localStorage — то есть что угодно.
 *
 * - `'broken'` — не разобралось как JSON или разобралось не в снимок;
 * - `'future'` — снимок более новой версии формата;
 * - `Snapshot` — годное содержимое; отдельные негодные записи уже отброшены.
 */
export function parseSnapshot(raw: string): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'broken'
  }

  if (!isObject(parsed) || !Array.isArray(parsed.entries)) return 'broken'

  const format = typeof parsed.format === 'number' ? parsed.format : 0
  // Строго больше: снимок ровно нашей версии читается, снимок старее — тоже
  // (форма записей чинится дозаполнением), снимок новее не читается и не будет
  // перезаписан.
  if (format > STORAGE_FORMAT) return 'future'

  const entries: Entry[] = []
  for (const item of parsed.entries) {
    const entry = readEntry(item)
    if (entry) {
      entries.push(entry)
      continue
    }
    // По `id`, если он вообще есть: сама запись в лог не попадает.
    log.warn('запись снимка отброшена', {
      id: isObject(item) && isString(item.id) ? item.id : 'без id',
    })
  }

  // Счёт отброшенных печатается здесь, а не в `restoreEntries`: только эта
  // функция знает исходную длину массива, а расширять ради неё возвращаемый тип
  // значило бы подмешивать отчёт о разборе в форму снимка.
  log.info('снимок разобран', {
    прочитано: entries.length,
    отброшено: parsed.entries.length - entries.length,
  })

  const origins = readOrigins(parsed.origins)

  return {
    format,
    exportedAt: isString(parsed.exportedAt) ? parsed.exportedAt : null,
    entries,
    ...(origins.size > 0 ? { origins: Object.fromEntries(origins) } : {}),
  }
}

/**
 * Поднимает набор правок из хранилища в `entryStore` (FR-23, FR-24).
 *
 * Вызывается один раз при загрузке, ДО первой отрисовки интерфейса и до первого
 * прохода наложения. Наружу не бросает ничего: отказ восстановления оставляет
 * рецензента с пустым набором, но с работающей панелью (NFR-06).
 */
export function restoreEntries(): void {
  const raw = read(ENTRIES_KEY)

  if (raw === null) {
    // Норма первого запуска, а не отказ: на этом адресе «Кальку» ещё
    // не открывали.
    log.debug('снимка в хранилище нет, набор пуст')
    return
  }

  const parsed = parseSnapshot(raw)

  if (parsed === 'broken') {
    // Сырая строка переносится в отдельный ключ, а основной НЕ трогается:
    // молча уничтожить работу рецензента при первой же случайности нельзя,
    // и отложенная копия оставляет шанс достать данные руками через консоль.
    const saved = write(BROKEN_ENTRIES_KEY, raw)
    log.warn('содержимое хранилища непригодно, работа начата с пустого набора', {
      длина: raw.length,
      копияОтложена: saved,
    })
    return
  }

  if (parsed === 'future') {
    // Снимок оставил более свежий бандл «Кальки» на том же адресе. Читать его
    // нечем, а записывать поверх нельзя: наш `format: 1` затёр бы чужую работу.
    // Персистентность выключается на всю сессию, и рецензент видит это словами
    // в панели, а не только строкой в логе.
    entryStore.setPersistFailed(true, 'version')
    log.warn('снимок незнакомой версии, сохранение выключено', { длина: raw.length })
    return
  }

  entryStore.seed(parsed.entries)
  // ПОСЛЕ seed: он очищает карту происхождения вместе с набором.
  // ДО markExported: порядок здесь тот же, что и у момента экспорта, — сперва
  // всё, что seed сбросил, и только потом состояние выгрузки.
  const origins = parsed.origins ? new Map(Object.entries(parsed.origins)) : undefined
  entryStore.seedOrigins(origins)
  // ПОСЛЕ seed: он сбрасывает состояние экспорта в «не экспортировано»,
  // и восстановленный момент обязан лечь поверх этого сброса.
  if (parsed.exportedAt !== null) entryStore.markExported(parsed.exportedAt)

  log.info('набор правок восстановлен', {
    прочитано: parsed.entries.length,
    происхождений: origins?.size ?? 0,
    версияСнимка: parsed.format,
    выгружен: parsed.exportedAt !== null,
  })
}

/*
 * ── Запись ───────────────────────────────────────────────────────────────────
 */

/**
 * Есть ли неисполненная отложенная запись.
 *
 * Модульная переменная, а не поле замыкания `startPersist`: `flushPersist`
 * вызывается снаружи (из `pagehide` и из снятия подписки) и обязан знать,
 * есть ли что сбрасывать. Экземпляр «Кальки» на странице один — второго набора
 * этих переменных не бывает.
 */
let pending = false

/** Ревизия, которая уже лежит в хранилище (или считается лежащей). */
let writtenRevision = 0

/** Немедленная сериализация и запись снимка. */
function persistNow(): void {
  pending = false

  const origins = entryStore.origins()

  const snapshot: Snapshot = {
    format: STORAGE_FORMAT,
    exportedAt: entryStore.exportedAt(),
    entries: entryStore.list(),
    // Пустая карта в снимок не пишется: лишний ключ в каждом снимке ради
    // ничего, а читается его отсутствие ровно так же — «импортированных
    // правок нет».
    ...(origins.size > 0 ? { origins: Object.fromEntries(origins) } : {}),
  }

  // Отступов нет: снимок читает код, а не человек. Читаемая выгрузка — это
  // файл экспорта, и там отступы есть.
  const text = JSON.stringify(snapshot)
  const revision = entryStore.revision()
  const ok = write(ENTRIES_KEY, text)

  if (!ok) {
    // Ревизия НЕ запоминается: следующая мутация обязана попробовать снова,
    // иначе освободившееся место так и осталось бы неиспользованным.
    entryStore.setPersistFailed(true, 'write')
    return
  }

  writtenRevision = revision
  // Снимаем предупреждение: место освободилось, и держать на экране надпись
  // «правки не сохраняются» после успешной записи значило бы гнать рецензента
  // экспортировать на ровном месте.
  entryStore.setPersistFailed(false, 'write')
  log.debug('снимок записан', { записей: snapshot.entries.length, длина: text.length })
}

const schedule = debounce(persistNow, PERSIST_DEBOUNCE_MS)

/**
 * Сбрасывает отложенную запись немедленно.
 *
 * Вызывается из `pagehide` и из снятия подписки. `pagehide`, а не
 * `beforeunload`: последний не гарантирован на мобильных, а `pagehide`
 * приходит и при уходе вкладки в bfcache. Без этого сброса теряется ровно
 * последняя правка — та, ради которой вся веха и делается.
 */
export function flushPersist(): void {
  if (!pending) return
  schedule.cancel()
  persistNow()
}

/**
 * Поднимает запись снимка по подписке на хранилище. Возвращает полное снятие.
 *
 * Пишет ТОЛЬКО при смене `revision()`: движок наложения дёргает подписчиков
 * на каждом проходе — то есть на каждой мутации носителя и на каждой
 * навигации, — и запись «при любом уведомлении» превратила бы прокрутку
 * страницы в поток сериализаций.
 *
 * Ревизия запоминается НА СТАРТЕ: восстановление из хранилища тоже её
 * увеличивает, и без этой предосторожности первая же подписка записала бы
 * обратно то, что оттуда только что прочитала.
 */
export function startPersist(): () => void {
  writtenRevision = entryStore.revision()

  // Снимок незнакомой версии не перезаписывается никогда: он оставлен более
  // свежим бандлом «Кальки», и наш `format: 1` затёр бы чужую работу (NFR-08).
  const blocked = entryStore.persistFailed()
  if (blocked) log.warn('запись выключена на эту сессию: снимок незнакомой версии')

  const stopStore = entryStore.subscribe(() => {
    if (blocked) return

    const revision = entryStore.revision()
    if (revision === writtenRevision) return
    // Ревизия здесь не запоминается: запись ещё не состоялась, и запоминание
    // на этом месте потеряло бы её при отказе.
    pending = true
    log.debug('запись снимка запланирована', { ревизия: revision, записей: entryStore.list().length })
    schedule()
  })

  // Слушатель `pagehide` вешается ЗДЕСЬ, а не в `app`, и это отступление от
  // правила «глобальную область трогает только app» — осознанное и оговорённое
  // планом вехи. Причина: сброс отложенной записи и её планирование обязаны
  // жить в одном месте, иначе снятие подписки в `app` и отмена таймера здесь
  // разъедутся по порядку, и последняя правка потеряется ровно в тот момент,
  // ради которого вся веха и делается. Слушатель снимается возвращаемой
  // функцией — после демонтажа на странице не остаётся ни одного нашего
  // обработчика.
  const onPageHide = (): void => flushPersist()
  window.addEventListener('pagehide', onPageHide)

  return (): void => {
    stopStore()
    window.removeEventListener('pagehide', onPageHide)
    // Сброс ПЕРЕД отменой таймера: снятие виджета не имеет права потерять
    // правку, сделанную за миг до него.
    flushPersist()
    schedule.cancel()
  }
}
