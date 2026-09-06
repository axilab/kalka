import { plainHtml, styleWords } from 'entities/entry'
import { createLogger } from 'shared/lib/log'
import type { Entry } from 'shared/model/format'
import type { Cutout } from 'shared/model/layer'
import { markUp } from './mark'

const log = createLogger('report')

/*
 * Сборка печатного документа отчёта.
 *
 * ── Вид: ДЕЛОВАЯ ЗАПИСКА, а не корректорский лист ──────────────────────────
 *
 * Главный читатель — менеджер, который передаёт задачу разработчику. Ему нужен
 * ответ на «сколько тут работы и что с этим делать», а не разметка правки.
 * Отсюда шапка с адресом, датой, автором и числом правок; отсюда два раздела,
 * упорядоченные по тому, КТО действует; отсюда рамка с именем файла обмена.
 * Метафора кальки остаётся в самом виджете, на бумагу она не едет.
 *
 * ── Порядок разделов: сперва то, что требует человека ──────────────────────
 *
 * «Требует решения» впереди: пожелания оформления и замечания агент
 * механически не применяет, и это и есть задача, которую менеджер кому-то
 * поручит. «Правки текста» после: их агент применит сам, и читать их подряд
 * менеджеру незачем.
 *
 * ── Порядок страниц устойчив ────────────────────────────────────────────────
 *
 * Страницы идут по первому появлению записи в наборе. Текущий маршрут сюда
 * не передаётся вовсе — намеренно: список разбора на экране поднимает текущую
 * страницу наверх, и это правильно там, где человек на ней стоит. В печатном
 * документе «текущая» страница — та, где рецензент случайно оказался в момент
 * печати, и два прогона по одному набору дали бы документы с разным порядком
 * разделов. После этого сослаться на «третью страницу отчёта» в переписке
 * стало бы нельзя.
 *
 * ── FR-36 ───────────────────────────────────────────────────────────────────
 *
 * В документе нет слов «формат», «селектор», «якорь», «DOM». Имя файла обмена
 * показать можно и нужно: это имя, а не термин.
 */

export interface ReportInput {
  /** Все записи набора в порядке добавления. */
  entries: readonly Entry[]
  /** Карта «идентификатор записи → её номер»: та же, что у метки и списка. */
  numbers: ReadonlyMap<string, number>
  /** Вырезка записи, если она снята. */
  cutoutOf: (entryId: string) => Cutout | null
  /** Адрес сайта: `location.origin` прототипа. */
  site: string
  /**
   * Имя файла обмена.
   *
   * `null` — набор ещё не выгружали. Имени тогда не выдумывается: названное
   * имя несуществующего файла хуже отсутствия имени, потому что выглядит
   * достоверно и отправляет менеджера искать то, чего нет.
   */
  fileName: string | null
  /** Момент сборки отчёта. Параметром, а не глобальным: так функция проверяема. */
  now: Date
  /** Документ-хозяин: нужен для разбора разметки «стало» в текст. */
  doc: Document
}

/** Экранирование текста, попадающего в разметку документа. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Дата и время человеку: локальные, без часового пояса и миллисекунд. */
function formatMoment(at: Date): string {
  const two = (value: number): string => String(value).padStart(2, '0')
  return (
    `${two(at.getDate())}.${two(at.getMonth() + 1)}.${at.getFullYear()} ` +
    `${two(at.getHours())}:${two(at.getMinutes())}`
  )
}

/** Правильная форма слова при числе. */
function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  const mod10 = count % 10
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

/**
 * Требует ли запись решения ЧЕЛОВЕКА.
 *
 * Не только по типу. Запись `text-override` с непустым пожеланием оформления —
 * достижимое штатное состояние: рецензент и текст поправил, и попросил сделать
 * его крупнее. Тип у неё один, а работы в ней две, и вторую агент механически
 * не применяет. Считать её «агент сделает сам» значит спрятать половину правки.
 */
function hasStyleWish(entry: Entry): boolean {
  return entry.style.fontSize !== undefined || entry.style.color !== undefined
}

