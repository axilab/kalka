import type { JSX } from 'preact'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useDrawArea } from 'features/draw-area'
import { usePlacePoint } from 'features/place-point'
import { resolveAnchor } from 'entities/anchor'
import { cutoutBuffer } from 'entities/cutout'
import { entryStore, numbering } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import type { Tool } from 'shared/model/ui'
import { APPLIED_ATTRIBUTE } from 'shared/config/constants'
import { logPlacement, placeCallout } from 'shared/lib/callout'
import { restorePoint, restoreRect, watchLayout } from 'shared/lib/geometry'
import { createLogger } from 'shared/lib/log'
import { CommentEditor } from './CommentEditor'
import { Marker } from './Marker'

const log = createLogger('mark-layer')

/*
 * Слой меток: рамки областей и точки поверх чужой вёрстки (FR-15).
 *
 * Все узлы слоя живут ВНУТРИ Shadow DOM «Кальки»: в чужой DOM не добавляется
 * ни одного элемента (решение 8 плана вехи). Обещание «страница после демонтажа
 * неотличима от исходной» на метках не делает исключений, а вставка рамок
 * в носителя будила бы наблюдатель мутаций на каждой своей вставке.
 *
 * `position: fixed` слоя работает от вьюпорта, несмотря на то что host-элемент
 * сам закреплён в правом нижнем углу: контейнер для фиксированных потомков
 * создают только `transform`, `filter` и `will-change`, а их у host нет
 * (предупреждение об этом стоит в `app/lib/mount.ts`).
 *
 * Чужой DOM слой ЧИТАЕТ, но не меняет: `resolveAnchor` ищет элемент,
 * `getBoundingClientRect` через `shared/lib/geometry` измеряет его. Запрет
 * из ARCHITECTURE.md касается изменения чужого DOM из компонентов; измерять
 * место, над которым рисуешь, иначе нельзя.
 */

/** Запись вместе с элементом, над которым сейчас рисуется её метка. */
interface Mark {
  entry: Entry
  element: Element
  /** Место найдено предположительно: вид метки отличается (решение 14). */
  drifted: boolean
  /**
   * Сквозной номер записи — тот же, что в строке списка разбора.
   *
   * `undefined` у ЧЕРНОВИКА: его в хранилище ещё нет, и номер появился бы
   * пустым местом ровно тогда, когда человек смотрит на только что
   * поставленную метку (см. `entities/entry`, `numbering`).
   */
  number?: number
}

/** Форма метки. */
type MarkKind = 'area' | 'point' | 'text'

/**
 * Вид метки выбирается по ТИПУ ЗАПИСИ, а не по наличию геометрии.
 *
 * Прежнее `mark.entry.rect ? 'area' : 'point'` выводило форму из того, каким
 * полем заполнена запись. Пока меток не было ни у чего, кроме замечаний, это
 * совпадало. Теперь метку получают и правки текста, у которых по инварианту
 * формата не заполнено ни `rect`, ни `point`, — и по старому правилу правка
 * текста молча получила бы форму указателя, то есть выноску на поле вместо
 * подчёркивания.
 */
function kindOf(entry: Entry): MarkKind {
  if (entry.type !== 'comment') return 'text'
  return entry.rect ? 'area' : 'point'
}

/**
 * Элемент, над которым рисуется метка записи.
 *
 * ⚠ У ПРАВОК ТЕКСТА поиск начинается с метки движка, и это не оптимизация.
 *
 * `resolveAnchor` ищет место в том числе по тексту `was` — исходному тексту
 * элемента. Для замечания это работает всегда: замечание страницу не меняет.
 * А правка текста меняет: движок наложения уже заменил содержимое элемента
 * на `now`, и `was` на странице больше нет. Поиск по нему честно отвечает
 * «места нет», запись попадает в счётчик потерянных, и подчёркивание
 * не строится НИ ОДНО. Проверено в браузере: `нарисовано: 0, потеряно: 1`
 * ровно на той правке, которую видно на экране.
 *
 * Поэтому порядок тот же, что у движка (`app/lib/overlay/engine`, `findApplied`):
 * сперва собственная метка наложения, и только потом якорь. Пожелание
 * оформления на страницу не накладывается, метки не получает и идёт вторым
 * путём — его `was` на месте.
 */
