import type { ComponentChildren, JSX, RefObject } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { createLogger } from 'shared/lib/log'
import { safely } from 'shared/lib/safe'
import { Button } from 'shared/ui/Button'
import {
  IconBold,
  IconClearFormat,
  IconItalic,
  IconLink,
  IconList,
} from 'shared/ui/icons'

const log = createLogger('text-editor:format')

/*
 * Форматирование выполняется `document.execCommand` (решение 9).
 *
 * Команда объявлена устаревшей, и это известно. Альтернатива — своя работа
 * с `Selection` и `Range`: несколько сотен строк разбора границ выделения ради
 * того же результата, а библиотека богатого редактора не помещается в бюджет
 * 100 КБ gzip (NFR-01), при конфликте с которым побеждает бюджет.
 * `execCommand` реализована во всех целевых браузерах (NFR-05) и работает
 * по сфокусированному редактируемому элементу.
 *
 * Известная зона риска — граница Shadow DOM: выделение внутри теневого корня
 * браузеры отдают по-разному. Поэтому выделение берётся сперва у теневого корня
 * и только потом у документа, а проверка в Chrome, Safari и Firefox вынесена
 * отдельным пунктом в «Проверку вехи».
 */

/** Минимум, который нужен от теневого корня: его собственное выделение. */
interface SelectionRoot {
  getSelection?: () => Selection | null
}

/**
 * Выделение внутри редактируемой области.
 *
 * Chrome отдаёт выделение теневого корня через `shadowRoot.getSelection()`,
 * остальные браузеры — через `document.getSelection()` с узлами внутри тени.
 * Порядок именно такой: у своего корня спрашиваем первым.
 */
function activeSelection(area: HTMLElement): Selection | null {
  const root = area.getRootNode() as SelectionRoot
  if (typeof root.getSelection === 'function') return root.getSelection()
  return area.ownerDocument.getSelection()
}

/** Список, внутри которого стоит выделение, — или `null`. */
function listAround(area: HTMLElement, selection: Selection | null): 'UL' | 'OL' | null {
  const node = selection?.anchorNode
  if (!node) return null

  let el: Element | null = node instanceof Element ? node : node.parentElement
  while (el && el !== area) {
    if (el.tagName === 'UL') return 'UL'
    if (el.tagName === 'OL') return 'OL'
    el = el.parentElement
  }
  return null
}

/** Стоит ли выделение внутри ссылки. */
function insideLink(area: HTMLElement, selection: Selection | null): boolean {
  const node = selection?.anchorNode
  if (!node) return false

  let el: Element | null = node instanceof Element ? node : node.parentElement
  while (el && el !== area) {
    if (el.tagName === 'A') return true
    el = el.parentElement
  }
  return false
}

/** Что из оформления сейчас включено под курсором. */
interface FormatState {
  bold: boolean
  italic: boolean
  list: boolean
  link: boolean
}

const NOTHING: FormatState = { bold: false, italic: false, list: false, link: false }

export interface FormatBarProps {
  areaRef: RefObject<HTMLDivElement>
  /**
   * Что встаёт В ТОМ ЖЕ РЯДУ после кнопок оформления.
   *
   * Пропом, а не импортом: размер и цвет — пожелания, они живут в своём
   * компоненте со своим состоянием и к выделению в области набора отношения
   * не имеют. Ряд при этом обязан быть ОДИН — иначе панель инструментов
   * распадается на две панели, стоящие друг под другом.
   *
   * Ставит их сюда `TextEditor`: он собирает окно и один знает, что в ряду
   * есть что-то кроме оформления текста.
   */
  after?: ComponentChildren
}

/**
 * Панель форматирования (FR-07): жирный, курсив, ссылка, список,
 * снятие форматирования. Подписи по-русски и без технических терминов (FR-36).
 */
