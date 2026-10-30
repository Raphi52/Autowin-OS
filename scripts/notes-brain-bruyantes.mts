/**
 * NOTES BRAIN BRUYANTES — servies au moins 10 fois par les notes proches du chat, jamais ouvertes.
 *
 * Même calcul que l'inventaire Brain de l'Observatory (`notesServiesJamaisOuvertes`,
 * src/main/activity/brain-injection-inventory.ts), pour l'étape 5 bis de la skill `curate`
 * (conv-1303, 2026-10-30). Lecture seule du spool de traces Brain, aucun appel réseau.
 *
 * Usage : npx tsx scripts/notes-brain-bruyantes.mts [dossier-de-donnees]
 *   défaut : .autowin-data/autowin-os
 */
import { join } from 'node:path'
import { readBrainTraces } from '../src/main/activity/brain-trace-spool'
import {
  NOTE_BRUYANTE_SEUIL,
  notesServiesJamaisOuvertes
} from '../src/main/activity/brain-injection-inventory'

const donnees = process.argv[2] ?? join('.autowin-data', 'autowin-os')
const { depuis, notes } = notesServiesJamaisOuvertes(readBrainTraces(undefined, donnees))
if (!depuis) {
  console.log('mesure non commencée : aucune ouverture de note tracée pour l’instant')
} else if (notes.length === 0) {
  console.log(`aucune note servie ${NOTE_BRUYANTE_SEUIL} fois sans être ouverte depuis ${depuis}`)
} else {
  console.log(
    `notes servies ${NOTE_BRUYANTE_SEUIL} fois ou plus, jamais ouvertes, depuis ${depuis} :`
  )
  for (const n of notes)
    console.log(`${String(n.servies).padStart(4)}  ${n.fils} fil(s)  ${n.chemin}`)
}
