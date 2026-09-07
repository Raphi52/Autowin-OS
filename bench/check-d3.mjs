#!/usr/bin/env node
/**
 * CRITERE BINAIRE — D3 : `ChatComposer.tsx` ecrit un ref PENDANT le rendu (ligne 295) et
 * appelle deux fonctions en rendu (449, 474). 3 erreurs react-hooks/refs qui rendent
 * `npm run lint`, donc `npm test`, rouge.
 *
 * Usage : node bench/check-d3.mjs <racine du depot a verifier>
 * Exit 0 = CRITERE ATTEINT · 1 = non atteint · 2 = cible invalide.
 *
 * Pourquoi ces gardes et pas seulement « eslint passe » : une directive de desactivation
 * eteint le message sans rien corriger au rendu (G2), et supprimer le reglage de volume
 * ferait passer eslint en retirant la fonction (G3). G4 rejoue les tests du composant :
 * un correctif qui casse la dictee ou la jauge ne compte pas.
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const cible = path.resolve(process.argv[2] || process.cwd())
const FICHIER = 'src/renderer/src/components/ChatComposer.tsx'
const TESTS = [
  'src/renderer/src/components/ChatComposer.dictee.test.tsx',
  'src/renderer/src/components/ChatComposer.jauge-contexte.test.tsx'
]
const ESC = String.fromCharCode(27)
const sansCouleur = (t) => t.split(ESC).map((m, i) => (i === 0 ? m : m.replace(/^.[0-9;]*m/, ''))).join('')
const resultats = []
const garde = (nom, fn) => {
  try {
    const d = fn()
    resultats.push({ nom, ok: d === true, detail: d === true ? 'ok' : String(d) })
  } catch (e) {
    resultats.push({ nom, ok: false, detail: e.message })
  }
}

if (!existsSync(path.join(cible, FICHIER))) {
  console.log(`RATE cible invalide : ${FICHIER} absent de ${cible}`)
  process.exit(2)
}
const src = readFileSync(path.join(cible, FICHIER), 'utf8')

garde('G1 eslint est propre sur ChatComposer.tsx (exit 0)', () => {
  const r = spawnSync('npx', ['eslint', '--no-cache', FICHIER], {
    cwd: cible,
    encoding: 'utf8',
    shell: true,
    timeout: 600000
  })
  if (r.status === 0) return true
  const sortie = sansCouleur(`${r.stdout || ''}${r.stderr || ''}`)
  const erreurs = sortie.split('\n').filter((l) => /\berror\b/.test(l))
  return `exit ${r.status} — ${erreurs.length} ligne(s) en erreur : ${erreurs.slice(0, 3).join(' | ').trim().slice(0, 300)}`
})

garde('G2 aucune desactivation de regle ajoutee', () => {
  const trouve = []
  if (/eslint-disable/.test(src)) trouve.push('directive eslint-disable')
  if (/@ts-(ignore|expect-error|nocheck)/.test(src)) trouve.push('directive TypeScript de contournement')
  if (/react-hooks\/refs/.test(src)) trouve.push('mention explicite de la regle react-hooks/refs')
  return trouve.length === 0 ? true : `le message est eteint, pas corrige : ${trouve.join(', ')}`
})

garde('G3 le reglage de volume vit toujours (le ref est encore lu)', () => {
  if (!/dicteeGainRef/.test(src)) return 'dicteeGainRef a disparu : la fonction a ete retiree, pas reparee'
  if (!/dicteeGainRef\.current/.test(src)) return 'dicteeGainRef n est plus lu nulle part'
  const ecritures = (src.match(/dicteeGainRef\.current\s*=/g) || []).length
  if (ecritures === 0) return 'dicteeGainRef n est plus jamais mis a jour : le volume ne suivra plus le curseur'
  if (!/useEffect\(/.test(src)) return 'plus aucun useEffect dans le fichier'
  return true
})

garde('G4 les tests du composant restent verts (exit 0)', () => {
  const r = spawnSync('npx', ['vitest', 'run', ...TESTS], {
    cwd: cible,
    encoding: 'utf8',
    shell: true,
    timeout: 900000
  })
  if (r.status === 0) return true
  const sortie = sansCouleur(`${r.stdout || ''}${r.stderr || ''}`)
  const echec = sortie.split('\n').find((l) => /FAIL|AssertionError/.test(l)) || `exit ${r.status}`
  return `exit ${r.status} — ${echec.trim().slice(0, 200)}`
})

const ok = resultats.every((x) => x.ok)
for (const x of resultats) console.log(`${x.ok ? 'OK  ' : 'RATE'} ${x.nom} — ${x.detail}`)
console.log(ok ? 'CRITERE ATTEINT' : 'CRITERE NON ATTEINT')
process.exit(ok ? 0 : 1)
