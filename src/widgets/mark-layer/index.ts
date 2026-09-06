/*
 * Публичный API слайса «слой меток». Без `export *` — барели расходуют бюджет
 * бандла (NFR-01), и наружу выходит только действительно нужное.
 *
 * `ui/Marker` и `ui/CommentEditor` наружу не выходят: это внутренние части
 * слоя, и меняться они вправе свободно, пока публичный API стабилен.
 */
export { MarkLayer } from './ui/MarkLayer'
export type { MarkLayerProps } from './ui/MarkLayer'
