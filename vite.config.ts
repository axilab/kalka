/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

const src = (layer: string) => fileURLToPath(new URL(`./src/${layer}`, import.meta.url))

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      app: src('app'),
      pages: src('pages'),
      widgets: src('widgets'),
      features: src('features'),
      entities: src('entities'),
      shared: src('shared'),
    },
  },
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    lib: {
      // Отклонение от kalka-overlay-widget/references/build.md, где показан
      // entry: 'src/index.ts'. Точка входа проекта — src/app/index.ts
      // (.ai-factory/ARCHITECTURE.md, «Структура папок»: app/index.ts —
      // точка входа бандла). Побеждает ARCHITECTURE.md: она описывает
      // именно этот проект.
      entry: fileURLToPath(new URL('./src/app/index.ts', import.meta.url)),
      name: 'Kalka',
      formats: ['iife'],
      fileName: () => 'kalka.js',
    },
    cssCodeSplit: false,
    target: 'es2020',
    minify: 'esbuild',
    rollupOptions: {
      // external не задаётся вовсе: Preact обязан оказаться внутри бандла (NFR-02).
      output: { inlineDynamicImports: true },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    // Node 26 перекрывает веб-хранилище jsdom собственными экспериментальными
    // глобалями: localStorage становится undefined, а Storage и sessionStorage
    // оказываются разных классов. Оснастка ставит одну согласованную реализацию.
    setupFiles: ['./vitest.setup.ts'],
    // Обязательно. По умолчанию Vitest подменяет любой CSS пустой строкой —
    // суффикс ?inline от этого не спасает. Без css: true в тесты монтирования
    // (фаза 2, задача 11) приходит пустой host.css, и проверка изоляции
    // превращается в проверку пустоты.
    css: true,
  },
})
