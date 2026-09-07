import { captureAgentContext } from 'entities/agent-context'
import { captureAnchor } from 'entities/anchor'
import { captureCutout } from 'entities/cutout'
import type { Entry } from 'shared/model/format'
import { createId } from 'shared/lib/id'
import { createLogger } from 'shared/lib/log'
import { normalize } from 'shared/lib/normalize'
import { currentRoute } from 'shared/lib/route'
import { usesTextPath } from 'shared/lib/dom'

const log = createLogger('edit-text:create')

/*
 * Оба entities вызываются ЗДЕСЬ, и это единственное место, где так можно:
 * `entities/anchor` и `entities/agent-context` — соседние слайсы одного слоя,
 * друг друга они не видят, а нужны оба сразу. Слой выше обоих — `features`,
 * и `ARCHITECTURE.md` описывает эту развязку дословно.
 */

/**
 * Новая запись по элементу страницы.
 *
 * `was` и `wasHtml` захватываются ТОЛЬКО здесь, то есть только для новой записи.
 * У существующей они уже есть, и перезахват затёр бы оригинал текстом
 * предыдущей правки — восстановить страницу после этого было бы нечем.
 *
 * `wasHtml` берётся как есть, без нормализации и без обрезки: движок наложения
 * восстанавливает из него оригинал (`app/lib/overlay/engine.ts`), и любое
 * сокращение здесь превратилось бы в потерю чужой вёрстки на странице. Смысла
 * поля веха «правка текста в кнопках и ссылках» НЕ меняет: `wasHtml` остаётся
 * свидетельством исходной разметки и для движка, и для агента — даже там,
 * где сама правка идёт простым текстом.
 *
 * А вот `now` на текстовом пути инициализируется значением `was`, а не
 * `wasHtml`: окно редактора правки кнопки обязано открыться СТРОКОЙ, а не
 * сериализованным `<svg>`. Второй аргумент предиката здесь — тот самый
 * `wasHtml`, только что снятый с нетронутого элемента.
 */
export function captureDraft(el: Element): Entry {
  const wasHtml = el.innerHTML
  const текстовыйПуть = usesTextPath(el, wasHtml)
  const was = normalize(el.textContent ?? '')

  // Порядок именно такой: сперва якорь, затем контекст. Оба читают страницу
  // ДО какой-либо записи в хранилище и до наложения — иначе контекст описывал
  // бы страницу, уже изменённую этой же правкой.
  const anchor = captureAnchor(el)
  const agent = captureAgentContext(el)

  const draft: Entry = {
    id: createId(),
    // Тип уточняется при сохранении по тому, что реально изменилось (решение 8).
    // Здесь он оптимистичный: чаще всего рецензент открывает редактор ради текста.
    type: 'text-override',
    route: currentRoute(),
    tag: el.tagName.toLowerCase(),
    was,
    wasHtml,
    // Пока рецензент ничего не изменил, «стало» равно «было»: окно редактора
    // открывается с текущим содержимым элемента, а не пустым. На текстовом
    // пути «было» — это строка, а не разметка.
    now: текстовыйПуть ? was : wasHtml,
    style: {},
    ...agent,
    anchor,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    at: new Date().toISOString(),
  }

  // Содержимое `was` и `wasHtml` в лог не попадает: это текст страницы
  // заказчика. В логе только длины (решение 16).
  log.debug('правка захвачена', {
    id: draft.id,
    тег: draft.tag,
    длинаТекста: draft.was.length,
    длинаРазметки: draft.wasHtml.length,
    текстовыйПуть,
    // Показывает, что контекст пришёл измеренным, а не заглушкой.
    повторов: draft.occurrencesOnPage,
  })

  /*
   * Снимок места правки для печатного отчёта — ЗДЕСЬ, вместе с `was`.
   *
   * Кадр УЗКИЙ, по самому элементу: строка текста печатается 1:1 и читается,
   * а окрестность правке текста ничего не добавляет.
   *
   * Съёмка отложенная и наверх ничего не возвращает: правка сохраняется
   * мгновенно, вырезка догоняет. Не снялась — отчёт покажет запись текстом
   * с явной пометкой.
   *
   * Точка та же, что у `was`/`wasHtml`, и по той же причине: элемент здесь ещё
   * не тронут слоем. При повторной правке уже правленого места (FR-10)
   * `captureDraft` не зовётся вовсе, значит вырезка не переснимается —
   * сохранённая показывает исходное состояние, что и требуется.
   */
  captureCutout({ entryId: draft.id, anchor: el, wide: false })

  return draft
}
