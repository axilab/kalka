import { useCallback, useEffect, useState } from 'preact/hooks'
import type { Entry, Style } from 'shared/model/format'
import { watchPicking } from 'shared/lib/dom'
import { createLogger } from 'shared/lib/log'
import { captureDraft } from './create'
import { findEntryFor } from './find'
import { removeEdit, saveEdit } from './save'

const log = createLogger('edit-text:tool')

/** Что сейчас правится. `null` в `draft` — окно редактора не открыто. */
interface Editing {
  draft: Entry | null
  /** `true` — запись уже была в хранилище, и её можно удалить (FR-11). */
  existing: boolean
  /**
   * Правимый элемент чужой страницы — тот самый, по которому кликнули.
   *
   * ── Зачем он наружу ─────────────────────────────────────────────────────
   *
   * Окно правки встаёт выноской У ПРАВИМОЙ СТРОКИ, и мерить эту строку больше
   * нечем: `captureDraft` возвращает сериализуемую запись, а элемент выбрасывает.
   * Тем же элементом берётся шрифт носителя для области набора.
   *
   * ── Почему это не утечка ────────────────────────────────────────────────
   *
   * Ссылка живёт ровно пока открыто окно и сбрасывается вместе с ним.
   * В хранилище она не попадает никогда: `Element` в сериализуемую часть
   * не входит вовсе (`shared/model/layer`), а узел после перерисовки носителя
   * стал бы оторванным от документа мусором. Перед каждым замером вызывающий
   * обязан проверять `isConnected` — ровно как это делает слой меток.
   */
  element: Element | null
}

const CLOSED: Editing = { draft: null, existing: false, element: null }

export interface TextTool extends Editing {
  /** Сохранить правку и закрыть окно. */
  save: (html: string, style: Style) => void
  /** Удалить существующую правку и закрыть окно (FR-11). */
  remove: () => void
  /** Закрыть окно, ничего не записывая. */
  close: () => void
}

/**
 * Инструмент «Текст»: режим выбора элемента плюс состояние текущей правки.
 *
 * Пока `active`, по странице ведётся подсветка и перехватывается клик
 * (`watchPicking` из `shared/lib/dom` — единственное место в `shared`, которому
 * разрешено трогать DOM носителя). Выключение инструмента и размонтирование
 * снимают перехват полностью: страница обязана вернуться к исходному виду.
 */
export function useTextTool(active: boolean): TextTool {
  const [editing, setEditing] = useState<Editing>(CLOSED)

  useEffect(() => {
    if (!active) {
      // Окно закрывается вместе с инструментом: висящее окно правки при
      // выключенном инструменте — состояние, из которого нет выхода.
      setEditing(CLOSED)
      return
    }

    return watchPicking((el) => {
      // Сперва ищем уже внесённую правку (FR-10) и только потом захватываем
      // новую: перезахват затёр бы оригинал текстом предыдущей правки.
      const found = findEntryFor(el)
      if (found) {
        log.debug('открыта уже внесённая правка', { id: found.id, тип: found.type })
        setEditing({ draft: found, existing: true, element: el })
        return
      }

      const draft = captureDraft(el)
      log.debug('открыта новая правка', { id: draft.id })
      setEditing({ draft, existing: false, element: el })
    })
  }, [active])

  const close = useCallback((): void => {
    setEditing((current) => {
      if (current.draft) log.debug('окно правки закрыто', { id: current.draft.id })
      return CLOSED
    })
  }, [])

  const save = useCallback(
    (html: string, style: Style): void => {
      if (!editing.draft) return
      saveEdit(editing.draft, html, style)
      close()
    },
    [editing.draft, close],
  )

  const remove = useCallback((): void => {
    // Удалять нечего, пока запись не сохранена: у новой правки в хранилище
    // ещё ничего нет, и кнопки «Удалить правку» для неё в окне тоже нет.
    if (!editing.draft || !editing.existing) return
    removeEdit(editing.draft.id)
    close()
  }, [editing.draft, editing.existing, close])

  return { ...editing, save, remove, close }
}
