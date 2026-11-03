/**
 * LES POST-IT DU BOARD = LES RUN.md LÉGERS (conv-1456, 2026-11-03).
 *
 * Demande d'origine (conv-1418) : « faire un run.md vraiment à chaque tâche et baser le board sur
 * les run.md », reprise ici : « j'avais déjà demandé à ce que ça soit basé dessus, récup et finis ce
 * travail commencé ». Les deux premières étapes sont faites : une fiche par nouvelle demande
 * (f49e01a7, 9d898055), puis la mesure contre le Board — 134 demandes comparées le 03/11, 0 écart
 * d'état, 0 demande sans fiche (`demandes/ecarts.json`). Troisième étape, ici : un post-it n'est
 * plus un FIL, c'est une TÂCHE, c'est-à-dire un RUN.md léger et ses suites, d'où qu'elles viennent.
 * Un fil qui a porté trois nouvelles demandes donne trois post-it ; un chantier et ses lots, un seul ;
 * les versions « façon N/3 », le post-it de leur demande d'origine.
 *
 * UNE DEMANDE SANS FICHE GARDE SA PLACE. Elle rejoint la tâche de la demande qui la précède dans son
 * fil : une question (pas de fiche, voulu) ou un tour pas encore fini (la fiche s'écrit à la fin).
 * Sans demande rangée avant elle — un fil plus ancien que les fiches —, elle reste sur le post-it de
 * son fil, comme avant : la clé de ce post-it est toujours l'id du fil, donc les états posés à la
 * main avant le changement s'y appliquent encore.
 *
 * L'ÉTAT reste celui des preuves, calculé en direct : c'est le même calcul que la fiche recopie à
 * chaque fin de tour, et `ecarts-des-fiches.ts` continue de dire s'ils divergent.
 *
 * Partagé par la vue (`carte-riviere.ts`) et la copie du Board (`board-dossier.ts`) : avant, chacun
 * refaisait son propre regroupement par fil, et rien ne les empêchait de diverger.
 */
import type { DemandeDeLaCarte, ProjetDeLaCarte } from './carte-des-besoins'

export interface TacheDuBoard {
  /**
   * L'identité du post-it : celle de sa fiche (`conv-1441.slug-xyz`), sinon l'id du fil. Elle range
   * les états posés à la main, que la copie du Board ne lit que sur `[\w.-]` (d'où aucun `/`).
   */
  cle: string
  /** Le RUN.md léger, relatif au dossier `demandes/` ; absent = le post-it d'un fil sans fiche. */
  fiche?: string
  /** Le fil de sa dernière demande : celui qui s'ouvre et que « vérifier » vise. */
  conversationId: string
  /** Le besoin de la fiche (sa première demande) ; pour un fil sans fiche, le titre du fil. */
  titre: string
  projet: Pick<ProjetDeLaCarte, 'cle' | 'libelle'>
  /** Ses demandes de la plus ancienne à la plus récente, sans les copies identiques d'une branche. */
  demandes: DemandeDeLaCarte[]
  derniere: DemandeDeLaCarte
  /** L'heure de sa demande la plus récente ; absente si aucune n'est datée. */
  derniereActivite?: number
  /**
   * Sa dernière demande est aussi la dernière de son fil. Sinon le fil est passé à une autre tâche,
   * et un `/check` envoyé dans ce fil vérifierait cette autre tâche, pas celle-ci.
   */
  derniereDuFil: boolean
}

const SUFFIXE_DE_FICHE = /\/RUN\.md$/u

