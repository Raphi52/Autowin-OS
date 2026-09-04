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
  niveau,
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
  /**
   * APERÇU PROVISOIRE — appelé pendant qu'une phrase est ENCORE en cours, avec la transcription du
   * tampon partiel. Ce texte n'est PAS définitif : il est remplacé par le suivant, puis effacé
   * (chaîne vide) quand la phrase finie part par `onTexte`. Il ne doit jamais être inséré dans le
   * champ, sinon le même mot y serait écrit deux fois.
   */
  onApercu?: (texte: string) => void
  /**
   * NIVEAU DU MICRO à chaque bloc (~93 ms), entre 0 et 1. Sert la jauge affichée dans la barre de
   * saisie : sans elle, l'écran reste muet tant qu'aucune phrase n'est finie, et l'utilisateur
   * croit que le micro ne prend rien. Absent = aucune jauge, comportement inchangé.
   */
  onNiveau?: (niveau: number) => void
  /**
   * VOLUME DE CAPTURE réglé par l'utilisateur, relu à CHAQUE bloc (donc un réglage bougé pendant
   * qu'on parle s'applique tout de suite). 1 = son du micro tel quel. Chaque échantillon est
   * multiplié puis borné à [-1, 1] : au-delà, le son sature au lieu de repartir de l'autre côté.
   */
  gain?: () => number
}

/** Bornes du volume de capture : en dessous on n'entend plus rien, au-dessus ce n'est que du bruit. */
export const GAIN_MIN = 0.5
export const GAIN_MAX = 4

/** Applique le volume de capture, en saturant proprement plutôt qu'en laissant déborder. */
export function appliquerGain(bloc: Float32Array, gain: number): Float32Array {
  if (!Number.isFinite(gain) || gain === 1) return bloc
  const g = Math.min(GAIN_MAX, Math.max(GAIN_MIN, gain))
  const sortie = new Float32Array(bloc.length)
  for (let i = 0; i < bloc.length; i++) sortie[i] = Math.max(-1, Math.min(1, bloc[i] * g))
  return sortie
}

/**
 * PÉRIODE DE L'APERÇU. La reconnaissance coûte ~2 s par appel sur la machine de référence
 * (mesuré le 2026-09-03 : 1 s d'audio, modèle small-q5_1, `-ac 512` → 1994 ms). Rafraîchir plus
 * vite ne ferait qu'empiler des appels qui arrivent après la phrase suivante.
 */
const MS_APERCU = 1_500

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
  /** Une transcription d'aperçu est-elle en vol ? Deux en parallèle se disputent le processeur. */
  private apercuEnVol = false
  /** Phrases définitives en attente de transcription : l'aperçu leur cède la place, elles priment. */
  private phrasesEnVol = 0
  /** Échantillons déjà couverts par le dernier aperçu lancé : sert à espacer les rafraîchissements. */
  private apercuDepuis = 0
  /** Dernier aperçu affiché : sert à ne jamais faire RECULER le texte provisoire. */
  private apercuTexte = ''

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

  private auBloc(brut: Float32Array): void {
    // Le volume de capture s'applique AVANT tout le reste : la jauge, la découpe des phrases et
    // l'audio envoyé à la transcription doivent voir le MÊME son que celui que l'utilisateur règle.
    const bloc = appliquerGain(brut, this.deps.gain?.() ?? 1)
    // AVANT la découpe : la jauge doit bouger à chaque bloc, pas seulement en fin de phrase.
    this.deps.onNiveau?.(niveau(bloc))
    // Plafond COURT ici : en parole continue, c'est lui qui déclenche la première apparition de
    // texte dans le champ. Le plafond long de Jarvis laisserait l'écran vide 15 s.
    const pas = avancerVad(this.vad, bloc, this.taux, SEUIL_PAROLE, DUREE_MAX_DICTEE_MS)
    this.vad = pas.etat
    if (pas.segment) {
      this.apercuDepuis = 0
      this.apercuTexte = ''
      this.enfiler(pas.segment, this.taux)
      return
    }
    this.peutEtreApercu()
  }

  /**
   * APERÇU DU TAMPON EN COURS. Rien ne sort de la découpe tant que la phrase n'est pas finie : sans
   * ceci, l'utilisateur qui parle voit un champ vide et en conclut que le micro ne marche pas.
   * Un seul aperçu à la fois, et pas plus d'un par MS_APERCU d'audio nouveau.
   */
  private peutEtreApercu(): void {
    // Une phrase définitive en cours de transcription PRIME : elle ira dans le champ, pas l'aperçu.
    // Les faire tourner ensemble mettrait deux moteurs whisper sur le même processeur.
    if (!this.deps.onApercu || this.apercuEnVol || this.phrasesEnVol > 0 || !this.vad.parle) return
    let total = 0
    for (const b of this.vad.tampon) total += b.length
    if (total - this.apercuDepuis < (MS_APERCU / 1000) * this.taux) return
    this.apercuDepuis = total
    const partiel = coller(this.vad.tampon)
    const taux = this.taux
    this.apercuEnVol = true
    // MÊME FILE que les phrases définitives : un seul moteur whisper tourne à la fois, sinon les
    // deux se disputent le processeur et l'aperçu retarde le texte qui compte vraiment.
    this.file = this.file.then(async () => {
      try {
        const texte = (await this.deps.transcrire(encoderWav16k(partiel, taux))).trim()
        // Une phrase finie entre-temps a déjà écrit le vrai texte : l'aperçu serait un doublon.
        if (!this.actif || !this.vad.parle || texte === '') return
        // ANTI-CLIGNOTEMENT. Chaque aperçu re-transcrit un audio qui s'ALLONGE : un résultat plus
        // court que le précédent est une hésitation du moteur, pas une correction. L'afficher
        // ferait reculer le texte sous les yeux — des bouts de phrase qui s'effacent.
        if (texte.length < this.apercuTexte.length) return
        this.apercuTexte = texte
        this.deps.onApercu?.(texte)
      } catch {
        // Un aperçu raté n'est pas une panne : la phrase finie reste transcrite normalement.
      } finally {
        this.apercuEnVol = false
      }
    })
  }

  /** Une phrase finie part en transcription, et son texte est écrit AUSSITÔT dans le champ. */
  private enfiler(segment: Float32Array, taux: number): void {
    this.phrasesEnVol += 1
    this.file = this.file.then(async () => {
      let texte = ''
      try {
        texte = (await this.deps.transcrire(encoderWav16k(segment, taux))).trim()
      } catch {
        // Une phrase ratée ne coupe pas l'écoute : on continue de dicter.
        return
      } finally {
        this.phrasesEnVol -= 1
      }
      if (texte === '') return
      this.aEcrit = true
      this.apercuTexte = ''
      this.deps.onApercu?.('')
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
    this.apercuTexte = ''
    this.deps.onApercu?.('')
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
    this.apercuTexte = ''
    this.deps.onApercu?.('')
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
  onTexte?: (texte: string) => void,
  onApercu?: (texte: string) => void,
  onNiveau?: (niveau: number) => void,
  gain?: () => number
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
    onTexte,
    onApercu,
    onNiveau,
    gain
  }
}
