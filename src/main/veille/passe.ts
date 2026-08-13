import { trierCandidats, type CandidatBrut, type Refus } from './candidats'
import {
  clesConnues,
  fusionnerPasse,
  lireStockVeille,
  ecrireStockVeille,
  type EchecSource,
  type StockVeille
} from './candidats-store'
import { SOURCES_VEILLE, type SourceVeille } from './sources'

/**
 * Une passe de veille : un scout par source, en parallèle, et un tri sans indulgence de ce qu'ils rendent.
 *
 * La répartition est écrite ici plutôt que déléguée au fan-out du pipeline, et c'est un choix motivé :
 * `selectPhaseFanOut` (os.ts) ne SÉLECTIONNE qu'un provider et un modèle par phase — le dispatch réel de
 * l'orchestrateur est lié à une machinerie de run (copies git isolées, preuves, portes de clôture) dont
 * une lecture de page web n'a aucun besoin. On garde donc le rôle configuré par l'utilisateur, et la
 * répartition reste une simple exécution parallèle bornée.
 *
 * Le scout est injecté (`lancerScout`) : la passe est donc testable sans réseau, et le module ne décide
 * pas quel fournisseur l'exécute.
 */

/** Ce qu'un scout reçoit et rend. La sortie est du texte brut : c'est un agent, pas une API. */
export type LancerScout = (source: SourceVeille, prompt: string) => Promise<string>

export interface ResultatPasse {
  retenus: number
  refuses: Refus[]
  echecs: EchecSource[]
  stock: StockVeille
}

/**
 * Le prompt d'un scout.
 *
 * Trois exigences y sont explicites, et chacune ferme une façon de rendre du plausible :
 *  - lire l'URL DONNÉE (le scout ne choisit pas où chercher) ;
 *  - recopier une ligne VERBATIM d'au moins 40 caractères (c'est elle qu'un vérificateur rejouera) ;
 *  - rendre un tableau VIDE plutôt que d'inventer quand la page n'apporte rien de récent.
 *
 * Le prompt n'est pas la garantie, il n'est que la consigne : le tri (`trierCandidats`) refuse ensuite ce
 * qui ne porte pas ses preuves, et le vérificateur rejoue la citation contre la page. Une consigne seule
 * se contourne ; c'est le contrôle en aval qui tient.
 */
export function construirePromptScout(source: SourceVeille): string {
  return [
    `Tu lis UNE page de notes de version : ${source.url}`,
    `Produit concerné : ${source.concurrent}.`,
    '',
    'Récupère cette page, puis rends les nouveautés RÉCENTES qu’elle annonce, au format JSON strict :',
    '[{"titre":"...","dateSource":"...","citation":"...","langue":"..."}]',
    '',
    'Règles :',
    '- `citation` est une ligne RECOPIÉE MOT POUR MOT de la page, au moins 40 caractères. Elle sera',
    '  vérifiée en récupérant l’URL à nouveau : une citation absente de la page fait rejeter l’entrée.',
    '- `dateSource` est la date que la page porte pour cette entrée. Si la page ne donne qu’un numéro de',
    '  version, mets ce numéro. Ne devine JAMAIS une date.',
    '- `langue` est la langue de la page (fr, en, zh…).',
    '- Si la page ne répond pas, ou n’annonce rien de récent, réponds exactement : []',
    '- N’ajoute aucun commentaire autour du JSON.',
    '',
    "Tu peux suivre un lien de cette page si l'entrée y est détaillée — mais la citation doit venir d'une",
    'page que tu as réellement lue, et son URL doit être celle que tu cites.'
  ].join('\n')
}

/**
 * Extrait le tableau JSON d'une sortie d'agent.
 *
 * Un agent ajoute volontiers une phrase avant ou après, malgré la consigne. On cherche donc le premier
 * `[` et le dernier `]` plutôt que d'exiger une sortie parfaite — mais on ne RÉPARE pas un JSON cassé :
 * illisible, la sortie rend `undefined`, et l'appelant en fait un échec nommé. Deviner ce qu'un agent a
 * voulu écrire serait la première marche vers l'invention.
 */
