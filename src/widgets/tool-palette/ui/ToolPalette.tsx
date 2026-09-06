import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { entryStore, toolOf } from 'entities/entry'
import { plural } from 'shared/lib/plural'
import { TOOL_LABELS } from 'shared/model/ui'
import type { Tool } from 'shared/model/ui'
import { Button } from 'shared/ui/Button'
import { IconArea, IconPoint, IconText } from 'shared/ui/icons'

/**
 * Инструменты. Порядок массива задаёт порядок кнопок и меняется только вместе
 * с PRD: рецензент привыкает к расположению.
 *
 * Подпись осталась прежним словом, но с рейки шириной 48px она ушла в два
 * места сразу: в доступное имя кнопки (`label`) и во всплывающую расшифровку
 * (`tip`). Видимого текста в кнопке больше нет — есть иконка.
 */
const TOOLS: ReadonlyArray<{
  readonly id: Tool
  readonly label: string
  readonly icon: JSX.Element
}> = [
  { id: 'text', label: TOOL_LABELS.text, icon: <IconText /> },
  { id: 'area', label: TOOL_LABELS.area, icon: <IconArea /> },
  { id: 'point', label: TOOL_LABELS.point, icon: <IconPoint /> },
]

export interface ToolPaletteProps {
  selected: Tool | null
  onSelect: (tool: Tool) => void
}

/** Сколько правок сделано каждым инструментом. */
function countsByTool(): Readonly<Record<Tool, number>> {
  const counts: Record<Tool, number> = { text: 0, area: 0, point: 0 }
  for (const entry of entryStore.list()) {
    const tool = toolOf(entry)
    if (tool) counts[tool] += 1
  }
  return counts
}

/**
 * Число правок инструмента для доступного имени кнопки.
 *
 * Отдельной фразой, а не числом встык: `aria-label` заменяет содержимое кнопки
 * целиком, и значок с числом внутри неё программа чтения с экрана не прочтёт
 * вовсе (см. проп `badge` в `shared/ui/Button`).
 */
function nameWithCount(label: string, count: number): string {
  if (count === 0) return label
  return `${label}, ${count} ${plural(count, 'правка', 'правки', 'правок')}`
}

/**
 * Подсказка по выбранному инструменту.
 *
 * Поведение есть у всех трёх: «Текст» — веха «Инструмент „Текст“»,
 * «Область» и «Указатель» — FR-13…FR-16. Подсказка объясняет ровно то, что
 * рецензенту предстоит сделать мышью, и напоминает, чем инструмент выключается:
 * пока он включён, клики по странице перехвачены, и без этой строки выход
 * приходится угадывать.
 *
 * Фразы сохранены дословно: переезд на рейку сменил им место, а не смысл.
 */
const HINTS: Readonly<Record<Tool, string>> = {
  text: 'Наведите на текст на странице и нажмите. Повторное нажатие кнопки выключит инструмент.',
  area: 'Обведите мышью часть страницы и напишите замечание. Повторное нажатие кнопки выключит инструмент.',
  point: 'Нажмите на нужное место и напишите замечание. Повторное нажатие кнопки выключит инструмент.',
}

/**
 * Сегментированный переключатель инструментов на рейке.
 *
 * ── Почему одна группа, а не три одинаковые кнопки ──────────────────────────
 *
 * Выбор здесь взаимоисключающий, и форма обязана это показывать: три кнопки
 * одной формы, стоящие в ряд с прочими, говорят «три отдельных действия».
 * Сегмент со сросшимися границами говорит «одно из трёх» — до того, как
 * человек нажал хоть раз.
 *
 * ── Состояние выбора сказано ДВАЖДЫ, и это намеренно ────────────────────────
 *
 * `selected` — зрительный признак (заливка), `pressed` — доступное состояние
 * (`aria-pressed`). Текста в иконной кнопке нет, поэтому один зрительный
 * признак не сообщил бы выбранный инструмент тому, кто пользуется программой
 * чтения с экрана, вовсе. Почему именно `aria-pressed`, а не радиогруппа,
 * разобрано в шапке `shared/ui/Button`.
 *
 * ── Две подписи, у каждой своя работа ───────────────────────────────────────
 *
 * `tip` — всплывающая расшифровка иконки: только НАЗЫВАЕТ кнопку и видна
 * по наведению и фокусу ещё до выбора. Подсказка ниже — постоянная, пока
 * инструмент выбран, и ОБЪЯСНЯЕТ действие и способ выключить инструмент.
 * Соединять их нельзя: первая нужна до выбора, вторая — после.
 */
export function ToolPalette({ selected, onSelect }: ToolPaletteProps): JSX.Element {
  /*
   * Счётчики берутся из хранилища ЗДЕСЬ, а не приходят пропом сверху.
   *
   * Потребитель у них ровно один — эта палитра, — и протаскивать их через
   * `Root` значило бы завести проп, который всегда приходит с одним и тем же
   * вычисленным значением. Приём тот же, что у `MarkLayer` и `EntryList`:
   * подписка `useState` + `useEffect` + `subscribe`, без пакета сигналов
   * (NFR-01).
   */
  const [counts, setCounts] = useState<Readonly<Record<Tool, number>>>(countsByTool)

  useEffect(() => {
    setCounts(countsByTool())
    return entryStore.subscribe(() => setCounts(countsByTool()))
  }, [])

  const chosen = TOOLS.find((tool) => tool.id === selected)

  return (
    <div class="kalka-tools">
      <div class="kalka-segmented">
        {TOOLS.map((tool) => (
          <Button
            key={tool.id}
            icon={tool.icon}
            badge={counts[tool.id]}
            label={nameWithCount(tool.label, counts[tool.id])}
            tip={tool.label}
            selected={tool.id === selected}
            pressed={tool.id === selected}
            onClick={() => onSelect(tool.id)}
          />
        ))}
      </div>

      {/* Абзацу в 48px места нет, поэтому подсказка выходит из рейки влево
          отдельным листком. Он не сдвигает рейку (position: absolute)
          и исчезает вместе со снятием инструмента. */}
      {chosen && (
        <div class="kalka-tools__hint">
          <p class="kalka-note">Выбрано: {chosen.label}</p>
          <p class="kalka-note">{HINTS[chosen.id]}</p>
        </div>
      )}
    </div>
  )
}
