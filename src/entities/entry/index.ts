/*
 * Публичный API слайса «запись». Без `export *` — барели расходуют бюджет
 * бандла (NFR-01), и наружу выходит только действительно нужное.
 */
export { entryStore } from './model/store'
export type { EntryState } from './model/store'
export { sanitizeHtml } from './model/sanitize'
// `agentFieldsPlaceholder` наружу НЕ выходит: у неё остался единственный
// вызывающий — внутренний `model/read.ts`, дозаполняющий записи, снятые
// до вехи «Машиночитаемость». Оставленный экспорт был бы приглашением новому
// создателю записи взять заглушку вместо измерения (решение 13).
// Сквозная нумерация метка↔запись. Производная от порядка в хранилище,
// поэтому живёт здесь: оба виджета-потребителя лежат в одном слое и друг друга
// не импортируют (см. шапку `model/number.ts`).
export { numbering } from './model/number'
// Раскладка «запись → инструмент». Производная от типа и геометрии, поэтому
// живёт здесь: потребителей два, и оба в `widgets` (см. шапку `model/tool.ts`).
export { toolOf } from './model/tool'
export { createCommentEntry } from './model/draft'
export type { CommentEntryInput, CommentGeometry } from './model/draft'
export { flushPersist, restoreEntries, startPersist } from './model/persist'
// `read.ts` наружу НЕ выходит: это внутренняя деталь слайса, и потребители
// работают через `parseSnapshot` и `parseExchangeFile`.
export { parseExchangeFile } from './model/parse'
export type { ImportedFile, ImportRejection } from './model/parse'
// Классификация исхода проверки (FR-35). Проход по странице живёт слоем выше,
// в `features/verify-applied`: ему нужны оба entities сразу.
export { classifyArrival, plainHtml, plainNow } from './model/verify'
// ABOUT наружу НЕ выходит: шапка файла обмена — деталь его сборки.
// `styleWords` и `plainHtml` выходят: печатный отчёт показывает пожелание
// оформления словами и снимает разметку с «стало» тем же единственным разбором.
export { buildExchangeFile, styleWords, toJsonText } from './model/serialize'
export type { ExchangeInput } from './model/serialize'
