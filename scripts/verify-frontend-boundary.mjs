import fs from 'node:fs'
import path from 'node:path'
import { parseSync } from '@swc/core'

const sourceRoot = path.resolve('src')
const allowedServerImport = '@server/http/app'
const extensions = new Set(['.ts', '.tsx'])

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(absolute)
    return extensions.has(path.extname(entry.name)) && !entry.name.endsWith('.d.ts') ? [absolute] : []
  })
}

function importedModules(file) {
  const source = parseSync(fs.readFileSync(file, 'utf8'), {
    syntax: 'typescript',
    tsx: file.endsWith('.tsx'),
    dynamicImport: true,
  })
  const imports = []
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (
      ['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration'].includes(node.type) &&
      node.source?.value
    ) {
      imports.push(node.source.value)
    } else if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'Import' &&
      node.arguments?.[0]?.expression?.value
    ) {
      imports.push(node.arguments[0].expression.value)
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit)
      else visit(value)
    }
  }
  visit(source)
  return imports
}

const violations = []
for (const file of sourceFiles(sourceRoot)) {
  for (const specifier of importedModules(file)) {
    const targetsServer =
      specifier.startsWith('@server/') ||
      (specifier.startsWith('.') && path.resolve(path.dirname(file), specifier).startsWith(path.resolve('server')))
    if (targetsServer && specifier !== allowedServerImport) {
      violations.push(`${path.relative(process.cwd(), file)} -> ${specifier}`)
    }
  }
}

if (violations.length > 0) {
  console.error(`Frontend dependency boundary violations:\n${violations.join('\n')}`)
  process.exit(1)
}

console.log(`Frontend dependency boundary valid (${sourceFiles(sourceRoot).length} modules checked).`)
