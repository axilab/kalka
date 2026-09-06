/*
 * Идентификатор записи файла обмена.
 *
 * Криптостойкость к нему НЕ предъявляется: `id` нужен ровно для того, чтобы
 * различать записи внутри одного файла и находить свой элемент по метке
 * `data-kalka-applied`. Ни секретом, ни ключом он не является, наружу не уходит
 * (NFR-03) и на права ничего не даёт.
 *
 * Длина — восемь шестнадцатеричных символов, по примеру из раздела 9 PRD.
 * Этого достаточно: записей в файле десятки, а не миллионы.
 */

/** Счётчик запасного пути: делает соседние идентификаторы различимыми. */
let fallbackCounter = 0

/** Восемь шестнадцатеричных символов из crypto, если он есть. */
function fromCrypto(): string | null {
  // `crypto` может отсутствовать на странице, отданной по http: виджет обязан
  // работать и там — прототипы нередко живут на внутреннем стенде без TLS.
  const source = typeof crypto === 'undefined' ? undefined : crypto
  if (!source || typeof source.getRandomValues !== 'function') return null

  const bytes = new Uint8Array(4)
  source.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Запасной путь: время плюс счётчик, той же длины и того же алфавита. */
function fromCounter(): string {
  fallbackCounter += 1
  const mixed = (Date.now() + fallbackCounter * 0x9e3779b1) >>> 0
  return mixed.toString(16).padStart(8, '0').slice(-8)
}

export function createId(): string {
  return fromCrypto() ?? fromCounter()
}
