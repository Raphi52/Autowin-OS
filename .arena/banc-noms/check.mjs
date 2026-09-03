#!/usr/bin/env node
/**
 * Critère du banc /arena « noms des fichiers du banc ».
 * Usage : node check.mjs <racine-du-depot>
 * Exit 0 = critère atteint · 1 = au moins une assertion RATE.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const racine = process.argv[2] ?? '.'
const cible = path.join(racine, 'skills', 'arena', 'SKILL.md')
const md = existsSync(cible) ? readFileSync(cible, 'utf8') : null

let rates = 0
const check = (libelle, fn) => {
  let ok = false
  let detail = ''
  try {
    const r = fn()
    ok = r === true
    if (!ok) detail = ` — ${r}`
  } catch (e) {
    detail = ` — assertion en erreur : ${e.message}`
  }
  if (!ok) rates++
  console.log(`${ok ? 'OK  ' : 'RATE'} ${libelle}${detail}`)
}

const NOMS = {
  'tache.txt': /tache\.txt/,
  'check.mjs': /check\.mjs/,
  'prompt-<bras>.txt': /prompt-(?:<bras>|\{bras\}|a)\.txt/,
  'out-<bras>.json': /out-(?:<bras>|\{bras\}|a)\.json/,
  'out-judge.json': /out-judge\.json/
}

check('nominal : SKILL.md nomme les 5 fichiers du banc attendus par le contrôle', () => {
  if (!md) return `${cible} introuvable`
  const manquants = Object.entries(NOMS)
    .filter(([, re]) => !re.test(md))
    .map(([n]) => n)
  return manquants.length ? `absents de SKILL.md : ${manquants.join(', ')}` : true
})

check('cas limite — SKILL.md vide ou introuvable : le critère doit refuser, pas passer', () => {
  if (!md) return `${cible} introuvable : refus`
  if (md.trim().length < 200) return 'SKILL.md vide ou tronqué : refus'
  return true
})

check('cas limite — nom voisin invalide interdit (tache.md, check.js, out-judge.txt, prompt-a.md)', () => {
  if (!md) return 'SKILL.md introuvable'
  const fautifs = [/tache\.md/, /\bcheck\.js\b/, /out-judge\.txt/, /prompt-a\.md/, /out-a\.txt/]
    .filter((re) => re.test(md))
    .map((re) => String(re))
  return fautifs.length ? `variantes fautives présentes : ${fautifs.join(', ')}` : true
})

check('cas limite — zéro nom dans la section du contrôle de protocole : liste hors sujet refusée', () => {
  if (!md) return 'SKILL.md introuvable'
  const i = md.search(/^#{2,4}\s*6\.\s/m)
  if (i < 0) return 'section « 6. Contrôle du protocole » introuvable'
  const reste = md.slice(i)
  const fin = reste.search(/\n#{2}\s/)
  const bloc = fin < 0 ? reste : reste.slice(0, fin)
  const dedans = Object.entries(NOMS).filter(([, re]) => re.test(bloc)).length
  return dedans >= 4 ? true : `${dedans} nom(s) sur 5 dans la section du contrôle, 4 minimum`
})

console.log(rates === 0 ? '\nCRITÈRE ATTEINT' : `\nCRITÈRE NON ATTEINT (${rates} RATE)`)
process.exit(rates === 0 ? 0 : 1)
