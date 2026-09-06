import { IMPORT_MAX_BYTES } from 'shared/config/constants'
import { createLogger } from 'shared/lib/log'

const log = createLogger('files')

/*
 * Вторая внешняя граница сегмента `shared/api` рядом с `storage.ts`: файлы.
 * Скачивание (FR-27) и чтение выбранного файла (FR-30).
 *
 * КЛЮЧЕВОЕ: родитель для временного якоря приходит ПАРАМЕТРОМ, а не берётся
 * как `document.body`.
 *
 * Обычный приём «создать <a>, добавить в document.body, кликнуть, удалить»
 * здесь запрещён по двум причинам сразу. Первая: обещание «страница после
 * демонтажа неотличима от исходной» держится с первой вехи и исключений
 * не имеет. Вторая: вставка узла в тело носителя разбудила бы наш собственный
 * наблюдатель мутаций и вызвала лишний проход наложения слоя.
 *
 * Safari при этом требует, чтобы якорь был в дереве документа, и это условие
 * выполняется: вызывающий передаёт узел из Shadow DOM «Кальки», который
 * в дереве документа лежит.
 *
 * Следующему читателю: «исправление» этой функции на `document.body.appendChild`
 * ломает оба обещания и не делает код короче.
 */

/** Отсрочка отзыва ссылки: отзыв в том же такте, что клик, отменяет загрузку. */
const REVOKE_DELAY_MS = 60_000

export interface DownloadInput {
  /** Имя файла для браузера. Собирается вызывающим — см. `sanitizeFileName`. */
  name: string
  text: string
  mime: string
  /** Узел-родитель временного якоря: теневой корень «Кальки», не `document.body`. */
  parent: Element
}

/**
 * Скачивает текст файлом. Возвращает `false` при любом сбое, наружу не бросая
 * ничего (NFR-06): неудавшаяся загрузка не имеет права уронить виджет
 * и тем более сайт-носитель.
 */
export function downloadText({ name, text, mime, parent }: DownloadInput): boolean {
  let url: string | null = null
  let anchor: HTMLAnchorElement | null = null

  try {
    const blob = new Blob([text], { type: mime })
    url = URL.createObjectURL(blob)

    // Документ берётся у родителя, а не глобальный: узел из чужого документа
    // (например, из iframe) иначе получил бы якорь не своего происхождения.
    anchor = parent.ownerDocument.createElement('a')
    anchor.href = url
    anchor.download = name
    // Якорь живёт доли секунды и в обход с клавиатуры попадать не должен.
    anchor.style.display = 'none'
    parent.appendChild(anchor)
    anchor.click()

    // Содержимое файла не логируется никогда: это текст правок заказчика.
    log.debug('файл отправлен на скачивание', { имя: name, тип: mime, байт: blob.size })
    return true
  } catch (error) {
    log.warn('не удалось скачать файл', { имя: name, ошибка: error })
    return false
  } finally {
    // Узел снимается всегда, даже если клик бросил: оставленный <a> — это
    // мусор в собственном теневом корне и лишний узел в отчёте о демонтаже.
    anchor?.remove()
    // Отзыв ссылки — ОТЛОЖЕННО. В том же такте, что клик, он отменяет загрузку
    // в части браузеров: они читают Blob уже после возврата из обработчика.
    if (url !== null) {
      const revoked = url
      window.setTimeout(() => URL.revokeObjectURL(revoked), REVOKE_DELAY_MS)
    }
  }
}

/**
 * Читает выбранный файл текстом. `null` при любом сбое (NFR-06): наружу
 * не бросается ничего — неудавшееся чтение не имеет права уронить ни виджет,
 * ни сайт-носитель.
 *
 * Размер проверяется ДО чтения и отвергается вместе с файлом: попытка разобрать
 * двадцатимегабайтную строку подвесила бы вкладку носителя. Виджет здесь гость,
 * и «попробовать, а вдруг получится» — не его право.
 *
 * Содержимое файла в лог не уходит никогда. Имя логируется: его называет
 * человек, выбирая файл, и содержимого оно не раскрывает (решение 22).
 */
export async function readTextFile(file: File): Promise<string | null> {
  if (file.size > IMPORT_MAX_BYTES) {
    log.warn('файл не прочитан', {
      имя: file.name,
      байт: file.size,
      потолок: IMPORT_MAX_BYTES,
      причина: 'слишком большой',
    })
    return null
  }

  try {
    const text = await file.text()
    log.debug('файл прочитан', { имя: file.name, байт: file.size, знаков: text.length })
    return text
  } catch (error) {
    log.warn('файл не прочитан', { имя: file.name, байт: file.size, ошибка: error })
    return null
  }
}

/**
 * Приводит строку к безопасному куску имени файла (FR-29).
 *
 * Оставляет `[a-z0-9.-]`, прочее заменяет дефисом, схлопывает повторы и
 * обрезает по краям. Кириллица и двоеточие из `host:port` в имя файла
 * не попадают: одни файловые системы их не примут, другие примут, и разбираться,
 * какая именно у заказчика, — не работа виджета.
 */
export function sanitizeFileName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
}
