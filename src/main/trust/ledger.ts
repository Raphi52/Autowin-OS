// Ledger de calibration des juges (candidat 6) : mesure la "honest limit" -
// le taux de faux-green / faux-red par modele-juge, une fois confirme par l'humain.
// Un verdict n'entre dans le calcul de calibration que s'il porte une humanTruth
// (verite terrain confirmee par l'humain) ; sans elle, il est ignore.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type Verdict = 'green' | 'red'

export interface JudgeVerdict {
  judgeModel: string
  verdict: Verdict
  /** Verite terrain confirmee par l'humain, optionnelle. */
  humanTruth?: Verdict
}

export interface Calibration {
  /** Nombre total de verdicts enregistres pour ce modele (avec ou sans humanTruth). */
  total: number
  /** Nombre de verdicts confirmes par l'humain (humanTruth present). */
  confirmed: number
  /** Verdict green alors que la verite terrain est red. */
  falseGreen: number
  /** Verdict red alors que la verite terrain est green. */
  falseRed: number
  /** (confirmes corrects) / confirmes, ou null si 0 confirme. */
  accuracy: number | null
}

export interface RankingEntry {
  model: string
  accuracy: number | null
  confirmed: number
}

export class TrustLedger {
  private verdicts: JudgeVerdict[] = []

  /** `persistPath` : fichier JSONL où historiser les verdicts (rechargé au démarrage). */
  constructor(private readonly persistPath?: string) {
    if (persistPath && existsSync(persistPath)) {
      for (const line of readFileSync(persistPath, 'utf8').split(/\r?\n/)) {
        if (!line) continue
        try {
          this.verdicts.push(JSON.parse(line) as JudgeVerdict)
        } catch {
          /* ligne corrompue — ignorée */
        }
      }
    }
  }

  record(v: JudgeVerdict): void {
    this.verdicts.push(v)
    if (this.persistPath) {
      try {
        mkdirSync(dirname(this.persistPath), { recursive: true })
        appendFileSync(this.persistPath, `${JSON.stringify(v)}\n`, 'utf8')
      } catch {
        /* persistance best-effort */
      }
    }
  }

  calibration(model: string): Calibration {
    const forModel = this.verdicts.filter((v) => v.judgeModel === model)
    const total = forModel.length

    let confirmed = 0
    let falseGreen = 0
    let falseRed = 0
    let correct = 0

    for (const v of forModel) {
      if (v.humanTruth === undefined) continue
      confirmed += 1
      if (v.verdict === v.humanTruth) {
        correct += 1
      } else if (v.verdict === 'green' && v.humanTruth === 'red') {
        falseGreen += 1
      } else if (v.verdict === 'red' && v.humanTruth === 'green') {
        falseRed += 1
      }
    }

    const accuracy = confirmed === 0 ? null : correct / confirmed

    return { total, confirmed, falseGreen, falseRed, accuracy }
  }

  ranking(): RankingEntry[] {
    return this.models()
      .map((model) => {
        const c = this.calibration(model)
        return { model, accuracy: c.accuracy, confirmed: c.confirmed }
      })
      .sort((a, b) => {
        // Tri accuracy desc, null (aucun confirme) toujours en dernier.
        if (a.accuracy === null && b.accuracy === null) return 0
        if (a.accuracy === null) return 1
        if (b.accuracy === null) return -1
        return b.accuracy - a.accuracy
      })
  }

  models(): string[] {
    const seen = new Set<string>()
    for (const v of this.verdicts) {
      seen.add(v.judgeModel)
    }
    return [...seen]
  }
}