function needsPerson(entry: Entry): boolean {
  return entry.type !== 'text-override' || hasStyleWish(entry)
}

/** Группы по страницам в порядке ПЕРВОГО ПОЯВЛЕНИЯ записи. */
function groupByRoute(entries: readonly Entry[]): { route: string; entries: Entry[] }[] {
  const groups = new Map<string, Entry[]>()
  for (const entry of entries) {
    const bucket = groups.get(entry.route)
    if (bucket) bucket.push(entry)
    else groups.set(entry.route, [entry])
  }

  return [...groups.entries()].map(([route, items]) => ({ route, entries: items }))
}

/**
 * Ширина колонки под картинку, px при 96 dpi.
 *
 * A4 (210 мм) минус поля `@page` (14 мм с каждой стороны) — это 182 мм,
 * то есть примерно 688 px. Минус жёлоб под номер записи (26 px кружок
 * плюс 10 px зазор) остаётся 652.
 *
 * Число живёт здесь, а не в `shared/config/constants`: оно выведено из `@page`
 * этого документа и вместе с ним и меняется. В константах общего пользования
 * оно разъехалось бы с полями страницы при первой же правке вёрстки.
 */
const COLUMN_PX = 652

/**
 * Картинка места правки — или честные слова вместо неё.
 *
 * Пометка ОБЯЗАТЕЛЬНА и обязана быть явной: читатель должен различать
 * «картинки нет» и «места нет». Молчаливый пропуск выглядел бы как
 * недоделанный отчёт, а исключение записи из документа молча потеряло бы
 * правку заказчика. Тот же принцип, что у уехавших якорей.
 *
 * ── Масштабирование и обрезка ───────────────────────────────────────────────
 *
 * Кадр снят во всю ширину страницы и в натуральную величину; ужимается он
 * ЗДЕСЬ — только отчёт знает ширину своей колонки. Ужимается почти всегда
 * и примерно вдвое: окно рецензента шире печатной колонки. Текст на картинке
 * от этого мелкий, и это осознанный обмен — картинка отвечает на вопрос
 * «ГДЕ это на странице», а «что именно исправить» стоит строками «Было/Стало»
 * прямо под ней, набранными в полный размер.
 *
 * По вертикали показывается ПОЛОСА вокруг якоря, а не весь кадр: кадр во всю
 * ширину это секция целиком, и место правки занимает в ней малую часть.
 *
 * Метка лежит ВНУТРИ масштабируемого узла и едет вместе с картинкой одним
 * преобразованием — потому её геометрия и считается в пикселях НЕСЖАТОГО
 * кадра, в тех же, что полоса.
 */
function placeOf(entry: Entry, number: number, cutout: Cutout | null): string {
  if (cutout === null) {
    return `<p class="place--none">Показать это место картинкой не удалось. Ищите по адресу страницы и тексту ниже.</p>`
  }

  const scale = Math.min(1, COLUMN_PX / cutout.width)
  const round = (value: number): number => Math.round(value * 1000) / 1000
  // Коробка ростом с ПОЛОСУ, а не с кадром: кадр это секция целиком, и место
  // правки в ней занимает малую часть.
  const boxStyle = `width:${Math.round(cutout.width * scale)}px;height:${Math.round(cutout.band.h * scale)}px`
  // Порядок преобразований именно такой. `scale` идёт первым, `translate`
  // вторым: так сдвиг задаётся в пикселях НЕСЖАТОГО кадра — тех самых, в которых
  // посчитаны и полоса, и `anchorBox` метки, — и обе величины остаются в одной
  // системе координат. Поменяй порядок, и сдвиг пришлось бы делить на масштаб
  // в двух местах, а метка разъехалась бы с картинкой при первой же правке.
  const shotStyle =
    `width:${cutout.width}px;height:${cutout.height}px;` +
    `transform:scale(${round(scale)}) translateY(${round(-cutout.band.y)}px)`

  return [
    `<div class="place" style="${boxStyle}">`,
    `<div class="place__shot" style="${shotStyle}">`,
    cutout.html,
    markUp(entry, number, cutout),
    `</div>`,
    `</div>`,
  ].join('')
}

