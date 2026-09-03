/**
 * LA DICTÉE DU CHAMP DE SAISIE — le micro du composer, chat plein ET mosaïque.
 *
 * Ce fichier ne réinvente RIEN de l'audio : il réutilise `whisper-audio.ts` (WAV PCM 16 bits mono
 * 16 kHz, la seule forme que whisper.cpp accepte) et la transcription locale déjà exposée par le
 * processus principal (`whisperTranscrire`). Le moteur d'écoute continue de Jarvis n'est PAS
 * réemployé : ici l'utilisateur décide lui-même quand il commence et quand il s'arrête, il n'y a
 * donc ni mot d'éveil, ni découpage sur le silence.
 *
 * Deux règles apprises des pannes déjà payées ailleurs dans l'app :
 *  - le bloc rendu par le noeud audio est RECYCLÉ au bloc suivant : il faut le copier, sinon on
 *    transcrit de l'audio écrasé ;
 *  - après `arreter()`, le micro est fermé AVANT la transcription : laisser une piste ouverte
 *    pendant l'attente reviendrait à écouter la pièce sans le dire.
 */
import {
  DUREE_MAX_DICTEE_MS,
  SEUIL_PAROLE,
  TAUX_WHISPER,
  avancerVad,
  coller,
  encoderWav16k,
  etatVadInitial,
  type EtatVad
} from './whisper-audio'

/** Ce que l'utilisateur voit : rien, le micro tourne, ou la transcription est en cours. */
export type EtatDictee = 'inactif' | 'ecoute' | 'transcription'

interface PisteAudio {
  stop(): void
}
interface FluxAudio {
  getTracks(): readonly PisteAudio[]
}
interface NoeudAudio {
  connect(cible: unknown): void
  disconnect(): void
  onaudioprocess: ((e: { inputBuffer: { getChannelData(c: number): Float32Array } }) => void) | null
}
interface ContexteAudio {
  sampleRate: number
  destination: unknown
  createMediaStreamSource(flux: FluxAudio): { connect(n: unknown): void; disconnect(): void }
  createScriptProcessor(taille: number, entrees: number, sorties: number): NoeudAudio
  close(): Promise<void>
}

export interface DependancesDictee {
  micro: () => Promise<FluxAudio>
  contexte: () => ContexteAudio
  transcrire: (wav: Uint8Array) => Promise<string>
  /**
   * ÉCRITURE EN DIRECT — appelé à CHAQUE phrase reconnue, micro encore ouvert. C'est ce qui fait
   * apparaître le texte dans la barre de prompt pendant qu'on parle, au lieu d'attendre le clic
   * d'arrêt. Absent = ancien comportement (tout à la fin).
   */
  onTexte?: (texte: string) => void
}

/** Même taille de tampon que le moteur Jarvis : ~93 ms à 44,1 kHz. */
const TAILLE_TAMPON = 4096

/**
 * INSERTION DU TEXTE RECONNU au point d'insertion, pas en fin de champ : l'utilisateur peut dicter
 * au milieu d'une phrase déjà tapée. Une transcription vide (whisper rend du vide sur du bruit)
 * ne touche à rien — sinon un espace parasite apparaîtrait à chaque essai raté.
 */
export function insererDictee(
  texte: string,
  transcription: string,
  caret: number
): { texte: string; caret: number } {
  const propre = transcription.trim()
  if (propre === '') return { texte, caret: Math.min(Math.max(caret, 0), texte.length) }
  const position = Math.min(Math.max(caret, 0), texte.length)
  const avant = texte.slice(0, position)
  const apres = texte.slice(position)
  const separateurAvant = avant !== '' && !/\s$/.test(avant) ? ' ' : ''
  const separateurApres = apres !== '' && !/^\s/.test(apres) ? ' ' : ''
  const insere = `${separateurAvant}${propre}${separateurApres}`
  return {
    texte: `${avant}${insere}${apres}`,
    caret: position + separateurAvant.length + propre.length
  }
}

/**
 * UNE DICTÉE = un micro ouvert, puis UN fichier transcrit. Aucune file : deux CLI whisper en même
 * temps se disputent le processeur, et le composer n'en a pas besoin — on parle, on relâche.
 */
export class Dictee {
  private flux: FluxAudio | null = null
  private ctx: ContexteAudio | null = null
  private source: { connect(n: unknown): void; disconnect(): void } | null = null
  private noeud: NoeudAudio | null = null
  private taux = TAUX_WHISPER
  private actif = false
  /** Découpage sur le silence : c'est lui qui décide quand une phrase est finie. */
  private vad: EtatVad = etatVadInitial
  /** Les transcriptions sont sérialisées : deux CLI whisper en parallèle se disputent le CPU. */
  private file: Promise<void> = Promise.resolve()
  /** Au moins une phrase a-t-elle été écrite dans le champ ? Sert au message « rien reconnu ». */
  private aEcrit = false

