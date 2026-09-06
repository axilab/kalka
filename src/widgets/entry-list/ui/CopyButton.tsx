import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { copyText } from 'shared/api/clipboard'
import { Button } from 'shared/ui/Button'
import { IconCopy, IconDone } from 'shared/ui/icons'

/*
 * Кнопка копирования текста правки в буфер (FR-34).
 *
 * ── Запасной путь обязателен, и он здесь ─────────────────────────────────────
 *
 * `navigator.clipboard` требует безопасного контекста, а прототипы из PRD стоят
 * на внутренних стендах по `http://` — то есть ровно там, где его нет. Кнопка,
 * которая молча не работает, хуже отсутствующей кнопки: человек решит, что
 * текст скопирован, и вставит в поиск по коду пустоту.
 *
 * Поэтому при отказе кнопка ЗАМЕНЯЕТСЯ полем с текстом, выделенным целиком, —
 * дальше рецензент копирует его сам привычным сочетанием клавиш.
 * `document.execCommand('copy')` не используется и не появится: он объявлен
 * устаревшим и на части браузеров молча не работает, то есть даёт третий путь
 * с тем же дефектом, что и первый (решение 16 плана вехи).
 *
 * ── Отклик галочкой, а не сменой подписи ─────────────────────────────────────
 *
 * Кнопка стоит в плашке действий и подписи не имеет вовсе — только всплывающую.
 * Подтверждать успех сменой подписи стало нечем, и его подтверждает ИКОНКА:
 * на две секунды копия сменяется галочкой, а всплывающая подпись — словом
 * «Скопировано». Молчания здесь быть не должно ровно по той же причине,
 * по которой оно было недопустимо и до плашки.
 */

/** Сколько держится подпись «Скопировано». */
const DONE_MS = 2000

export interface CopyButtonProps {
  /** Что положить в буфер. */
  text: string
  /** Название действия: «Копировать „было“» и подобные. Оно же — подпись. */
  children: string
}

export function CopyButton({ text, children }: CopyButtonProps): JSX.Element {
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState(false)
  const field = useRef<HTMLTextAreaElement | null>(null)

  // Выделение целиком — на монтировании поля: рецензенту остаётся только нажать
  // сочетание клавиш, искать начало и конец текста мышью он не должен.
  useEffect(() => {
    if (!failed) return
    field.current?.focus()
    field.current?.select()
  }, [failed])

  // Подпись «Скопировано» гасится таймером, и таймер обязан сниматься:
  // размонтированный компонент не имеет права дёрнуть setState.
  useEffect(() => {
    if (!done) return
    const timer = window.setTimeout(() => setDone(false), DONE_MS)
    return () => clearTimeout(timer)
  }, [done])

  async function copy(): Promise<void> {
    const ok = await copyText(text)
    if (ok) setDone(true)
    else setFailed(true)
  }

  if (failed) {
    return (
      <label class="kalka-copy kalka-copy--manual">
        Скопируйте вручную
        <textarea class="kalka-copy__field" readOnly ref={field} rows={2} value={text} />
      </label>
    )
  }

  return (
    <span class="kalka-copy">
      <Button
        icon={done ? <IconDone /> : <IconCopy />}
        label={done ? 'Скопировано' : children}
        tip={done ? 'Скопировано' : children}
        onClick={() => void copy()}
      />
    </span>
  )
}
