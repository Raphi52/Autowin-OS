/**
 * LE MOTEUR D'ÉCOUTE LOCAL — même contrat que `webkitSpeechRecognition`, mais qui FONCTIONNE ici.
 *
 * MESURÉ sur cette application : le moteur de Chromium rend le code `network` (capture datée du
 * 2026-08-31, chemin cité dans l'en-tête de `src/main/whisper-local.ts`) — le micro s'ouvrait, et
 * rien n'était jamais reconnu. La CAUSE de ce code n'est pas établie ici, et n'a pas besoin de
 * l'être pour décider : le moteur natif ne rend rien. Ce moteur-ci lit le micro
 * lui-même, découpe sur le silence (`whisper-audio.ts`), et fait transcrire chaque phrase par la CLI
 * whisper.cpp installée en local, via le processus principal.
 *
 * Il expose EXACTEMENT la forme attendue par le widget (`start` / `stop` / `onresult` / `onend` /
 * `onerror`), pour que le reste de Jarvis — mot d'éveil, bip, envoi de l'ordre — ne change pas d'une
 * ligne, et que ses tests restent valables.
 *
 * DEUX GARDES apprises de la panne d'origine :
 *  - une transcription VIDE ne remonte pas : whisper rend du vide sur le bruit ambiant, et un ordre
 *    vide envoyé à Jarvis serait pire que le silence.
 *  - après `stop()`, plus rien ne remonte, même un segment déjà parti en transcription. Un dernier
 *    résultat arrivé après l'arrêt ferait agir Jarvis micro éteint.
 */
import {
  TAUX_WHISPER,
  avancerVad,
  encoderWav16k,
  etatVadInitial,
  type EtatVad
} from './whisper-audio'

/** Le contrat commun aux deux moteurs (Web Speech et Whisper local). */
export interface MoteurVocal {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: unknown) => void) | null
  onend: (() => void) | null
  onerror: ((e: unknown) => void) | null
  start(): void
  stop(): void
  abort?(): void
}

export type FabriqueMoteur = new () => MoteurVocal

interface PisteAudio {
  stop(): void
}
interface FluxAudio {
  getTracks(): readonly PisteAudio[]
}
interface NoeudConnectable {
  connect(destination: unknown): void
  disconnect(): void
}
interface NoeudTraitement extends NoeudConnectable {
  onaudioprocess:
    ((e: { inputBuffer: { getChannelData(canal: number): Float32Array } }) => void) | null
}
interface ContexteAudio {
  sampleRate: number
  destination: unknown
  createMediaStreamSource(flux: FluxAudio): NoeudConnectable
  createScriptProcessor(taille: number, entrees: number, sorties: number): NoeudTraitement
  close(): Promise<void>
}

export interface DependancesWhisper {
  micro: () => Promise<FluxAudio>
  contexte: () => ContexteAudio
  transcrire: (wav: Uint8Array) => Promise<string>
}

/** 4096 échantillons ≈ 85 ms à 48 kHz : assez court pour une découpe fine, assez long pour ne pas
 * saturer le fil du renderer. */
const TAILLE_TAMPON = 4096

export function fabriqueWhisper(deps: DependancesWhisper): FabriqueMoteur {
  return class MoteurWhisper implements MoteurVocal {
    continuous = true
    interimResults = false
    lang = 'fr-FR'
    onresult: ((e: unknown) => void) | null = null
    onend: (() => void) | null = null
    onerror: ((e: unknown) => void) | null = null

    private actif = false
    private flux: FluxAudio | null = null
    private ctx: ContexteAudio | null = null
    private source: NoeudConnectable | null = null
    private noeud: NoeudTraitement | null = null
    private vad: EtatVad = etatVadInitial
    /** Les transcriptions sont mises à la queue : deux CLI whisper en parallèle se disputeraient le CPU. */
    private file: Promise<void> = Promise.resolve()

    start(): void {
      if (this.actif) return
      this.actif = true
      this.vad = etatVadInitial
      void this.ouvrir()
    }

    stop(): void {
      if (!this.actif) return
      this.actif = false
      this.fermer()
      this.onend?.()
    }

    abort(): void {
      this.stop()
    }

    private async ouvrir(): Promise<void> {
      try {
        const flux = await deps.micro()
        if (!this.actif) {
          // L'utilisateur a coupé pendant la demande d'autorisation : on ne laisse pas un micro ouvert.
          for (const piste of flux.getTracks()) piste.stop()
          return
        }
        this.flux = flux
        const ctx = deps.contexte()
        this.ctx = ctx
        this.source = ctx.createMediaStreamSource(flux)
        const noeud = ctx.createScriptProcessor(TAILLE_TAMPON, 1, 1)
        this.noeud = noeud
        noeud.onaudioprocess = (e): void => this.auBloc(e.inputBuffer.getChannelData(0))
        this.source.connect(noeud)
        noeud.connect(ctx.destination)
      } catch {
        this.actif = false
        this.fermer()
        this.onerror?.({ error: 'micro-indisponible' })
        this.onend?.()
      }
    }

    private auBloc(donnees: Float32Array): void {
      if (!this.actif || !this.ctx) return
      // COPIE obligatoire : le tampon du noeud est réutilisé au bloc suivant, le garder tel quel
      // ferait transcrire de l'audio écrasé.
      const bloc = new Float32Array(donnees)
      const pas = avancerVad(this.vad, bloc, this.ctx.sampleRate || TAUX_WHISPER)
      this.vad = pas.etat
      if (pas.segment) this.enfiler(pas.segment, this.ctx.sampleRate || TAUX_WHISPER)
    }

    private enfiler(segment: Float32Array, taux: number): void {
      this.file = this.file.then(async () => {
        if (!this.actif) return
        const wav = encoderWav16k(segment, taux)
        let texte: string | null = null
        for (let essai = 0; essai < 2 && texte === null; essai += 1) {
          try {
            texte = await deps.transcrire(wav)
          } catch {
            texte = null
          }
        }
        if (!this.actif) return
        if (texte === null) {
          this.onerror?.({ error: 'transcription-impossible' })
          return
        }
        const propre = texte.trim()
        if (propre === '') return
        this.onresult?.({
          resultIndex: 0,
          results: [Object.assign([{ transcript: propre }], { isFinal: true })]
        })
      })
    }

    private fermer(): void {
      if (this.noeud) {
        this.noeud.onaudioprocess = null
        this.noeud.disconnect()
      }
      this.source?.disconnect()
      for (const piste of this.flux?.getTracks() ?? []) piste.stop()
      void this.ctx?.close()
      this.noeud = null
      this.source = null
      this.flux = null
      this.ctx = null
      this.vad = etatVadInitial
    }
  }
}

/** Les dépendances RÉELLES du navigateur : ce câblage n'est pas testable hors fenêtre, il reste nu. */
export function dependancesNavigateur(
  transcrire: (wav: Uint8Array) => Promise<string>
): DependancesWhisper {
  return {
    micro: () =>
      navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
      }) as unknown as Promise<FluxAudio>,
    contexte: () =>
      new (window as unknown as { AudioContext: new (o?: unknown) => ContexteAudio }).AudioContext({
        sampleRate: TAUX_WHISPER
      }),
    transcrire
  }
}