/** `conv-1441/slug-xyz/RUN.md` → `conv-1441.slug-xyz` : unique, et lisible comme clé d'état manuel. */
export function cleDeLaFiche(fiche: string): string {
  return fiche.replace(SUFFIXE_DE_FICHE, '').replace(/\//gu, '.')
}

/** Le fil où la fiche est née : son premier dossier (`fiches-de-demande.ts`). */
function filDeLaFiche(fiche: string): string {
  return fiche.split('/')[0] ?? ''
}

/**
 * Une branche du fil recopie ses demandes (même heure, même texte, même réponse) : celle d'une
 * « façon N/3 » a sa propre réponse et reste, celle d'un retour en arrière est un doublon.
 */
function memeDemande(a: DemandeDeLaCarte, b: DemandeDeLaCarte): boolean {
  return (
    a.conversationId !== b.conversationId &&
    a.debut === b.debut &&
    a.titre === b.titre &&
    a.statut === b.statut &&
    a.constat === b.constat
  )
}

type Projet = Pick<ProjetDeLaCarte, 'cle' | 'libelle' | 'demandes'>

/** `-Infinity - -Infinity` vaut NaN : deux demandes sans heure restent dans leur ordre. */
const ordre = (a: number, b: number): number => (a === b ? 0 : a - b)

/** Les post-it du Board, le plus récemment actif d'abord. */
export function tachesDuBoard(projets: readonly Projet[]): TacheDuBoard[] {
  const parFil = new Map<string, { projet: Projet; demandes: DemandeDeLaCarte[] }>()
  for (const projet of projets)
    for (const demande of projet.demandes) {
      const fil = parFil.get(demande.conversationId)
      if (fil) fil.demandes.push(demande)
      else parFil.set(demande.conversationId, { projet, demandes: [demande] })
    }

  const enConstruction = new Map<
    string,
    { fiche?: string; projet: Projet; demandes: { demande: DemandeDeLaCarte; quand: number }[] }
  >()
  const derniereDuFil = new Map<string, DemandeDeLaCarte>()
  for (const [conversationId, fil] of parFil) {
    const ordonnees = [...fil.demandes].sort((a, b) => a.rang - b.rang)
    derniereDuFil.set(conversationId, ordonnees[ordonnees.length - 1])
    let fiche: string | undefined
    // Une demande sans heure se range à celle de la précédente de son fil : l'ordre du fil tient.
    let quand = Number.NEGATIVE_INFINITY
    for (const demande of ordonnees) {
      if (demande.fiche) fiche = demande.fiche
      if (demande.debut !== undefined) quand = demande.debut
      const cle = fiche ? cleDeLaFiche(fiche) : conversationId
      let tache = enConstruction.get(cle)
      if (!tache) {
        tache = { ...(fiche ? { fiche } : {}), projet: fil.projet, demandes: [] }
        enConstruction.set(cle, tache)
      }
      tache.demandes.push({ demande, quand })
    }
  }

  const taches: TacheDuBoard[] = []
  for (const [cle, tache] of enConstruction) {
    // Tri STABLE : à heure égale (une copie et son original), l'ordre des fils est gardé.
    const triees = [...tache.demandes].sort((a, b) => ordre(a.quand, b.quand)).map((d) => d.demande)
    const demandes: DemandeDeLaCarte[] = []
    for (const demande of triees)
      if (!demandes.some((gardee) => memeDemande(gardee, demande))) demandes.push(demande)
    const derniere = demandes[demandes.length - 1]
    let derniereActivite: number | undefined
    for (const d of demandes)
      if (d.debut !== undefined && (derniereActivite === undefined || d.debut > derniereActivite))
        derniereActivite = d.debut
    // Le projet du fil où la fiche est née, même quand un lot d'un autre dossier y a rangé sa suite.
    const projet = (tache.fiche && parFil.get(filDeLaFiche(tache.fiche))?.projet) || tache.projet
    const auBout = derniereDuFil.get(derniere.conversationId)
    taches.push({
      cle,
      ...(tache.fiche ? { fiche: tache.fiche } : {}),
      conversationId: derniere.conversationId,
      titre: tache.fiche
        ? demandes[0].titre
        : derniere.conversationTitre || derniere.conversationId,
      projet: { cle: projet.cle, libelle: projet.libelle },
      demandes,
      derniere,
      ...(derniereActivite === undefined ? {} : { derniereActivite }),
      derniereDuFil: auBout === derniere
    })
  }
  return taches.sort((a, b) =>
    ordre(
      b.derniereActivite ?? Number.NEGATIVE_INFINITY,
      a.derniereActivite ?? Number.NEGATIVE_INFINITY
    )
  )
}
