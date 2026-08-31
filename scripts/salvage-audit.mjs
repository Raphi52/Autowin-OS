#!/usr/bin/env node
// Oracle de salvage : aucune branche locale ne doit porter du contenu absent de main
// sans decision tracee dans le registre docs/salvage/registre.md.
// Exit 0 = tout est soit fusionne, soit explicitement statue. Exit 1 = du travail est orphelin.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const REGISTRE = 'docs/salvage/registre.md'
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()

const base = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'main'

const branches = git('for-each-ref', '--format=%(refname:short)', 'refs/heads')
  .split('\n').filter(Boolean).filter((b) => b !== base)

const registre = existsSync(REGISTRE) ? readFileSync(REGISTRE, 'utf8') : ''

const orphelines = []
for (const b of branches) {
  const ahead = Number(git('rev-list', '--count', `${base}..${b}`))
  if (ahead === 0) continue
  const diff = git('diff', '--shortstat', `${base}...${b}`)
  if (!diff) continue // commits sans contenu propre : deja represente sur main
  if (registre.includes(b)) continue // decision tracee
  orphelines.push({ branche: b, ahead, diff })
}

const rapport = { base, branches: branches.length, orphelines }
console.log(JSON.stringify(rapport, null, 2))
if (orphelines.length > 0) {
  console.error(`\nECHEC : ${orphelines.length} branche(s) portent du travail absent de ${base} et non statue.`)
  process.exit(1)
}
console.error(`\nOK : rien d'orphelin. ${branches.length} branches examinees.`)