/** Одна запись документа. */
function entryBlock(input: ReportInput, entry: Entry): string {
  const number = input.numbers.get(entry.id) ?? 0
  const place = placeOf(entry, number, input.cutoutOf(entry.id))
  const rows: string[] = []

  if (entry.type === 'text-override') {
    rows.push(row('Было', entry.was))
    rows.push(row('Стало', plainHtml(entry.now, input.doc)))
  } else if (entry.type === 'style-wish') {
    rows.push(row('Текст', entry.was))
    rows.push(row('Оформление', styleWords(entry.style)))
    if (entry.now) rows.push(row('Замечание', plainHtml(entry.now, input.doc)))
  } else {
    rows.push(row('Здесь', entry.was))
    rows.push(row('Замечание', entry.now))
  }

  // Пожелание оформления у правки текста — ОТДЕЛЬНОЙ помеченной строкой.
  // Иначе оно утонет в разделе, про который документ говорит «сделают без вас».
  if (entry.type === 'text-override' && hasStyleWish(entry)) {
    rows.push(
      `<div class="row row--person"><div class="row__label">Требует решения</div>` +
        `<div class="row__value">Оформление: ${escapeHtml(styleWords(entry.style))}</div></div>`,
    )
  }

  return [
    `<article class="entry">`,
    `<div class="entry__no">${number}</div>`,
    `<div class="entry__body">`,
    place,
    `<div class="rows">${rows.join('')}</div>`,
    `</div>`,
    `</article>`,
  ].join('')
}

function row(label: string, value: string): string {
  return (
    `<div class="row"><div class="row__label">${escapeHtml(label)}</div>` +
    `<div class="row__value">${escapeHtml(value)}</div></div>`
  )
}

/**
 * Объяснение для случая, когда картинки нет НИ У ОДНОЙ записи.
 *
 * ── Почему это отдельная строка, а не шесть одинаковых пометок ──────────────
 *
 * Пометка «показать это место картинкой не удалось» задумана как честная
 * деградация ОТДЕЛЬНОЙ записи: заголовок поверх фотографии снять нечем, и текст
 * вместо картинки лучше пустого места. Но когда такая пометка стоит у каждой
 * записи подряд, документ перестаёт читаться как «вот эти четыре места
 * не снялись» и начинает читаться как «отчёт сломан». Проверено на живом
 * человеке: получив шесть таких пометок, он и решил, что кнопка не работает.
 *
 * ── Почему причина названа общо, а не одним точным словом ───────────────────
 *
 * Картинка берётся из двух источников: снятая в момент правки и снятая прямо
 * при сборке документа по живому элементу. Отсутствие обеих означает одно —
 * места этой правки на открытой сейчас странице не нашлось: она с другой
 * страницы, либо вёрстка там сменилась, либо снять его не удалось (заголовок
 * поверх фотографии самопроверка бракует намеренно). Разделить эти случаи
 * в записи нечем, и код врать не станет. Зато выход у них общий: открыть
 * ту страницу, где правка сделана, и напечатать отчёт оттуда.
 *
 * Строка появляется только при полном отсутствии картинок. Одна-две записи
 * без вырезки среди прочих — это штатная деградация, и объяснять её незачем.
 */
function noShots(): string {
  return (
    `<div class="callout callout--warn">` +
    `<b>В этом документе нет картинок мест.</b> Так бывает, когда все правки ` +
    `сделаны на других страницах прототипа, а также когда вёрстка на странице ` +
    `сменилась или показать место картинкой не удалось. Правки от этого ` +
    `не теряются — они все ниже, с адресом страницы и текстом. Чтобы картинки ` +
    `появились, откройте страницу, к которой относятся правки, и напечатайте ` +
    `отчёт с неё.` +
    `</div>`
  )
}

