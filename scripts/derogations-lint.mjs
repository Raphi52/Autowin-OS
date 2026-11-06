#!/usr/bin/env node
/*
 * Mesure les DÉROGATIONS au linter : combien de commentaires `eslint-disable` par règle, et combien
 * d'alertes ils cachent vraiment, fichier par fichier (ESLint rejoué en ignorant les commentaires).
 *
 * Pourquoi (conv-1654, 06/11/2026) : compter les `eslint-disable` à la main sous-estime le problème.
 * Deux fichiers (ChatView.tsx, chat-view-mosaique.tsx) coupent quatre règles pour TOUT le fichier
 * en un seul commentaire : 47 dérogations React comptées, 82 alertes réellement cachées. Ce script
 * donne le chiffre avant/après d'un nettoyage, sans refaire le grep et le JSON d'ESLint à la main.
 *
 * Usage :
 *   node scripts/derogations-lint.mjs                       # toutes les règles, tout src/
 *   node scripts/derogations-lint.mjs --regle react-hooks/  # règles qui commencent par ce préfixe
 *   node scripts/derogations-lint.mjs --regle react-hooks/ src/renderer/src/App.tsx ...
 *   node scripts/derogations-lint.mjs --json                # sortie machine
 * Sortie 0 quand la mesure a pu se faire (même s'il reste des alertes cachées), 1 sinon.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { ESLint } from 'eslint'

const RACINE = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '..'
)

export function lireArguments(argv) {
  const options = { regle: '', json: false, fichiers: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') options.json = true
    else if (a === '--regle') options.regle = argv[++i] ?? ''
    else options.fichiers.push(a)
  }
  return options
}

/** Règles nommées dans un commentaire `eslint-disable…` (la justification après « -- » est ignorée). */
export function reglesDuCommentaire(ligne) {
  // Ancré sur le début du commentaire : « on a retiré le eslint-disable qui… » n'est pas une dérogation.
  const m = /(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?\b([^*\n]*)/.exec(ligne)
  if (!m) return []
  const corps = m[1].split(/\s--\s|\s--$/)[0].replace(/\*\/.*$/, '')
  return corps
    .split(',')
    .map((r) => r.trim().split(/\s+/)[0])
    .filter((r) => /^[@a-z][\w@/-]*$/.test(r))
}

function grepDerogations(regle, fichiers) {
  const args = ['grep', '-n', '--untracked', '-E', 'eslint-disable', '--']
  args.push(...(fichiers.length ? fichiers : ['src']))
  let sortie = ''
  try {
    sortie = execFileSync('git', args, {
      cwd: RACINE,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    })
  } catch (e) {
    if (e.status === 1) return [] // aucun résultat
    throw e
  }
  const lignes = []
  for (const brut of sortie.split('\n')) {
    const m = /^([^:]+):(\d+):(.*)$/.exec(brut)
    if (!m) continue
    for (const r of reglesDuCommentaire(m[3])) {
      if (!regle || r.startsWith(regle))
        lignes.push({ fichier: m[1], ligne: Number(m[2]), regle: r })
    }
  }
  return lignes
}

async function main() {
  const options = lireArguments(process.argv.slice(2))
  const derogations = grepDerogations(options.regle, options.fichiers)
  const parRegle = {}
  for (const d of derogations) parRegle[d.regle] = (parRegle[d.regle] ?? 0) + 1

  const cibles = options.fichiers.length
    ? options.fichiers
    : [...new Set(derogations.map((d) => d.fichier))].filter((f) => /\.(m?[jt]sx?)$/.test(f))
  const cachees = {}
  const cacheesParRegle = {}
  let total = 0
  if (cibles.length) {
    const eslint = new ESLint({ cwd: RACINE, allowInlineConfig: false })
    for (const resultat of await eslint.lintFiles(cibles)) {
      const rel = path.relative(RACINE, resultat.filePath).replaceAll('\\', '/')
      for (const m of resultat.messages) {
        if (!m.ruleId || (options.regle && !m.ruleId.startsWith(options.regle))) continue
        cachees[rel] ??= {}
        cachees[rel][m.ruleId] = (cachees[rel][m.ruleId] ?? 0) + 1
        cacheesParRegle[m.ruleId] = (cacheesParRegle[m.ruleId] ?? 0) + 1
        total++
      }
    }
  }

  const rapport = {
    regle: options.regle || '(toutes)',
    commentaires: derogations.length,
    commentairesParRegle: parRegle,
    alertesCachees: total,
    alertesCacheesParRegle: cacheesParRegle,
    parFichier: cachees
  }
  if (options.json) {
    process.stdout.write(JSON.stringify(rapport, null, 2) + '\n')
    return
  }
  const trier = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])
  console.log(`Règle : ${rapport.regle}`)
  console.log(`Commentaires eslint-disable : ${rapport.commentaires}`)
  for (const [r, n] of trier(parRegle)) console.log(`  ${String(n).padStart(4)}  ${r}`)
  console.log(`Alertes réellement cachées (ESLint sans les commentaires) : ${total}`)
  for (const [r, n] of trier(cacheesParRegle)) console.log(`  ${String(n).padStart(4)}  ${r}`)
  console.log('Par fichier :')
  const fichiersTries = Object.entries(cachees)
    .map(([f, regles]) => [f, Object.values(regles).reduce((s, n) => s + n, 0), regles])
    .sort((a, b) => b[1] - a[1])
  for (const [f, n, regles] of fichiersTries) {
    const detail = trier(regles)
      .map(([r, k]) => `${r.replace(/^react-hooks\//, '')} ${k}`)
      .join(', ')
    console.log(`  ${String(n).padStart(4)}  ${f}  (${detail})`)
  }
}

const lanceDirectement =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(RACINE, 'scripts/derogations-lint.mjs')
if (lanceDirectement) {
  main().catch((e) => {
    console.error(e?.stack ?? String(e))
    process.exit(1)
  })
}
