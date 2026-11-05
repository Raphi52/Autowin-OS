#!/usr/bin/env node
/**
 * RÉGLAGE ADMINISTRATEUR DU MOD AUTOWIN (conv-1582, 2026-11-05).
 *
 * Pourquoi : le garde intégré du CLI Claude (`cc-plugin-sec-default`) saute le mod 2
 * (`prompt.attachment`, retrait du compte à rebours de tokens) de tout mod « installé par
 * l'utilisateur » — 315 des 3 795 journaux de `run-stdout/` le disaient le 2026-11-05. Seul un mod
 * « de l'organisation » le passe : activé par les réglages administrateur, depuis un catalogue local
 * chargé SUR PLACE, et placé dans `prependPlugins` avec le garde après lui.
 * Source : https://code.claude.com/docs/en/plugins/mods/admin.md (« Install your organization's mods
 * and set the order » ; garder `sec-default@builtin` dans la liste, sinon le garde entier disparaît).
 *
 * Le catalogue est `mods/autowin/.claude-plugin/marketplace.json`, dans le dépôt : une copie ailleurs
 * casserait le mod 1 (il déduit le lanceur du bureau caché de son propre dossier, hooks/register.js)
 * et vieillirait en silence, puisque le CLI ignore alors la copie `--plugin-dir` d'Autowin
 * (https://code.claude.com/docs/en/plugins/loading.md, « Name conflicts »).
 *
 * Usage :
 *   node scripts/mod-autowin-admin.mjs              montre le fichier qui serait écrit
 *   node scripts/mod-autowin-admin.mjs --appliquer  l'écrit (droits administrateur)
 *   node scripts/mod-autowin-admin.mjs --retirer    retire ces clés (le fichier part s'il ne reste rien)
 * Un fichier existant illisible n'est JAMAIS réécrit : le CLI refuserait de démarrer.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Fichier que lit le CLI sous Windows (docs « Deploy managed settings »). */
export const CHEMIN_REGLAGES_ADMIN = 'C:\\Program Files\\ClaudeCode\\managed-settings.json'
export const NOM_CATALOGUE = 'autowin'
export const ID_MOD_AUTOWIN = 'autowin-mods@autowin'
const GARDE = 'sec-default@builtin'

function sansCle(objet, cle) {
  if (!objet || typeof objet !== 'object') return undefined
  const { [cle]: _retire, ...reste } = objet
  return Object.keys(reste).length ? reste : undefined
}

/**
 * Ajoute le catalogue, active le mod et le met en tête de `prependPlugins`. Une liste déjà posée par
 * l'administrateur est gardée telle quelle derrière le mod ; sans liste, on écrit l'ordre par défaut
 * du CLI (le garde) derrière lui.
 */
export function reglagesAdminAvecModAutowin(existant, dossierMod) {
  const r = { ...(existant ?? {}) }
  r.extraKnownMarketplaces = {
    ...(r.extraKnownMarketplaces ?? {}),
    [NOM_CATALOGUE]: { source: { source: 'directory', path: dossierMod } }
  }
  r.enabledPlugins = { ...(r.enabledPlugins ?? {}), [ID_MOD_AUTOWIN]: true }
  const ordre = Array.isArray(r.prependPlugins)
    ? r.prependPlugins.filter((id) => id !== ID_MOD_AUTOWIN)
    : [GARDE]
  r.prependPlugins = [ID_MOD_AUTOWIN, ...ordre]
  return r
}

/** Retire ce que `reglagesAdminAvecModAutowin` a ajouté. */
export function reglagesAdminSansModAutowin(existant) {
  const r = { ...(existant ?? {}) }
  const catalogues = sansCle(r.extraKnownMarketplaces, NOM_CATALOGUE)
  const actives = sansCle(r.enabledPlugins, ID_MOD_AUTOWIN)
  if (catalogues) r.extraKnownMarketplaces = catalogues
  else delete r.extraKnownMarketplaces
  if (actives) r.enabledPlugins = actives
  else delete r.enabledPlugins
  if (Array.isArray(r.prependPlugins)) {
    const ordre = r.prependPlugins.filter((id) => id !== ID_MOD_AUTOWIN)
    if (ordre.length === 1 && ordre[0] === GARDE) delete r.prependPlugins
    else r.prependPlugins = ordre
  }
  return r
}

function lireExistant(chemin) {
  if (!existsSync(chemin)) return {}
  const brut = readFileSync(chemin, 'utf8')
  const valeur = JSON.parse(brut)
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur))
    throw new Error(`${chemin} n'est pas un objet JSON`)
  return valeur
}

function ecrireVerifie(chemin, valeur) {
  mkdirSync(dirname(chemin), { recursive: true })
  if (existsSync(chemin)) copyFileSync(chemin, `${chemin}.avant-autowin-${Date.now()}`)
  const texte = JSON.stringify(valeur, null, 2) + '\n'
  JSON.parse(texte)
  const temporaire = `${chemin}.tmp`
  writeFileSync(temporaire, texte, 'utf8')
  JSON.parse(readFileSync(temporaire, 'utf8'))
  renameSync(temporaire, chemin)
}

function principal(argv) {
  if (process.platform !== 'win32') {
    console.error(
      'Ce script vise le fichier Windows du CLI Claude ; ailleurs, voir docs « Deploy managed settings ».'
    )
    return 2
  }
  const dossierMod = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'mods', 'autowin')
  if (!existsSync(join(dossierMod, '.claude-plugin', 'marketplace.json'))) {
    console.error(`Catalogue absent : ${join(dossierMod, '.claude-plugin', 'marketplace.json')}`)
    return 1
  }
  let existant
  try {
    existant = lireExistant(CHEMIN_REGLAGES_ADMIN)
  } catch (e) {
    console.error(`Fichier administrateur illisible, laissé tel quel : ${e.message}`)
    return 1
  }
  const retirer = argv.includes('--retirer')
  const cible = retirer
    ? reglagesAdminSansModAutowin(existant)
    : reglagesAdminAvecModAutowin(existant, dossierMod)
  console.log(JSON.stringify(cible, null, 2))
  if (!argv.includes('--appliquer') && !retirer) {
    console.log(
      `\nAperçu seulement. Écriture : node scripts/mod-autowin-admin.mjs --appliquer (${CHEMIN_REGLAGES_ADMIN})`
    )
    return 0
  }
  if (retirer && Object.keys(cible).length === 0) {
    if (existsSync(CHEMIN_REGLAGES_ADMIN)) rmSync(CHEMIN_REGLAGES_ADMIN)
    console.log(`\nRetiré : ${CHEMIN_REGLAGES_ADMIN} n'avait que ces clés, il est supprimé.`)
    return 0
  }
  ecrireVerifie(CHEMIN_REGLAGES_ADMIN, cible)
  console.log(
    `\nÉcrit : ${CHEMIN_REGLAGES_ADMIN}. Vérifier : claude --debug, ligne « hooks module ${ID_MOD_AUTOWIN} loaded » avec « tier prepend ».`
  )
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = principal(process.argv.slice(2))
}
