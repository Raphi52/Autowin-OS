import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { PariPhase } from '../../shared/pari-calibration'

/**
 * Journal des paris de phase — append-only, DÉLIBÉRÉMENT séparé du journal outcome-learning.
 *
 * La tentation était d'ajouter un `kind: 'pari'` à `OutcomeLearningEventV1`. C'est un piège :
 * `assertEvent` (outcome-learning-ledger.ts:33) JETTE sur un `kind` inconnu, et `read()` fait échouer
 * la lecture de TOUT le journal sur une seule ligne invalide. Un journal contenant nos paris
 * deviendrait donc illisible pour toute version d'Autowin antérieure à ce chantier — sur un poste où
 * l'application tourne pendant qu'on développe, c'est une panne qu'on s'infligerait soi-même. Un
 * fichier à nous coûte quelques lignes et ne peut rien casser chez le voisin.
 *
 * Deux propriétés portent tout le sens de la mesure :
 * - un pari ne se RÉVISE pas (`deposer` refuse une phase déjà pariée) — sinon la prédiction se
 *   réécrirait à la lumière du résultat, et mesurer une prophétie ajustée après coup ne mesure rien ;
 * - une ligne illisible est IGNORÉE et comptée, jamais fatale — contrairement au journal principal.
 *   Perdre des semaines d'historique de mesure parce qu'une écriture a été coupée serait absurde pour
 *   un journal dont personne ne dépend pour fonctionner.
 */
export class PariPhaseStore {
  readonly chemin: string
  private illisibles = 0

  constructor(chemin: string) {
    this.chemin = resolve(chemin)
  }

  /** Rend `false` si la phase a déjà un pari (aucune révision), `true` si le pari est écrit. */
  deposer(pari: PariPhase): boolean {
    if (!Number.isFinite(pari.confiance) || pari.confiance < 0 || pari.confiance > 1) {
      throw new Error(`confiance hors [0,1] : ${String(pari.confiance)}`)
    }
    if (!pari.refutateur.trim()) {
      throw new Error('pari sans réfutateur : un chiffre sans condition de démenti ne mesure rien')
    }
    const identite = `${pari.runId}/${pari.phase}`
    if (this.lire().some((existant) => `${existant.runId}/${existant.phase}` === identite)) {
      return false
    }
    mkdirSync(dirname(this.chemin), { recursive: true })
    appendFileSync(this.chemin, `${JSON.stringify(pari)}\n`, { encoding: 'utf8', flush: true })
    return true
  }

  lire(): PariPhase[] {
    this.illisibles = 0
    if (!existsSync(this.chemin)) return []
    const paris: PariPhase[] = []
    for (const ligne of readFileSync(this.chemin, 'utf8').split('\n')) {
      if (!ligne.trim()) continue
      try {
        const parse = JSON.parse(ligne) as PariPhase
        if (typeof parse.runId === 'string' && typeof parse.phase === 'string') paris.push(parse)
        else this.illisibles += 1
      } catch {
        this.illisibles += 1
      }
    }
    return paris
  }

  /** Nombre de lignes écartées à la dernière lecture — un compte qui monte est un défaut à regarder. */
  lignesIllisibles(): number {
    return this.illisibles
  }
}
