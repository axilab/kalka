/*
 * Публичный API слайса «удаление правки с откатом».
 * Без `export *`: барели расходуют бюджет бандла (NFR-01).
 */
export {
  flushRemovals,
  pendingRemovals,
  removeWithUndo,
  subscribeRemovals,
  undoRemove,
} from './model/pending'
export type { PendingRemoval } from './model/pending'
