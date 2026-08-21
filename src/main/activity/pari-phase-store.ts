import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { IssuePhase, PariPhase } from '../../shared/pari-calibration'

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
    /*
     * UN PARI POSTERIEUR AU VERDICT N'EST PAS UNE PREDICTION. Sans cette garde, une boucle
     * juge -> correction -> nouvelle phase du meme run pouvait deposer un pari alors que l'issue
     * etait deja connue : la non-revisabilite n'etait qu'apparente, puisqu'il suffisait de parier
     * sur une AUTRE phase du meme run pour predire un resultat deja tombe.
     */
    if (this.lireIssues().some((issue) => issue.runId === pari.runId)) return false
    mkdirSync(dirname(this.chemin), { recursive: true })
    appendFileSync(this.chemin, `${JSON.stringify(pari)}\n`, { encoding: 'utf8', flush: true })
    return true
  }

  /**
   * Inscrit l'ARBITRAGE d'un run : le verdict, une fois connu, rejoint le journal a cote des paris.
   * Sans cette ligne, la mesure ne vivrait que dans le log d'un run et personne ne pourrait relire
   * l'historique -- exactement le genre de mecanique presente mais inerte qu'on cherche a eviter.
   * Comme le pari, un arbitrage ne se revise pas.
   */
  arbitrer(runId: string, reussie: boolean): boolean {
    /*
     * GARDE A LA MAILLE PHASE, PAS RUN. Avec une garde au niveau du run, un arbitrage interrompu
     * apres la premiere ligne (crash, disque plein, arret de l'app) devenait definitivement
     * irrattrapable : les paris restants du run n'auraient plus jamais d'issue, alors que leur
     * verdict etait connu. A la maille phase, la reprise complete ce qui manque et ne touche pas
     * ce qui est deja inscrit.
     */
    const dejaArbitrees = new Set(
      this.lireIssues()
        .filter((issue) => issue.runId === runId)
        .map((issue) => issue.phase)
    )
    const aInscrire = this.lire().filter(
      (pari) => pari.runId === runId && !dejaArbitrees.has(pari.phase)
    )
    if (!aInscrire.length) return false
    mkdirSync(dirname(this.chemin), { recursive: true })
    /*
     * UNE SEULE ecriture pour les N lignes : un append par phase laissait une fenetre ou l'arbitrage
     * etait a moitie inscrit.
     */
    const bloc = aInscrire
      .map((pari) =>
        JSON.stringify({
          arbitrage: true,
          runId,
          phase: pari.phase,
          reussie,
          jugee: true,
          arbitreA: new Date().toISOString()
        })
      )
      .join('\n')
    appendFileSync(this.chemin, `${bloc}\n`, { encoding: 'utf8', flush: true })
    return true
  }

  /** Les arbitrages deja inscrits, relus pour l'appariement. */
  lireIssues(): IssuePhase[] {
    return this.lignes()
      .filter((ligne) => ligne.arbitrage === true)
      .map((ligne) => ({
        runId: String(ligne.runId),
        phase: String(ligne.phase),
        reussie: ligne.reussie === true,
        jugee: true
      }))
  }

  private lignes(): Record<string, unknown>[] {
    this.illisibles = 0
    if (!existsSync(this.chemin)) return []
    const lignes: Record<string, unknown>[] = []
    for (const ligne of readFileSync(this.chemin, 'utf8').split('\n')) {
      if (!ligne.trim()) continue
      try {
        const parse = JSON.parse(ligne) as Record<string, unknown>
        if (typeof parse.runId === 'string' && typeof parse.phase === 'string') lignes.push(parse)
        else this.illisibles += 1
      } catch {
        this.illisibles += 1
      }
    }
    return lignes
  }

  /** Les PARIS seuls : les lignes d'arbitrage vivent dans le même fichier et n'en sont pas. */
  lire(): PariPhase[] {
    return this.lignes()
      .filter((ligne) => ligne.arbitrage !== true)
      .map((ligne) => ligne as unknown as PariPhase)
  }

  /** Nombre de lignes écartées à la dernière lecture — un compte qui monte est un défaut à regarder. */
  lignesIllisibles(): number {
    return this.illisibles
  }
}
