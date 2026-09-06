import type { JSX } from 'preact'
import { useRef } from 'preact/hooks'
import type { Style } from 'shared/model/format'
import { createLogger } from 'shared/lib/log'
import { Button } from 'shared/ui/Button'
import { IconClose } from 'shared/ui/icons'

const log = createLogger('text-editor:style')

/**
 * Короткий список размеров. Значения — в пикселях, потому что именно так они
 * уйдут в поле `style` файла обмена (`fontSize: '18px'`).
 *
 * Пустое значение — «как на сайте»: свойство не задано вовсе. Это не то же
 * самое, что «14 пикселей»: незаданный размер оставляет вёрстку носителя
 * в покое, а заданный — просит её изменить.
 */
const SIZES: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: '', label: 'Как на сайте' },
  { value: '14px', label: 'Мельче' },
  { value: '16px', label: 'Обычный' },
  { value: '20px', label: 'Крупнее' },
  { value: '28px', label: 'Заголовок' },
]

/**
 * Цвета, предлагаемые нативному диалогу образцами.
 *
 * ── Закрытый список цветов ОТМЕНЁН, и вот чем ───────────────────────────────
 *
 * Здесь стоял выбор из пяти цветов с доводом: «`<input type="color">` принимал
 * любое из шестнадцати миллионов значений… закрытый набор снимает пожелания
 * вида „чуть-чуть другой синий“, которые разработчику нечем исполнить».
 *
 * Довод не отменён — он остался верным, и потому закрыт не запретом, а этим
 * списком. `<datalist>` кладёт те же пять цветов образцами прямо в нативный
 * диалог: первое, что видит рука, — цвета, которые в исходниках прототипа
 * действительно есть. Свободный выбор при этом остался свободным, и
 * ответственность за него у того, кто отклонился от образцов, а не
 * у инструмента, который ему это запретил.
 *
 * ⚠ Образцы — это ПОДСКАЗКА, а не гарантия: `<datalist>` для цвета
 * поддержан не всеми браузерами, и там, где его нет, диалог открывается
 * обычным. Ничего не ломается — теряется только удобство.
 *
 * ── Это СВОЙ набор, а не палитра хрома ──────────────────────────────────────
 *
 * Взять шестёрку `--kalka-*` буквально нельзя: `--kalka-sheet` в роли цвета
 * текста на белой странице невидим, `--kalka-edge` и `--kalka-shade` цветами
 * текста не являются вовсе, а `--kalka-redline` занят под то, что нанёс
 * человек, — покрасить им текст носителя значило бы спутать след инструмента
 * с содержимым страницы.
 */
const SUGGESTED: readonly string[] = ['#111111', '#6b6b6b', '#b3261e', '#1b5e20', '#0b4a8f']

/**
 * Идентификатор списка образцов.
 *
 * Постоянный, а не сгенерированный: окно правки на странице ровно одно,
 * а идентификаторы внутри теневого корня не сталкиваются с идентификаторами
 * носителя — тем же соображением живёт `DRAWER_ID` в `app/ui/Root`.
 */
const SWATCHES_ID = 'kalka-color-swatches'

/** Цвет в поле выбора, когда цвет не задан. Виден только внутри диалога. */
const NEUTRAL = '#111111'

export interface StyleBarProps {
  value: Style
  onChange: (style: Style) => void
}

/**
 * Размер и цвет (FR-08) — два контрола в ряду оформления.
 *
 * Значения складываются в отдельное поле `style` и НИКОГДА не подмешиваются
 * в текст правки (решение 13, раздел 9 PRD): инлайновый CSS внутри `now`
 * агент применил бы прямо в исходники прототипа.
 *
 * Незаданное свойство в объект не попадает вовсе, а не приезжает пустой
 * строкой: пустая строка в файле обмена читается как «задан пустой размер»,
 * то есть как ошибка, а не как «не трогать».
 *
 * ── Почему здесь нет подписей «Размер» и «Цвет» ─────────────────────────────
 *
 * Раньше это был отдельный блок под областью набора: два поля с этикетками
 * над ними, то есть форма. Форма под текстом читалась как второй шаг правки,
 * хотя размер и цвет — такое же оформление, как жирный и курсив, и место им
 * в том же ряду. В ряду инструментов роль этикетки берёт всплывающая подпись,
 * ровно как у иконок рейки.
 */
