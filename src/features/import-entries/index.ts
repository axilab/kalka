/* Публичный API слайса. Без `export *` — барели расходуют бюджет бандла. */
export { importFromFile } from './model/import'
export type { ImportOutcome } from './model/import'
export type { MergeReport } from './model/merge'
