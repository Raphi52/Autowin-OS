#!/usr/bin/env node
/**
 * MET À L'ABRI LES SAUVEGARDES QUI BLOQUENT LA PURGE D'UNE CORBEILLE DU `/gc` (conv-1798, 2026-11-22).
 *
 * `gc-purger-corbeilles.mjs` garde toute corbeille qui porte un `conversations.json*` ou un
 * `*.pre-remake` (`NOM_PROTEGE`), à toute profondeur : ces fichiers ne se recréent pas. Le 22/11, la
 * corbeille du 07/11 (12,4 Go, 43 571 fichiers) restait bloquée pour 50 fichiers de 57 Mo, venus de bacs
 * à sable de tests balayés dans `%TEMP%` (`aw-iso*`, `awtest*`, `real717`…). Le geste prévu par
 * `skills/gc/SKILL.md` (étape 6) — mettre la sauvegarde dans `.autowin-data/sauvegardes/` — se faisait
 * à la main, comme le 28/10 et le 29/10.
 *
 * LE GESTE : chaque entrée protégée (fichier, ou dossier entier, reconnue par le MÊME `NOM_PROTEGE`) est
 * copiée dans `<vers>/gc-corbeille-<AAAA-MM-JJ>/`, à son chemin relatif dans la corbeille, puis comparée
 * octet par octet. Seulement quand TOUT est identique, `ORIGINE.txt` est écrit à côté, puis les sources
 * sont retirées de la corbeille. La corbeille, son `MANIFEST.txt` et le reste de son contenu ne bougent pas :
 * la question de purge reste à poser, ce script ne supprime rien d'autre.
 *
 * Refus (code 2, rien ne bouge) : options manquantes, corbeille qui n'est pas `gc-corbeille/<date>`,
 * destination déjà présente (une deuxième passe n'écrase jamais la première), lien ou jonction dans une
 * entrée protégée (jamais suivi). Code 1 : copie différente ou impossible, les sources restent en place.
 *
 * Usage, depuis le dépôt Autowin :
 *   node --no-warnings scripts/gc-abriter-sauvegardes.mjs --corbeille <racine>/gc-corbeille/<AAAA-MM-JJ> --vers <dépôt>/.autowin-data/sauvegardes
 * Sortie : JSON `{ corbeille, vers, abrites: [{ chemin, octets }], octets }`.
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { supprimerArbre } from '../src/main/fichiers/fs-supprimer.ts'
import { NOM_PROTEGE } from './gc-purger-corbeilles.mjs'

const NOM_DATE = /^\d{4}-\d{2}-\d{2}$/u

class Refus extends Error {}

/** Les entrées protégées de la corbeille : on ne descend pas dans un dossier protégé, il part entier. */
function entreesProtegees(corbeille) {
  const trouvees = []
  const aVoir = [corbeille]
  while (aVoir.length > 0) {
    const dossier = aVoir.pop()
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, entree.name)
      const infos = lstatSync(chemin)
      if (NOM_PROTEGE.test(entree.name)) {
        if (infos.isSymbolicLink()) throw new Refus(`lien protégé, jamais suivi : ${chemin}`)
        trouvees.push({ chemin, dossier: infos.isDirectory() })
      } else if (infos.isDirectory() && !infos.isSymbolicLink()) aVoir.push(chemin)
    }
  }
  return trouvees.sort((a, b) => a.chemin.localeCompare(b.chemin))
}

/** Les fichiers d'une entrée protégée ; un lien dedans refuse tout le geste. */
function fichiersDe({ chemin, dossier }) {
  if (!dossier) return [chemin]
  const fichiers = []
  const aVoir = [chemin]
  while (aVoir.length > 0) {
    const courant = aVoir.pop()
    for (const entree of readdirSync(courant, { withFileTypes: true })) {
      const enfant = join(courant, entree.name)
      const infos = lstatSync(enfant)
      if (infos.isSymbolicLink())
        throw new Refus(`lien dans une sauvegarde, jamais suivi : ${enfant}`)
      if (infos.isDirectory()) aVoir.push(enfant)
      else fichiers.push(enfant)
    }
  }
  return fichiers
}

export function abriterLesSauvegardes({ corbeille, vers }) {
  if (!corbeille || !vers || !isAbsolute(corbeille) || !isAbsolute(vers))
    throw new Refus('--corbeille et --vers sont obligatoires, en chemins absolus')
  const source = resolve(corbeille)
  const jour = basename(source)
  if (!NOM_DATE.test(jour) || basename(dirname(source)) !== 'gc-corbeille')
    throw new Refus(`pas une corbeille du /gc (gc-corbeille/AAAA-MM-JJ) : ${source}`)
  if (!existsSync(source) || !lstatSync(source).isDirectory())
    throw new Refus(`corbeille absente : ${source}`)
  const destination = join(resolve(vers), `gc-corbeille-${jour}`)
  if (existsSync(destination)) throw new Refus(`destination déjà présente : ${destination}`)

  const entrees = entreesProtegees(source)
  const fichiers = entrees.flatMap(fichiersDe)
  const abrites = []
  for (const fichier of fichiers) {
    const cible = join(destination, relative(source, fichier))
    mkdirSync(dirname(cible), { recursive: true })
    copyFileSync(fichier, cible)
    if (!readFileSync(fichier).equals(readFileSync(cible)))
      throw new Error(`copie différente de sa source : ${fichier}`)
    abrites.push({ chemin: relative(source, fichier), octets: lstatSync(cible).size })
  }
  if (abrites.length === 0) return { corbeille: source, vers: destination, abrites, octets: 0 }

  writeFileSync(
    join(destination, 'ORIGINE.txt'),
    `Mis à l'abri par /gc le ${new Date().toISOString()} depuis ${source}\n` +
      `Ces fichiers bloquaient la purge de la corbeille (NOM_PROTEGE, scripts/gc-purger-corbeilles.mjs).\n` +
      abrites.map((a) => `${a.chemin}\t${a.octets}`).join('\n') +
      '\n'
  )
  for (const entree of entrees) {
    if (entree.dossier) supprimerArbre(entree.chemin)
    else unlinkSync(entree.chemin)
  }
  return {
    corbeille: source,
    vers: destination,
    abrites,
    octets: abrites.reduce((total, a) => total + a.octets, 0)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({
      options: { corbeille: { type: 'string' }, vers: { type: 'string' } },
      strict: true
    })
    process.stdout.write(`${JSON.stringify(abriterLesSauvegardes(values), null, 2)}\n`)
  } catch (erreur) {
    process.stderr.write(`${erreur.message}\n`)
    process.exitCode =
      erreur instanceof Refus || erreur.code?.startsWith?.('ERR_PARSE_ARGS') ? 2 : 1
  }
}