export function StyleBar({ value, onChange }: StyleBarProps): JSX.Element {
  /**
   * Поле выбора цвета живёт скрытым, а нажимают кнопку рядом.
   *
   * Тот же приём, что у выбора файла в `widgets/entry-list`, и по той же
   * причине: собственный вид кнопки виджета не должен зависеть от того, как
   * браузер рисует `input[type=color]`. Здесь к этому добавляется второе:
   * у поля выбора ВСЕГДА есть значение, и состояние «не менять» нарисовать
   * на нём нечем — а на своей кнопке рисуется чем угодно.
   */
  const picker = useRef<HTMLInputElement | null>(null)

  function update(next: Style): void {
    // В лог идут только имена заданных свойств, без значений (решение 16).
    log.debug('оформление изменено', {
      размер: next.fontSize !== undefined,
      цвет: next.color !== undefined,
    })
    onChange(next)
  }

  function chooseSize(size: string): void {
    const next: Style = { ...value }
    if (size) next.fontSize = size
    else delete next.fontSize
    update(next)
  }

  function chooseColor(color: string): void {
    const next: Style = { ...value }
    if (color) next.color = color
    else delete next.color
    update(next)
  }

  return (
    <>
      {/* Черта отделяет пожелания от оформления текста: жирный и курсив
          меняют саму правку, размер и цвет — только просят о ней. */}
      <span class="kalka-editor__divider" aria-hidden="true" />

      {/* Своя метка на ОБЁРТКЕ, а не на самом списке: в ряду флекс-элементом
          является обёртка, и правило растяжения, поставленное на список
          внутри неё, не делает ничего — обёртка всё равно держит ширину
          по содержимому и в узком окне выталкивает соседей на вторую строку. */}
      <span class="kalka-tipped kalka-editor__size">
        <select
          class="kalka-select"
          aria-label="Размер текста"
          value={value.fontSize ?? ''}
          onChange={(event) => chooseSize(event.currentTarget.value)}
        >
          {SIZES.map((size) => (
            <option key={size.value} value={size.value}>
              {size.label}
            </option>
          ))}
        </select>
        <span class="kalka-tip" aria-hidden="true">
          Размер текста
        </span>
      </span>

      <input
        class="kalka-editor__picker"
        type="color"
        list={SWATCHES_ID}
        tabIndex={-1}
        aria-hidden="true"
        value={value.color ?? NEUTRAL}
        /* `change`, а не `input`: диалог сообщает о каждом движении по палитре,
           и на `input` в состояние прилетал бы десяток цветов за одно
           открытие — вместе с десятком записей в лог. */
        onChange={(event) => chooseColor(event.currentTarget.value)}
        ref={picker}
      />
      <datalist id={SWATCHES_ID}>
        {SUGGESTED.map((color) => (
          <option key={color} value={color} />
        ))}
      </datalist>

      <Button
        icon={
          <span
            class={`kalka-swatch${value.color === undefined ? ' kalka-swatch--none' : ''}`}
            style={value.color === undefined ? undefined : { background: value.color }}
          />
        }
        label={value.color === undefined ? 'Цвет текста: как на сайте' : 'Цвет текста'}
        tip="Цвет текста"
        onClick={() => picker.current?.click()}
      />

      {/*
        Возврат к «как на сайте» — ОТДЕЛЬНАЯ кнопка, и появляется она только
        когда есть что возвращать.

        Без неё пути обратно нет вовсе: у нативного поля выбора всегда есть
        значение, и «не менять» оно выразить не может. Прежний список делал это
        строкой «Не менять»; строки больше нет, а состояние осталось.
      */}
      {value.color !== undefined && (
        <Button
          icon={<IconClose />}
          label="Вернуть цвет как на сайте"
          tip="Цвет как на сайте"
          onClick={() => chooseColor('')}
        />
      )}
    </>
  )
}
