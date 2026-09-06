/**
 * Каталог сайта для GitHub Pages.
 *
 * Собирается отдельно от dist/, а не поверх него: check-bundle.mjs требует,
 * чтобы в dist/ лежал ровно один файл kalka.js (FR-01, подключение одной
 * строкой). Положить index.html рядом с бандлом — уронить сборку.
 */
import { copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs'

const SITE = 'site'
const BUNDLE = 'dist/kalka.js'
const PAGE = 'scripts/site/index.html'

const bundle = statSync(BUNDLE, { throwIfNoEntry: false })

if (!bundle) {
  console.error(`✗ нет ${BUNDLE}: сначала npm run build`)
  process.exit(1)
}

rmSync(SITE, { recursive: true, force: true })
mkdirSync(SITE, { recursive: true })
copyFileSync(BUNDLE, `${SITE}/kalka.js`)
copyFileSync(PAGE, `${SITE}/index.html`)

console.log(`✓ ${SITE}/: kalka.js (${(bundle.size / 1024).toFixed(1)} КБ) и index.html`)
