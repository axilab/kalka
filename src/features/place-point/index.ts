/*
 * Публичный API слайса «указатель». Без `export *` — барели расходуют бюджет
 * бандла (NFR-01), и наружу выходит только действительно нужное.
 */
export { usePlacePoint } from './model/tool'
export type { PlacePointTool } from './model/tool'
