import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { importFromFile } from 'features/import-entries'
import type { ImportOutcome } from 'features/import-entries'
import { flushRemovals, pendingRemovals, subscribeRemovals } from 'features/remove-entry'
import type { PendingRemoval } from 'features/remove-entry'
import { startVerifyMode } from 'features/verify-applied'
import { IMPORT_REPORT_MS } from 'shared/config/constants'
import { entryStore, numbering } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import { createLogger } from 'shared/lib/log'
import { plural } from 'shared/lib/plural'
import { Button } from 'shared/ui/Button'
import { countdownStyle } from '../lib/countdown'
import { EntryGroup } from './EntryGroup'

const log = createLogger('entry-list')

/*
 * Блок разбора целиком: загрузка правок, отчёт о ней, переключатель проверки
 * и список с группировкой по страницам (FR-30…FR-35).
 *
 * Всё одним слайсом намеренно (решение 21 плана вехи) — по той же причине,
 * по которой предпросмотр выгрузки и строка счётчика лежат вместе
 * в `widgets/export-summary`: это один блок интерфейса, отвечающий на один
 * вопрос, и дробление его на три слайса стоило бы трёх барелей против бюджета
 * NFR-01 при нулевой пользе.
 *
 * Подписка на хранилище тем же приёмом, что в `ExportSummary` и `MarkLayer`:
 * `useState` + `useEffect` + `subscribe`. Пакета `@preact/signals`
 * в зависимостях нет, и заводить его ради одного блока нельзя (NFR-01).
 *
 * Весь текст по-русски и без технических терминов (FR-36): ни «JSON»,
 * ни «формат», ни «версия 1», ни «разбор» рецензент здесь не видит.
 */

/** Перерисовка при любом изменении хранилища. */
function useStoreVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => entryStore.subscribe(() => setVersion((value) => value + 1)), [])
  return version
}

/**
 * Перерисовка при изменении буфера удалённых записей.
 *
 * ОТДЕЛЬНАЯ подписка, а не расширение хранилища: буфер меняется и тогда, когда
 * набор записей неподвижен — на истечении окна отката запись просто уходит
 * из буфера, и хранилищу об этом сказать нечего. Без этой подписки полоса
 * отмены висела бы на экране до следующей чужой перерисовки.
 */
function useRemovalsVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeRemovals(() => setVersion((value) => value + 1)), [])
  return version
}

/**
 * Отчёт о загрузке на экране.
 *
 * `until` есть только у удачного: отчёт об отказе не исчезает вовсе.
 */
interface Report {
  text: string
  error: boolean
  /** Когда отчёт погаснет. `null` — не гаснет никогда. */
  until: number | null
}

/** Отчёт о загрузке словами. Отдельная функция: все фразы обязаны лежать рядом. */
function reportOf(outcome: ImportOutcome): { text: string; error: boolean } {
  if (!outcome.ok) {
    if (outcome.reason === 'foreign-version') {
      return { text: 'Файл создан другой версией — правки не загружены', error: true }
    }
    if (outcome.reason === 'not-a-file') {
      return { text: 'В файле нет правок', error: true }
    }
    // `unreadable` и `unreadable-file`: человеку в обоих случаях нужно одно
    // и то же — взять другой файл. Различать их он не может и не должен.
    return { text: 'Не удалось прочитать файл — возможно, он повреждён', error: true }
  }

  const { added, duplicates } = outcome.report

  if (added === 0 && duplicates > 0) {
    // Тишина здесь читалась бы как «кнопка сломалась» (решение 3 плана вехи).
    return { text: 'Новых правок нет — этот файл уже загружен', error: false }
  }
  if (added === 0) {
    return { text: 'В файле нет правок', error: false }
  }

  const parts = [`Загружено ${added} ${plural(added, 'правка', 'правки', 'правок')}`]
  if (duplicates > 0) {
    parts.push(`${duplicates} уже ${plural(duplicates, 'была', 'были', 'были')} загружены`)
  }
  // Молчаливое исчезновение негодных записей — то же нарушение цели Ц4,
  // что и потеря файла, только меньшего масштаба: число называется вслух.
  if (outcome.skipped > 0) {
    const word = plural(outcome.skipped, 'запись', 'записи', 'записей')
    parts.push(`${outcome.skipped} ${word} пропущено`)
  }

  return { text: parts.join(', '), error: false }
}