function elementFor(entry: Entry): { element: Element; exact: boolean } | null {
  if (entry.type !== 'comment') {
    const applied = document.querySelector(`[${APPLIED_ATTRIBUTE}="${CSS.escape(entry.id)}"]`)
    // Метку ставит движок ПОСЛЕ успешного разрешения якоря, поэтому найденный
    // так элемент — точное попадание, а не предположение.
    if (applied) return { element: applied, exact: true }
  }

  const resolved = resolveAnchor(entry.anchor, entry.was, document)
  return 'status' in resolved ? null : { element: resolved.element, exact: resolved.exact }
}

/**
 * Прямоугольник метки во вьюпортных координатах.
 *
 * Общий для меток и для окна замечания — оба обязаны мерить якорь ОДИНАКОВО
 * и в одном кадре, иначе окно встанет по одной геометрии, а метка по другой.
 *
 * Три ветки, ровно по трём формам:
 * — область: доли прямоугольника от bounding box якоря;
 * — указатель: доли точки;
 * — правка текста: ВЕСЬ якорь целиком.
 *
 * Третья ветка обязательна и названа явно. У `text-override` и `style-wish`
 * не заполнено ни `rect`, ни `point` — это инвариант формата, а не пропуск, —
 * и без неё цепочка возвращала бы `null`, метка получала бы `display: none`
 * и попадала в счётчик скрытых: подчёркивание строилось бы и тут же исчезало,
 * а в логе вставало бы «метки скрыты вместе с якорем», уводя отладку не туда.
 * Пересчитывать доли здесь не из чего и не нужно: правка занимает элемент
 * целиком.
 *
 * `null` у скрытого якоря (`display: none`, свёрнутый аккордеон): `restore*`
 * честно возвращает `null` при нулевом bounding box. Метки при этом нет,
 * но запись цела и потерянной не считается — якорь-то нашёлся (решение 14).
 */
function boxOf(mark: Mark): DOMRect | null {
  if (!mark.element.isConnected) return null
  if (mark.entry.rect) return restoreRect(mark.entry.rect, mark.element)
  if (mark.entry.point) return restorePoint(mark.entry.point, mark.element)

  const box = mark.element.getBoundingClientRect()
  return box.width === 0 && box.height === 0 ? null : box
}

/** Перерисовка при любом изменении хранилища, включая смену маршрута. */
function useStoreVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => entryStore.subscribe(() => setVersion((value) => value + 1)), [])
  return version
}

export interface MarkLayerProps {
  /**
   * Выбранный инструмент, либо `null` — рисовать нечем.
   *
   * Слой `widgets` выше `features`, поэтому подключение к `useDrawArea`
   * и `usePlacePoint` здесь легально. Движок наложения отсюда НЕ вызывается
   * и вызван быть не может (`app` выше `widgets`): он подписан на то же
   * хранилище и переприменит слой сам.
   */
  tool: Tool | null
  /**
   * Измеритель полосы у правого края, занятой интерфейсом. Приходит сверху,
   * из `app/ui/Root`: рейка и ящик живут там — см. `TextEditorProps`.
   * Без него окно замечания у правого края уезжало бы под рейку.
   */
  reservedRight?: () => number
}

