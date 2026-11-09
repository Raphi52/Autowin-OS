import { isPipelinePhase } from '../../shared/pipeline-phases'
import { lireProprietairesDeFichiers } from '../fichiers/proprietaire-fichier'
import type { Message, SendOptions, SendResult, StreamChunk } from '../providers/types'
import type { LanceurCommandeSkill, SpecCommandeSkill } from '../skills/skill-node-tools'
import {
  demarrerServeurOutilsNoeudSkill,
  libelleAppelObserve,
  porteLesOutilsNatifs,
  type PerimetreOutils
} from '../skills/skill-node-mcp'
import type { OrchestrationStep } from './orchestrator-contrats'

/**
 * LES ÉTAPES D'UN RUN DE LOT PEUVENT ÉCRIRE AU CHEF ET SAVOIR À QUI EST UN FICHIER.
 *
 * Les étapes du pipeline ne reçoivent aucun outil de l'app. La demande d'un lot leur dit pourtant
 * « bloqué par une information que seul le chef détient ? envoie-lui une question avec
 * ecrire_a_un_fil » : sans l'outil, l'agent du build laissait sa question dans son bilan, que le
 * chef ne lisait qu'une fois le lot en échec. Les lots d'un plan travaillent en même temps sur le
 * même dépôt : proprietaire_fichier leur dit, avant d'écrire, quel autre run ou fil tient déjà un
 * fichier. Ces DEUX outils seulement, signés du fil du lot. Le juge en reste privé : il rend un
 * verdict, il n'écrit rien et n'a pas de question à poser au chef.
 */
export const OUTILS_ETAPE_DE_LOT = ['ecrire_a_un_fil', 'proprietaire_fichier'] as const

export const PERIMETRE_ETAPE_DE_LOT: PerimetreOutils = {
  outils: OUTILS_ETAPE_DE_LOT,
  refus: (nom) =>
    `REFUSÉ — \`${nom}\` est indisponible depuis une étape d'un lot : seuls ${OUTILS_ETAPE_DE_LOT.join(' et ')} y sont servis. L'appel n'a pas eu lieu.`
}

const permis = (nom: string): boolean => (OUTILS_ETAPE_DE_LOT as readonly string[]).includes(nom)

/**
 * Le lanceur des étapes d'un run lancé par `fil`, ou rien si ce fil n'est pas un lot.
 *
 * L'expéditeur est le fil du lot, posé ici et jamais lu dans les arguments de l'agent : c'est la
 * même règle que dans le chat, où l'app signe le message du fil de l'appel.
 *
 * `dossier` est celui de l'étape, la copie de son run. proprietaire_fichier y répond, lu sur place :
 * par le bus, la commande lirait le dossier du FIL du lot, où la copie du run n'est qu'une copie parmi
 * d'autres, et l'agent lirait son propre travail comme celui d'un autre run.
 */
export function lanceurDuLot(
  fil: string | undefined,
  deps: {
    estUnLot: (fil: string) => boolean
    exec: (
      name: string,
      args: Record<string, unknown>,
      fil: string
    ) => ReturnType<LanceurCommandeSkill['exec']>
    catalogue: () => SpecCommandeSkill[]
  },
  dossier?: string
): LanceurCommandeSkill | undefined {
  if (!fil || !deps.estUnLot(fil)) return undefined
  return {
    // Seconde barrière : le serveur refuse déjà tout nom hors périmètre, le lanceur aussi.
    exec: async (name, args) => {
      if (!permis(name)) return { ok: false, error: PERIMETRE_ETAPE_DE_LOT.refus(name) }
      if (name !== 'proprietaire_fichier' || !dossier) return deps.exec(name, args, fil)
      try {
        const data = await lireProprietairesDeFichiers({
          workspace: dossier,
          chemins: args.chemins,
          conversationId: fil
        })
        return { ok: true, data }
      } catch (erreur) {
        return { ok: false, error: erreur instanceof Error ? erreur.message : String(erreur) }
      }
    },
    catalogue: () => deps.catalogue().filter((spec) => permis(spec.name))
  }
}

/** L'appel est-il celui d'une étape (hors juge) qui peut recevoir les outils par le canal natif ? */
export function etapeQuiRecoitLesOutilsDuLot(fournisseur: string, opts: SendOptions): boolean {
  const phase = opts.execution?.phaseAppelante
  return (
    phase !== undefined &&
    isPipelinePhase(phase) &&
    phase !== 'judge' &&
    // Un nœud skill porte déjà les siens.
    !opts.skillNodeTools &&
    porteLesOutilsNatifs(fournisseur)
  )
}

interface RegistreQuiEnvoie {
  send(
    id: string,
    messages: Message[],
    opts?: SendOptions,
    onChunk?: (c: StreamChunk) => void
  ): Promise<SendResult>
}

/**
 * Le registre du run, dont les envois d'étape portent les outils du lot.
 *
 * Posé sur le registre et non sur chaque chemin : une étape build part par le chemin simple, par
 * plusieurs modèles en parallèle ou découpée en sous-tâches, et les trois passent par `send`. Le
 * serveur vit le temps d'un envoi, comme celui d'un nœud skill. `lanceur` est relu à chaque envoi,
 * avec le dossier de l'étape : un fil devient ou cesse d'être un lot pendant la vie de l'app.
 */
export function registreAvecOutilsDuLot<R extends RegistreQuiEnvoie>(
  registre: R,
  lanceur: (dossier: string | undefined) => LanceurCommandeSkill | undefined,
  push?: (s: OrchestrationStep) => void
): R {
  const tracer = (detail: string): void => push?.({ step: 'exec', role: 'subagent', detail })
  const envoyer: RegistreQuiEnvoie['send'] = async (id, messages, opts = {}, onChunk) => {
    const outils = etapeQuiRecoitLesOutilsDuLot(id, opts) ? lanceur(opts.execution?.cwd) : undefined
    if (!outils) return registre.send(id, messages, opts, onChunk)
    const phase = opts.execution?.phaseAppelante ?? ''
    let serveur: Awaited<ReturnType<typeof demarrerServeurOutilsNoeudSkill>>
    try {
      serveur = await demarrerServeurOutilsNoeudSkill(outils, {
        perimetre: PERIMETRE_ETAPE_DE_LOT,
        observer: (appel) => tracer(libelleAppelObserve(appel, phase))
      })
    } catch (error) {
      // L'étape part sans l'outil, comme avant, et la privation est dite.
      tracer(
        `outils du lot indisponibles pour ${phase} : ${error instanceof Error ? error.message : String(error)}`
      )
      return registre.send(id, messages, opts, onChunk)
    }
    tracer(`outils du lot servis à ${phase} : ${serveur.nomsExposes().join(', ')}`)
    try {
      return await registre.send(
        id,
        messages,
        {
          ...opts,
          skillNodeTools: {
            mcpConfig: serveur.configMcp(),
            allowedTools: serveur.nomsExposes(),
            sansServeursUtilisateur: true
          }
        },
        onChunk
      )
    } finally {
      await serveur.arreter()
    }
  }
  return new Proxy(registre, {
    get(cible, cle) {
      if (cle === 'send') return envoyer
      const valeur = Reflect.get(cible, cle, cible)
      return typeof valeur === 'function' ? valeur.bind(cible) : valeur
    }
  })
}
