/**
 * Rejoue chaque citation contre sa page. C'est le contrôle HORS MODÈLE de la veille.
 *
 * Tout le reste de la chaîne repose sur un agent : c'est lui qui lit la page, choisit les entrées et
 * recopie la citation. Rien de tout ça ne prouve qu'une feature existe — un modèle produit du plausible
 * sans effort. Ce script est le seul endroit où l'affirmation est CONFRONTÉE à la réalité : on récupère
 * l'URL et on cherche la citation dedans. Absente → le candidat est un mensonge, et le script échoue.
 *
 * Aucun modèle n'intervient ici, volontairement : `fetch` et une comparaison de texte. Un vérificateur
 * qui demanderait à un agent « cette citation est-elle dans la page ? » ne vérifierait rien.
 *
 *   npx tsx scripts/verifier-candidats-veille.ts
 *   npx tsx scripts/verifier-candidats-veille.ts --stock C:/chemin/veille.json
 *   npx tsx scripts/verifier-candidats-veille.ts --controle-negatif
 *
 * Codes de sortie :
 *   0 — toutes les citations retrouvées (ou stock vide : rien à contredire)
 *   1 — au moins une citation ABSENTE de sa page
 *   2 — aucune page lisible : rien n'a pu être vérifié, ce qui n'est PAS un succès
 */

import { lireStockVeille, type StockVeille } from '../src/main/veille/candidats-store'
import type { CandidatVeille } from '../src/main/veille/candidats'

const valeur = (nom: string): string | undefined => {
  const i = process.argv.indexOf(nom)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/**
 * Texte ramené à sa forme comparable.
 *
 * Les pages et les citations divergent sur des détails qui ne changent rien au sens : guillemets
 * courbes contre droits, tirets longs, espaces insécables, retours à la ligne au milieu d'une phrase,
 * balises HTML autour des mots. Comparer les chaînes brutes déclarerait absente une citation
 * parfaitement présente — un faux accusé bien plus coûteux qu'un contrôle un peu tolérant.
 */
function normaliser(texte: string): string {
  return texte
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/[\s\u00a0\u202f]+/g, ' ')
    .toLowerCase()
    .trim()
}

type Verdict = 'verifiee' | 'absente' | 'page illisible'

interface Controle {
  candidat: CandidatVeille
  verdict: Verdict
  detail?: string
}

const pages = new Map<string, string | undefined>()

/** Une page par URL, récupérée UNE fois : plusieurs candidats partagent la même page de notes. */
async function lirePage(url: string): Promise<string | undefined> {
  if (pages.has(url)) return pages.get(url)
  let contenu: string | undefined
  try {
    const reponse = await fetch(url, {
      // Certains sites refusent une requête sans agent déclaré ; ce n'est pas un déguisement, c'est
      // un en-tête que tout client HTTP envoie.
      headers: { 'user-agent': 'AutowinOS-veille/1.0 (verification de citations)' },
      signal: AbortSignal.timeout(30_000)
    })
    contenu = reponse.ok ? await reponse.text() : undefined
  } catch {
    contenu = undefined
  }
  pages.set(url, contenu)
  return contenu
}

async function controler(candidat: CandidatVeille): Promise<Controle> {
  const page = await lirePage(candidat.url)
  if (page === undefined)
    return { candidat, verdict: 'page illisible', detail: 'page non récupérable' }
  const trouvee = normaliser(page).includes(normaliser(candidat.citation))
  return trouvee
    ? { candidat, verdict: 'verifiee' }
    : { candidat, verdict: 'absente', detail: 'citation introuvable dans la page' }
}

async function verifier(stock: StockVeille, bavard = true): Promise<Controle[]> {
  const controles: Controle[] = []
  // En série et non en parallèle : on lit peu de pages, et marteler un site de sept requêtes
  // simultanées est un comportement qu'on n'a pas à avoir pour gagner deux secondes.
  for (const candidat of stock.candidats) {
    const controle = await controler(candidat)
    controles.push(controle)
    if (bavard) {
      const marque =
        controle.verdict === 'verifiee' ? 'OK  ' : controle.verdict === 'absente' ? 'FAUX' : '?   '
      console.log(
        `${marque} [${controle.candidat.concurrent}] ${controle.candidat.titre.slice(0, 70)}` +
          (controle.detail ? ` — ${controle.detail}` : '')
      )
    }
  }
  return controles
}

