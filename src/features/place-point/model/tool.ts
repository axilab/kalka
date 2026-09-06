import { useCallback, useEffect, useState } from 'preact/hooks'
import { captureAgentContext } from 'entities/agent-context'
import { captureAnchor } from 'entities/anchor'
import { captureCutout } from 'entities/cutout'
import { createCommentEntry } from 'entities/entry'
import type { Entry } from 'shared/model/format'
import { elementAtPoint, watchPointPicking } from 'shared/lib/dom'
import { capturePoint } from 'shared/lib/geometry'
import { createLogger } from 'shared/lib/log'
import { normalize } from 'shared/lib/normalize'
import { currentRoute } from 'shared/lib/route'

const log = createLogger('place-point')

export interface PlacePointTool {
  /**
   * Собранный, но ЕЩЁ НЕ СОХРАНЁННЫЙ черновик замечания. См. `DrawAreaTool`:
   * запись без комментария — мусор в файле обмена, и сохранение делает окно
   * комментария, а не инструмент.
   */
  draft: Entry | null
  /** Закрыть черновик, ничего не записывая. */
  cancel: () => void
}

/**
 * Инструмент «Указатель» (FR-14).
 *
 * Устроен так же, как «Область», но проще: предпросмотра у точки нет — метка
 * появляется сразу вместе с окном комментария, вести мышью нечего.
 *
 * Якорь — элемент ПОД КУРСОРОМ, без подъёма по дереву: рецензент ткнул именно
 * в него, и подниматься к контейнеру означало бы решать за него (решение 11
 * плана вехи). Это отличие от «Области» намеренное: рамку обводят вокруг блока,
 * точку ставят в конкретное место.
 *
 * Слайс `features/draw-area` отсюда НЕ импортируется: соседний слайс того же
 * слоя. Общего кода у них нет по построению — доли считает
 * `shared/lib/geometry`, запись собирает `entities/entry` (решение 1 плана вехи).
 */
export function usePlacePoint(active: boolean): PlacePointTool {
  const [draft, setDraft] = useState<Entry | null>(null)

  useEffect(() => {
    if (!active) {
      setDraft(null)
      return
    }

    return watchPointPicking((x, y) => {
      const el = elementAtPoint(x, y)
      if (!el) {
        log.debug('под указателем нет элемента носителя, черновик не создан')
        return
      }

      const point = capturePoint(el, x, y)
      // Сперва якорь, затем контекст. Оба читают страницу ДО записи в хранилище
      // и до наложения — иначе контекст описывал бы страницу, уже изменённую
      // этой же правкой.
      const anchor = captureAnchor(el)
      const agent = captureAgentContext(el)
      const entry = createCommentEntry({
        point,
        anchor,
        agent,
        tag: el.tagName.toLowerCase(),
        was: normalize(el.textContent ?? ''),
        comment: '',
        viewport: { w: window.innerWidth, h: window.innerHeight },
        route: currentRoute(),
      })

      log.debug('черновик указателя создан', {
        id: entry.id,
        тег: entry.tag,
        доляX: point.x,
        доляY: point.y,
      })

      // Снимок места для печатного отчёта. Кадр ШИРОКИЙ, с окрестностью:
      // указатель без окрестности показывает точку в пустоте.
      captureCutout({ entryId: entry.id, anchor: el, wide: true })

      setDraft(entry)
    })
  }, [active])

  const cancel = useCallback((): void => {
    setDraft(null)
  }, [])

  return { draft, cancel }
}
