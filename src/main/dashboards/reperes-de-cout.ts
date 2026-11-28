/**
 * REPÈRES DE COÛT servis à l'agent à chaque tour : ce que CE fil a déjà coûté, et ce que coûte
 * d'ordinaire une exécution `orchestrate` sur ce poste.
 *
 * Pourquoi : l'agent du chat décide de lancer une exécution sans aucun ordre de grandeur. Mesure du
 * 2026-11-19 sur `cost.jsonl` (706 exécutions) : médiane 4,6 $, 9 sur 10 sous 20 $, la pire 411 $,
 * contre moins d'un dollar pour un tour de chat. Un fil a lancé sur un périmètre seulement SUPPOSÉ
 * (« corrige-moi si besoin ») une exécution de 235 $ et 11 heures ; une question coûtait 0,7 $.
 * Le contexte ne disait ni l'un ni l'autre : l'agent ne pouvait pas peser l'enjeu.
 *
 * Ce module INFORME, il ne bloque rien : aucun plafond de dépense ne coupe un run (décision de
 * l'utilisateur du 2026-10-28, « ni budget ni blocage », `execution-supervisor.ts`).
 *
 * Tenu au fil de l'eau (une ligne de coût = O(1)) : le registre compte 24 000 lignes et l'état du
 * tour est calculé à CHAQUE tour, sur le fil qui sert l'interface.
 */
import type { TurnCost } from './cost'

/** Rôles du registre qui relèvent d'une exécution lancée par `orchestrate`, pas du tour de chat. */
const ROLES_EXECUTION = new Set(['subagent', 'judge', 'orchestrator'])

/** Sous ce nombre de mesures, une médiane ne dit rien : le repère reste absent. */
export const MESURES_MIN = 5

export const LEGENDE_REPERES_DE_COUT =
  'Mesuré sur ce poste (registre des coûts). ceFil : dépensé par ce fil jusqu’ici, exécutions comprises ' +
  '(le tour en cours n’y entre qu’à la fin de chaque appel). uneExecution : ce que coûte un `orchestrate` ' +
  'lancé depuis un tour (9 sur 10 sous neufSurDixSousUsd). unTourDeChat : un tour sans exécution.'

export interface ReperesDeCout {
  ceFil?: { depenseUsd: number; dontExecutionsUsd: number; toursDeChat: number }
  uneExecution?: { medianeUsd: number; neufSurDixSousUsd: number; maxUsd: number; mesurees: number }
  unTourDeChat?: { medianeUsd: number; mesures: number }
  legende: string
}

interface CoutDuFil {
  depenseUsd: number
  dontExecutionsUsd: number
  toursDeChat: Set<string>
}

/** Arrondi lisible : au cent sous 10 $, au dollar au-delà (le détail n'aide pas à décider). */
function arrondi(usd: number): number {
  return usd >= 10 ? Math.round(usd) : Math.round(usd * 100) / 100
}

function quantile(tries: readonly number[], q: number): number {
  return tries[Math.min(tries.length - 1, Math.floor(q * (tries.length - 1)))] ?? 0
}

export class ReperesDeCoutEnCours {
  private readonly parFil = new Map<string, CoutDuFil>()
  /** Clé `fil|tour` : une exécution se rattache au tour de chat qui l'a lancée. */
  private readonly executions = new Map<string, number>()
  private readonly toursDeChat = new Map<string, number>()
  /** Distributions triées, recalculées seulement après un ajout. */
  private cache?: Pick<ReperesDeCout, 'uneExecution' | 'unTourDeChat'>

  ajouter(t: TurnCost): void {
    const usd = typeof t.costUsd === 'number' && Number.isFinite(t.costUsd) ? t.costUsd : 0
    if (!t.conversationId) return
    const fil = this.parFil.get(t.conversationId) ?? {
      depenseUsd: 0,
      dontExecutionsUsd: 0,
      toursDeChat: new Set<string>()
    }
    fil.depenseUsd += usd
    const execution = ROLES_EXECUTION.has(t.role ?? '')
    if (execution) fil.dontExecutionsUsd += usd
    if (t.role === 'supervisor' && t.turnId) fil.toursDeChat.add(t.turnId)
    this.parFil.set(t.conversationId, fil)
    if (!t.turnId) return
    const cle = `${t.conversationId}|${t.turnId}`
    if (execution) this.executions.set(cle, (this.executions.get(cle) ?? 0) + usd)
    else if (t.role === 'supervisor')
      this.toursDeChat.set(cle, (this.toursDeChat.get(cle) ?? 0) + usd)
    else return
    this.cache = undefined
  }

  /**
   * Ce que ce fil a coûté jusqu'ici, exécutions comprises ; `undefined` s'il n'a aucune ligne au
   * registre. Lu par les plans de lots (coût attendu au dépôt, dépense à chaque réveil du chef).
   */
  depenseDuFil(conversationId: string): number | undefined {
    return this.parFil.get(conversationId)?.depenseUsd
  }

  reperes(conversationId?: string): ReperesDeCout {
    if (!this.cache) {
      const execs = [...this.executions.values()].filter((v) => v > 0).sort((a, b) => a - b)
      // Un tour qui a lancé une exécution n'est pas « un tour de chat » : sa part chat seule
      // ferait croire qu'une demande lourde coûte un tour léger.
      const chats = [...this.toursDeChat]
        .filter(([cle, v]) => v > 0 && !this.executions.has(cle))
        .map(([, v]) => v)
        .sort((a, b) => a - b)
      this.cache = {
        ...(execs.length >= MESURES_MIN
          ? {
              uneExecution: {
                medianeUsd: arrondi(quantile(execs, 0.5)),
                neufSurDixSousUsd: arrondi(quantile(execs, 0.9)),
                maxUsd: arrondi(execs[execs.length - 1] ?? 0),
                mesurees: execs.length
              }
            }
          : {}),
        ...(chats.length >= MESURES_MIN
          ? { unTourDeChat: { medianeUsd: arrondi(quantile(chats, 0.5)), mesures: chats.length } }
          : {})
      }
    }
    const fil = conversationId ? this.parFil.get(conversationId) : undefined
    return {
      ...(fil
        ? {
            ceFil: {
              depenseUsd: arrondi(fil.depenseUsd),
              dontExecutionsUsd: arrondi(fil.dontExecutionsUsd),
              toursDeChat: fil.toursDeChat.size
            }
          }
        : {}),
      ...this.cache,
      legende: LEGENDE_REPERES_DE_COUT
    }
  }
}
