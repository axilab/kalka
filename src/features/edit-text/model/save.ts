import { cutoutBuffer } from 'entities/cutout'
import { entryStore, sanitizeHtml } from 'entities/entry'
import type { Entry, EntryType, Style } from 'shared/model/format'
import { createLogger } from 'shared/lib/log'
import { normalize } from 'shared/lib/normalize'

const log = createLogger('edit-text:save')

/** Очищенная разметка вместе с её текстом: оба нужны для решения о типе. */
interface Cleaned {
  html: string
  text: string
}

/**
 * Прогоняет разметку редактора через белый список (решение 12).
 *
 * Список один на весь проект: набор `B/STRONG/I/EM/A/UL/OL/LI/BR` ровно
 * покрывает форматирование FR-07, а два расходящихся списка означали бы
 * разметку, которую редактор разрешил, а наложение на страницу вырезало.
 *
 * `document` здесь используется ровно для одного — создать открепленный
 * `<template>` внутри `sanitizeHtml`. В страницу носителя слайс не лезет
 * и лезть не имеет права (ARCHITECTURE.md).
 */
function clean(html: string): Cleaned {
  const holder = document.createElement('div')
  holder.appendChild(sanitizeHtml(html, document))
  return { html: holder.innerHTML, text: normalize(holder.textContent ?? '') }
}

/** Задано ли в оформлении хоть что-то: пустой объект — это «как на сайте». */
function hasStyle(style: Style): boolean {
  return style.fontSize !== undefined || style.color !== undefined
}

/**
 * Тип записи выводится из того, что изменилось относительно ОРИГИНАЛА страницы,
 * а не относительно предыдущего состояния черновика (решение 8).
 *
 * Сравнение «текст изменился» идёт по нормализованному тексту очищенной
 * разметки, а не по строкам HTML: перестановка тегов без изменения текста
 * правкой не является, и записывать её как `text-override` значило бы просить
 * агента переписать исходник ради ничего.
 *
 * `null` — не изменилось ничего: ни текста, ни оформления.
 */
function resolveType(draft: Entry, cleaned: Cleaned, style: Style): EntryType | null {
  if (cleaned.text !== normalize(draft.was)) return 'text-override'
  // Текст тот же, изменилось только оформление: агент такую запись механически
  // не применяет — ровно то, чего требует FR-39.
  if (hasStyle(style)) return 'style-wish'
  return null
}

/**
 * Сохраняет правку. Движок наложения подписан на хранилище и переприменит слой
 * сам — прямого вызова движка отсюда нет и быть не может (`app` выше `features`).
 */
export function saveEdit(draft: Entry, nextHtml: string, nextStyle: Style): void {
  const cleaned = clean(nextHtml)
  const type = resolveType(draft, cleaned, nextStyle)

  if (type === null) {
    // Правка сведена к оригиналу. Новая запись при этом не создаётся вовсе,
    // а уже существующая удаляется: держать в файле обмена запись «замени
    // текст на такой же» — значит просить агента о пустой работе, а на странице
    // оставить метку изменённого места там, где изменений нет.
    if (entryStore.get(draft.id)) {
      log.info('правка сведена к оригиналу, запись снята', { id: draft.id })
      entryStore.remove(draft.id)
      cutoutBuffer.drop(draft.id)
      return
    }
    log.debug('изменений нет, запись не создаётся', { id: draft.id })
    return
  }

  const entry: Entry = {
    ...draft,
    type,
    // У пожелания по оформлению текст не менялся, и класть его в `now` нельзя:
    // это поле агент читает как «заменить на», а заменять нечего.
    now: type === 'text-override' ? cleaned.html : '',
    style: nextStyle,
  }

  entryStore.upsert(entry)

  // Ни `was`, ни `now`, ни адрес введённой ссылки в лог не попадают: через
  // редактор проходит именно то, что написал рецензент (решение 16).
  log.info('правка сохранена', {
    id: entry.id,
    тип: entry.type,
    былоЗнаков: normalize(draft.was).length,
    сталоЗнаков: cleaned.text.length,
    оформление: hasStyle(nextStyle),
  })
}

/** Удаление правки (FR-11). Собственного слайса не заводим — решение 15. */
export function removeEdit(id: string): void {
  log.info('правка удалена', { id })
  entryStore.remove(id)
  // Снимок места уходит вместе с записью: вырезка без записи бессмысленна
  // и только занимает место в буфере, вытесняя нужные.
  cutoutBuffer.drop(id)
}
