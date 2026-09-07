import type { JSX, RefObject } from 'preact'
import { useEffect } from 'preact/hooks'
import { sanitizeHtml } from 'entities/entry'
import type { Style } from 'shared/model/format'
import { createLogger } from 'shared/lib/log'
import { safely } from 'shared/lib/safe'

const log = createLogger('text-editor:area')

export interface EditorAreaProps {
  /**
   * Ссылка на редактируемую область. Держит её окно редактора: разметку
   * при сохранении читает именно оно, из `innerHTML` этого элемента.
   */
  areaRef: RefObject<HTMLDivElement>
  /** Исходная разметка правки. Кладётся в область один раз на открытие. */
  html: string
  /**
   * Что считать новым открытием. Обычно `id` записи: смена значения — это
   * другая правка, и область пересоздаётся с её содержимым.
   */
  openedFor: string
  /** Предпросмотр оформления. На страницу не уходит (решение 13). */
  style: Style
  /**
   * Гарнитура правимого элемента — та, какой текст встанет на странице.
   *
   * Набирать правку шрифтом инструмента, когда на странице стоит другой, —
   * значит показывать не то, что получится. И наоборот: контраст «шрифт вашей
   * страницы против шрифта инструмента» сам сообщает человеку, где он сейчас
   * находится, без единой подписи.
   *
   * Снимается вызывающим через `getComputedStyle` с того самого элемента,
   * по которому кликнули. `undefined` — элемента нет: тогда область остаётся
   * со шрифтом интерфейса, и это честнее выдуманного значения.
   */
  fontFamily?: string
  /**
   * Правка идёт ПРОСТЫМ ТЕКСТОМ: у границы правки (кнопка, ссылка, подпись
   * поля, заголовок раскрывающегося блока) форматирования нет — там правится
   * строка, а значок внутри правкой не затрагивается вовсе.
   *
   * Признак приходит пропом из `features/edit-text`: он считается по элементу
   * страницы, а слой `widgets` чужой DOM не трогает вовсе (ARCHITECTURE.md).
   */
  plainOnly?: boolean
}

/**
 * Редактируемая область окна правки (FR-06).
 *
 * Элемент страницы редактируемым НЕ делается: правка идёт в собственном окне
 * внутри Shadow DOM, а страница носителя всё это время остаётся нетронутой.
 *
 * Разметка кладётся через `ref` при открытии, а не через `dangerouslySetInnerHTML`
 * на каждом рендере: Preact затирал бы каретку при любой перерисовке — например,
 * при выборе размера в соседней панели, — и рецензент терял бы место набора.
 *
 * Содержимое проходит тот же белый список, что и наложение на страницу
 * (решение 12): и `wasHtml`, и `now` приезжают из чужого DOM либо из файла
 * обмена, и разрешать в окне то, чего не разрешает страница, нельзя.
 */
export function EditorArea({
  areaRef,
  html,
  openedFor,
  style,
  fontFamily,
  plainOnly,
}: EditorAreaProps): JSX.Element {
  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    // На текстовом пути содержимое кладётся ТЕКСТОВЫМ УЗЛОМ, а не разбором:
    // иначе набранное рецензентом `<b>` как часть текста разбор бы съел,
    // а сериализованный значок кнопки, наоборот, показал бы разметкой.
    if (plainOnly) area.replaceChildren(area.ownerDocument.createTextNode(html))
    else area.replaceChildren(sanitizeHtml(html, area.ownerDocument))
    // Каретка ставится в область сразу: рецензент открыл окно, чтобы править,
    // и лишний клик по области ему не нужен.
    area.focus()
    // Зависимость — только `openedFor`, и `html` в список намеренно не входит:
    // перечитывать разметку на каждом рендере значило бы затирать уже
    // набранный рецензентом текст.
  }, [openedFor])

  /*
   * Очистка вставки (FR-12).
   *
   * Текст, скопированный из Word или с другой страницы, приносит с собой чужие
   * шрифты, цвета и разметку. Штатная вставка положила бы всё это в правку,
   * а оттуда — в файл обмена, где агент принял бы её за содержание.
   */
  const onPaste = safely(log, 'вставка из буфера', (event: ClipboardEvent) => {
    event.preventDefault()

    const area = areaRef.current
    const data = event.clipboardData
    if (!area || !data) return

    const doc = area.ownerDocument
    const html = data.getData('text/html')

    // На текстовом пути вставка ВСЕГДА идёт простым текстом: разметке в правке
    // кнопки взяться неоткуда, и ветка `insertHTML` завела бы её с чёрного хода.
    if (html && !plainOnly) {
      const holder = doc.createElement('div')
      holder.appendChild(sanitizeHtml(html, doc))
      // `insertHTML` работает по текущему выделению внутри сфокусированной
      // области и сам заменяет выделенное — ровно то, чего ждут от вставки.
      doc.execCommand('insertHTML', false, holder.innerHTML)
      log.debug('вставка очищена', { источник: 'html', знаков: (holder.textContent ?? '').length })
      return
    }

    const plain = data.getData('text/plain')
    // Простой текст идёт через `insertText`, а не через `insertHTML`: иначе
    // угловые скобки в тексте превратились бы в разметку.
    doc.execCommand('insertText', false, plain)
    log.debug('вставка очищена', { источник: 'plain', знаков: plain.length })
  })

  return (
    <div
      ref={areaRef}
      class="kalka-editor__area"
      /*
       * `plaintext-only` — ПЕРВЫЙ рубеж против форматирования с клавиатуры.
       *
       * Область — обычный `contentEditable`, и браузер применяет `Cmd/Ctrl+B`
       * и `Cmd/Ctrl+I` сам, независимо от того, показана панель форматирования
       * или нет: скрытие панели от этого не защищает.
       *
       * Вторым рубежом стоит взятие `textContent` при сохранении
       * (`TextEditor.tsx`): атрибут поддержан не везде одинаково,
       * а `textContent` разметку снимает всегда.
       */
      contentEditable={plainOnly ? 'plaintext-only' : true}
      role="textbox"
      aria-multiline="true"
      aria-label="Текст правки"
      // Оформление применяется только к самой области и никуда больше:
      // на странице носителя размер и цвет не меняются (решение 13).
      style={{ fontFamily, fontSize: style.fontSize, color: style.color }}
      onPaste={onPaste}
    />
  )
}
