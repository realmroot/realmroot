import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
let worktree = process.cwd()
const excluded = []
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--worktree' && args[index + 1]) worktree = resolve(args[++index])
  else if (args[index] === '--exclude' && args[index + 1]) excluded.push(args[++index].replace(/\/$/, ''))
  else throw new Error(`Unknown or incomplete argument: ${args[index]}`)
}

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
  cwd: worktree,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean)
  .filter((path) => !excluded.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)))
  .sort()

const digest = createHash('sha256')
for (const path of files) {
  const contentHash = createHash('sha256')
    .update(await readFile(resolve(worktree, path)))
    .digest('hex')
  digest.update(path).update('\0').update(contentHash).update('\0')
}
process.stdout.write(`${digest.digest('hex')}\n`)
