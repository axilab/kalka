/*
 * Публичный API слайса «печатный отчёт». Без `export *` — барели расходуют
 * бюджет бандла (NFR-01).
 */
export { buildReport } from './model/report'
// Сбор картинок мест: буфер, а где его нет — съёмка по живому элементу.
// Разом на весь набор, по одной съёмке на запись: обоснование — в шапке
// `collect.ts`.
export { collectCutouts, cutoutFor } from './model/collect'
// Срок жизни чернового буфера вырезок: сбор сирот перед печатью и очистка
// при первом изменении набора после неё. Обоснование — в шапке `cleanup.ts`.
export { armCutoutCleanupAfterPrint, sweepOrphanCutouts } from './model/cleanup'
export type { ReportInput } from './model/report'
