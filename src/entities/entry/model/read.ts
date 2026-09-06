import type { Anchor, Entry, EntryType, Style } from 'shared/model/format'
import { agentFieldsPlaceholder } from './draft'

/*
 * Единый валидатор записи. Внутренняя деталь слайса: наружу (`index.ts`)
 * не экспортируется — потребители работают через `parseSnapshot`
 * и `parseExchangeFile`.
 *
 * У валидатора ДВА вызывающих, и это главное, что о нём нужно знать:
 *   - `model/persist.ts` — разбор снимка `localStorage`;
 *   - `model/parse.ts`   — разбор файла обмена.
 *
 * Запись снимка и запись файла обмена имеют РОВНО ОДНУ И ТУ ЖЕ форму: снимок
 * и файл отличаются шапкой, а не записями. Второй валидатор рядом с этим
 * разошёлся бы с ним на первой же правке формата, и тогда набор, прочитанный
 * из хранилища, отличался бы от набора, прочитанного из файла, — при одинаковом
 * содержимом. Заводить его нельзя.
 *
 * В лог этот модуль не пишет ничего: только вызывающий знает исходную длину
 * массива и может назвать число отброшенных записей вслух (цель Ц4 — правка
 * не исчезает молча).
 */

const KNOWN_TYPES = new Set<string>(['text-override', 'style-wish', 'comment'])

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/** Якорь целиком: без него запись нечем положить на страницу. */
function readAnchor(value: unknown): Anchor | null {
  if (!isObject(value)) return null
  const { selector, xpath, snippet, index } = value
  if (!isString(selector) || !isString(xpath) || !isString(snippet)) return null
  if (typeof index !== 'number' || !Number.isFinite(index)) return null
  return { selector, xpath, snippet, index }
}

/** Доли bounding box: числа и ничего больше. */
function readNumbers<K extends string>(value: unknown, keys: readonly K[]): Record<K, number> | null {
  if (!isObject(value)) return null
  const result = {} as Record<K, number>
  for (const key of keys) {
    const raw = value[key]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
    result[key] = raw
  }
  return result
}

/**
 * Приводит одну сырую запись к `Entry` — либо отбрасывает её.
 *
 * Проверяется только то, без чего запись бесполезна: `id`, известный `type`,
 * `route`, `was`, `now`, `at` и полный `anchor`. Поля для ИИ-агента (`path`,
 * `nearestHeading`, `contextBefore`, `contextAfter`, `occurrencesOnPage`)
 * дозаполняются нейтральными значениями: их отсутствие означает запись, снятую
 * до вехи «Машиночитаемость», а не порчу данных. Это ЕДИНСТВЕННЫЙ оставшийся
 * вызывающий `agentFieldsPlaceholder` — новые записи получают измеренные поля
 * от `entities/agent-context` (решение 13 плана вехи).
 *
 * Существующие записи задним числом НЕ дополняются измеренными полями
 * (решение 15). Соблазн пройтись по хранилищу и досчитать контекст у старых
 * записей отвергнут: страница с тех пор могла измениться, и посчитанный сегодня
 * контекст описывал бы не то состояние, в котором правку делали. Пустое поле
 * честнее выдуманного значения — ровно по той же логике, по которой выбран ноль.
 *
 * Терять весь набор из-за одной кривой записи нельзя — цена потери работы
 * рецензента здесь выше цены одной пропавшей строки.
 */
export function readEntry(value: unknown): Entry | null {
  if (!isObject(value)) return null

  const { id, type, route, was, now, at } = value
  if (!isString(id) || !isString(route) || !isString(was) || !isString(now) || !isString(at)) {
    return null
  }
  if (!isString(type) || !KNOWN_TYPES.has(type)) return null

  const anchor = readAnchor(value.anchor)
  if (!anchor) return null

  const rect = value.rect === undefined ? null : readNumbers(value.rect, ['x', 'y', 'w', 'h'])
  const point = value.point === undefined ? null : readNumbers(value.point, ['x', 'y'])

  // Инвариант из format.ts: у записи заполнено не больше одной геометрии.
  // Пришли обе — чинить угадыванием нельзя, потому что неизвестно, какая
  // из них настоящая, а какая осталась от потерянной второй записи.
  if (rect && point) return null

  const viewport = readNumbers(value.viewport, ['w', 'h']) ?? { w: 0, h: 0 }
  const agent = agentFieldsPlaceholder()

  return {
    id,
    type: type as EntryType,
    route,
    tag: isString(value.tag) ? value.tag : '',
    was,
    wasHtml: isString(value.wasHtml) ? value.wasHtml : '',
    now,
    // `style` при отсутствии — пустой объект: контракт требует поле, а не
    // содержимое, и пожелание оформления не обязано быть у каждой записи.
    style: isObject(value.style) ? (value.style as Style) : {},
    path: isString(value.path) ? value.path : agent.path,
    nearestHeading: isString(value.nearestHeading) ? value.nearestHeading : agent.nearestHeading,
    contextBefore: isString(value.contextBefore) ? value.contextBefore : agent.contextBefore,
    contextAfter: isString(value.contextAfter) ? value.contextAfter : agent.contextAfter,
    occurrencesOnPage:
      typeof value.occurrencesOnPage === 'number' && Number.isFinite(value.occurrencesOnPage)
        ? value.occurrencesOnPage
        : agent.occurrencesOnPage,
    anchor,
    viewport,
    ...(rect ? { rect } : {}),
    ...(point ? { point } : {}),
    at,
  }
}