/**
 * Возвращает удалённые записи в список НА ИХ МЕСТА — только для отрисовки.
 *
 * В хранилище их уже нет: удаление применилось в момент нажатия, страница
 * вернула исходный текст, метка исчезла, номера сдвинулись. Но место в списке
 * за ними держится до конца окна отката — иначе список прыгал бы дважды:
 * сразу при нажатии и ещё раз при отмене.
 *
 * Вставка идёт по возрастанию мест, и порядок здесь существенный: места сняты
 * с ЭТОГО ЖЕ списка в момент удаления, и вставка сверху вниз воспроизводит их
 * точно. Пойди она в обратную сторону — каждая следующая вставка смещала бы
 * места предыдущих.
 */
function withRemovals(entries: readonly Entry[], removals: readonly PendingRemoval[]): Entry[] {
  const merged = [...entries]
  for (const item of removals) {
    merged.splice(Math.min(item.index, merged.length), 0, item.entry)
  }
  return merged
}

/** Группы правок: текущая страница первой, остальные — в порядке появления. */
function groupByRoute(entries: readonly Entry[], route: string): { route: string; entries: Entry[] }[] {
  const groups = new Map<string, Entry[]>()
  for (const entry of entries) {
    const bucket = groups.get(entry.route)
    if (bucket) bucket.push(entry)
    else groups.set(entry.route, [entry])
  }

  const here = groups.get(route)
  const rest = [...groups.entries()].filter(([key]) => key !== route)

  return [
    ...(here ? [{ route, entries: here }] : []),
    ...rest.map(([key, items]) => ({ route: key, entries: items })),
  ]
}

