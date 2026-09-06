import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { entryStore } from 'entities/entry'
import { createLogger } from 'shared/lib/log'
import { Button } from 'shared/ui/Button'
import { IconEdited, IconHighlightOn, IconOriginal } from 'shared/ui/icons'

const log = createLogger('toggle-view')

/**
 * Вид страницы: три состояния одной кнопки (FR-21, FR-22).
 *
 * ── Почему одна кнопка, а не две ────────────────────────────────────────────
 *
 * Их и было две — «оригинал / с правками» и «показать, где изменения». Но
 * состояний у страницы всё это время было ТРИ, а не четыре: подсветка
 * в режиме оригинала не показывалась вовсе (подсвечивать нечего), и вторая
 * кнопка просто исчезала. Два флага описывали три состояния, а на рейке
 * занимали две клетки из шести.
 *
 * Цикл замкнут: с правками → где изменения → оригинал → снова с правками.
 * Попасть в любое состояние можно не более чем за два нажатия.
 *
 * ── Почему подпись называет ТЕКУЩЕЕ состояние, а не действие ────────────────
 *
 * У прежнего тумблера подпись называла действие («Показать оригинал»), и для
 * двух состояний этого хватало: не оригинал — значит с правками, третьего
 * не дано. Для трёх не хватает — «Показать оригинал» одинаково верно и когда
 * видны правки, и когда видно, где изменения. Поэтому и подпись, и рисунок
 * говорят, что на экране СЕЙЧАС, а следующее состояние открывается нажатием.
 *
 * ── Переприменение ──────────────────────────────────────────────────────────
 *
 * Отсюда не вызывается и вызвано быть не может: движок наложения живёт в `app`,
 * слой выше `features`. Он подписан на то же хранилище и переприменит слой
 * сам — это и есть общение слайсов через хранилище (ARCHITECTURE.md).
 */

/** Что показано на странице. Производная от двух флагов хранилища. */
type View = 'edited' | 'highlighted' | 'original'

const NEXT: Readonly<Record<View, View>> = {
  edited: 'highlighted',
  highlighted: 'original',
  original: 'edited',
}

/**
 * Подписи и рисунки по состояниям.
 *
 * Текст по-русски и без технических терминов (FR-36): рецензент читает про
 * страницу и правки, а не про слой, наложение и подсветку атрибутов.
 */
const VIEWS: Readonly<Record<View, { label: string; icon: JSX.Element }>> = {
  edited: { label: 'Вид: с правками', icon: <IconEdited /> },
  highlighted: { label: 'Вид: где изменения', icon: <IconHighlightOn /> },
  original: { label: 'Вид: оригинал', icon: <IconOriginal /> },
}

function currentView(): View {
  if (entryStore.showOriginal()) return 'original'
  return entryStore.highlightApplied() ? 'highlighted' : 'edited'
}

export interface ViewToggleProps {
  /**
   * Компактный вид для рейки: одна иконка вместо фразы.
   *
   * Фраза при этом никуда не девается — она остаётся доступным именем кнопки
   * и всплывающей подписью. Убрать видимый текст с рейки в 48px можно,
   * отобрать имя у программы чтения с экрана — нет.
   */
  compact?: boolean
}

export function ViewToggle({ compact }: ViewToggleProps): JSX.Element {
  const [view, setView] = useState<View>(currentView)

  useEffect(() => {
    // Снимок берётся и при подписке: между первым рендером и эффектом флаги
    // могли измениться, и компонент остался бы с устаревшим значением.
    setView(currentView())
    return entryStore.subscribe(() => setView(currentView()))
  }, [])

  function step(): void {
    const next = NEXT[view]
    log.debug('смена вида страницы', { было: view, стало: next })

    /*
     * Пишется только то, что действительно меняется.
     *
     * Каждый сеттер уведомляет подписчиков сам, а движок наложения на каждое
     * уведомление переприменяет слой. Ставь оба флага всегда — и половина
     * переходов давала бы два прохода по чужой странице вместо одного,
     * с заметным мельканием на длинных страницах.
     */
    const original = next === 'original'
    const highlighted = next === 'highlighted'
    if (entryStore.showOriginal() !== original) entryStore.setShowOriginal(original)
    if (entryStore.highlightApplied() !== highlighted) {
      entryStore.setHighlightApplied(highlighted)
    }
  }

  const { label, icon } = VIEWS[view]

  /*
   * Состояние несут ИМЯ и РИСУНОК, а не `aria-pressed`: имя уже меняется
   * вместе с состоянием, а нажатость у кнопки с тремя состояниями сказала бы
   * неправду — она двоичная. Разбор — в шапке `shared/ui/Button`.
   */
  if (compact) return <Button onClick={step} icon={icon} label={label} tip={label} />

  return <Button onClick={step}>{label}</Button>
}
