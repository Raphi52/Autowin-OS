import { describe, expect, it } from 'vitest'
import { flattenChatParts } from './chat-turn'

/**
 * LES ÉTIQUETTES D'ACTION SONT UN DERNIER RECOURS — deux garanties qui ne valent qu'ENSEMBLE.
 *
 * Mesuré le 2026-08-15 sur 39 conversations de sonde : 36 commençaient par « [a exécuté …] », y
 * compris quand la réponse en dessous était parfaitement rédigée. Verdict de l'utilisateur : « c'est
 * pas du tout l'expérience utilisateur que je veux offrir », et son juge le confirmait à chaque
 * mesure — dernier défaut restant après cinq correctifs.
 *
 * Mais les supprimer purement ferait revenir un défaut plus ancien et PIRE : la bulle VIDE d'un tour
 * qui n'a fait qu'agir (`conv-1141`). D'où le couple, indissociable :
 *   · aucune étiquette quand une vraie réponse existe ;
 *   · jamais de bulle vide quand elle n'existe pas.
 *
 * Et une nuance qui compte : un ÉCHEC n'est pas du bruit technique, c'est le fait le plus important
 * du tour. Seules les actions RÉUSSIES s'effacent devant une réponse.
 */
const action = (name: string, ok = true) => ({ kind: 'action' as const, name, ok })
const texte = (text: string) => ({ kind: 'text' as const, text })

describe('flattenChatParts — les étiquettes ne masquent plus la réponse', () => {
  it('EFFACE les étiquettes réussies quand une vraie réponse existe', () => {
    const rendu = flattenChatParts([action('list_files'), texte('23 fichiers.')] as never)
    expect(rendu).toBe('23 fichiers.')
    expect(rendu).not.toContain('a exécuté')
  })

  it('les GARDE quand il n’y a rien d’autre : jamais de bulle vide', () => {
    // Le defaut plus ancien et pire : un tour qui a agi sans rien dire ne doit pas etre muet.
    const rendu = flattenChatParts([action('list_files'), action('read_file')] as never)
    expect(rendu).toContain('a exécuté list_files')
    expect(rendu).toContain('a exécuté read_file')
  })

  it('MONTRE toujours une action échouée, même avec une réponse', () => {
    // Un echec tu serait le pire des silences — c'est le fait le plus important du tour.
    const rendu = flattenChatParts([action('edit_file', false), texte('Voilà.')] as never)
    expect(rendu).toContain('(échec)')
    expect(rendu).toContain('Voilà.')
  })

  it('MONTRE toujours une erreur', () => {
    const rendu = flattenChatParts([
      { kind: 'error', message: 'disque plein' },
      texte('Suite.')
    ] as never)
    expect(rendu).toContain('⚠️ disque plein')
  })

  it('rend une chaîne vide quand il n’y a réellement rien', () => {
    expect(flattenChatParts([] as never)).toBe('')
  })
})

describe('annonce d’intention en tête — retirée quand le résultat suit', () => {
  it('retire « Je dois d’abord lire… » quand la réponse suit', () => {
    // Cas RÉEL, `conv-1257` : dernier défaut refusé par le juge d'expérience.
    const rendu = flattenChatParts([
      texte(
        'Je dois d’abord lire le contenu direct de `src/main` pour donner un nombre vérifié.\n226 fichiers.'
      )
    ] as never)
    expect(rendu).toBe('226 fichiers.')
  })

  it('GARDE l’annonce si elle est tout le message : mieux vaut ça qu’une bulle vide', () => {
    const seule = 'Je vais vérifier le dossier.'
    expect(flattenChatParts([texte(seule)] as never)).toBe(seule)
  })

  it('ne touche PAS un refus, qui n’annonce rien au futur', () => {
    const refus = 'Je ne peux pas lister ce dossier : il est introuvable.\nAucun nombre disponible.'
    expect(flattenChatParts([texte(refus)] as never)).toBe(refus)
  })

  it('ne touche PAS une phrase qui commence par autre chose', () => {
    const normal = 'Le dossier contient 12 fichiers.\nDétail ci-dessous.'
    expect(flattenChatParts([texte(normal)] as never)).toBe(normal)
  })
})