  constructor(private readonly deps: DependancesDictee) {}

  get enCours(): boolean {
    return this.actif
  }

  /** Une phrase a-t-elle déjà été écrite en direct pendant cette dictée ? */
  get aDejaEcrit(): boolean {
    return this.aEcrit
  }

  /** Ouvre le micro. Rend `false` si l'autorisation est refusée ou le micro indisponible. */
  async demarrer(): Promise<boolean> {
    if (this.actif) return true
    this.actif = true
    this.vad = etatVadInitial
    this.aEcrit = false
    try {
      const flux = await this.deps.micro()
      if (!this.actif) {
        for (const piste of flux.getTracks()) piste.stop()
        return false
      }
      this.flux = flux
      const ctx = this.deps.contexte()
      this.ctx = ctx
      this.taux = ctx.sampleRate || TAUX_WHISPER
      this.source = ctx.createMediaStreamSource(flux)
      const noeud = ctx.createScriptProcessor(TAILLE_TAMPON, 1, 1)
      this.noeud = noeud
      noeud.onaudioprocess = (e): void => {
        if (!this.actif) return
        // COPIE obligatoire : le tampon du noeud est réutilisé au bloc suivant.
        this.auBloc(new Float32Array(e.inputBuffer.getChannelData(0)))
      }
      this.source.connect(noeud)
      noeud.connect(ctx.destination)
      return true
    } catch {
      this.actif = false
      this.fermer()
      return false
    }
  }

  private auBloc(bloc: Float32Array): void {
    // Plafond COURT ici : en parole continue, c'est lui qui déclenche la première apparition de
    // texte dans le champ. Le plafond long de Jarvis laisserait l'écran vide 15 s.
    const pas = avancerVad(this.vad, bloc, this.taux, SEUIL_PAROLE, DUREE_MAX_DICTEE_MS)
    this.vad = pas.etat
    if (pas.segment) this.enfiler(pas.segment, this.taux)
  }

  /** Une phrase finie part en transcription, et son texte est écrit AUSSITÔT dans le champ. */
  private enfiler(segment: Float32Array, taux: number): void {
    this.file = this.file.then(async () => {
      let texte = ''
      try {
        texte = (await this.deps.transcrire(encoderWav16k(segment, taux))).trim()
      } catch {
        // Une phrase ratée ne coupe pas l'écoute : on continue de dicter.
        return
      }
      if (texte === '') return
      this.aEcrit = true
      this.deps.onTexte?.(texte)
    })
  }

  /**
   * Ferme le micro, transcrit la FIN de phrase restée dans le tampon et la rend. Les phrases déjà
   * écrites en direct ne sont PAS rendues une seconde fois — elles sont déjà dans le champ.
   */
  async arreter(): Promise<string> {
    if (!this.actif) return ''
    this.actif = false
    const reste = this.vad.tampon.length > 0 ? coller(this.vad.tampon) : null
    const taux = this.taux
    this.vad = etatVadInitial
    this.fermer()
    // On attend les phrases déjà en vol, pour que l'ordre du texte reste celui de la parole.
    await this.file
    if (!reste || reste.length === 0) return ''
    try {
      return (await this.deps.transcrire(encoderWav16k(reste, taux))).trim()
    } catch {
      return ''
    }
  }

  /** Coupe sans rien transcrire : l'utilisateur a annulé. */
  annuler(): void {
    this.actif = false
    this.vad = etatVadInitial
    this.fermer()
  }

  private fermer(): void {
    if (this.noeud) {
      this.noeud.onaudioprocess = null
      this.noeud.disconnect()
    }
    this.source?.disconnect()
    if (this.flux) for (const piste of this.flux.getTracks()) piste.stop()
    void this.ctx?.close()
    this.noeud = null
    this.source = null
    this.flux = null
    this.ctx = null
  }
}

/** Le câblage RÉEL du navigateur : non testable hors fenêtre, il reste nu. */
export function dependancesDicteeNavigateur(
  transcrire: (wav: Uint8Array) => Promise<string>,
  onTexte?: (texte: string) => void
): DependancesDictee {
  return {
    micro: () =>
      navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
      }) as unknown as Promise<FluxAudio>,
    contexte: () =>
      new (window as unknown as { AudioContext: new (o?: unknown) => ContexteAudio }).AudioContext({
        sampleRate: TAUX_WHISPER
      }),
    transcrire,
    onTexte
  }
}
