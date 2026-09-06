import { createLogger } from 'shared/lib/log'

const log = createLogger('entry:sanitize')

/*
 * Санитизация разметки на СТОРОНЕ ЗАПИСИ в чужой DOM.
 *
 * Поля `now` и `wasHtml` содержат разметку (PRD, раздел 9) и приезжают из файла
 * обмена, то есть из-за пределов виджета. Писать их в страницу носителя без
 * белого списка нельзя ни при каких условиях.
 *
 * Белый список ОДИН на весь проект. Редактор (FR-07, FR-12) вызывает эту же
 * функцию в двух точках — при вставке из буфера и при сохранении правки, —
 * и второго списка не заводит: два расходящихся набора тегов означали бы
 * разметку, которую редактор разрешил, а наложение на страницу вырезало.
 * Набор `B/STRONG/I/EM/A/UL/OL/LI/BR` ровно покрывает форматирование FR-07.
 */

/**
 * Что разрешено в тексте правки. Список намеренно короткий: он покрывает
 * форматирование редактора (жирный, курсив, ссылка, список) и ничего сверх.
 * Всё, чего здесь нет, разворачивается в собственный текст.
 */
const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'A', 'UL', 'OL', 'LI', 'BR'])

/**
 * Элементы, которые удаляются ВМЕСТЕ с содержимым, а не разворачиваются в текст.
 *
 * Для остальных запрещённых тегов текст сохраняется: это данные заказчика.
 * Но исходник скрипта или таблицы стилей — не текст правки, и показывать его
 * на странице как текст было бы хуже, чем потерять.
 */
const DROPPED_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME'])

/** Единственный уцелевающий атрибут, и только у ссылки. */
const ALLOWED_HREF_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/** Схемы вроде `javascript:` и `data:` до элемента не доходят. */
function isSafeHref(value: string, doc: Document): boolean {
  try {
    // База нужна для относительных адресов: `/about` — законная ссылка.
    return ALLOWED_HREF_SCHEMES.has(new URL(value, doc.baseURI).protocol)
  } catch {
    return false
  }
}

/**
 * Разбирает HTML и возвращает безопасный фрагмент для вставки в чужой DOM.
 *
 * `doc` передаётся параметром, а не берётся глобальным: функция остаётся чистой
 * и проверяемой, как и ядро якорей.
 *
 * Разбор идёт через `<template>`: его содержимое — инертный фрагмент, браузер
 * не выполняет в нём скрипты и не загружает ресурсы уже на этапе разбора.
 * `innerHTML` обычного элемента такой гарантии не даёт.
 */
export function sanitizeHtml(html: string, doc: Document): DocumentFragment {
  const template = doc.createElement('template')
  template.innerHTML = html

  let removedElements = 0
  let removedAttributes = 0

  // Обход по снимку: узлы во время прохода заменяются, и живая коллекция
  // потеряла бы часть дерева.
  const elements = [...template.content.querySelectorAll('*')]
  for (const el of elements) {
    if (DROPPED_WITH_CONTENT.has(el.tagName)) {
      el.remove()
      removedElements += 1
      continue
    }

    if (!ALLOWED_TAGS.has(el.tagName)) {
      // Элемент убирается, а его содержимое остаётся: текст правки — данные
      // заказчика, и терять его из-за неизвестного тега нельзя.
      el.replaceWith(...el.childNodes)
      removedElements += 1
      continue
    }

    for (const attribute of [...el.attributes]) {
      const keep =
        el.tagName === 'A' &&
        attribute.name === 'href' &&
        isSafeHref(attribute.value, doc)
      if (keep) continue
      el.removeAttribute(attribute.name)
      removedAttributes += 1
    }
  }

  log.debug('разметка очищена', {
    удаленоЭлементов: removedElements,
    снятоАтрибутов: removedAttributes,
  })

  return template.content
}
