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
  SEUIL_PAROLE,
  TAUX_WHISPER,
  avancerVad,
  coller,
  encoderWav16k,
  etatVadInitial,
  niveau,
  seuilValide,
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
  /**
   * OPTIONNELS, et c'est structurel : le contrat est partagé avec `webkitSpeechRecognition`, qui ne
   * les connaîtra jamais. Les rendre obligatoires casserait la branche de secours et ses tests.
   *  - `onniveau` : niveau efficace BRUT de chaque bloc (avant toute normalisation) — la jauge.
   *  - `seuilParole` : sensibilité choisie par l'utilisateur, sinon `SEUIL_PAROLE`.
   */
  onniveau?: ((rms: number) => void) | null
  seuilParole?: number
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

/**
 * LES PARTIELS — ce qui dit « je t'entends » PENDANT que tu parles.
 *
 * Le défaut réel : ce moteur ne rendait QUE des phrases figées. Entre le moment où l'utilisateur
 * commence à parler et le moment où l'ordre part, il fallait attendre la fin de la phrase, puis
 * 700 ms de silence (`MS_SILENCE_FIN`), puis la transcription. Rien ne bougeait à l'écran, et
 * surtout le BIP d'éveil — le seul signal qui dit « parle maintenant » — n'arrivait qu'après. Le
 * widget, lui, était déjà prêt : il pose `interimResults = true` et `reagirAParole` bipe sur le
 * partiel (`JarvisWidget.tsx`, commentaire de `auResultat`). C'est le moteur qui ne l'a jamais
 * honoré : `interimResults` y était à `false` en dur et aucun partiel n'était produit.
 *
 * Les seuils sont en ÉCHANTILLONS, pas en millisecondes d'horloge : un compteur d'échantillons se
 * prouve sans micro ni faux temps, et il suit le vrai débit audio plutôt que le temps mural.
 *
 * DEUX seuils DISTINCTS, et ils ne se cumulent pas : `MINIMUM` commande le PREMIER partiel de la
 * phrase, `INTERVALLE` espace les suivants. Les cumuler rendrait le minimum décoratif — le premier
 * partiel n'arriverait qu'à 1500 ms, et le seuil de 1200 ms ne déciderait jamais de rien.
 *
 * TROIS GARDES, chacune pour une panne précise :
 *  - jamais de partiel sous `MS_PARTIEL_MINIMUM` de parole : sur un fragment plus court, whisper
 *    rend du vide ou du faux, et un faux partiel ferait biper Jarvis sur du bruit ;
 *  - un seul partiel en vol, et AUCUN pendant qu'une phrase figée est en transcription : deux CLI
 *    whisper en parallèle se disputent le CPU, ce qui rendrait tout PLUS lent, à l'envers du but ;
 *  - un partiel qui revient après `stop()`, ou après la fin de la phrase, est jeté : il afficherait
 *    de la parole micro éteint.
 */
const MS_PARTIEL_MINIMUM = 1200
const MS_PARTIEL_INTERVALLE = 1500

