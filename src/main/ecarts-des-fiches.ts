/**
 * LA MESURE DES ÉCARTS entre les RUN.md légers et le Board (conv-1418, 2026-11-01).
 *
 * Demande : « ne touche pas encore au Board et ajoute une mesure des écarts avec son état actuel ».
 * Le Board reste la référence : ce module le lit, il ne le change pas. Son bilan dit s'il est sûr de
 * le faire reposer un jour sur les fiches.
 *
 * L'ÉTAT D'UNE FICHE EST CALCULÉ PAR LE MÊME CODE QUE LE BOARD : comparés à l'écriture, ils seraient
 * égaux par construction. Ce qui se mesure, c'est ce qui dérive APRÈS : une demande dont l'état change
 * sans nouveau tour, une demande restée sans fiche (tour perdu dans un redémarrage), une fiche dont
 * le message a quitté le fil. Le calcul part donc de la carte du moment, et il repart de TOUTES les
 * fiches à chaque fois : `ecarts.json` est toujours un bilan complet, jamais un delta.
 *
 * Les états posés à la main sur le Board ne comptent pas : la carte comparée est celle des preuves.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CarteDesBesoins, DemandeDeLaCarte, StatutDemande } from '../shared/carte-des-besoins'
import type { NatureDuBesoin } from '../shared/ligne-besoin'
import { DOSSIER_DES_FICHES, type LigneDeFiche } from './fiches-de-demande'
import { cleDuJournal } from './journal-des-besoins'

export const FICHIER_DES_ECARTS = 'ecarts.json'

/** Le détail reste lisible d'un coup d'œil ; les totaux, eux, ne sont jamais coupés. */
export const DETAIL_MAX = 50

/** Une rafale de fins de tour ne coûte qu'une mesure, et le fil a le temps de se stabiliser. */
export const DELAI_DE_MESURE_MS = 60_000

export interface EcartDEtat {
  conversationId: string
  messageId: string
  titre: string
  fiche: string
  etatDeLaFiche: StatutDemande
  constatDeLaFiche: string
  etatDuBoard: StatutDemande
  constatDuBoard: string
}

export interface DemandeSansFiche {
  conversationId: string
  messageId?: string
  titre: string
  etatDuBoard: StatutDemande
  /** Ce que l'agent a déclaré ; `sans-ligne` = sa réponse n'en portait pas, ou le tour s'est perdu. */
  nature: NatureDuBesoin | 'sans-ligne'
}

export interface BilanDesEcarts {
  v: 1
  calculeA: number
  /** Heure de la première demande rangée : le Board n'est comparé qu'à partir d'elle. */
  depuis: number | null
  /** Demandes du Board depuis `depuis`, questions et tours en cours compris. */
  demandesComparees: number
  enAccord: number
  /** Tours pas encore finis : ni accord ni écart. */
  enCours: number
  /** Déclarées « pas un besoin » : le Board les montre, elles n'ont pas de fiche, c'est normal. */
  questions: number
  ecartsDEtat: { total: number; detail: EcartDEtat[] }
  sansFiche: { total: number; detail: DemandeSansFiche[] }
  /** Lignes de l'index dont le message n'est plus sur le Board (fil rembobiné, message retiré). */
  lignesSansDemande: number
  fiches: number
  suites: number
  /** Lignes rangées sans que l'agent l'ait dit : ce que coûte sa ligne de besoin manquante. */
  classementsDeduits: number
  /** Le Board range par fil, les fiches par tâche : ces deux comptes disent où ils divergent. */
  filsAPlusieursFiches: number
  fichesAPlusieursFils: number
}

function compterParValeursDistinctes(
  paires: readonly (readonly [string, string])[]
): Map<string, Set<string>> {
  const groupes = new Map<string, Set<string>>()
  for (const [cle, valeur] of paires) {
    const groupe = groupes.get(cle)
    if (groupe) groupe.add(valeur)
    else groupes.set(cle, new Set([valeur]))
  }
  return groupes
}

const plusDeUne = (groupes: ReadonlyMap<string, ReadonlySet<string>>): number =>
  [...groupes.values()].filter((groupe) => groupe.size > 1).length

