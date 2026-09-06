import path from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Порядок слоёв FSD сверху вниз. Модуль импортирует только из слоёв строго ниже
 * и не импортирует соседние слайсы своего слоя.
 */
const LAYERS = ['app', 'pages', 'widgets', 'features', 'entities', 'shared']

/** app и shared — одновременно слои и слайсы: внутри них импорт свободен. */
const SINGLE_SLICE = new Set(['app', 'shared'])

/** Слои со слайсами: наружу видна только точка входа слайса. */
const SLICED = LAYERS.filter((l) => !SINGLE_SLICE.has(l))

const SRC = fileURLToPath(new URL('./src', import.meta.url))

function locate(filename) {
  const relative = path.relative(SRC, filename)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null

  const [layer, slice] = relative.split(path.sep)
  if (!LAYERS.includes(layer)) return null

  return {
    layer,
    slice: SINGLE_SLICE.has(layer) ? layer : slice,
  }
}

function restrictionsFor(layer) {
  const index = LAYERS.indexOf(layer)
  const above = LAYERS.slice(0, index)
  const patterns = above.map((l) => ({
    group: [`${l}`, `${l}/**`],
    message: `Импорт вверх по слоям запрещён: ${layer} не знает о ${l} (ARCHITECTURE.md).`,
  }))

  if (!SINGLE_SLICE.has(layer)) {
    patterns.push({
      group: [`${layer}/**`],
      message: `Слайсы одного слоя не импортируют друг друга: общаться через хранилище (ARCHITECTURE.md).`,
    })
  }

  for (const l of SLICED) {
    if (l === layer) continue
    patterns.push({
      group: [`${l}/*/**`],
      message: `Обращение внутрь слайса в обход index.ts запрещено: импортируйте из ${l}/<слайс>.`,
    })
  }

  return patterns
}

/**
 * `no-restricted-imports` видит текст спецификатора, но относительный путь
 * `../../review-mode` не знает ни о слоях, ни о слайсах. Это правило разрешает
 * относительные импорты только внутри текущего слайса. Между слоями и слайсами
 * используются алиасы, которые проверяет `no-restricted-imports` выше.
 */
const kalka = {
  rules: {
    'relative-inside-boundary': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          outside:
            'Относительный импорт вышел за границу слайса: используйте публичный API и алиас слоя (ARCHITECTURE.md).',
        },
      },
      create(context) {
        const from = locate(context.filename ?? context.getFilename())

        function check(node) {
          const specifier = node.source?.value
          if (!from || typeof specifier !== 'string' || !specifier.startsWith('.')) return

          const filename = context.filename ?? context.getFilename()
          const target = locate(path.resolve(path.dirname(filename), specifier))
          const sameBoundary =
            target !== null && target.layer === from.layer && target.slice === from.slice

          if (!sameBoundary) {
            context.report({ node: node.source, messageId: 'outside' })
          }
        }

        return {
          ImportDeclaration: check,
          ExportNamedDeclaration: check,
          ExportAllDeclaration: check,
          ImportExpression: check,
        }
      },
    },
  },
}

export default tseslint.config(
  {
    // Вне проверки: артефакты сборки, зависимости, дев-стенд и инструментарий.
    // `.claude/**` и `.codex/**` — вендоренные пакеты навыков: чужой код вне FSD.
    // `.playwright-mcp/**` — черновики разведочных гейтов: папка в `.gitignore`,
    // то есть в репозитории её нет, а `eslint .` у того, кто гейт запускал,
    // без этой строки падает на чужом одноразовом скрипте.
    ignores: [
      'dist/**',
      'site/**',
      'node_modules/**',
      'dev/**',
      'scripts/**',
      '.claude/**',
      '.codex/**',
      '.playwright-mcp/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Сам конфиг — не код виджета. Единственная глобаль, которой он пользуется.
    files: ['eslint.config.js'],
    languageOptions: { globals: { URL: 'readonly' } },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { kalka },
    rules: {
      'kalka/relative-inside-boundary': 'error',
      'no-console': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Виджет ничего не отправляет наружу (NFR-03).' },
        { name: 'XMLHttpRequest', message: 'Виджет ничего не отправляет наружу (NFR-03).' },
        { name: 'WebSocket', message: 'Виджет ничего не отправляет наружу (NFR-03).' },
        { name: 'EventSource', message: 'Виджет ничего не отправляет наружу (NFR-03).' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'navigator',
          property: 'sendBeacon',
          message: 'Виджет ничего не отправляет наружу (NFR-03).',
        },
        {
          object: 'window',
          property: 'fetch',
          message: 'Виджет ничего не отправляет наружу (NFR-03).',
        },
      ],
    },
  },
  ...LAYERS.map((layer) => ({
    files: [`src/${layer}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': ['error', { patterns: restrictionsFor(layer) }],
    },
  })),
  {
    // Единственное место, где console разрешён: он и есть логгер.
    files: ['src/shared/lib/log.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['src/**/*.test.{ts,tsx}'],
    rules: { 'no-console': 'off' },
  },
)
