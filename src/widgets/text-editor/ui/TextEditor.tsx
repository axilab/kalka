import type { JSX } from 'preact'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useTextTool } from 'features/edit-text'
import type { Entry, Style } from 'shared/model/format'
import { logPlacement, placeCallout } from 'shared/lib/callout'
import { watchLayout } from 'shared/lib/geometry'
import { createLogger } from 'shared/lib/log'
import { Button } from 'shared/ui/Button'
import { EditorArea } from './EditorArea'
import { FormatBar } from './FormatBar'
import { StyleBar } from './StyleBar'

const log = createLogger('text-editor')

/**
 * Как назвать место правки рецензенту (FR-36).
 *
 * Слов «селектор», «якорь» и «DOM» он не видит; имени тега — тоже. Тег, которого
 * в списке нет, называется просто текстом: соврать про «встроенную цитату»
 * хуже, чем не уточнить.
 */
const PLACES: Readonly<Record<string, string>> = {
  h1: 'заголовок страницы',
  h2: 'заголовок раздела',
  h3: 'подзаголовок',
  h4: 'подзаголовок',
  h5: 'подзаголовок',
  h6: 'подзаголовок',
  p: 'абзац',
  li: 'пункт списка',
  a: 'ссылка',
  button: 'надпись на кнопке',
  td: 'ячейка таблицы',
  th: 'заголовок столбца',
  figcaption: 'подпись',
  label: 'подпись поля',
}

function placeOf(tag: string): string {
  return PLACES[tag] ?? 'текст'
}

/**
 * Разметка, с которой открывается область правки.
 *
 * У записи типа `text-override` это внесённая правка (FR-10: повторный клик
 * открывает именно её, а не оригинал). У пожелания по оформлению `now` пуст
 * по определению, поэтому берётся исходная разметка.
 */
function initialHtml(draft: Entry): string {
  return draft.type === 'text-override' && draft.now ? draft.now : draft.wasHtml
}

export interface TextEditorProps {
  /** Выбран ли инструмент «Текст». */
  active: boolean
  /**
   * Измеритель полосы у правого края, занятой интерфейсом.
   *
   * Приходит сверху, из `app/ui/Root`: рейка и ящик живут там, и только там
   * известно, что сейчас открыто. Функция, а не число: между открытием окна
   * и кадром прокрутки ящик мог открыться или закрыться, а окно всё это время
   * висит у своей строки.
   *
   * Без него окно у правого края уезжает под рейку — то есть ровно тот дефект,
   * который выноска и чинит.
   */
  reservedRight?: () => number
}

/**
 * Окно редактора текста (FR-06…FR-09, FR-11).
 *
 * Слой `widgets` выше `features`, поэтому подключение к `useTextTool` легально.
 * Движок наложения отсюда НЕ вызывается и вызван быть не может (`app` выше
 * `widgets`): он подписан на то же хранилище и переприменит слой сам.
 */
