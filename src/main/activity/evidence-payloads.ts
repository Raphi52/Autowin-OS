import type { TracePayload } from './trace-event'

/**
 * Forme MINIMALE d'une preuve d'execution dont la trace a besoin — structurelle plutot qu'un import
 * d'`ExecutionEvidence` (`providers/types.ts`), pour que l'ajout d'un champ la-bas ne puisse jamais
 * faire echouer une ecriture de trace ici.
 */
interface EvidenceLike {
  type: string
  summary?: string
  command?: string
  exitCode?: number
  stdout?: string
  diff?: string
  path?: string
  ok?: boolean
}

/**
 * Plafond par charge. Une trace causale est un fichier append-only relu entierement par Observatory :
 * y deverser des sorties de plusieurs centaines de milliers de caracteres rendrait la vue inutilisable
 * et le fichier ingerable. La borne est donc necessaire — mais elle est ANNONCEE dans le contenu et
 * degrade la fidelite declaree, jamais silencieuse.
 */
const MAX_CONTENU = 20_000

interface Borne {
  texte: string
  tronque: boolean
}

function borner(valeur: string): Borne {
  if (valeur.length <= MAX_CONTENU) return { texte: valeur, tronque: false }
  return {
    texte: `${valeur.slice(0, MAX_CONTENU)}\n… (tronqué : ${valeur.length} caractères au total)`,
    tronque: true
  }
}

interface EvidencePayloadResult {
  payloads: TracePayload[]
  /**
   * `exact` UNIQUEMENT si le contenu integral est transporte.
   *
   * Avant ce module, l'evenement declarait `exact` en ne portant qu'un resume : un libelle menteur,
   * plus nuisible qu'une trace absente puisqu'on le croit. `derived` est le terme du contrat
   * (`TraceObservation`) pour « il y a une information, elle n'est pas la source integrale ».
   */
  fidelity: 'exact' | 'derived'
  /**
   * Ce qui manque, en clair, quand la fidelite n'est pas `exact`. Le contrat prevoit ce champ
   * (`TraceObservation.limitation`) : une degradation NOMMEE vaut infiniment mieux qu'une troncature
   * muette, qui se lit comme un contenu complet.
   */
  limitation?: string
}

/**
 * Construit les charges de trace d'une action reellement executee, en transportant ce que le CHAT
 * affiche deja (commande, code de sortie, sortie brute, diff) au lieu du seul resume.
 *
 * L'appel et le resultat sont separes en deux charges : c'est la distinction que le contrat exprime
 * avec `tool-call` / `tool-result`, et la confondre obligeait le lecteur a deviner quelle partie du
 * texte etait la commande et quelle partie sa sortie.
 */
export function evidencePayloads(item: EvidenceLike): EvidencePayloadResult {
  const payloads: TracePayload[] = []
  let tronque = false
  let integral = false

  const appel = item.command ?? item.path
  if (appel) {
    const borne = borner(appel)
    tronque = tronque || borne.tronque
    integral = true
    payloads.push({ kind: 'tool-call', name: item.type, content: borne.texte })
  }

  const sortie = item.stdout ?? item.diff
  if (sortie) {
    const borne = borner(sortie)
    tronque = tronque || borne.tronque
    integral = true
    const entete = typeof item.exitCode === 'number' ? `exit=${item.exitCode}\n` : ''
    payloads.push({
      kind: item.ok === false ? 'error' : 'tool-result',
      name: item.type,
      content: `${entete}${borne.texte}`
    })
  } else if (typeof item.exitCode === 'number') {
    // Un code de sortie sans sortie reste une information utile : « la commande a fini par 1 ».
    payloads.push({
      kind: item.ok === false ? 'error' : 'tool-result',
      name: item.type,
      content: `exit=${item.exitCode}`
    })
  }

  // Aucun contenu reel : on retombe sur le resume — c'etait l'etat de TOUTES les traces avant ce
  // correctif, et c'est desormais declare comme approximatif.
  if (payloads.length === 0) {
    payloads.push({
      kind: 'tool-call',
      name: item.type,
      content: item.summary?.trim() || item.type || 'action sans détail'
    })
  }

  if (integral && !tronque) return { payloads, fidelity: 'exact' }
  return {
    payloads,
    fidelity: 'derived',
    limitation: tronque
      ? `sortie bornée à ${MAX_CONTENU} caractères par charge`
      : 'résumé seul — la commande, la sortie et le diff ne sont pas disponibles'
  }
}
