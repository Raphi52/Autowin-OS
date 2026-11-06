import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * RELEVÉ MÉMOIRE ET PROCESSEUR DE L'APP (conv-1077, 2026-10-22).
 *
 * Mesure du 22/10 : trois `electron.exe` pesaient ~872, 433 et 307 Mo, et rien dans l'app ne disait
 * lequel est quoi (fenêtre, GPU, service) — `app.getAppMetrics()` n'était appelé nulle part. Décision
 * du 2026-09-23 : mesurer d'abord, au plus une fois par minute, affiché dans l'onglet Latence.
 *
 * Fichier PROPRE (`memoire.jsonl`), pas `gels.jsonl` : la vue des gels lit les 200 DERNIÈRES lignes ;
 * un relevé par minute en aurait chassé tous les gels en un peu plus de trois heures. Sur disque :
 * le premier relevé puis un tous les dix (≈ 144 lignes par jour) ; en mémoire : le dernier et le pic.
 */

/** Ce qu'on lit d'un `Electron.ProcessMetric` — rien de plus, pour se tester sans Electron. */
export interface MetriqueBrute {
  pid: number
  type: string
  name?: string
  serviceName?: string
  cpu?: { percentCPUUsage?: number }
  /** `workingSetSize` en Ko, comme Electron le rend. */
  memory?: { workingSetSize?: number }
}

export interface ProcessusReleve {
  pid: number
  /** Rôle Electron : Browser (le main), Tab (une fenêtre), GPU, Utility… */
  type: string
  nom?: string
  memoireMo: number
  cpuPct: number
}

export interface ReleveMemoire {
  ts: string
  totalMo: number
  processus: ProcessusReleve[]
}

export interface EtatReleveMemoire {
  dernier?: ReleveMemoire
  /** Le plus gros total vu depuis le lancement : une fuite se lit là. */
  picTotalMo: number
  echantillons: number
  periodeMs: number
}

const nombre = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function resumerMetriques(metriques: readonly MetriqueBrute[], ts: string): ReleveMemoire {
  const processus = metriques
    .map((m): ProcessusReleve => {
      const nom = m.name || m.serviceName
      return {
        pid: m.pid,
        type: m.type,
        ...(nom ? { nom } : {}),
        memoireMo: Math.round(nombre(m.memory?.workingSetSize) / 1024),
        cpuPct: Math.round(nombre(m.cpu?.percentCPUUsage) * 10) / 10
      }
    })
    .sort((a, b) => b.memoireMo - a.memoireMo)
  return { ts, totalMo: processus.reduce((s, p) => s + p.memoireMo, 0), processus }
}

const PERIODE_DEFAUT_MS = 60_000
const ECRIRE_TOUS_LES = 10

let etat: EtatReleveMemoire = { picTotalMo: 0, echantillons: 0, periodeMs: PERIODE_DEFAUT_MS }
let releverHorsCadence: (() => void) | undefined

/** Le relevé courant, tel quel. */
export function releveMemoire(): EtatReleveMemoire {
  return etat
}

/**
 * Le relevé pour l'ÉCRAN, refait à CHAQUE demande. Constaté le 2026-10-22 sur une instance cachée :
 * le premier relevé part à l'enregistrement des canaux, AVANT la fenêtre — l'onglet montrait
 * « Processus principal 232 Mo » seul pendant une minute. `getAppMetrics` lit la mémoire du
 * processus, sans disque : le refaire à la demande ne coûte rien et n'écrit rien ; l'écran ne le
 * demande qu'à l'ouverture de l'onglet et sur « Relire le journal ».
 * fix-ok: cause mesurée 2026-10-22 (conv-1077) — le seuil de 5 s laissait passer le relevé d'avant la fenêtre : onglet ouvert < 5 s après lui = [Browser] seul (capture code-construit de 16:07:40, test « 1 s après » rouge).
 */
export function releveMemoireFrais(): EtatReleveMemoire {
  releverHorsCadence?.()
  return etat
}

/**
 * Relève tout de suite, puis toutes les `periodeMs`. Rend la fonction d'arrêt. Une source qui lève
 * (Electron sans métriques) ne casse rien : le relevé précédent reste celui qu'on montre.
 */
export function demarrerReleveMemoire(options: {
  dossier: string
  lire: () => readonly MetriqueBrute[]
  periodeMs?: number
}): () => void {
  const periodeMs = options.periodeMs ?? PERIODE_DEFAUT_MS
  etat = { picTotalMo: 0, echantillons: 0, periodeMs }
  // `ecrire` FAUX = relevé demandé par l'écran : il rafraîchit l'affichage, pas le journal.
  const relever = (ecrire = true): void => {
    let releve: ReleveMemoire
    try {
      releve = resumerMetriques(options.lire(), new Date().toISOString())
    } catch {
      return
    }
    const echantillons = etat.echantillons + (ecrire ? 1 : 0)
    etat = {
      dernier: releve,
      picTotalMo: Math.max(etat.picTotalMo, releve.totalMo),
      echantillons,
      periodeMs
    }
    if (!ecrire || (echantillons - 1) % ECRIRE_TOUS_LES !== 0) return
    const ligne = JSON.stringify(releve) + '\n'
    void mkdir(options.dossier, { recursive: true })
      .then(() => appendFile(join(options.dossier, 'memoire.jsonl'), ligne, 'utf8'))
      .catch(() => {
        /* observabilite best-effort : un journal muet ne doit jamais casser l'application */
      })
  }
  relever()
  releverHorsCadence = () => relever(false)
  const minuteur = setInterval(() => relever(), periodeMs)
  minuteur.unref?.()
  return () => {
    clearInterval(minuteur)
    releverHorsCadence = undefined
  }
}