export function TextEditor({ active, reservedRight }: TextEditorProps): JSX.Element | null {
  const { draft, existing, element, save, remove, close } = useTextTool(active)
  const areaRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const frame = useRef<number | null>(null)
  /** Прежняя сторона выноски. Только чтобы не логировать каждый кадр прокрутки. */
  const sideBefore = useRef<'below' | 'above' | null>(null)
  const [style, setStyle] = useState<Style>({})
  /** Гарнитура правимого элемента: набираемый текст показывается ею. */
  const [hostFont, setHostFont] = useState<string | undefined>(undefined)

  const openedFor = draft?.id ?? ''

  useEffect(() => {
    // Снимается один раз на открытие, а не при каждой отрисовке:
    // `getComputedStyle` заставляет браузер посчитать раскладку, а шрифт
    // правимого элемента за время правки не меняется.
    if (!draft || !element || !element.isConnected) {
      setHostFont(undefined)
      return
    }
    setHostFont(getComputedStyle(element).fontFamily)
  }, [openedFor, element])

  useEffect(() => {
    // Оформление берётся из записи при каждом открытии: повторный клик по месту
    // с пожеланием обязан показать уже выбранные размер и цвет, а не сброс.
    setStyle(draft ? { ...draft.style } : {})
    if (draft) log.debug('окно правки открыто', { id: draft.id, тип: draft.type })
    sideBefore.current = null
  }, [openedFor])

  /*
   * Позиция пишется ИМПЕРАТИВНО, прямо в `style` узла, — тем же приёмом, что
   * у слоя меток. Прокрутка чужой страницы даёт до шестидесяти пересчётов
   * в секунду, и проводить каждый через состояние Preact значило бы
   * перерисовывать окно вместе с областью набора на каждый кадр — то есть
   * ронять каретку и выделение в тот момент, когда человек печатает.
   */
  const place = useCallback((): void => {
    const node = boxRef.current
    // `isConnected` перед каждым замером: носитель мог перерисовать блок,
    // и оторванный узел дал бы нулевой прямоугольник — окно уехало бы в угол.
    if (!node || !element || !element.isConnected) return

    const placement = placeCallout({
      anchor: element.getBoundingClientRect(),
      size: { width: node.offsetWidth, height: node.offsetHeight },
      reservedRight: reservedRight?.() ?? 0,
    })

    node.style.left = `${placement.left}px`
    node.style.top = `${placement.top}px`
    node.style.maxHeight = `${placement.maxHeight}px`
    node.style.maxWidth = `${placement.maxWidth}px`

    sideBefore.current = logPlacement('окно правки поставлено', placement, sideBefore.current)
  }, [element, reservedRight])

  const schedule = useCallback((): void => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      place()
    })
  }, [place])

  // Позиция выдаётся ДО первой отрисовки на экране: иначе окно успевает мигнуть
  // в левом верхнем углу и только потом прыгнуть к своей строке.
  useLayoutEffect(place, [place, openedFor])

  useEffect(() => {
    // Слежение тем же `watchLayout`, что и у слоя меток, а не собственным
    // слушателем: у прокрутки внутреннего контейнера событие не всплывает,
    // и своя подписка на `window` без фазы перехвата его не увидела бы.
    const stop = watchLayout(schedule)
    return (): void => {
      stop()
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current)
        frame.current = null
      }
    }
  }, [schedule])

  // Пока правка не выбрана, окна нет вовсе: пустое окно посреди страницы мешало
  // бы вести мышью по элементам, ради которых инструмент и включён.
  if (!draft) return null

  function onSave(): void {
    const area = areaRef.current
    if (!area) return
    save(area.innerHTML, style)
  }

  return (
    <div class="kalka-editor" ref={boxRef}>
      <p class="kalka-title">Правим {placeOf(draft.tag)}</p>

      <FormatBar areaRef={areaRef} after={<StyleBar value={style} onChange={setStyle} />} />

      {/*
        Заметка показывается ТОЛЬКО когда пожелание задано.
        
        Прежде она висела всегда, включая случай, когда ни размера, ни цвета
        нет и объяснять нечего. Нужна она ровно в одну секунду: человек выбрал
        цвет, посмотрел на страницу и не увидел изменений. Без неё это читается
        как поломка, а не как задуманное поведение (решение 13).

        Собирает её `TextEditor`, а не `StyleBar`: контролы стоят в ряду
        инструментов, а фраза — под ним, и одному компоненту два места
        в раскладке не принадлежат.
      */}
      {(style.fontSize !== undefined || style.color !== undefined) && (
        <p class="kalka-note">
          Размер и цвет уйдут пожеланием — на самой странице они не поменяются.
        </p>
      )}

      <EditorArea
        areaRef={areaRef}
        html={initialHtml(draft)}
        openedFor={draft.id}
        style={style}
        fontFamily={hostFont}
      />

      <div class="kalka-row">
        <Button primary onClick={onSave}>
          Сохранить
        </Button>
        <Button onClick={close}>Отмена</Button>
        {/* «Удалить правку» есть только у уже сохранённой записи: удалять
            несохранённое нечего, а кнопка обещала бы обратное (FR-11). */}
        {existing && <Button onClick={remove}>Удалить правку</Button>}
      </div>
    </div>
  )
}
