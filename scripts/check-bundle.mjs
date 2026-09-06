/**
 * Четыре проверки выходного бандла. Любая непройденная роняет сборку.
 *
 * 1. FR-01  — в dist ровно один файл: подключение одной строкой <script>
 * 2. NFR-01 — не больше 100 КБ gzip
 * 3. NFR-03/04 — ни одного внешнего адреса: виджет ничего не грузит извне
 * 4. NFR-02 — react-dom не просочился транзитивной зависимостью
 * 5. rules/base.md — в продакшен-сборке нет ни одного вызова console
 */
import { gzipSync } from 'node:zlib'
import { readFileSync, readdirSync, statSync } from 'node:fs'

const DIST = 'dist'
const FILE = `${DIST}/kalka.js`
const LIMIT = 100 * 1024

/**
 * Пространства имён разметки — не загрузка ресурса, а строковые константы.
 * Ядро Preact содержит все три в основном пути отрисовки (проверено на 10.27.1),
 * они не вырезаются деревотрясением, и без этого исключения падала бы любая сборка.
 * Список закрытый: расширять его можно только под такие же строки-идентификаторы,
 * по которым браузер никуда не ходит.
 */
const NAMESPACES = /^https?:\/\/www\.w3\.org\//

const problems = []

const files = readdirSync(DIST)
if (files.length !== 1 || files[0] !== 'kalka.js') {
  problems.push(`в ${DIST}/ должен быть ровно один файл kalka.js, а лежит: ${files.join(', ')}`)
}

const code = readFileSync(FILE, 'utf8')
const raw = statSync(FILE).size
const gz = gzipSync(readFileSync(FILE)).length

console.log(
  `kalka.js: ${(raw / 1024).toFixed(1)} КБ → ${(gz / 1024).toFixed(1)} КБ gzip ` +
    `(${((gz / LIMIT) * 100).toFixed(1)}% бюджета)`,
)

if (gz > LIMIT) problems.push(`превышен бюджет: ${gz} > ${LIMIT} байт gzip`)

const urls = [...code.matchAll(/https?:\/\/[^\s'"`)]+/g)]
  .map((match) => match[0])
  .filter((url) => !NAMESPACES.test(url))

if (urls.length > 0) problems.push(`внешний адрес в бандле: ${urls[0]}`)

if (code.includes('react-dom')) problems.push('в бандле найден react-dom')

const call = code.match(/console\s*\.\s*[a-z]+/)
if (call) problems.push(`вызов console в продакшен-сборке: ${call[0]}`)

if (problems.length > 0) {
  for (const p of problems) console.error(`✗ ${p}`)
  process.exit(1)
}

console.log('✓ бандл соответствует ограничениям')