export function extraireCandidats(sortie: string): CandidatBrut[] | undefined {
  const debut = sortie.indexOf('[')
  const fin = sortie.lastIndexOf(']')
  if (debut < 0 || fin <= debut) return undefined
  try {
    const valeur: unknown = JSON.parse(sortie.slice(debut, fin + 1))
    if (!Array.isArray(valeur)) return undefined
    return valeur.filter((e): e is CandidatBrut => !!e && typeof e === 'object')
  } catch {
    return undefined
  }
}

/** Le prompt proposé à l'utilisateur pour ce candidat. Il porte sa source : on cliquera dessus. */
export function redigerPromptCandidat(candidat: CandidatBrut): string {
  return [
    `Étudie cette nouveauté de ${candidat.concurrent} et dis-moi si Autowin OS devrait l’avoir :`,
    '',
    `« ${candidat.titre} »`,
    `Source : ${candidat.url} (${candidat.dateSource})`,
    `Extrait lu : « ${candidat.citation} »`,
    '',
    'Commence par vérifier ce que fait déjà Autowin OS sur ce sujet — si c’est déjà couvert, dis-le et',
    'arrête-toi là. Sinon, propose ce que ça donnerait ici, et ce que ça coûte.'
  ].join('\n')
}

/**
 * Exécute une passe complète : tous les scouts en parallèle, tri, fusion dans le stock.
 *
 * Un scout qui échoue n'arrête pas les autres — sa source part dans `echecs` avec le motif. C'est ce qui
 * évite qu'une passe rende zéro candidat sans qu'on sache si c'est « rien de neuf » ou « rien n'a été lu ».
 */
export async function executerPasse(deps: {
  lancerScout: LancerScout
  sources?: readonly SourceVeille[]
  maintenant?: () => string
  chemin?: string
}): Promise<ResultatPasse> {
  const sources = deps.sources ?? SOURCES_VEILLE
  const maintenant = (deps.maintenant ?? (() => new Date().toISOString()))()
  const stockAvant = lireStockVeille(deps.chemin)

  const parSource = await Promise.all(
    sources.map(async (source) => {
      try {
        const sortie = await deps.lancerScout(source, construirePromptScout(source))
        const extraits = extraireCandidats(sortie)
        if (!extraits) {
          return {
            bruts: [],
            echec: {
              concurrent: source.concurrent,
              url: source.url,
              detail: 'sortie du scout illisible : aucun JSON exploitable',
              vuLe: maintenant
            }
          }
        }
        // Le concurrent et l'URL viennent de la SOURCE, jamais de ce que le scout a écrit : c'est ce qui
        // empêche un scout de rattacher une trouvaille à un produit ou à une page qu'on ne lui a pas donnés.
        return {
          bruts: extraits.map((brut) => ({
            ...brut,
            concurrent: source.concurrent,
            url: brut.url?.trim() || source.url
          })),
          echec: undefined
        }
      } catch (erreur) {
        return {
          bruts: [],
          echec: {
            concurrent: source.concurrent,
            url: source.url,
            detail: erreur instanceof Error ? erreur.message : String(erreur),
            vuLe: maintenant
          }
        }
      }
    })
  )

  const bruts = parSource.flatMap((r) => r.bruts)
  const echecs = parSource.map((r) => r.echec).filter((e): e is EchecSource => e !== undefined)
  const { retenus, refuses } = trierCandidats(bruts, clesConnues(stockAvant), {
    maintenant,
    redigerPrompt: redigerPromptCandidat
  })
  const stock = fusionnerPasse(stockAvant, { retenus, echecs, maintenant })
  ecrireStockVeille(stock, deps.chemin)
  return { retenus: retenus.length, refuses, echecs, stock }
}