/** Раздел с группировкой по страницам. Пустой раздел не рисуется вовсе. */
function section(input: ReportInput, title: string, entries: readonly Entry[]): string {
  if (entries.length === 0) return ''

  const groups = groupByRoute(entries).map(
    (group) =>
      `<section class="page"><h3 class="page__route">${escapeHtml(group.route)}</h3>` +
      group.entries.map((entry) => entryBlock(input, entry)).join('') +
      `</section>`,
  )

  return `<section class="part"><h2 class="part__title">${escapeHtml(title)}</h2>${groups.join('')}</section>`
}

/**
 * Рамка с именем файла обмена.
 *
 * Это ЕДИНСТВЕННОЕ смягчение известного риска: менеджер отправляет
 * разработчику один читаемый документ, потому что тот выглядит достаточным,
 * — и применять правки становится нечем. Поэтому документ называет свой файл
 * по имени и говорит словами, откуда берутся правки.
 */
function callout(fileName: string | null): string {
  if (fileName === null) {
    return (
      `<div class="callout callout--warn">` +
      `<b>Файл с правками ещё не выгружен.</b> Откройте «Калька» на прототипе, ` +
      `нажмите «Экспорт» и отправьте скачанный файл вместе с этим документом: ` +
      `правки текста применяются из него, а не из этого документа.` +
      `</div>`
    )
  }

  return (
    `<div class="callout">` +
    `Правки текста применяются из файла <b>${escapeHtml(fileName)}</b> — ` +
    `отправьте его вместе с этим документом. Этот документ показывает, ` +
    `<i>что</i> и <i>где</i> исправить; сами правки берутся из файла.` +
    `</div>`
  )
}

/** Печатные стили документа. Внешних адресов нет: всё внутри. */
function styles(fontFaces: readonly string[]): string {
  return `<style>
${fontFaces.join('\n')}
/* Браузер по умолчанию не печатает фоны, и вырезка приехала бы белым листом. */
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@page { size: A4; margin: 16mm 14mm; }
body {
  margin: 0;
  font: 400 11pt/1.5 -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  color: #16181d;
  background: #fff;
}
.head { border-bottom: 2px solid #16181d; padding-bottom: 10px; margin-bottom: 14px; }
.head__title { margin: 0 0 6px; font-size: 17pt; }
.head__meta { margin: 0; color: #4a5160; font-size: 9.5pt; }
.head__meta span + span::before { content: " · "; }
.callout {
  border: 1px solid #16181d; border-left-width: 4px;
  padding: 9px 12px; margin: 0 0 18px; font-size: 10pt;
}
.callout--warn { border-color: #8a5a00; background: #fff6e5; }
.part { margin: 0 0 20px; break-inside: auto; }
.part__title {
  font-size: 13pt; margin: 0 0 4px;
  border-bottom: 1px solid #c9ced8; padding-bottom: 4px;
}
.page { margin: 12px 0 0; }
.page__route { font-size: 10pt; color: #4a5160; font-weight: 500; margin: 0 0 6px; }
/* Запись не разрывается между страницами: половина правки на развороте
   нечитаема, а искать её продолжение читатель не обязан. */
.entry { display: flex; gap: 10px; margin: 0 0 14px; break-inside: avoid; page-break-inside: avoid; }
.entry__no {
  flex: 0 0 26px; height: 26px; border-radius: 50%;
  background: #16181d; color: #fff; font-weight: 600; font-size: 11pt;
  display: flex; align-items: center; justify-content: center;
}
.entry__body { flex: 1 1 auto; min-width: 0; }
/* Кадр ужимается ЗДЕСЬ, а не при съёмке: только документ знает ширину своей
   колонки. Метка ужимается вместе с картинкой одним преобразованием. */
.place {
  position: relative; overflow: hidden; margin: 0 0 8px;
  border: 1px solid #c9ced8; border-radius: 4px; max-width: 100%;
}
.place__shot { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
.place--none {
  margin: 0 0 8px; padding: 7px 10px;
  border: 1px dashed #c9a24a; border-radius: 4px;
  color: #8a5a00; background: #fff6e5; font-size: 9.5pt;
}
.mark { position: absolute; box-sizing: border-box; }
.mark--rect { border: 2px solid #d92d20; border-radius: 3px; }
.mark--point {
  width: 20px; height: 20px; margin: -10px 0 0 -10px;
  border-radius: 50%; border: 2px solid #d92d20; background: rgba(217,45,32,.18);
}
.mark__no {
  position: absolute; top: -11px; left: -11px;
  min-width: 20px; height: 20px; border-radius: 10px;
  background: #d92d20; color: #fff; font: 600 10px/20px sans-serif;
  text-align: center; padding: 0 4px;
}
.rows { font-size: 10pt; }
.row { display: flex; gap: 8px; padding: 3px 0; border-top: 1px solid #eceef2; }
.row__label { flex: 0 0 104px; color: #4a5160; }
.row__value { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.row--person .row__label { color: #8a5a00; font-weight: 600; }
.row--person .row__value { color: #8a5a00; }
.empty { color: #4a5160; }
</style>`
}

