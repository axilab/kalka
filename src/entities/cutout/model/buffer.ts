import { read, remove, write } from 'shared/api/storage'
import { CUTOUTS_KEY, CUTOUT_BUFFER_MAX_BYTES } from 'shared/config/constants'
import { createLogger } from 'shared/lib/log'
import type { Cutout } from 'shared/model/layer'

const log = createLogger('cutout:buffer')

/*
 * ЧЕРНОВОЙ БУФЕР вырезок.
 *
 * ── Черновой, потому что со сроком жизни ────────────────────────────────────
 *
 * Вырезки пишутся в момент правки, переживают переходы между страницами разбора
 * и стираются после печати. В файл обмена они не попадают никогда, и разработчик,
 * импортировавший чужой JSON, отчёта с картинками не получит: транспорт для
 * картинок — сам напечатанный документ.
 *
 * ── Несущий инвариант: жертвуем вырезку, а не запись ────────────────────────
 *
 * Буфер лежит в `localStorage` под СВОИМ ключом рядом с записями, и это
 * решение, а не удобство. Записи — то, ради чего продукт существует; вырезки —
 * вспомогательные картинки. Лежи они в одном ключе, переполнение квоты от
 * разросшихся картинок сорвало бы запись ПРАВОК. Отсюда три обязательства:
 *
 *   1. писать только под `CUTOUTS_KEY` и никогда не трогать `ENTRIES_KEY`;
 *   2. при отказе записи НЕ выставлять `persistFailed` записей — это флаг
 *      другого хранилища, и подняв его отсюда, виджет соврал бы рецензенту,
 *      что не сохранились правки, тогда как не сохранилась картинка;
 *   3. считать потерю буфера штатной: нет вырезки — отчёт деградирует в текст
 *      с явной пометкой.
 *
 * ── Сироты и порядок вытеснения ────────────────────────────────────────────
 *
 * Съёмка идёт в точке создания ЧЕРНОВИКА, а черновик записью становится не
 * всегда: `captureDraft` зовётся на каждый клик по элементу при включённом
 * инструменте «Текст», а правка, сведённая к оригиналу, записи не создаёт.
 * Значит в буфере копятся вырезки под идентификаторами, которых в наборе нет.
 *
 * Сам буфер отличить сироту от живой вырезки НЕ МОЖЕТ и не должен: набор
 * записей лежит в соседнем слайсе того же слоя, и знать о нём отсюда нельзя.
 * Поэтому здесь два разных механизма, и путать их не надо:
 *
 *   — `fit()` вытесняет по ВОЗРАСТУ, когда буфер упёрся в потолок. Это
 *     последняя защита от переполнения, а не уборка;
 *   — `keep()` снимает сирот по списку живых идентификаторов. Список приносит
 *     слой выше, и зовётся `keep()` перед печатью, когда набор устоялся.
 *
 * Звать `keep()` на каждое изменение набора нельзя: вырезка пишется отложенно,
 * а запись замечания появляется в хранилище только после ввода комментария —
 * проход между этими моментами снял бы вырезку живой правки.
 */

/** Снимок буфера: идентификатор записи → её вырезка. */
type Buffer = Record<string, Cutout>

/** Размер строки в байтах: потолок назначен в байтах, а не в знаках. */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function isNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Годится ли хранимая вырезка к употреблению.
 *
 * ── Почему проверка формы, а не приведение типом ────────────────────────────
 *
 * Буфер лежит в `localStorage` и ПЕРЕЖИВАЕТ ПЕРЕДЕПЛОЙ. Вырезку туда положила
 * та сборка виджета, которая работала на этом адресе вчера, а достаёт её
 * сегодняшняя — и поля у них совпадают ровно до первого изменения `Cutout`.
 * Приведение `as Cutout` этого не замечает: разбор проходит, вырезка уходит
 * в отчёт, и падает уже сборка документа, обратившись к полю, которого нет.
 *
 * Стоило это ровно так: `Cutout` получил поле `band` (полоса кадра), после
 * передеплоя кнопка «Отчёт» перестала работать молча, а в консоль носителя
 * улетело `Cannot read properties of undefined`. Виджет — гость, и ронять
 * чужую страницу он не имеет права (NFR-06).
 *
 * Номер версии буфера завести было бы можно, но проверка формы честнее: она
 * ловит не только «старую сборку», но и чужую запись под нашим ключом, и просто
 * побитый снимок. А номер версии пришлось бы помнить поднять при каждой правке
 * `Cutout` — то есть держать инвариант на памяти человека.
 *
 * Непригодная вырезка не чинится, а выбрасывается: она снимется заново тем же
 * кругом правки, а отчёт до тех пор честно скажет, что место показать
 * не удалось. Записи это не касается никак — гибнет картинка, не правка.
 */
