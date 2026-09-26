import { describe, expect, it } from 'vitest'
import {
  recommandationDitRien,
  suiteAttendUneDonneeUtilisateur,
  suiteEstDifferee
} from './chat-auto-mode'
import { estCibleDestructrice } from '../../../shared/scout-cible-lecture'

/*
 * RELECTURE DES REGLES D'ARRET (conv-787, 2026-09-22) — apres deux fausses coupures vecues
 * (« Voici le message… » et « Rien de plus sur ce sujet… »), les autres portes ont ete sondees avec
 * des phrases realistes. Trois d'entre elles arretaient le mode auto A TORT. Ces tests figent le
 * partage : ce qui doit continuer a arreter, et ce qui ne doit plus.
 */
describe('cible destructrice — une piste qui EMPECHE la destruction n’en est pas une', () => {
  it('laisse passer les pistes protectrices', () => {
    expect(estCibleDestructrice('Vérifier que rien n’est supprimé par erreur')).toBe(false)
    expect(estCibleDestructrice('Empêcher l’effacement du brouillon')).toBe(false)
    expect(estCibleDestructrice('Documenter pourquoi on ne supprime jamais une branche')).toBe(
      false
    )
  })
  it('arrête toujours sur une vraie destruction', () => {
    expect(estCibleDestructrice('Supprimer la branche de secours')).toBe(true)
    expect(estCibleDestructrice('Écraser le fichier de config')).toBe(true)
    expect(estCibleDestructrice('git reset --hard sur main')).toBe(true)
  })
})

describe('suite différée — « des » sans accent est un article, pas « dès »', () => {
  it('ne met plus en pause sur une durée citée dans la tâche', () => {
    expect(suiteEstDifferee('Corrige le calcul des 12 h de rétention', null)).toBe(false)
  })
  it('met toujours en pause sur une vraie échéance', () => {
    expect(suiteEstDifferee('Relis le rapport à 3 h du matin', null)).toBe(true)
    expect(suiteEstDifferee('Reprends dès 9 h demain', null)).toBe(true)
  })
})

describe('donnée utilisateur — toute « clé » n’est pas un secret', () => {
  it('laisse passer une clé de tri', () => {
    expect(suiteAttendUneDonneeUtilisateur('Voici la clé de tri à appliquer au tableau')).toBe(
      false
    )
    expect(suiteAttendUneDonneeUtilisateur('Voici la clé primaire de la table')).toBe(false)
  })
  it('met toujours en pause sur un vrai secret', () => {
    expect(suiteAttendUneDonneeUtilisateur('Voici la clé API')).toBe(true)
    expect(suiteAttendUneDonneeUtilisateur('Voici les identifiants à brancher')).toBe(true)
  })
})

/*
 * SONDAGE SUR CLOTURES REELLES (conv-787) : 2970 blocs de cloture extraits de conversations.json ont
 * ete rejoues dans les portes « rien ». 15 vraies fins etaient RATEES sur la meme forme — « rien : »
 * ou « rien — » suivi de la justification. Les phrases ci-dessous sont copiees telles quelles.
 */
describe('porte « rien » — fins réelles ratées (sondage sur 2970 clôtures)', () => {
  it('reconnaît « rien : … » et « rien — … »', () => {
    expect(recommandationDitRien('rien : la demande d’origine est satisfaite et vérifiée.')).toBe(
      true
    )
    expect(recommandationDitRien('Rien — le ménage demandé est terminé.')).toBe(true)
    expect(recommandationDitRien('rien : il n’y a pas de bug ici.')).toBe(true)
  })
  it('laisse passer une fin qui propose encore quelque chose', () => {
    expect(recommandationDitRien('rien : lance le contrôle final quand tu veux')).toBe(false)
    expect(recommandationDitRien("rien d'autre : tu peux m'envoyer un nom d'instance")).toBe(false)
  })
})
