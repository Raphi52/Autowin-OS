import {
  dependancesNavigateur,
  fabriqueWhisper,
  type FabriqueMoteur
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
  peripherique?: string
): FabriqueMoteur | null {
  const api = apiJarvis()
  if (whisperInstalle && api?.whisperTranscrire) {
    const transcrire = api.whisperTranscrire.bind(api)
    return fabriqueWhisper(dependancesNavigateur((wav) => transcrire(wav), peripherique))
  }
  const w = window as unknown as {
    SpeechRecognition?: FabriqueMoteur
    webkitSpeechRecognition?: FabriqueMoteur
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}
