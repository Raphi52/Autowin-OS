import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync
} from 'node:fs'
import { join } from 'node:path'

/**
 * Ledger d'activité des agents IN-APP — append-only JSONL, un fichier par jour
 * (`trace-YYYY-MM-DD.jsonl`). Chaque commande bus / événement pilote / étape
 * d'orchestration y laisse une ligne pour le diagnostic durable des actions in-app.
 */

export interface TraceEvent {
  ts: string
  source: 'bus' | 'pilot' | 'orchestrate'
  name: string
  detail?: string
  ok?: boolean
}

const DETAIL_CAP = 200

/** Saut de ligne SANS sequence d'echappement : cinq fois dans cette session un `\n` injecte est
 * devenu un vrai retour a la ligne et a casse la source. On ne se repose plus sur l'echappement. */
const SAUT_DE_LIGNE = String.fromCharCode(10)

/**
 * Budget d'octets par evenement demande, pour lire la QUEUE du fichier au lieu de son integralite.
 *
 * Candidat du scout interne du 2026-08-19 (score 86), confirme par son juge (« ledger entier dans
 * ledger.ts:59 ») : `recent(n)` chargeait le fichier ENTIER pour n'en garder que les n dernieres
 * lignes. Sur une journee chargee, le diagnostic devenait la chose la plus couteuse de la session.
 *
 * 1 Ko par evenement est large : un evenement plafonne a 200 caracteres de detail en pese ~300.
 */
const OCTETS_PAR_EVENEMENT = 1_024
const OCTETS_MIN = 8_192
const OCTETS_MAX = 4_000_000

/** Etat de sante du tracage — un ledger muet se lit comme un ledger vide, donc comme « rien ». */
export interface SanteLedger {
  ecrituresEchouees: number
  lecturesEchouees: number
  lignesCorrompues: number
  octetsLus: number
  derniereErreur?: string
  enBonneSante: boolean
}

/**
 * Lit les `octets` derniers octets d'un fichier, en UTF-8, sans jamais le charger en entier.
 *
 * Ce n'est PAS `readBoundedUtf8FileWithin` : celui-la lit le DEBUT d'un fichier Behaviour, avec ses
 * controles de racine et de lien. Ici on veut la FIN d'un journal append-only. Deux faits differents,
 * deux lecteurs — mais un seul par fait.
 *
 * La premiere ligne est jetee des que la fenetre ne commence pas au debut du fichier : elle est
 * coupee en son milieu, et une moitie de JSON compterait comme une ligne corrompue alors qu'elle est
 * intacte sur le disque.
 */
function queueUtf8(chemin: string, octets: number): { texte: string; lus: number } {
  const fd = openSync(chemin, 'r')
  try {
    const taille = fstatSync(fd).size
    const longueur = Math.min(taille, octets)
    const depart = taille - longueur
    const tampon = Buffer.allocUnsafe(longueur)
    let lus = 0
    while (lus < longueur) {
      const n = readSync(fd, tampon, lus, longueur - lus, depart + lus)
      if (n <= 0) break
      lus += n
    }
    let texte = tampon.subarray(0, lus).toString('utf8')
    if (depart > 0) {
      const saut = texte.indexOf(SAUT_DE_LIGNE)
      texte = saut < 0 ? '' : texte.slice(saut + 1)
    }
    return { texte, lus }
  } finally {
    closeSync(fd)
  }
}

export class TraceLedger {
  constructor(private readonly dir: string) {}

  // Compteurs de sante. Le tracage ne doit jamais casser l'action tracee, mais son echec ne doit
  // pas non plus etre invisible : candidat du scout interne (score 65), « erreurs de ledger
  // silencieuses ». Dossier absent, disque plein, permission refusee, ligne corrompue — tout etait
  // avale, donc un tracage totalement mort se lisait comme un tracage vide.
  private ecrituresEchouees = 0
  private lecturesEchouees = 0
  private lignesCorrompues = 0
  private octetsLus = 0
  private derniereErreur?: string

  /** Etat du tracage, lisible sans jamais jeter. `enBonneSante` est faux des le premier incident. */
  sante(): SanteLedger {
    return {
      ecrituresEchouees: this.ecrituresEchouees,
      lecturesEchouees: this.lecturesEchouees,
      lignesCorrompues: this.lignesCorrompues,
      octetsLus: this.octetsLus,
      ...(this.derniereErreur ? { derniereErreur: this.derniereErreur } : {}),
      enBonneSante:
        this.ecrituresEchouees === 0 && this.lecturesEchouees === 0 && this.lignesCorrompues === 0
    }
  }

  private noter(erreur: unknown): string {
    const texte = erreur instanceof Error ? erreur.message : String(erreur)
    this.derniereErreur = texte.slice(0, DETAIL_CAP)
    return this.derniereErreur
  }

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
    } catch (erreur) {
      // Le tracage ne doit JAMAIS casser l'action tracee — mais son echec est desormais COMPTE.
      this.ecrituresEchouees += 1
      this.noter(erreur)
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
    } catch (erreur) {
      this.lecturesEchouees += 1
      this.noter(erreur)
      return []
    }
    const out: TraceEvent[] = []
    for (const f of files) {
      if (out.length >= n) break
      try {
        // QUEUE seulement : le budget suit ce qu'il reste a remplir, borne haut et bas.
        const budget = Math.min(
          OCTETS_MAX,
          Math.max(OCTETS_MIN, (n - out.length) * OCTETS_PAR_EVENEMENT)
        )
        const { texte, lus } = queueUtf8(join(this.dir, f), budget)
        this.octetsLus += lus
        const lines = texte.trimEnd().split(SAUT_DE_LIGNE).reverse()
        for (const line of lines) {
          if (out.length >= n) break
          if (!line.trim()) continue
          try {
            out.push(JSON.parse(line) as TraceEvent)
          } catch (erreur) {
            this.lignesCorrompues += 1
            this.noter(erreur)
          }
        }
      } catch (erreur) {
        this.lecturesEchouees += 1
        this.noter(erreur)
      }
    }
    return out // du plus récent au plus ancien
  }
}