export function MarkLayer({ tool, reservedRight }: MarkLayerProps): JSX.Element {
  const version = useStoreVersion()
  const area = useDrawArea(tool === 'area')
  const point = usePlacePoint(tool === 'point')

  /** Сохранённая запись, по метке которой кликнули (FR-15). */
  const [picked, setPicked] = useState<Entry | null>(null)

  // Черновик приходит от того инструмента, который сейчас выбран: одновременно
  // активным может быть только один, поэтому выбирать между ними не приходится.
  const draft = area.draft ?? point.draft
  const editing = picked ?? draft
  const existing = picked !== null

  // Новый черновик закрывает окно ранее открытой записи: два окна замечания
  // одновременно — состояние, в котором непонятно, что сохранит «Сохранить».
  useEffect(() => {
    if (draft) setPicked(null)
  }, [draft?.id])

  useEffect(() => {
    if (editing) log.debug('окно замечания открыто', { id: editing.id, сохранена: existing })
  }, [editing?.id])
  const nodes = useRef(new Map<string, HTMLElement>())
  const commentNode = useRef<HTMLElement | null>(null)
  /** Прежняя сторона выноски окна замечания. Только чтобы не логировать каждый кадр. */
  const commentSide = useRef<'below' | 'above' | null>(null)
  const frame = useRef<number | null>(null)
  /** Сколько меток скрыто вместе с якорем. Только чтобы не логировать каждый кадр. */
  const hiddenBefore = useRef(-1)

  /*
   * Элементы разрешает сам слой, а не берёт готовые из хранилища.
   *
   * Сложить найденный `Element` в хранилище нельзя: оно переживает перерисовки
   * носителя, а узел после перерисовки — оторванный от документа мусор, который
   * никто не соберёт (`shared/model/layer.ts` прямо оговаривает, что `Element`
   * в сериализуемую часть не входит). Поэтому находки живут ровно до ближайшего
   * уведомления хранилища — то есть до смены записей, статусов или маршрута.
   *
   * Двойное разрешение записей-комментариев — движком ради статуса и слоем ради
   * элемента — осознанная плата: комментариев на странице единицы, а утечка
   * узлов навсегда (решение 13 плана вехи).
   */
  const marks = useMemo<Mark[]>(() => {
    // «Показать оригинал» означает страницу без следов «Кальки». Рамки и точки —
    // такой же след, как заменённый текст, и оставить их значило бы сломать
    // единственный способ увидеть страницу как есть (FR-21, решение 15).
    if (entryStore.showOriginal()) {
      log.debug('метки не рисуются', { причина: 'оригинал' })
      return []
    }

    const route = entryStore.route()
    /*
     * Тумблер FR-22 управляет видимостью ТЕКСТОВЫХ меток и только их.
     *
     * Замечания видны всегда (FR-15): это не изменения страницы, а записки
     * на полях. «Показать, где изменения» относится ровно к тому, что на
     * странице изменилось, — к правкам текста и пожеланиям оформления.
     *
     * Прежнее правило `[data-kalka-applied]` в чужом `<head>` снято вместе
     * с переездом: обоснование — в шапке `app/lib/overlay/engine`.
     */
    const showText = entryStore.highlightApplied()
    // Карта строится ОДИН раз на пересборку набора, а не на каждую метку:
    // порядок берётся из хранилища и внутри одного прохода не меняется.
    const numbers = numbering()

    const found: Mark[] = []
    let lost = 0

    // Черновик рисуется наравне с сохранёнными записями: метка обязана появиться
    // сразу вместе с окном замечания, иначе рецензент вводит комментарий,
    // не видя, к чему именно (FR-14). В хранилище черновика ещё нет — он
    // придёт туда только по кнопке «Сохранить».
    const all = draft ? [...entryStore.list(), draft] : entryStore.list()

    for (const entry of all) {
      if (entry.route !== route) continue

      /*
       * Явный набор из трёх веток вместо одного отсекающего фильтра.
       *
       * Раньше здесь стояло `if (entry.type !== 'comment') continue`, и метку
       * получали только замечания. Из-за этого у правок текста не было ни метки,
       * ни — следом — номера, и обещание вехи «по номеру разработчик находит
       * запись и обратно» выполнялось бы для меньшинства записей.
       *
       * `style-wish` включается ЯВНО, а не как случайное следствие снятого
       * фильтра: связь метка↔запись требуется у всех типов.
       */
      if (entry.type !== 'comment' && !showText) continue

      const resolved = elementFor(entry)
      if (!resolved) {
        // Места на странице не нашлось — рисовать не по чему, и придуманная
        // позиция была бы враньём. Запись при этом остаётся в хранилище
        // и видна в списке правок (решение 14).
        lost += 1
        continue
      }

      const status = entryStore.statusOf(entry.id)?.status
      found.push({
        entry,
        element: resolved.element,
        // Статус от движка, если он уже посчитан; иначе — по самой находке.
        // Слой не ждёт первого прохода движка, чтобы нарисовать метку.
        drifted: status === undefined ? !resolved.exact : status === 'drifted',
        number: numbers.get(entry.id),
      })
    }

    /*
     * Форма метки называется ЗДЕСЬ, при построении набора, а не в `layout()`.
     *
     * `layout()` вызывается из `requestAnimationFrame` на каждом кадре
     * прокрутки: лог оттуда залил бы консоль в дев-режиме и испортил бы
     * плавность чужой страницы. В проекте это уже установленное правило —
     * у обхода текстовых узлов логов нет ровно по той же причине.
     */
    const count = (kind: MarkKind): number =>
      found.filter((mark) => kindOf(mark.entry) === kind).length

    log.debug('набор меток пересобран', {
      нарисовано: found.length,
      потеряно: lost,
      уголки: count('area'),
      выноски: count('point'),
      подчёркивания: count('text'),
    })
    return found
  }, [version, draft])

  /**
   * Позиции пишутся ИМПЕРАТИВНО, прямо в `style` узла.
   *
   * Прокрутка чужой страницы даёт до шестидесяти пересчётов в секунду, и
   * проводить каждый через состояние Preact значило бы перерисовывать всё
   * дерево меток на каждый кадр — на чужой странице, чью плавность виджет
   * портить не имеет права (решение 10 плана вехи).
   */
  const layout = useCallback((): void => {
    let hidden = 0

    for (const mark of marks) {
      const node = nodes.current.get(mark.entry.id)
      if (!node) continue

      const box = boxOf(mark)

      if (!box) {
        hidden += 1
        node.style.display = 'none'
        continue
      }

      node.style.display = ''
      node.style.left = `${box.left}px`
      node.style.top = `${box.top}px`
      // У выноски размер задают стили: геометрия знает только её место.
      // У области и у подчёркивания размер — часть места: подчёркивание идёт
      // во всю ширину правимого элемента, а не под фиксированный отрезок.
      if (!mark.entry.point) {
        node.style.width = `${box.width}px`
        node.style.height = `${box.height}px`
      }
    }

    /*
     * Окно замечания встаёт выноской У СВОЕЙ МЕТКИ — в том же кадре и тем же
     * измерением, что и метки.
     *
     * Прямоугольник берётся не из дерева: позиции меток пишутся императивно
     * в `node.style`, минуя состояние Preact, и спросить их у разметки не у кого.
     * Якорный элемент приходит из того же набора `marks` — черновик там тоже
     * есть, — и мерится тем же `restoreRect`/`restorePoint`.
     *
     * Скрытый якорь (свёрнутый аккордеон, `display: none`) даёт `null`,
     * и окно ОСТАЁТСЯ НА ПРЕЖНЕМ МЕСТЕ, а не исчезает вслед за меткой: человек
     * уже набирает в нём текст, и уводить окно из-под курсора нельзя.
     */
    const comment = commentNode.current
    const anchor = editing ? marks.find((mark) => mark.entry.id === editing.id) : undefined
    const box = anchor ? boxOf(anchor) : null

    if (comment && box) {
      const placement = placeCallout({
        anchor: box,
        size: { width: comment.offsetWidth, height: comment.offsetHeight },
        reservedRight: reservedRight?.() ?? 0,
      })
      comment.style.left = `${placement.left}px`
      comment.style.top = `${placement.top}px`
      comment.style.maxHeight = `${placement.maxHeight}px`
      comment.style.maxWidth = `${placement.maxWidth}px`
      commentSide.current = logPlacement(
        'окно замечания поставлено',
        placement,
        commentSide.current,
      )
    }

    // Лог только на фактическом изменении: скрытие блока — событие, кадр
    // прокрутки — нет.
    if (hidden !== hiddenBefore.current) {
      hiddenBefore.current = hidden
      log.debug('метки скрыты вместе с якорем', { скрыто: hidden })
    }
  }, [marks, editing, reservedRight])

  const schedule = useCallback((): void => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      layout()
    })
  }, [layout])

  // Разметка меток создаётся заново только при изменении набора записей —
  // и сразу же получает позиции, до первой отрисовки на экране.
  useLayoutEffect(layout, [layout])

  useEffect(() => {
    const stop = watchLayout(schedule)
    return (): void => {
      stop()
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current)
        frame.current = null
      }
    }
  }, [schedule])

  const attach = useCallback(
    (id: string) =>
      (node: HTMLElement | null): void => {
        if (node) nodes.current.set(id, node)
        else nodes.current.delete(id)
      },
    [],
  )

  /** Закрывает окно замечания, ничего не записывая. */
  function close(): void {
    if (editing) log.debug('окно замечания закрыто', { id: editing.id })
    setPicked(null)
    area.cancel()
    point.cancel()
  }

  function save(comment: string): void {
    if (!editing) return

    // Пустое замечание — это отмена, а не запись: метка без текста никому
    // ничего не сообщает, а в файле обмена занимает место наравне с полезной.
    const text = comment.trim()
    if (!text) {
      close()
      return
    }

    const entry = { ...editing, now: text }
    entryStore.upsert(entry)
    // Текст замечания в лог не попадает, только его длина (решение 18).
    log.info('замечание сохранено', {
      id: entry.id,
      тип: entry.type,
      геометрия: entry.rect ? 'область' : 'точка',
      длинаЗамечания: text.length,
    })

    // Переприменение слоя после сохранения делает движок сам по подписке
    // на хранилище: прямого вызова движка отсюда нет и быть не может.
    close()
  }

  function remove(): void {
    if (!editing) return
    entryStore.remove(editing.id)
    // Снимок места уходит вместе с записью (FR-16): вырезка без записи
    // бессмысленна и только занимает место в буфере, вытесняя нужные.
    cutoutBuffer.drop(editing.id)
    log.info('замечание удалено', { id: editing.id })
    close()
  }

  const preview = area.preview

  return (
    <div class="kalka-marks">
      {/*
        Нажимаются ТОЛЬКО метки замечаний (FR-15). Текстовым `onClick`
        не передаётся вовсе, и `Marker` рисует им неинтерактивный узел.

        Это не про удобство, а про сохранность правки. Метка вызывала бы
        `setPicked`, `setPicked` открывает окно замечания, поле окна привязано
        к `entry.now`, а его «Сохранить» пишет `{ ...editing, now: text }` —
        не меняя типа записи. Заказчик, нажав на собственное подчёркивание,
        получил бы подмену набранной разметки голым текстом из окна замечания
        либо превращение пожелания оформления в другой тип; кнопка «Удалить»
        рядом снесла бы правку целиком.
      */}
      {marks.map((mark) => {
        const kind = kindOf(mark.entry)
        return (
          <Marker
            key={mark.entry.id}
            kind={kind}
            drifted={mark.drifted}
            number={mark.number}
            title={titleOf(mark)}
            attach={attach(mark.entry.id)}
            onClick={kind === 'text' ? undefined : () => setPicked(mark.entry)}
          />
        )
      })}

      {/* Притенение страницы на время рисования: стоит МЕЖДУ сохранёнными
          метками и ведомой рамкой, поэтому притеняет и страницу, и старые
          метки, а рамку — нет. Живёт ровно столько, сколько человек ведёт
          мышью. */}
      {preview && <div class="kalka-shade" aria-hidden="true" />}

      {/* Предпросмотр рисуемой рамки: та же разметка, но без обработчика клика.
          Его позиция приходит из хука и меняется на каждое движение указателя,
          поэтому пишется обычным `style`, а не по ссылке на узел. */}
      {preview && (
        <Marker
          kind="area"
          preview
          style={{
            left: `${preview.left}px`,
            top: `${preview.top}px`,
            width: `${preview.width}px`,
            height: `${preview.height}px`,
          }}
        />
      )}

      {editing && (
        <CommentEditor
          entry={editing}
          existing={existing}
          attach={(node) => {
            commentNode.current = node
          }}
          onSave={save}
          onRemove={remove}
          onCancel={close}
        />
      )}
    </div>
  )
}

/**
 * Подпись метки для рецензента (FR-36).
 *
 * Ни «якоря», ни «селектора», ни имени тега: «уехала» объясняется словами,
 * потому что метка предположительная и метка точная — это разное доверие
 * к месту, и рецензент обязан видеть разницу.
 *
 * Выбор идёт по ТИПУ записи, а не по наличию `rect`. Прежнее правило знало
 * только два слова — «Замечание к области» и «Замечание к месту», — и обе
 * текстовые записи получили бы чужое: правка текста не замечание, а пожелание
 * оформления — тем более.
 */
function titleOf(mark: Mark): string {
  const what =
    mark.entry.type === 'text-override'
      ? 'Правка текста'
      : mark.entry.type === 'style-wish'
        ? 'Пожелание по оформлению'
        : mark.entry.rect
          ? 'Замечание к области'
          : 'Замечание к месту'

  // Номер входит и в доступное имя: без него человек с программой чтения
  // с экрана слышит «Правка текста» на каждой метке и связать её со строкой
  // списка не может ничем.
  const named = mark.number === undefined ? what : `${what} № ${mark.number}`
  return mark.drifted ? `${named} — место найдено приблизительно` : named
}
