import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { captureAgentContext } from 'entities/agent-context'
import { captureAnchor } from 'entities/anchor'
import { captureCutout } from 'entities/cutout'
import { createCommentEntry } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import { pickRectAnchor, setPageCursor, watchAreaDrawing } from 'shared/lib/dom'
import { captureRect } from 'shared/lib/geometry'
import { createLogger } from 'shared/lib/log'
import { normalize } from 'shared/lib/normalize'
import { currentRoute } from 'shared/lib/route'

const log = createLogger('draw-area')

export interface DrawAreaTool {
  /**
   * Собранный, но ЕЩЁ НЕ СОХРАНЁННЫЙ черновик замечания.
   *
   * Наружу отдаётся именно черновик, а не запись в хранилище: комментарий пока
   * не введён, а запись типа `comment` с пустым `now` — мусор в файле обмена.
   * FR-13 требует «обвести область, затем ввести комментарий», и порядок здесь
   * буквальный: сохранение делает окно комментария (`widgets/mark-layer`).
   */
  draft: Entry | null
  /** Рамка, которую рецензент ведёт прямо сейчас. Рисует её слой меток. */
  preview: DOMRectReadOnly | null
  /** Закрыть черновик, ничего не записывая. */
  cancel: () => void
}

/**
 * Инструмент «Область» (FR-13).
 *
 * Пока `active`, на странице носителя включён режим рисования
 * (`watchAreaDrawing` из `shared/lib/dom` — одно из четырёх мест, которым
 * разрешено трогать чужой DOM). Выключение инструмента и размонтирование
 * снимают перехват полностью: страница обязана вернуться к исходному
 * поведению, включая работающие ссылки и кнопки.
 *
 * Якорь собирается здесь, а не в `entities/entry`: `captureAnchor` живёт
 * в `entities/anchor`, соседнем слайсе того же слоя, и увидеть его может
 * только слой выше — то есть `features` (решение 2 плана вехи).
 *
 * Слайс `features/place-point` отсюда НЕ импортируется и импортировать нас
 * не может: общего кода у инструментов нет по построению. Захотелось
 * скопировать кусок — значит, он обязан уехать в `shared/lib/geometry`
 * или `entities/entry`, а не задвоиться (решение 1 плана вехи).
 *
 * ── Черновик управляет ДВУМЯ вещами сразу ───────────────────────────────────
 *
 * Пока окно замечания открыто, инструмент стоит на паузе: нажатие по странице
 * по-прежнему проглатывается, но новой рамки не начинает — иначе недописанный
 * текст исчезал бы от случайного клика. Курсор в тот же момент становится
 * `default`: жеста сейчас не ждут, и крест об этом обязан сказать.
 *
 * Условие у курсора и у режима поэтому РАЗНОЕ — «инструмент выбран» против
 * «инструмент выбран и черновика нет», — и живут они в двух эффектах.
 * Склеивать их в один нельзя: перевключение курсора не должно снимать
 * и заново вешать перехват на чужой странице.
 */
export function useDrawArea(active: boolean): DrawAreaTool {
  const [draft, setDraft] = useState<Entry | null>(null)
  const [preview, setPreview] = useState<DOMRectReadOnly | null>(null)

  /*
   * Черновик для предиката паузы — ССЫЛКОЙ, а не через зависимость эффекта.
   *
   * Предикат спрашивают в момент нажатия, и ему нужно нынешнее значение;
   * положи черновик в зависимости — и каждое открытие окна пересоздавало бы
   * перехват целиком, теряя вместе с ним начатое.
   */
  const draftRef = useRef<Entry | null>(null)
  draftRef.current = draft

  useEffect(() => {
    if (!active) {
      // Черновик закрывается вместе с инструментом: висящее окно замечания при
      // выключенном инструменте — состояние, из которого нет выхода.
      setDraft(null)
      setPreview(null)
      return
    }

    return watchAreaDrawing(
      (drawn) => {
        const el = pickRectAnchor(drawn)
        if (!el) {
          log.debug('рамке не нашлось элемента-якоря, черновик не создан')
          return
        }

        const rect = captureRect(el, drawn)
        // Сперва якорь, затем контекст. Оба читают страницу ДО записи в хранилище
        // и до наложения — иначе контекст описывал бы страницу, уже изменённую
        // этой же правкой.
        const anchor = captureAnchor(el)
        const agent = captureAgentContext(el)
        const entry = createCommentEntry({
          rect,
          anchor,
          agent,
          tag: el.tagName.toLowerCase(),
          was: normalize(el.textContent ?? ''),
          // Замечания ещё нет: его вводит рецензент в окне комментария.
          comment: '',
          viewport: { w: window.innerWidth, h: window.innerHeight },
          route: currentRoute(),
        })

        log.debug('черновик области создан', {
          id: entry.id,
          тег: entry.tag,
          доляX: rect.x,
          доляY: rect.y,
          доляШирины: rect.w,
          доляВысоты: rect.h,
        })

        // Снимок места для печатного отчёта. Кадр ШИРОКИЙ, с окрестностью:
        // замечание «это убрать» на вырезке из одного элемента не опознать —
        // читателю нужно видеть, среди чего обведённое стоит.
        captureCutout({ entryId: entry.id, anchor: el, wide: true })

        setDraft(entry)
      },
      setPreview,
      // Пауза: окно замечания открыто — нажатие глотаем, рамку не начинаем.
      () => draftRef.current !== null,
    )
  }, [active])

  /*
   * Курсор режима. Условие своё, отличное от условия перехвата выше: крест
   * означает «целься», а пока рецензент печатает замечание, целиться некуда.
   *
   * Зависимость — `idle`, а не сам черновик: вид курсора меняется дважды за
   * жизнь черновика (появился, закрылся), и пересчитывать правило на каждой
   * букве замечания незачем.
   */
  const idle = draft === null
  useEffect(() => {
    if (!active) return
    return setPageCursor(idle ? 'crosshair' : 'default')
  }, [active, idle])

  const cancel = useCallback((): void => {
    setDraft(null)
    setPreview(null)
  }, [])

  return { draft, preview, cancel }
}