export function EntryList(): JSX.Element {
  useStoreVersion()
  useRemovalsVersion()

  const picker = useRef<HTMLInputElement | null>(null)
  const stopVerify = useRef<(() => void) | null>(null)
  const root = useRef<HTMLDivElement | null>(null)
  const [report, setReport] = useState<Report | null>(null)

  /*
   * Снятие режима проверки на размонтировании ОБЯЗАТЕЛЬНО: без него полный
   * демонтаж «Кальки» оставил бы слой правок выключенным навсегда, и рецензент
   * решил бы, что виджет потерял всю его работу.
   *
   * ⚠ Это НЕ обработчик закрытия ящика, и путать одно с другим нельзя.
   * Ящик закрывается, ПРЯЧА список, а не размонтируя его: закрытие — действие
   * лёгкое и по смыслу обратимое (посмотреть на страницу целиком и вернуться),
   * а выключение проверки — тяжёлое и осознанное. Размонтируй список при
   * закрытии — и проверка снималась бы вместе с ним, вместе с отчётом
   * о только что загруженном файле, каждый раз, когда человек просто хотел
   * взглянуть на прототип. Проверка выключается кнопкой «Выйти из проверки»
   * либо вместе со всем виджетом — и больше ничем (FR-35).
   */
  useEffect(
    () => () => {
      stopVerify.current?.()
      stopVerify.current = null

      /*
       * Открытые окна отката ЗАКРЫВАЮТСЯ ПОДТВЕРЖДЕНИЕМ, а не возвратом правок.
       *
       * Направление здесь единственно верное: записи сняты с хранилища и со
       * страницы ещё в момент нажатия, и вернуть их при демонтаже значило бы
       * отдать человеку правки, которые он на глазах удалил.
       *
       * ⚠ Это, как и снятие проверки выше, НЕ обработчик закрытия ящика:
       * закрытый ящик прячется через `hidden`, а не размонтируется.
       */
      flushRemovals()
    },
    [],
  )

  /*
   * Гашение удачного отчёта.
   *
   * Зависимость — сам объект отчёта, а не его поля: он пересоздаётся ровно
   * при новой загрузке, и эффект перезаводит таймер тогда же. Перерисовки
   * от изменений набора — а их много — идентичность не трогают, и таймер
   * переживает их не сбрасываясь.
   *
   * Срок считается от МЕТКИ, а не берётся константой: между постановкой
   * таймера и этим кадром могло пройти время, если отчёт пережил перерисовку.
   */
  useEffect(() => {
    if (report === null || report.until === null) return

    const timer = window.setTimeout(
      () => setReport(null),
      Math.max(0, report.until - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [report])

  /**
   * Полоса, занятая интерфейсом, — измеренная, а не вычисленная из констант.
   *
   * Ширина ящика живёт в стилях и меняется вместе с ними (узкий экран отдаёт
   * ему всю ширину), поэтому литерала `408` здесь нет и быть не должно.
   * Мерится в момент перехода, а не при отрисовке: между ними мог измениться
   * размер окна.
   *
   * Закрытый ящик прямоугольника не даёт: `hidden` схлопывает его в нули,
   * и поправка не применяется — ровно то поведение, что было до ящика.
   */
  function coveredStrip(): DOMRectReadOnly | null {
    const drawer = root.current?.closest('.kalka-drawer')
    if (!drawer) return null
    const rect = drawer.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 ? rect : null
  }

  const entries = entryStore.list()
  const route = entryStore.route()
  /*
   * Удалённые записи, ждущие отката. Карта по идентификатору, а не список:
   * группа спрашивает про КАЖДУЮ свою запись, «ждёт ли она отката», и перебор
   * списка на каждой строке был бы обходом набора заново на каждую строку —
   * ровно то, чего избегает и `numbering()`.
   */
  const removals = pendingRemovals()
  const removalById = new Map(removals.map((item) => [item.id, item]))
  /*
   * Номера берутся ИЗ ПОРЯДКА ХРАНИЛИЩА, а не из порядка отрисовки.
   *
   * `groupByRoute` ниже перекладывает записи в группы по страницам и ставит
   * текущую первой — исходного порядка после него нет ни у кого. Считай номер
   * на месте отрисовки, и на второй группе нумерация началась бы с единицы
   * заново, а связь метка↔запись перестала бы работать ровно там, где чаще
   * всего и нужна: на чужой странице.
   */
  const numbers = numbering()
  const verifying = entryStore.verifyMode()

  /*
   * Лог только на ФАКТИЧЕСКОМ изменении набора, а не на каждой отрисовке.
   *
   * Список перерисовывается от любого уведомления хранилища — включая смену
   * маршрута, статусов и вида страницы, — и строка отсюда шла бы потоком,
   * ничего не сообщая. В проекте это уже установленное правило: так же
   * устроен счётчик скрытых меток в слое.
   *
   * Число и диапазон номеров — первое, что спрашивают, когда «номера в списке
   * и на странице не сходятся».
   */
  useEffect(() => {
    log.debug('список разбора построен', {
      записей: entries.length,
      номера: entries.length === 0 ? 'нет' : `1…${entries.length}`,
    })
  }, [entries.length])

  async function load(event: JSX.TargetedEvent<HTMLInputElement>): Promise<void> {
    const input = event.currentTarget
    const file = input.files?.[0]
    // Сброс ДО выхода и до любой асинхронщины: без него повторный выбор ТОГО ЖЕ
    // файла не даёт события `change`, и человек решит, что кнопка сломалась.
    input.value = ''
    if (!file) return

    log.debug('файл выбран', { имя: file.name, байт: file.size })

    const outcome = reportOf(await importFromFile(file))
    /*
     * Удачный отчёт гаснет сам, отказ остаётся.
     *
     * «Загружено 4 правки» нужно ровно один раз — в секунду, когда человек
     * отпустил кнопку. Дальше эта строка занимает место под кнопкой навсегда
     * и сообщает о событии, которое было десять минут назад.
     *
     * Отказ — другое дело: «не удалось прочитать файл» означает, что работа
     * НЕ СДЕЛАНА и нужно взять другой файл. Пропади он через шесть секунд —
     * человек отвёл бы глаза, вернулся и увидел пустой список без объяснения,
     * то есть решил бы, что загрузка прошла. Это ровно та потеря, от которой
     * бережёт цель Ц4.
     */
    setReport({ ...outcome, until: outcome.error ? null : Date.now() + IMPORT_REPORT_MS })
  }

  function toggleVerify(): void {
    if (stopVerify.current) {
      stopVerify.current()
      stopVerify.current = null
      log.debug('проверка выключена')
      return
    }
    stopVerify.current = startVerifyMode()
    log.debug('проверка включена')
  }

  /*
   * ── Порядок внутри списка: сперва правки, потом инструменты ───────────────
   *
   * «Загрузить правки» и «Проверить правки» стоят ПОСЛЕ групп, а не перед ними.
   *
   * Прежде они занимали первый экран ящика и не освобождали его никогда,
   * а обращаются к ним дважды за разбор: загрузить чужой файл и включить
   * проверку после передеплоя. Всё остальное время человек читает список —
   * и читал его начиная с четвёртой строки сверху.
   *
   * Порядок в разметке, а не перестановка стилями: он же порядок обхода
   * с клавиатуры, и «сначала содержимое, потом инструменты над ним» верно
   * для обоих способов чтения. `order` во flex развёл бы их и оставил бы
   * табуляцию идти против того, что видно на экране.
   *
   * Отчёт о загрузке и подсказка проверки переехали сюда же, под свои кнопки:
   * ответ обязан стоять там, где нажимали, а не на другом краю панели.
   */
  return (
    <div class="kalka-list" ref={root}>
      <div class="kalka-list__groups">
        {groupByRoute(withRemovals(entries, removals), route).map((group) => (
          <EntryGroup
            key={group.route}
            route={group.route}
            entries={group.entries}
            here={group.route === route}
            covered={coveredStrip}
            numbers={numbers}
            removals={removalById}
          />
        ))}
      </div>

      <div class="kalka-list__dev">
        <div class="kalka-list__devrow">
          {/* Поле выбора файла скрыто и живёт внутри теневого корня: собственный
              вид кнопки виджета не должен зависеть от того, как носитель
              оформляет `input[type=file]`. */}
          <input
            class="kalka-list__picker"
            type="file"
            accept="application/json,.json"
            ref={picker}
            onChange={(event) => void load(event)}
          />
          <Button onClick={() => picker.current?.click()}>Загрузить правки</Button>
          <Button onClick={toggleVerify} disabled={entries.length === 0}>
            {/* Подпись сокращена до действия: «Проверить, что правки доехали»
                в 360 пикселях ящика переносилась на две строки и делала кнопку
                вдвое выше соседней. Что именно проверяется, объясняет подсказка
                ниже — она появляется ровно тогда, когда проверка включена. */}
            {verifying ? 'Выйти из проверки' : 'Проверить правки'}
          </Button>
        </div>

        {report && (
          <p class={`kalka-list__report${report.error ? ' kalka-list__report--error' : ''}`}>
            {report.text}
            {/* Полоса та же, что у отмены удаления: строка гаснет сама, и молчать
                об этом нельзя — исчезнувший без предупреждения текст читается
                как сбой, а не как истёкший срок. У отказа её нет: он не гаснет. */}
            {report.until !== null && (
              <span
                class="kalka-countdown"
                aria-hidden="true"
                style={countdownStyle(report.until, IMPORT_REPORT_MS)}
              />
            )}
          </p>
        )}

        {/* Следствие решения 10, сказанное человеку: иначе исчезнувшие с экрана
            правки выглядят как потерянная работа. */}
        {verifying && (
          <p class="kalka-list__hint">
            Страница показана такой, какая она сейчас, без наложенных правок
          </p>
        )}
      </div>
    </div>
  )
}