/**
 * Le CONTRÔLE NÉGATIF : le vérificateur doit ÉCHOUER sur une citation fabriquée.
 *
 * Sans lui, un vérificateur qui valide tout ressemble exactement à un vérificateur qui marche. C'est la
 * seule manière de savoir que le vert veut dire quelque chose — et cette leçon a été payée plusieurs
 * fois dans ce dépôt : un test qui ne pouvait pas rougir, un compteur qui ne pouvait pas descendre.
 */
async function controleNegatif(): Promise<boolean> {
  const invente: CandidatVeille = {
    id: 'controle-negatif',
    concurrent: 'Contrôle',
    titre: 'Feature entièrement inventée pour le contrôle négatif',
    // Une URL réelle et lisible, pour que l'échec vienne de la CITATION et non d'une page injoignable.
    url: 'https://raw.githubusercontent.com/anthropics/claude-code/main/README.md',
    dateSource: '2026-01-01',
    citation:
      'Cette phrase n a jamais ete ecrite dans aucune page et sert uniquement au controle negatif du verificateur',
    type: 'ajout',
    prompt: '',
    vuLe: new Date(0).toISOString(),
    statut: 'nouveau'
  }
  const [controle] = await verifier({ candidats: [invente], echecs: [] }, false)
  const correct = controle.verdict === 'absente'
  console.log(
    correct
      ? 'Contrôle négatif OK : une citation fabriquée est bien rejetée.'
      : `Contrôle négatif ÉCHOUÉ : la citation fabriquée a rendu « ${controle.verdict} » — le vérificateur ne vérifie rien.`
  )
  return correct
}

/**
 * `process.exitCode` et non `process.exit()`.
 *
 * MESURE : `process.exit()` juste apres un `fetch` tue le processus pendant que libuv referme le
 * descripteur, et Node meurt sur « Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) » avec un
 * code 127 — alors que la verification, elle, avait REUSSI. Un vert transforme en 127 par la sortie
 * elle-meme est exactement le genre de faux rouge qui fait douter d'un code correct.
 */
async function main(): Promise<void> {
  if (process.argv.includes('--controle-negatif')) {
    process.exitCode = (await controleNegatif()) ? 0 : 1
    return
  }

  const chemin = valeur('--stock')
  const stock = lireStockVeille(chemin)
  console.log(`${stock.candidats.length} candidat(s) à vérifier`)
  if (stock.candidats.length === 0) {
    // Rien à contredire : ce n'est pas un échec, mais ce n'est pas une preuve non plus. On le dit.
    console.log('Stock vide : aucune citation à confronter.')
    return
  }

  const controles = await verifier(stock)
  const faux = controles.filter((c) => c.verdict === 'absente')
  const illisibles = controles.filter((c) => c.verdict === 'page illisible')
  const verifiees = controles.filter((c) => c.verdict === 'verifiee')

  console.log('')
  console.log(`Vérifiées      : ${verifiees.length}`)
  console.log(`ABSENTES       : ${faux.length}`)
  console.log(`Pages illisibles : ${illisibles.length}`)

  if (faux.length > 0) {
    console.log('')
    console.log('Ces candidats affirment une citation que leur page ne contient pas :')
    for (const c of faux) console.log(`  [${c.candidat.concurrent}] ${c.candidat.titre}`)
    process.exitCode = 1
    return
  }
  // Aucune page lue = rien de prouvé. Sortir 0 ici ferait passer un silence pour une validation.
  if (verifiees.length === 0) {
    console.log('')
    console.log('Aucune page lisible : rien n’a pu être vérifié.')
    process.exitCode = 2
    return
  }
  process.exitCode = 0
}

void main()
