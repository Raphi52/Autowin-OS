#!/usr/bin/env node
/**
 * Critère du banc /arena « couleurs » — défaut : l'écran d'attente du lanceur dev
 * (`scripts/launch_dev_splash.py`, doré/violet) et l'écran de démarrage de l'app
 * (`src/renderer/index.html`, rose/orange depuis 08016aac) ont divergé, et le contrôle
 * censé l'empêcher recopie les hexadécimaux à la main.
 *
 * Usage : node check.mjs <racine-de-la-copie>
 * Exit 0 = critère atteint · 1 = au moins une assertion RATE.
 *
 * Le SENS de la convergence est libre (aligner l'app sur le lanceur ou l'inverse) : (b) relit
 * les valeurs dans le lanceur, quelles qu'elles soient. (c) refuse qu'un bras vide le contrôle.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const racine = path.resolve(process.argv[2] ?? '.')
const VERIFIE_MIN = 111
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
const lire = (rel) => {
  const p = path.join(racine, rel)
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

check('(a) le contrôle Python des phases du lanceur sort 0', () => {
  const f = path.join(racine, 'scripts', 'launch_dev_phases_test.py')
  if (!existsSync(f)) return `${f} introuvable — un contrôle supprimé n'est pas un contrôle vert`
  const r = spawnSync('py', ['-3', f], { cwd: racine, encoding: 'utf8', timeout: 300000, maxBuffer: 20 * 1024 * 1024 })
  if (r.status === 0) return true
  const sortie = String(r.stdout || '') + String(r.stderr || '')
  const fails = sortie.split('\n').filter((l) => l.includes('FAIL')).slice(0, 3).join(' | ')
  return `exit ${r.status} : ${fails || sortie.trim().slice(-200)}`
})

check('(b) les deux écrans partagent la palette : les accents du lanceur sont dans index.html', () => {
  const splash = lire(path.join('scripts', 'launch_dev_splash.py'))
  const html = lire(path.join('src', 'renderer', 'index.html'))
  if (!splash) return 'scripts/launch_dev_splash.py introuvable'
  if (!html) return 'src/renderer/index.html introuvable'
  const valeur = (nom) => {
    const m = splash.match(new RegExp(nom + '[ ]*=[ ]*"(#[0-9a-fA-F]{3,8})"'))
    return m ? m[1] : null
  }
  const dore = valeur('_DORE')
  const violet = valeur('_VIOLET')
  if (!dore || !violet) return `accents du lanceur illisibles (_DORE=${dore}, _VIOLET=${violet})`
  const absents = [dore, violet].filter((c) => !html.toLowerCase().includes(c.toLowerCase()))
  return absents.length ? `absents de index.html : ${absents.join(', ')} (palette encore divergente)` : true
})

check('(c) cas limite — le contrôle Python n’est pas désarmé (assertions et deux sources relues)', () => {
  const t = lire(path.join('scripts', 'launch_dev_phases_test.py'))
  if (!t) return 'scripts/launch_dev_phases_test.py introuvable'
  const n = (t.match(/verifie[(]/g) || []).length
  if (n < VERIFIE_MIN) return `${n} appels verifie( restants, ${VERIFIE_MIN} au départ : contrôle affaibli`
  const manquants = ['index.html', 'launch_dev_splash.py'].filter((s) => !t.includes(s))
  return manquants.length ? `le contrôle ne lit plus : ${manquants.join(', ')}` : true
})

console.log(rates === 0 ? 'CRITERE ATTEINT' : `CRITERE RATE (${rates})`)
process.exit(rates === 0 ? 0 : 1)
