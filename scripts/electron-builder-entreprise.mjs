#!/usr/bin/env node
/**
 * Lance electron-builder avec l'IDENTITE du profil d'entreprise, quand il existe.
 *
 * Pourquoi (2026-10-13, conv-913) : `electron-builder.yml` et `package.json` ne portent que des
 * valeurs NEUTRES, pour que la version publique du depot ne nomme aucune entreprise. Une
 * entreprise garde pourtant SON identifiant d'application (raccourcis, notifications, installateur
 * deja poses sur ses postes) et son nom d'auteur : ils vivent dans `entreprise/<nom>/identite.json`
 * et sont passes ici en surcharges de ligne de commande (`-c.appId=...`). Le processus principal
 * lit le meme fichier au demarrage (`src/main/identite-entreprise.ts`) : application et paquet
 * gardent ainsi la MEME identite.
 *
 * Sans profil, electron-builder tourne exactement comme avant, avec les valeurs du depot.
 */
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lireProfil, RACINE_DEPOT } from './identite-entreprise.mjs'

export { lireProfil }

const APP_ID = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/
const NOM = /^[\p{L}\p{N} .&'-]{1,80}$/u

/** Surcharges electron-builder tirees du profil ; une valeur invalide est ignoree, jamais passee. */
export function surchargesEntreprise(profil) {
  const application = profil?.application ?? {}
  const surcharges = []
  if (typeof application.appId === 'string' && APP_ID.test(application.appId)) {
    surcharges.push(`-c.appId=${application.appId}`)
  }
  if (typeof application.auteur === 'string' && NOM.test(application.auteur)) {
    surcharges.push(`-c.extraMetadata.author=${application.auteur}`)
    surcharges.push(`-c.linux.maintainer=${application.auteur}`)
  }
  return surcharges
}

const estLancementDirect =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (estLancementDirect) {
  const racine = RACINE_DEPOT
  const surcharges = surchargesEntreprise(lireProfil(racine))
  const cli = join(racine, 'node_modules', 'electron-builder', 'cli.js')
  const resultat = spawnSync(process.execPath, [cli, ...process.argv.slice(2), ...surcharges], {
    cwd: racine,
    stdio: 'inherit'
  })
  process.exit(resultat.status ?? 1)
}
