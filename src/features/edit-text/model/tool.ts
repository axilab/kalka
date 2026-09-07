import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import type { Entry, Style } from 'shared/model/format'
import { usesTextPath, watchPicking } from 'shared/lib/dom'
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
   * Элемент чужой страницы, которому ПРИНАДЛЕЖИТ правка.
   *
   * Не обязательно кликнутый узел: клик по ссылке внутри уже правленого абзаца
   * открывает правку абзаца, и элементом здесь становится абзац. Иначе выноска
   * встала бы по ссылке, шрифт взялся бы у ссылки, а признак простого текста
   * посчитался бы по границе `<a>` и по `wasHtml` абзаца — из половинок разных
   * элементов.
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
  /**
   * Правка идёт ПРОСТЫМ ТЕКСТОМ: форматирование недоступно, сохраняется строка.
   *
   * Считается РОВНО ОДИН РАЗ и ровно здесь — по элементу записи и её `wasHtml`.
   * Отсюда признак уходит и в окно редактора, и в сохранение. Второго
   * вычисления по другому правилу в проекте быть не должно: два правила
   * однажды разойдутся, и разойдутся молча.
   */
  plainOnly: boolean
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
        // В `element` кладётся элемент ЗАПИСИ, а не кликнутый узел: клик мог
        // прийтись на ссылку внутри правленого абзаца, и тогда выноска, шрифт
        // и признак простого текста считались бы от разных элементов.
        log.debug('открыта уже внесённая правка', {
          id: found.entry.id,
          тип: found.entry.type,
          простойТекст: usesTextPath(found.element, found.entry.wasHtml),
        })
        setEditing({ draft: found.entry, existing: true, element: found.element })
        return
      }

      const draft = captureDraft(el)
      log.debug('открыта новая правка', {
        id: draft.id,
        простойТекст: usesTextPath(el, draft.wasHtml),
      })
      setEditing({ draft, existing: false, element: el })
    })
  }, [active])

  const close = useCallback((): void => {
    setEditing((current) => {
      if (current.draft) log.debug('окно правки закрыто', { id: current.draft.id })
      return CLOSED
    })
  }, [])

  /*
   * ЕДИНСТВЕННОЕ вычисление признака простого текста на весь проект.
   *
   * Слайс инструмента — то место, где на руках есть и элемент, и запись
   * одновременно. Окно редактора элемента не видит вовсе (`widgets` чужой DOM
   * не трогают), а `saveEdit` получает одну запись; оба получают уже
   * посчитанное значение — окно пропом, сохранение параметром.
   */
  const plainOnly = useMemo(
    () =>
      editing.element && editing.draft
        ? usesTextPath(editing.element, editing.draft.wasHtml)
        : false,
    [editing.element, editing.draft],
  )

  const save = useCallback(
    (html: string, style: Style): void => {
      if (!editing.draft) return
      saveEdit(editing.draft, html, style, plainOnly)
      close()
    },
    [editing.draft, plainOnly, close],
  )

  const remove = useCallback((): void => {
    // Удалять нечего, пока запись не сохранена: у новой правки в хранилище
    // ещё ничего нет, и кнопки «Удалить правку» для неё в окне тоже нет.
    if (!editing.draft || !editing.existing) return
    removeEdit(editing.draft.id)
    close()
  }, [editing.draft, editing.existing, close])

  return { ...editing, plainOnly, save, remove, close }
}
