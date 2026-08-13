import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = fileURLToPath(new URL('..', import.meta.url))
const skillsDirectory = path.join(root, 'skills')
const outputDirectory = path.join(root, 'public', '.well-known', 'agent-skills')
const indexPath = path.join(outputDirectory, 'index.json')
const check = process.argv.includes('--check')

const artifacts = readdirSync(skillsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(path.join(skillsDirectory, entry.name, 'SKILL.md')))
  .map((entry) => buildSkillArtifact(entry.name))
  .sort((left, right) => left.name.localeCompare(right.name))
const index = Buffer.from(
  `${JSON.stringify(
    {
      $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
      skills: artifacts.map(({ name, description, digest }) => ({
        name,
        type: 'archive',
        description,
        url: `/.well-known/agent-skills/${name}.tar.gz`,
        digest: `sha256:${digest}`,
      })),
    },
    null,
    2,
  )}\n`,
)

if (check) {
  for (const artifact of artifacts) assertCurrent(artifact.path, artifact.archive)
  assertCurrent(indexPath, index)
} else {
  mkdirSync(outputDirectory, { recursive: true })
  for (const artifact of artifacts) writeFileSync(artifact.path, artifact.archive)
  writeFileSync(indexPath, index)
}

function buildSkillArtifact(directoryName) {
  const skillDirectory = path.join(skillsDirectory, directoryName)
  const metadata = parseFrontmatter(readFileSync(path.join(skillDirectory, 'SKILL.md'), 'utf8'), directoryName)
  if (metadata.name !== directoryName) {
    throw new Error(`skills/${directoryName}/SKILL.md name must match its directory.`)
  }
  const archive = gzipSync(
    createTar(
      listFiles(skillDirectory).map((name) => ({ name, bytes: readFileSync(path.join(skillDirectory, name)) })),
    ),
    { level: 9, mtime: 0 },
  )
  archive[9] = 255
  return {
    ...metadata,
    archive,
    digest: createHash('sha256').update(archive).digest('hex'),
    path: path.join(outputDirectory, `${metadata.name}.tar.gz`),
  }
}

function listFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name
      return entry.isDirectory() ? listFiles(path.join(directory, entry.name), name) : [name]
    })
    .sort()
}

function parseFrontmatter(markdown, directoryName) {
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---\n/)
  if (!frontmatter) throw new Error(`skills/${directoryName}/SKILL.md must start with YAML frontmatter.`)
  const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1]?.trim()
  const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim()
  if (!name || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name) || name.includes('--')) {
    throw new Error('Realmroot Skill name does not conform to the Agent Skills specification.')
  }
  if (!description || description.length > 1024) {
    throw new Error('Realmroot Skill description must contain 1 to 1024 characters.')
  }
  return { name, description }
}

function createTar(files) {
  const blocks = []
  for (const file of files) {
    const header = Buffer.alloc(512)
    writeString(header, 0, 100, file.name)
    writeOctal(header, 100, 8, 0o644)
    writeOctal(header, 108, 8, 0)
    writeOctal(header, 116, 8, 0)
    writeOctal(header, 124, 12, file.bytes.length)
    writeOctal(header, 136, 12, 0)
    header.fill(0x20, 148, 156)
    header[156] = '0'.charCodeAt(0)
    writeString(header, 257, 6, 'ustar')
    writeString(header, 263, 2, '00')
    const checksum = header.reduce((total, byte) => total + byte, 0)
    const checksumText = checksum.toString(8).padStart(6, '0')
    header.write(checksumText, 148, 6, 'ascii')
    header[154] = 0
    header[155] = 0x20
    blocks.push(header, file.bytes)
    const padding = (512 - (file.bytes.length % 512)) % 512
    if (padding) blocks.push(Buffer.alloc(padding))
  }
  blocks.push(Buffer.alloc(1024))
  return Buffer.concat(blocks)
}

function writeString(buffer, offset, length, value) {
  const bytes = Buffer.from(value)
  if (bytes.length > length) throw new Error(`Tar field is too long: ${value}`)
  bytes.copy(buffer, offset)
}

function writeOctal(buffer, offset, length, value) {
  buffer.write(value.toString(8).padStart(length - 1, '0'), offset, length - 1, 'ascii')
  buffer[offset + length - 1] = 0
}

function assertCurrent(file, expected) {
  if (!existsSync(file) || !readFileSync(file).equals(expected)) {
    throw new Error(`${path.relative(root, file)} is stale. Run pnpm run build:skills.`)
  }
}