export function fabriqueWhisper(deps: DependancesWhisper): FabriqueMoteur {
  return class MoteurWhisper implements MoteurVocal {
    continuous = true
    interimResults = false
    lang = 'fr-FR'
    onresult: ((e: unknown) => void) | null = null
    onend: (() => void) | null = null
    onerror: ((e: unknown) => void) | null = null
    onniveau: ((rms: number) => void) | null = null
    seuilParole = SEUIL_PAROLE

    private actif = false
    private flux: FluxAudio | null = null
    private ctx: ContexteAudio | null = null
    private source: NoeudConnectable | null = null
    private noeud: NoeudTraitement | null = null
    private vad: EtatVad = etatVadInitial
    /** Les transcriptions sont mises à la queue : deux CLI whisper en parallèle se disputeraient le CPU. */
    private file: Promise<void> = Promise.resolve()
    /**
     * Combien de phrases figées attendent ou transcrivent. Un COMPTEUR, pas un booléen : la file est
     * sérielle, donc pendant que la phrase A transcrit, la phrase B peut déjà être enfilée. Un
     * booléen remis à false à la fin de A laisserait un partiel démarrer à côté de B.
     */
    private figesEnAttente = 0
    /** Un partiel est-il en vol ? Un seul à la fois, jamais deux. */
    private partielEnCours = false
    /** Échantillons de parole écoulés depuis le dernier partiel émis ou tenté. */
    private depuisPartiel = 0
    /** Partiels déjà tentés DANS LA PHRASE en cours : c'est ce qui distingue le premier des suivants. */
    private partielsEmis = 0

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
      const taux = this.ctx.sampleRate || TAUX_WHISPER
      // La jauge est nourrie ICI, sur le signal brut : après `encoderWav16k` le gain de
      // normalisation aurait déjà remonté un micro faible, et la jauge afficherait « plein ».
      this.onniveau?.(niveau(bloc))
      const pas = avancerVad(this.vad, bloc, taux, seuilValide(this.seuilParole))
      const parlaitAvant = this.vad.parle
      this.vad = pas.etat
      if (pas.segment) {
        this.depuisPartiel = 0
        this.partielsEmis = 0
        this.enfiler(pas.segment, taux)
        return
      }
      // La phrase s'est terminée sans produire de segment (trop courte) : les compteurs repartent.
      if (parlaitAvant && !this.vad.parle) {
        this.depuisPartiel = 0
        this.partielsEmis = 0
      }
      if (this.vad.parle) this.depuisPartiel += bloc.length
      this.peutEtrePartiel(taux)
    }

    /** Un partiel part-il maintenant ? Toutes les gardes sont ICI, pas dispersées. */
    private peutEtrePartiel(taux: number): void {
      if (!this.interimResults || !this.vad.parle) return
      if (this.figesEnAttente > 0 || this.partielEnCours) return
      if (this.vad.echantillonsParole < (MS_PARTIEL_MINIMUM / 1000) * taux) return
      if (this.partielsEmis > 0 && this.depuisPartiel < (MS_PARTIEL_INTERVALLE / 1000) * taux)
        return
      this.depuisPartiel = 0
      this.partielsEmis += 1
      this.partielEnCours = true
      const apercu = coller(this.vad.tampon)
      void this.transcrirePartiel(apercu, taux)
    }

    private async transcrirePartiel(apercu: Float32Array, taux: number): Promise<void> {
      try {
        const texte = await deps.transcrire(encoderWav16k(apercu, taux))
        // Le micro peut avoir été coupé, ou la phrase figée pendant la transcription : dans les deux
        // cas ce partiel est périmé et l'afficher ferait mentir le widget.
        if (!this.actif || !this.vad.parle) return
        const propre = texte.trim()
        if (propre === '') return
        this.onresult?.({
          resultIndex: 0,
          results: [Object.assign([{ transcript: propre }], { isFinal: false })]
        })
      } catch {
        // Un partiel raté ne vaut PAS une erreur remontée : la phrase figée reste le chemin qui
        // compte, et afficher « transcription impossible » sur un simple aperçu couperait l'écoute.
      } finally {
        this.partielEnCours = false
      }
    }

    private enfiler(segment: Float32Array, taux: number): void {
      this.figesEnAttente += 1
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
      this.file = this.file.finally(() => {
        this.figesEnAttente -= 1
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
      this.depuisPartiel = 0
      this.partielsEmis = 0
    }
  }
}

/** Les dépendances RÉELLES du navigateur : ce câblage n'est pas testable hors fenêtre, il reste nu. */
export function dependancesNavigateur(
  transcrire: (wav: Uint8Array) => Promise<string>,
  peripherique?: string
): DependancesWhisper {
  return {
    micro: () =>
      navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          // Sans `deviceId`, Windows impose SON micro par défaut — souvent celui d'une webcam,
          // c'est-à-dire le niveau trop bas mesuré comme cause du charabia.
          ...(peripherique ? { deviceId: { exact: peripherique } } : {})
        }
      }) as unknown as Promise<FluxAudio>,
    contexte: () =>
      new (window as unknown as { AudioContext: new (o?: unknown) => ContexteAudio }).AudioContext({
        sampleRate: TAUX_WHISPER
      }),
    transcrire
  }
}
