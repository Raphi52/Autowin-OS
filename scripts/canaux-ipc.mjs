#!/usr/bin/env node
/**
 * NOMME les canaux `ipcMain.handle` ajoutés ou retirés entre deux états de `src/main`.
 *
 * Pourquoi (conv-1451, 2026-11-03) : le compte de `src/main/gardes/security-critical-fixes.test.ts` est un
 * fil-piège qui dérive à chaque fusion de fils. Chaque mise à jour du compte doit dire QUELS canaux
 * sont arrivés, et ce comparatif se refaisait à la main (archive du commit, grep, comm). Une ligne
 * grep rate les appels écrits sur plusieurs lignes (`ipcMain.handle(\n  'canal'`) : 262 au lieu de 291
 * mesurés le même jour. Ce script lit avec la même expression que le test, sur les mêmes fichiers
 * (tout `.ts` de `src/main` hors tests et aides de test), donc ses totaux sont ceux du test.
 *
 * Usage : node scripts/canaux-ipc.mjs <ref-avant> [ref-après]
 *   ref = un commit, une branche, ou `.` pour l'arbre de travail (défaut de ref-après).
 *   Ex. : node scripts/canaux-ipc.mjs $(git log -1 --format=%h -S"toHaveLength(291)" -- src/main/gardes/security-critical-fixes.test.ts)
 * Sortie : JSON { avant, apres, ajoutes: [{canal, fichier}], retires: [...] } ; code 0.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { racineDepot } from './racine-depot.mjs'

/** La même expression que `security-critical-fixes.test.ts`. */
const MOTIF = /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g

const compte = (fichier) =>
  fichier.endsWith('.ts') && !fichier.endsWith('.test.ts') && !fichier.includes('test-helpers')

/** Canaux d'un texte source, avec le fichier qui les porte. */
export function canauxDuTexte(texte, fichier) {
  return [...texte.replace(/\r\n/g, '\n').matchAll(MOTIF)].map((m) => ({ canal: m[1], fichier }))
}

function canauxDeLArbre(racine) {
  const marcher = (dossier) =>
    readdirSync(dossier).flatMap((nom) => {
      const chemin = join(dossier, nom)
      return statSync(chemin).isDirectory() ? marcher(chemin) : compte(chemin) ? [chemin] : []
    })
  return marcher(join(racine, 'src', 'main')).flatMap((chemin) =>
    canauxDuTexte(readFileSync(chemin, 'utf8'), relative(racine, chemin).replace(/\\/g, '/'))
  )
}

function canauxDuCommit(racine, ref) {
  const git = (...args) =>
    execFileSync('git', args, { cwd: racine, encoding: 'utf8', maxBuffer: 1 << 28 })
  // Seuls les fichiers qui nomment `ipcMain.handle` sont relus : quelques dizaines, pas tout src/main.
  let liste = ''
  try {
    liste = git('grep', '-l', '-e', 'ipcMain.handle', ref, '--', 'src/main')
  } catch (erreur) {
    // `git grep` rend 1 quand rien ne correspond : aucun canal, pas une panne.
    if (erreur.status !== 1) throw erreur
  }
  return liste
    .split('\n')
    .filter(Boolean)
    .map((ligne) => ligne.slice(ref.length + 1))
    .filter(compte)
    .flatMap((fichier) => canauxDuTexte(git('show', `${ref}:${fichier}`), fichier))
}

/** Compare deux listes de canaux par leur NOM. */
export function comparerCanaux(avant, apres) {
  const nomsAvant = new Set(avant.map((c) => c.canal))
  const nomsApres = new Set(apres.map((c) => c.canal))
  return {
    avant: avant.length,
    apres: apres.length,
    ajoutes: apres.filter((c) => !nomsAvant.has(c.canal)),
    retires: avant.filter((c) => !nomsApres.has(c.canal))
  }
}

const lanceEnCli = Boolean(process.argv[1] && process.argv[1].endsWith('canaux-ipc.mjs'))
if (lanceEnCli) {
  const [refAvant, refApres = '.'] = process.argv.slice(2)
  if (!refAvant) {
    console.error(
      'Usage : node scripts/canaux-ipc.mjs <ref-avant> [ref-après]  (ref = commit ou .)'
    )
    process.exit(2)
  }
  const racine = racineDepot()
  const lire = (ref) => (ref === '.' ? canauxDeLArbre(racine) : canauxDuCommit(racine, ref))
  console.log(JSON.stringify(comparerCanaux(lire(refAvant), lire(refApres)), null, 2))
}