/**
 * Собирает самодостаточный документ отчёта.
 *
 * `author` и имя файла обмена приходят ПАРАМЕТРАМИ: они живут в соседнем
 * слайсе того же слоя, импорт которого запрещён. Собирает их слой выше —
 * ровно тем же приёмом, каким `features/edit-text` передаёт готовый якорь
 * в `entities/entry`.
 *
 * В лог уходят только количества: ни текстов правок, ни адреса сайта, ни имени
 * автора — по образцу выгрузки.
 */
export function buildReport(input: ReportInput): string {
  const { entries } = input

  const forPerson = entries.filter(needsPerson)
  const forAgent = entries.filter((entry) => !needsPerson(entry))
  const withShot = entries.filter((entry) => input.cutoutOf(entry.id) !== null).length

  log.debug('сборка отчёта', {
    записей: entries.length,
    требуютРешения: forPerson.length,
    правокТекста: forAgent.length,
    сКартинкой: withShot,
    безКартинки: entries.length - withShot,
  })

  // Шрифтовые правила собираются со ВСЕХ вырезок и объявляются один раз:
  // повторённое на каждую вырезку правило раздуло бы документ, а браузер всё
  // равно применяет объявление один раз на документ.
  const fontFaces = [
    ...new Set(entries.flatMap((entry) => input.cutoutOf(entry.id)?.fontFaces ?? [])),
  ]

  // Имени рецензента в шапке нет: правки снимает один человек, различать
  // авторов незачем, и вопрос перед выгрузкой, ради которого имя собиралось,
  // из продукта убран.
  const meta = [`<span>${escapeHtml(input.site)}</span>`, `<span>${formatMoment(input.now)}</span>`]
  meta.push(
    `<span>${entries.length} ${plural(entries.length, 'правка', 'правки', 'правок')}, ` +
      `из них ${forPerson.length} ${plural(forPerson.length, 'требует', 'требуют', 'требуют')} решения</span>`,
  )

  const body = [
    `<div class="head">`,
    `<h1 class="head__title">Правки к прототипу</h1>`,
    `<p class="head__meta">${meta.join('')}</p>`,
    `</div>`,
    callout(input.fileName),
    // Только при ПОЛНОМ отсутствии картинок: одна-две записи без вырезки среди
    // прочих — штатная деградация, объяснять её незачем.
    entries.length > 0 && withShot === 0 ? noShots() : '',
    section(input, 'Требует решения', forPerson),
    section(input, 'Правки текста', forAgent),
    entries.length === 0 ? `<p class="empty">Правок нет.</p>` : '',
  ].join('')

  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Правки к прототипу</title>${styles(fontFaces)}</head><body>${body}</body></html>`

  log.info('отчёт собран', {
    записей: entries.length,
    требуютРешения: forPerson.length,
    правокТекста: forAgent.length,
    знаков: html.length,
  })

  return html
}
