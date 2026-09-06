/* Публичный API слайса. Без `export *` — барели расходуют бюджет бандла. */
export { exportEntries } from './model/export'
// Имя файла обмена нужно печатному отчёту: документ называет свой файл, чтобы
// пара не разошлась в переписке. Собирает его слой выше — соседний слайс
// `features/print-report` импортировать нас не может.
export { exportFileName } from './model/name'
export { startUnsavedGuard } from './model/warn'
