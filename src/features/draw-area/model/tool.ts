import { useCallback, useEffect, useState } from 'preact/hooks'
import { captureAgentContext } from 'entities/agent-context'
import { captureAnchor } from 'entities/anchor'
import { captureCutout } from 'entities/cutout'
import { createCommentEntry } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import { pickRectAnchor, watchAreaDrawing } from 'shared/lib/dom'
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
 */
export function useDrawArea(active: boolean): DrawAreaTool {
  const [draft, setDraft] = useState<Entry | null>(null)
  const [preview, setPreview] = useState<DOMRectReadOnly | null>(null)

  useEffect(() => {
    if (!active) {
      // Черновик закрывается вместе с инструментом: висящее окно замечания при
      // выключенном инструменте — состояние, из которого нет выхода.
      setDraft(null)
      setPreview(null)
      return
    }

    return watchAreaDrawing((drawn) => {
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
    }, setPreview)
  }, [active])

  const cancel = useCallback((): void => {
    setDraft(null)
    setPreview(null)
  }, [])

  return { draft, preview, cancel }
}
