import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Ledger d'activité des agents IN-APP — append-only JSONL, un fichier par jour
 * (`trace-YYYY-MM-DD.jsonl`). Chaque commande bus / événement pilote / étape
 * d'orchestration y laisse une ligne : c'est la moitié « agents d'Autowin OS »
 * de l'observatoire (l'autre = les transcripts Claude Code, transcripts.ts).
 */

export interface TraceEvent {
  ts: string
  source: 'bus' | 'pilot' | 'orchestrate'
  name: string
  detail?: string
  ok?: boolean
}

const DETAIL_CAP = 200

export class TraceLedger {
  constructor(private readonly dir: string) {}

  private fileFor(date: Date): string {
    const d = date.toISOString().slice(0, 10)
    return join(this.dir, `trace-${d}.jsonl`)
  }

  append(e: Omit<TraceEvent, 'ts'>): void {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
      const ev: TraceEvent = {
        ts: new Date().toISOString(),
        source: e.source,
        name: e.name,
        detail: e.detail ? e.detail.slice(0, DETAIL_CAP) : undefined,
        ok: e.ok
      }
      appendFileSync(this.fileFor(new Date()), `${JSON.stringify(ev)}\n`, 'utf8')
    } catch {
      /* le traçage ne doit JAMAIS casser l'action tracée */
    }
  }

  /** Derniers n événements (fichiers du plus récent au plus ancien). */
  recent(n = 300): TraceEvent[] {
    let files: string[] = []
    try {
      files = readdirSync(this.dir)
        .filter((f) => f.startsWith('trace-') && f.endsWith('.jsonl'))
        .sort()
        .reverse()
    } catch {
      return []
    }
    const out: TraceEvent[] = []
    for (const f of files) {
      if (out.length >= n) break
      try {
        const lines = readFileSync(join(this.dir, f), 'utf8').trimEnd().split('\n').reverse()
        for (const line of lines) {
          if (out.length >= n) break
          try {
            out.push(JSON.parse(line) as TraceEvent)
          } catch {
            /* ligne corrompue — ignorée */
          }
        }
      } catch {
        /* fichier illisible — ignoré */
      }
    }
    return out // du plus récent au plus ancien
  }
}
