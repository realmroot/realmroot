#!/usr/bin/env node

import { readFileSync } from 'node:fs'

const requestedConfigs = process.argv.slice(2).filter((argument) => argument !== '--')
const configs = requestedConfigs.length > 0 ? requestedConfigs : ['wrangler.toml']
const requiredSnippets = [
  'binding = "ASSETS"',
  'directory = "./dist/client"',
  'name = "EMAIL"',
  'binding = "ASSET_BUCKET"',
  'binding = "DB"',
  '[triggers]',
  'crons =',
]

for (const config of configs) {
  const content = readFileSync(config, 'utf8')

  for (const snippet of requiredSnippets) {
    if (!content.includes(snippet)) {
      throw new Error(`${config} is missing ${snippet}`)
    }
  }
}

console.log('Cloudflare config includes required Assets, Email, R2, D1, and Cron bindings.')
