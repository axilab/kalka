/*
 * Публичный API слайса «вырезка» — снимка места правки для печатного отчёта.
 * Без `export *`: барели расходуют бюджет бандла (NFR-01).
 */
export { buildCutout } from './model/build'
export type { CutoutInput } from './model/build'
export { cutoutBuffer } from './model/buffer'
// `makeCutout` наружу выходит ради отчёта: он доснимает место правки в момент
// печати, синхронно и мимо буфера. `captureCutout` — та же съёмка, отложенная
// и с записью в буфер.
export { captureCutout, makeCutout } from './model/capture'
export type { CaptureInput, MakeCutoutInput } from './model/capture'
export { checkCutout } from './model/check'
export type { CutoutCheck } from './model/check'
