import {
  dependancesNavigateur,
  fabriqueWhisper,
  type FabriqueMoteur,
  type SourceAudio
} from './jarvis-moteur-whisper'

interface ApiTranscription {
  whisperTranscrire?: (wav: Uint8Array) => Promise<string>
}

const apiJarvis = (): ApiTranscription | undefined =>
  (window as unknown as { api?: ApiTranscription }).api

/**
 * QUEL MOTEUR DE RECONNAISSANCE OUVRE LE MICRO.
 *
 * Sorti de `JarvisWidget.tsx` parce que DEUX widgets s'en servent desormais : Jarvis (parler a
 * l'app) et Enregistrements (ecrire ce qui se dit). Un fichier de composant ne peut pas exporter
 * autre chose qu'un composant sans casser le rechargement a chaud.
 */
export function fabriqueMoteur(
  whisperInstalle: boolean,
  peripherique?: string,
  source: SourceAudio = 'micro'
): FabriqueMoteur | null {
  const api = apiJarvis()
  if (whisperInstalle && api?.whisperTranscrire) {
    const transcrire = api.whisperTranscrire.bind(api)
    return fabriqueWhisper(dependancesNavigateur((wav) => transcrire(wav), peripherique, source))
  }
  // LE SON DU SYSTEME N'A PAS DE SECOURS. Le moteur du navigateur ouvre le micro lui-meme et
  // n'accepte aucun flux : sans reconnaissance hors ligne installee, « ce que j'entends » ne peut
  // pas etre transcrit. Rendre le moteur du navigateur ici transcrirait le MICRO en le faisant
  // passer pour l'interlocuteur — deux fois la meme voix, attribuee a tort.
  if (source === 'haut-parleurs') return null
  const w = window as unknown as {
    SpeechRecognition?: FabriqueMoteur
    webkitSpeechRecognition?: FabriqueMoteur
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}