export function FormatBar({ areaRef, after }: FormatBarProps): JSX.Element {
  const [linkOpen, setLinkOpen] = useState(false)
  const [href, setHref] = useState('')
  /**
   * Выделение, запомненное до открытия поля адреса.
   *
   * Поле ввода забирает фокус, и выделение в редактируемой области пропадает —
   * то самое, к которому ссылка и применяется. Поэтому диапазон запоминается
   * заранее и восстанавливается перед вызовом команды.
   */
  const savedRange = useRef<Range | null>(null)

  /*
   * ── Состояние нажатия у кнопок оформления ─────────────────────────────────
   *
   * Раньше его не было вовсе: пять одинаковых кнопок ничем не показывали,
   * жирный ли сейчас текст под курсором. С иконками это стало нетерпимо —
   * подписи в кнопке не осталось, и без состояния она не сообщает ничего.
   *
   * Читается `queryCommandState` у того же документа, по которому работает
   * `execCommand`. Список и ссылка — обходом вверх: `queryCommandState`
   * про них отвечает по-разному в разных браузерах, а дерево — одинаково.
   */
  const [format, setFormat] = useState<FormatState>(NOTHING)

  const readState = useCallback(
    safely(log, 'состояние оформления', () => {
      const area = areaRef.current
      if (!area) return

      const selection = activeSelection(area)
      const node = selection?.anchorNode
      const inside = node ? area.contains(node instanceof Element ? node : node.parentNode) : false

      // Выделение ушло из области — состояние гасим, а не показываем чужое:
      // `queryCommandState` ответил бы про то место, где сейчас курсор,
      // и кнопки соврали бы про текст правки.
      if (!inside) {
        setFormat(NOTHING)
        return
      }

      const doc = area.ownerDocument
      setFormat({
        bold: doc.queryCommandState('bold'),
        italic: doc.queryCommandState('italic'),
        list: listAround(area, selection) !== null,
        link: insideLink(area, selection),
      })
    }),
    [areaRef],
  )

  useEffect(() => {
    // `selectionchange` — единственное событие, которое приходит и на движение
    // каретки клавишами, и на выделение мышью, и на программную установку
    // диапазона. Слушается на документе: у теневого корня своего такого нет.
    readState()
    document.addEventListener('selectionchange', readState)
    return (): void => document.removeEventListener('selectionchange', readState)
  }, [readState])

  /** Выполняет команду по сфокусированной области. Отказ не роняет редактор. */
  function exec(command: string, value?: string): boolean {
    const area = areaRef.current
    if (!area) return false

    // Фокус обязателен: команда работает по сфокусированному редактируемому
    // элементу, а нажатие кнопки панели фокус с области уже сняло.
    area.focus()
    const done = area.ownerDocument.execCommand(command, false, value)
    // Адрес ссылки в лог не пишется: это данные рецензента (решение 16).
    log.debug('команда форматирования', { команда: command, выполнена: done })
    // `execCommand` не всегда поднимает `selectionchange`, а состояние кнопки
    // обязано смениться в тот же миг, что и текст под курсором.
    readState()
    return done
  }

  const apply = (command: string): (() => void) =>
    safely(log, `форматирование: ${command}`, () => {
      exec(command)
    })

  /**
   * «Убрать оформление» снимает и ссылку, и список (решение 10).
   *
   * `removeFormat` в браузерах не трогает ни `<a>`, ни `<ul>`: без `unlink`
   * и выключения списка кнопка обманывала бы — подпись обещает чистый текст,
   * а ссылка и список остаются.
   */
  const clearFormat = safely(log, 'форматирование: снятие', () => {
    const area = areaRef.current
    if (!area) return

    exec('removeFormat')
    exec('unlink')

    const list = listAround(area, activeSelection(area))
    if (list) exec(list === 'UL' ? 'insertUnorderedList' : 'insertOrderedList')
  })

  /** Открывает поле адреса, запомнив текущее выделение. */
  const openLink = safely(log, 'форматирование: ссылка', () => {
    const area = areaRef.current
    if (!area) return

    const selection = activeSelection(area)
    savedRange.current =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null

    setHref('')
    setLinkOpen(true)
  })

  const closeLink = (): void => {
    savedRange.current = null
    setLinkOpen(false)
    setHref('')
  }

  /*
   * Адрес вводится своим полем, а не `window.prompt` (решение 11): нативный
   * диалог выпадает из русского интерфейса (FR-36), в части контекстов
   * блокируется браузером и уводит фокус из редактируемой области.
   */
  const applyLink = safely(log, 'форматирование: адрес ссылки', () => {
    const area = areaRef.current
    const url = href.trim()

    // Пустой адрес — отмена: ссылка без адреса не ссылка.
    if (!area || !url) {
      closeLink()
      return
    }

    area.focus()
    const range = savedRange.current
    const selection = activeSelection(area)
    if (range && selection) {
      selection.removeAllRanges()
      selection.addRange(range)
    }

    exec('createLink', url)
    closeLink()
  })

  return (
    <div class="kalka-editor__format">
      {/*
        Иконный ряд вместо пяти одинаковых пилюль. Подпись каждой осталась
        доступным именем и всплывающей расшифровкой: убрать видимый текст можно,
        отобрать имя — нет.

        `pressed` — у тех четырёх, у кого состояние есть. «Убрать оформление» —
        действие, а не выключатель: у него состояния нет и `pressed` там был бы
        враньём.
      */}
      <div class="kalka-row">
        <Button
          icon={<IconBold />}
          label="Жирный"
          tip="Жирный"
          pressed={format.bold}
          onClick={apply('bold')}
        />
        <Button
          icon={<IconItalic />}
          label="Курсив"
          tip="Курсив"
          pressed={format.italic}
          onClick={apply('italic')}
        />
        <Button
          icon={<IconLink />}
          label="Ссылка"
          tip="Ссылка"
          pressed={format.link || linkOpen}
          onClick={openLink}
        />
        <Button
          icon={<IconList />}
          label="Список"
          tip="Список"
          pressed={format.list}
          onClick={apply('insertUnorderedList')}
        />
        <Button
          icon={<IconClearFormat />}
          label="Убрать оформление"
          tip="Убрать оформление"
          onClick={clearFormat}
        />
        {after}
      </div>

      {linkOpen && (
        <div class="kalka-row kalka-editor__link">
          <input
            class="kalka-input"
            type="text"
            value={href}
            placeholder="Куда ведёт ссылка"
            aria-label="Адрес ссылки"
            onInput={(event) => setHref(event.currentTarget.value)}
          />
          <Button onClick={applyLink}>Применить</Button>
          <Button onClick={closeLink}>Отмена</Button>
        </div>
      )}
    </div>
  )
}
