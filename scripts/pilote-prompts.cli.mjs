#!/usr/bin/env node
/**
 * ENTREE EN LIGNE DE COMMANDE de la sonde pilote — separee de la bibliotheque A DESSEIN.
 *
 * MESURE du 2026-09-03 : tant que le `main()` d'affichage vivait dans le meme fichier que les
 * fonctions pures, vitest refusait de charger le module (« Invalid or unexpected token » au point
 * d'import) des que ce main etait reference. Localise par bissection ligne a ligne. Une
 * bibliotheque pure dun cote, un affichage de lautre : les tests chargent la premiere, la
 * commande npm appelle la seconde.
 */

import {
  lireCorpus,
  analyser,
  grosOeuvre,
  nommeUneCible,
  racineDonnees
} from './pilote-prompts.mjs'

export function main() {
  const argv = process.argv.slice(2)
  const top = Number(argv[argv.indexOf('--top') + 1]) || 15
  const dir = racineDonnees(argv.includes('--data') ? argv[argv.indexOf('--data') + 1] : null)
  const { conversations, fichier } = lireCorpus(dir)
  const { style, chantiers, prompts } = analyser(conversations)
  const ouvrages = grosOeuvre(process.cwd())
  if (argv.includes('--json')) {
    console.log(
      JSON.stringify(
        { fichier, grosOeuvre: ouvrages.slice(0, top), style, chantiers: chantiers.slice(0, top) },
        null,
        2
      )
    )
    return
  }
  console.log(`# Sonde pilote — ${fichier}`)
  console.log(
    `\n## LE GROS OEUVRE — l'ouvrage declare dans le depot (${ouvrages.length} objectifs)`
  )
  console.log(`Classe par ECART MESURE : restes ecrits x3 + fichiers cites encore presents x2.`)
  for (const o of ouvrages.slice(0, top)) {
    console.log(`\n- **${o.titre}** — ${o.document}:${o.ligne} (ecart ${o.ecart})`)
    if (o.but) console.log(`  but : ${o.but}`)
    for (const r of o.restes.slice(0, 3)) console.log(`  reste ecrit : ${r}`)
    if (o.presents.length)
      console.log(`  encore dans le depot : ${o.presents.slice(0, 5).join(', ')}`)
  }
  console.log(`\n## Style reel de l'utilisateur (${conversations.length} conversations)`)
  console.log(`- demandes retenues : ${style.prompts} (dont ${style.relances} relances nues)`)
  console.log(`- longueur mediane : ${style.medianeCaracteres} caracteres`)
  console.log(`- courtes (<=80 car.) : ${style.pctCourts} %`)
  console.log(`- a l'imperatif : ${style.pctImperatif} %`)
  console.log(`- cible nommee (fichier / commande / conv-N) : ${style.pctCibleNommee} %`)
  // Gabarit IMBRIQUE evite a dessein : sous vitest il fait echouer le chargement du module entier
  // (« Invalid or unexpected token » au point d'import). Localise par bissection le 2026-09-03.
  const ouvertures = style.ouverturesTop.map((paire) => paire[0] + ' (' + paire[1] + ')').join(', ')
  console.log('- ouvertures les plus frequentes : ' + ouvertures)
  console.log(`\n## Chantiers laisses ouverts (${chantiers.length})`)
  for (const c of chantiers.slice(0, top)) console.log(`- [${c.conversation}] ${c.ligne}`)
  console.log(`\n## Echantillon de ses vraies demandes (les 12 dernieres avec une cible)`)
  for (const p of prompts.filter(nommeUneCible).slice(-12)) console.log(`- ${p.slice(0, 160)}`)
}

main()
