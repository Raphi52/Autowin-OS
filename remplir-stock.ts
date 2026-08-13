/**
 * Remplit le stock de veille avec les VRAIS défauts d'Autowin, notés.
 *
 * Écrit dans le fichier que la vue lit, en passant par les fonctions du module (tri, déduplication,
 * fusion) et non par une écriture JSON à la main : un stock fabriqué à côté du code divergerait du
 * premier changement de format.
 *
 * Les entrées de veille WEB déjà présentes ne sont pas supprimées mais ÉCARTÉES : la vue sait les
 * réafficher, donc rien n'est perdu et la décision reste réversible.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { lireSourcesDuDepot } from './src/main/veille/audit-depot'
import { auditerDepot, candidatsDepuisAudit } from './src/main/veille/audit-interne'
import { trierCandidats } from './src/main/veille/candidats'
import { redigerPromptCandidat } from './src/main/veille/passe'
import { clesConnues, fusionnerPasse } from './src/main/veille/candidats-store'
import type { StockVeille } from './src/main/veille/candidats-store'

const depot = process.argv[2]
const chemin = process.argv[3]
const plafond = Number(process.argv[4] ?? '12')
const maintenant = new Date().toISOString()

const stockAvant: StockVeille = existsSync(chemin)
  ? (JSON.parse(readFileSync(chemin, 'utf8')) as StockVeille)
  : { candidats: [], echecs: [], dernierePasse: undefined }

if (existsSync(chemin)) {
  copyFileSync(chemin, `${chemin}.avant-audit`)
  console.log(`sauvegarde : ${chemin}.avant-audit`)
}

/**
 * Selection DIVERSIFIEE : les meilleurs de CHAQUE classe de defaut, puis on complete.
 *
 * Deux erreurs corrigees ici, dans cet ordre :
 *  - un `slice(0, plafond)` sur une liste triee par score prenait douze fois la meme classe ;
 *  - une premiere diversification groupait sur le DEBUT DU TITRE, or chaque titre commence par
 *    « La classe <nom> … » : chaque nom formait son propre groupe, et rien ne changeait. Le
 *    regroupement se fait donc sur `classe`, le champ qui porte reellement la nature du defaut.
 *
 * Une colonne monotone est aussi peu exploitable qu'une colonne bruyante : on ne voit plus la NATURE
 * du travail qui attend.
 */
const constats = auditerDepot(lireSourcesDuDepot(depot))
const parClasse = new Map<string, typeof constats>()
for (const c of constats) parClasse.set(c.classe, [...(parClasse.get(c.classe) ?? []), c])
const choisis: typeof constats = []
// Tour a tour, une classe apres l'autre : la colonne montre d'emblee l'eventail des defauts.
for (let rang = 0; choisis.length < plafond; rang += 1) {
  let ajoute = false
  for (const liste of parClasse.values()) {
    if (liste[rang] && choisis.length < plafond) {
      choisis.push(liste[rang])
      ajoute = true
    }
  }
  if (!ajoute) break
}
const bruts = candidatsDepuisAudit(choisis, maintenant)
const { retenus, refuses } = trierCandidats(bruts, clesConnues(stockAvant), {
  maintenant,
  redigerPrompt: redigerPromptCandidat
})
console.log(`constats produits : ${bruts.length} — retenus : ${retenus.length}`)
for (const r of refuses) console.log(`  refusé (${r.raison}) : ${String(r.brut.titre).slice(0, 60)}`)

const fusionne = fusionnerPasse(stockAvant, { retenus, echecs: [], maintenant })

// Les corrections venues du WEB passent en `ecarte` : ce sont les bugs des concurrents, sans objet
// ici. Les AJOUTS web restent tels quels — ils inspirent des nouveautés, c'est leur raison d'être.
const INTERNE = 'Autowin OS'
const stock: StockVeille = {
  ...fusionne,
  candidats: fusionne.candidats.map((c) =>
    c.concurrent !== INTERNE && c.type !== 'ajout' && c.statut === 'nouveau'
      ? { ...c, statut: 'ecarte' as const }
      : c
  )
}
writeFileSync(chemin, `${JSON.stringify(stock, null, 2)}\n`, 'utf8')

const internes = stock.candidats.filter((c) => c.concurrent === INTERNE)
console.log(`\nstock écrit : ${stock.candidats.length} candidats, dont ${internes.length} internes`)
console.log(`web écartés : ${stock.candidats.filter((c) => c.statut === 'ecarte').length}`)
console.log('\n| note | défaut | où |')
for (const c of [...internes].sort((a, b) => (b.pertinence ?? 0) - (a.pertinence ?? 0)))
  console.log(`| ${String(c.pertinence).padStart(3)} | ${c.titre.slice(0, 62)} | ${c.url} |`)
