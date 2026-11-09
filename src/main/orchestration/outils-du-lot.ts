import { isPipelinePhase } from '../../shared/pipeline-phases'
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
 * LES ÉTAPES D'UN RUN DE LOT PEUVENT ÉCRIRE AU CHEF.
 *
 * Les étapes du pipeline ne reçoivent aucun outil de l'app. La demande d'un lot leur dit pourtant
 * « bloqué par une information que seul le chef détient ? envoie-lui une question avec
 * ecrire_a_un_fil » : sans l'outil, l'agent du build laissait sa question dans son bilan, que le
 * chef ne lisait qu'une fois le lot en échec. Elles reçoivent donc ce SEUL outil, signé du fil du
 * lot. Le juge en reste privé : il rend un verdict, il n'a pas de question à poser au chef.
 */
export const OUTILS_ETAPE_DE_LOT = ['ecrire_a_un_fil'] as const

export const PERIMETRE_ETAPE_DE_LOT: PerimetreOutils = {
  outils: OUTILS_ETAPE_DE_LOT,
  refus: (nom) =>
    `REFUSÉ — \`${nom}\` est indisponible depuis une étape d'un lot : seul ecrire_a_un_fil y est servi. L'appel n'a pas eu lieu.`
}

const permis = (nom: string): boolean => (OUTILS_ETAPE_DE_LOT as readonly string[]).includes(nom)

/**
 * Le lanceur des étapes d'un run lancé par `fil`, ou rien si ce fil n'est pas un lot.
 *
 * L'expéditeur est le fil du lot, posé ici et jamais lu dans les arguments de l'agent : c'est la
 * même règle que dans le chat, où l'app signe le message du fil de l'appel.
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
  }
): LanceurCommandeSkill | undefined {
  if (!fil || !deps.estUnLot(fil)) return undefined
  return {
    // Seconde barrière : le serveur refuse déjà tout nom hors périmètre, le lanceur aussi.
    exec: (name, args) =>
      permis(name)
        ? deps.exec(name, args, fil)
        : Promise.resolve({ ok: false, error: PERIMETRE_ETAPE_DE_LOT.refus(name) }),
    catalogue: () => deps.catalogue().filter((spec) => permis(spec.name))
  }
}

/** L'appel est-il celui d'une étape (hors juge) qui peut recevoir l'outil par le canal natif ? */
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
 * Le registre du run, dont les envois d'étape portent l'outil du lot.
 *
 * Posé sur le registre et non sur chaque chemin : une étape build part par le chemin simple, par
 * plusieurs modèles en parallèle ou découpée en sous-tâches, et les trois passent par `send`. Le
 * serveur vit le temps d'un envoi, comme celui d'un nœud skill. `lanceur` est relu à chaque envoi :
 * un fil devient ou cesse d'être un lot pendant la vie de l'app.
 */
export function registreAvecOutilsDuLot<R extends RegistreQuiEnvoie>(
  registre: R,
  lanceur: () => LanceurCommandeSkill | undefined,
  push?: (s: OrchestrationStep) => void
): R {
  const tracer = (detail: string): void => push?.({ step: 'exec', role: 'subagent', detail })
  const envoyer: RegistreQuiEnvoie['send'] = async (id, messages, opts = {}, onChunk) => {
    const outils = etapeQuiRecoitLesOutilsDuLot(id, opts) ? lanceur() : undefined
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
        `outil pour écrire au chef indisponible pour ${phase} : ${error instanceof Error ? error.message : String(error)}`
      )
      return registre.send(id, messages, opts, onChunk)
    }
    tracer(`outil servi à ${phase} pour écrire au chef : ${serveur.nomsExposes().join(', ')}`)
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