function usable(value: unknown): value is Cutout {
  if (value === null || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  const band = c.band as Record<string, unknown> | undefined
  const box = c.anchorBox as Record<string, unknown> | undefined

  return (
    typeof c.html === 'string' &&
    isNumber(c.width) &&
    isNumber(c.height) &&
    typeof c.at === 'string' &&
    Array.isArray(c.fontFaces) &&
    band !== undefined &&
    isNumber(band.y) &&
    isNumber(band.h) &&
    box !== undefined &&
    isNumber(box.x) &&
    isNumber(box.y) &&
    isNumber(box.w) &&
    isNumber(box.h)
  )
}

/**
 * Читает буфер целиком, отбрасывая вырезки неподходящей формы.
 *
 * Непригодное содержимое — это ПУСТОЙ буфер, а не исключение и не откладывание
 * копии в сторону, как у записей. Разница намеренная: сломанный снимок правок
 * стоит спасать руками через консоль, сломанный буфер картинок — нет,
 * они снимаются заново одним кругом правки.
 */
function load(): Buffer {
  const raw = read(CUTOUTS_KEY)
  if (raw === null) return {}

  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const buffer: Buffer = {}
    let dropped = 0
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (usable(value)) buffer[id] = value
      else dropped += 1
    }

    if (dropped > 0) {
      log.warn('вырезки прежней формы отброшены, снимутся заново', {
        отброшено: dropped,
        осталось: Object.keys(buffer).length,
      })
      // Чистка ЗАПИСЫВАЕТСЯ, а не только применяется к прочитанному. Иначе
      // негодные байты лежат в хранилище дальше: занимают квоту, которой
      // и так делимся с сайтом-носителем, и повторяют это предупреждение
      // на каждое обращение к буферу. Запись из читающего пути — единственная
      // на весь срок жизни негодной вырезки, а не побочное действие на каждый
      // вызов: со второго раза отбрасывать уже нечего.
      save(buffer)
    }

    return buffer
  } catch (error) {
    log.warn('буфер вырезок непригоден, начинаем с пустого', { ошибка: error })
    return {}
  }
}

/** Пишет буфер целиком. `false` — записать не удалось. */
function save(buffer: Buffer): boolean {
  const text = JSON.stringify(buffer)
  const ok = write(CUTOUTS_KEY, text)

  if (!ok) {
    // Флаг отказа записей отсюда НЕ поднимается: см. инвариант 2 в шапке.
    log.warn('буфер вырезок не записан, отчёт покажет текст', {
      вырезок: Object.keys(buffer).length,
      байт: byteLength(text),
    })
  }

  return ok
}

/**
 * Вытесняет самые старые вырезки, пока буфер не уложится в потолок.
 *
 * Порядок по `at`, а не по порядку ключей: порядок ключей в объекте после
 * сериализации и разбора формально сохраняется, но опираться на него значит
 * держать инвариант хранения на детали реализации `JSON.parse`.
 */
function fit(buffer: Buffer): { buffer: Buffer; dropped: number } {
  const current = { ...buffer }
  let dropped = 0

  while (byteLength(JSON.stringify(current)) > CUTOUT_BUFFER_MAX_BYTES) {
    const oldest = Object.entries(current).sort(([, a], [, b]) => a.at.localeCompare(b.at))[0]
    if (oldest === undefined) break

    delete current[oldest[0]]
    dropped += 1
  }

  return { buffer: current, dropped }
}

/**
 * Кладёт вырезку под идентификатор записи. `false` — не легла.
 *
 * Отказ здесь штатен и наверх идёт значением, а не исключением: вызывающий
 * обязан продолжить работу, а не считать правку несохранённой.
 */
function put(entryId: string, cutout: Cutout): boolean {
  const buffer = load()
  buffer[entryId] = cutout

  const fitted = fit(buffer)
  if (fitted.dropped > 0) {
    log.warn('вытеснены старые вырезки: буфер уперся в потолок', {
      снято: fitted.dropped,
      потолок: CUTOUT_BUFFER_MAX_BYTES,
    })
  }

  const ok = save(fitted.buffer)
  log.debug('вырезка положена в буфер', {
    id: entryId,
    байт: byteLength(cutout.html),
    вБуфере: Object.keys(fitted.buffer).length,
    легла: ok,
  })

  return ok
}

/** Вырезка записи, если она есть. */
function get(entryId: string): Cutout | null {
  const cutout = load()[entryId] ?? null
  log.debug('запрос вырезки', { id: entryId, есть: cutout !== null })
  return cutout
}

/** Есть ли вырезка у записи. Дешевле `get`, когда содержимое не нужно. */
function has(entryId: string): boolean {
  return load()[entryId] !== undefined
}

/** Снимает вырезку удалённой записи: вырезка без записи бессмысленна. */
function drop(entryId: string): void {
  const buffer = load()
  if (buffer[entryId] === undefined) return

  delete buffer[entryId]
  save(buffer)
  log.debug('вырезка снята', { id: entryId, осталось: Object.keys(buffer).length })
}

/**
 * Оставляет в буфере только вырезки перечисленных записей. Возвращает число
 * снятых.
 *
 * Это сбор СИРОТ — вырезок, снятых на черновик, который записью так и не стал
 * (разбор причины — в шапке файла). Зовётся слоем выше при печати и при первом
 * изменении набора после неё.
 */
function keep(ids: readonly string[]): number {
  const buffer = load()
  const alive = new Set(ids)
  const kept: Buffer = {}
  let dropped = 0

  for (const [id, cutout] of Object.entries(buffer)) {
    if (alive.has(id)) kept[id] = cutout
    else dropped += 1
  }

  if (dropped === 0) return 0

  save(kept)
  log.info('сняты вырезки без записей', { снято: dropped, осталось: Object.keys(kept).length })
  return dropped
}

/** Стирает буфер целиком. Возвращает число снятых вырезок. */
function clear(): number {
  const count = Object.keys(load()).length
  if (count === 0) return 0

  remove(CUTOUTS_KEY)
  log.info('буфер вырезок очищен', { снято: count })
  return count
}

/**
 * Черновой буфер вырезок.
 *
 * Объект, а не набор отдельных экспортов: у слайса уже есть чистые функции
 * (`buildCutout`, `checkCutout`), и голые `get`/`put`/`clear` рядом с ними
 * читались бы у вызывающего как что угодно. `cutoutBuffer.clear()` называет
 * себя сам.
 */
export const cutoutBuffer = { put, get, has, drop, keep, clear }
