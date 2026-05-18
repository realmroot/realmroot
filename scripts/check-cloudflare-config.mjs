#!/usr/bin/env node

import { readFileSync } from 'node:fs'

const configs = ['wrangler.toml', 'wrangler.preview.toml']
const requiredSnippets = [
  'binding = "ASSETS"',
  'directory = "./dist/client"',
  'name = "EMAIL"',
  'binding = "ASSET_BUCKET"',
  'binding = "DB"',
  'binding = "EMAIL_QUEUE"',
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

console.log('Cloudflare config includes required Assets, Email, R2, D1, Queue, and Cron bindings.')