export function mesurerLesEcarts(entree: {
  demandes: readonly DemandeDeLaCarte[]
  lignes: readonly LigneDeFiche[]
  calculeA: number
}): BilanDesEcarts {
  const { demandes, lignes } = entree
  const parMessage = new Map(
    lignes.map((ligne) => [cleDuJournal(ligne.conversationId, ligne.messageId), ligne])
  )
  const depuis = lignes.length
    ? Math.min(...lignes.map((ligne) => ligne.demandeLe ?? ligne.ts))
    : null

  const retrouvees = new Set<string>()
  const ecarts: EcartDEtat[] = []
  const sansFiche: DemandeSansFiche[] = []
  let demandesComparees = 0
  let enAccord = 0
  let enCours = 0
  let questions = 0

  for (const demande of demandes) {
    const cle = demande.messageId
      ? cleDuJournal(demande.conversationId, demande.messageId)
      : undefined
    const ligne = cle ? parMessage.get(cle) : undefined
    if (ligne && cle) retrouvees.add(cle)
    // Sans fiche et plus ancienne que la première : elle n'a jamais eu l'occasion d'en avoir une.
    if (!ligne && (depuis === null || (demande.debut ?? Number.NEGATIVE_INFINITY) < depuis))
      continue
    demandesComparees += 1
    if (demande.statut === 'en-cours') enCours += 1
    else if (ligne) {
      if (ligne.etat === demande.statut) enAccord += 1
      else
        ecarts.push({
          conversationId: demande.conversationId,
          messageId: ligne.messageId,
          titre: demande.titre,
          fiche: ligne.fiche,
          etatDeLaFiche: ligne.etat,
          constatDeLaFiche: ligne.constat,
          etatDuBoard: demande.statut,
          constatDuBoard: demande.constat
        })
    } else if (demande.besoin?.nature === 'aucun') questions += 1
    else
      sansFiche.push({
        conversationId: demande.conversationId,
        ...(demande.messageId ? { messageId: demande.messageId } : {}),
        titre: demande.titre,
        etatDuBoard: demande.statut,
        nature: demande.besoin?.nature ?? 'sans-ligne'
      })
  }

  return {
    v: 1,
    calculeA: entree.calculeA,
    depuis,
    demandesComparees,
    enAccord,
    enCours,
    questions,
    ecartsDEtat: { total: ecarts.length, detail: ecarts.slice(0, DETAIL_MAX) },
    sansFiche: { total: sansFiche.length, detail: sansFiche.slice(0, DETAIL_MAX) },
    lignesSansDemande: parMessage.size - retrouvees.size,
    fiches: new Set(lignes.map((ligne) => ligne.fiche)).size,
    suites: lignes.filter((ligne) => ligne.role === 'suite').length,
    classementsDeduits: lignes.filter((ligne) => ligne.classement === 'deduit').length,
    filsAPlusieursFiches: plusDeUne(
      compterParValeursDistinctes(lignes.map((l) => [l.conversationId, l.fiche]))
    ),
    fichesAPlusieursFils: plusDeUne(
      compterParValeursDistinctes(lignes.map((l) => [l.fiche, l.conversationId]))
    )
  }
}

/** La mesure de fin de tour : au plus une par délai, sans jamais retarder ni casser un tour. */
export function creerMesureDesEcarts(deps: {
  racine: string
  lireLaCarte: () => Promise<Pick<CarteDesBesoins, 'projets'>>
  lireLignes: () => Promise<readonly LigneDeFiche[]>
  maintenant?: () => number
  delaiMs?: number
  attendre?: (fn: () => void, ms: number) => void
}): { planifier: () => void; mesurer: () => Promise<BilanDesEcarts> } {
  const maintenant = deps.maintenant ?? Date.now
  const delaiMs = deps.delaiMs ?? DELAI_DE_MESURE_MS
  const attendre =
    deps.attendre ??
    ((fn: () => void, ms: number): void => {
      setTimeout(fn, ms).unref?.()
    })
  let planifiee = false

  async function mesurer(): Promise<BilanDesEcarts> {
    const [carte, lignes] = await Promise.all([deps.lireLaCarte(), deps.lireLignes()])
    const bilan = mesurerLesEcarts({
      demandes: carte.projets.flatMap((projet) => projet.demandes),
      lignes,
      calculeA: maintenant()
    })
    const dossier = join(deps.racine, DOSSIER_DES_FICHES)
    await mkdir(dossier, { recursive: true })
    await writeFile(
      join(dossier, FICHIER_DES_ECARTS),
      `${JSON.stringify(bilan, null, 2)}\n`,
      'utf8'
    )
    return bilan
  }

  return {
    mesurer,
    planifier() {
      if (planifiee) return
      planifiee = true
      attendre(() => {
        planifiee = false
        mesurer().catch((erreur: unknown) =>
          console.warn(
            '[fiches] mesure des écarts impossible :',
            erreur instanceof Error ? erreur.message : erreur
          )
        )
      }, delaiMs)
    }
  }
}
