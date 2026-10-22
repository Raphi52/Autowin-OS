import { describe, expect, it, vi } from 'vitest'
import {
  contenuDeNotificationDeFinDeTour,
  creerNotifieurDeFinDeTour,
  type NotificationAffichable
} from './notification-fin-de-tour'

/**
 * FIL ASYNCHRONE (conv-1038, 2026-10-21) : la fin d'un tour vient chercher l'utilisateur.
 *
 * Mesuré par le scout : tour médian 226 s, p90 ≈ 17 min. La seule notification Windows du main
 * signalait un travail ABANDONNÉ (`os.ts`, `onAbandon`) ; un tour fini ne disait rien hors de la
 * fenêtre. Ces tests tiennent la décision (quand sonner) et le texte (quoi dire).
 */

const TEXTE_CLOS = [
  'Voilà le travail.',
  '',
  '---',
  '### ✅ Fait',
  '- Barre flottante sur la sélection du fil',
  '- Alt+clic remplit la saisie avec une référence exacte',
  '- Troisième fait qui ne tient pas dans deux lignes',
  '### 📍 Maintenant',
  'Rien.',
  '### ⏳ Reste à faire',
  'Rien.',
  '### 👉 Recommandé',
  'Rien.'
].join('\n')

const BASE = {
  ok: true,
  cancelled: false,
  text: TEXTE_CLOS,
  titreDuFil: 'Refonte du chat',
  fenetreRegardee: false,
  instanceDeTest: false,
  tourDeFond: false
}

describe('contenuDeNotificationDeFinDeTour — quand sonner', () => {
  it('fenêtre non regardée + tour réussi : sonne, avec les DEUX premiers faits de « ✅ Fait »', () => {
    expect(contenuDeNotificationDeFinDeTour(BASE)).toEqual({
      title: 'Refonte du chat — réponse prête',
      body: 'Barre flottante sur la sélection du fil\nAlt+clic remplit la saisie avec une référence exacte',
      // La carte en bas à droite affiche le titre NU du fil et son issue (popup conv-1066).
      fil: 'Refonte du chat',
      issue: 'prete'
    })
  })

  // Le jumeau accepté du refus « fenêtre regardée » : même tour, seule la fenêtre change.
  it('fenêtre REGARDÉE : ne sonne pas — l’utilisateur voit déjà la réponse', () => {
    expect(contenuDeNotificationDeFinDeTour({ ...BASE, fenetreRegardee: true })).toBeNull()
  })

  it('tour ARRÊTÉ par l’utilisateur : ne sonne pas', () => {
    expect(contenuDeNotificationDeFinDeTour({ ...BASE, cancelled: true })).toBeNull()
  })

  it('instance de TEST (capture cachée) : ne sonne jamais sur l’écran de l’utilisateur', () => {
    expect(contenuDeNotificationDeFinDeTour({ ...BASE, instanceDeTest: true })).toBeNull()
  })

  it('tour de FOND (tâche planifiée) : personne n’attend devant, ne sonne pas', () => {
    expect(contenuDeNotificationDeFinDeTour({ ...BASE, tourDeFond: true })).toBeNull()
  })

  it('tour en ÉCHEC : sonne aussi, avec la première ligne de l’erreur', () => {
    expect(
      contenuDeNotificationDeFinDeTour({
        ...BASE,
        ok: false,
        text: undefined,
        error: 'Le modèle est surchargé (529)\ndétail technique'
      })
    ).toEqual({
      title: 'Refonte du chat — le tour a échoué',
      body: 'Le modèle est surchargé (529)',
      fil: 'Refonte du chat',
      issue: 'echec'
    })
  })
})

describe('contenuDeNotificationDeFinDeTour — quoi dire sans bloc de clôture', () => {
  it('réponse sans « ✅ Fait » : ses deux premières lignes utiles, décor Markdown retiré', () => {
    const contenu = contenuDeNotificationDeFinDeTour({
      ...BASE,
      text: '## Résultat\n\n**Le test passe** maintenant.\n\n- la cause était un cache périmé\n- 3e ligne'
    })
    expect(contenu?.body).toBe('Résultat\nLe test passe maintenant.')
  })

  it('une ligne trop longue est coupée à 120 caractères, avec « … »', () => {
    const longue = 'x'.repeat(300)
    const contenu = contenuDeNotificationDeFinDeTour({ ...BASE, text: longue })
    expect(contenu?.body).toBe(`${'x'.repeat(119)}…`)
  })

  it('réponse vide : un texte générique plutôt qu’une notification muette', () => {
    expect(contenuDeNotificationDeFinDeTour({ ...BASE, text: '' })?.body).toBe(
      'Le tour est terminé.'
    )
  })

  it('fil sans titre : « Autowin » prend sa place dans le titre', () => {
    expect(contenuDeNotificationDeFinDeTour({ ...BASE, titreDuFil: '  ' })?.title).toBe(
      'Autowin — réponse prête'
    )
  })
})

/** Fausse notification Electron : on lit ce qui a été montré, fermé, et le clic. */
function fausseNotification(): {
  fabrique: (contenu: { title: string; body: string }) => NotificationAffichable
  creees: Array<{ contenu: { title: string; body: string }; fermee: boolean; cliquer: () => void }>
} {
  const creees: Array<{
    contenu: { title: string; body: string }
    fermee: boolean
    cliquer: () => void
  }> = []
  return {
    creees,
    fabrique: (contenu) => {
      const entree = { contenu, fermee: false, cliquer: () => {} }
      creees.push(entree)
      return {
        show: () => {},
        close: () => {
          entree.fermee = true
        },
        // Seul le clic sur la bulle est lu ici ; les boutons ont leur test (`.suites.test.ts`).
        on: (evenement: string, ecouteur: () => void) => {
          if (evenement === 'click') entree.cliquer = ecouteur
        }
      } as NotificationAffichable
    }
  }
}

describe('creerNotifieurDeFinDeTour — le câblage', () => {
  const FIN = { ok: true, cancelled: false, text: TEXTE_CLOS }

  it('clic sur la notification : ouvre CE fil (et pas le fil affiché)', () => {
    const faux = fausseNotification()
    const ouvrirFil = vi.fn()
    const notifier = creerNotifieurDeFinDeTour({
      fabrique: faux.fabrique,
      fenetreRegardee: () => false,
      instanceDeTest: false,
      titreDuFil: () => 'Refonte du chat',
      ouvrirFil
    })
    notifier('conv-42', FIN)
    expect(faux.creees).toHaveLength(1)
    faux.creees[0].cliquer()
    expect(ouvrirFil).toHaveBeenCalledWith('conv-42')
  })

  it('mode auto qui enchaîne 3 tours du MÊME fil : une seule notification reste affichée', () => {
    const faux = fausseNotification()
    const notifier = creerNotifieurDeFinDeTour({
      fabrique: faux.fabrique,
      fenetreRegardee: () => false,
      instanceDeTest: false,
      titreDuFil: () => 'Refonte du chat',
      ouvrirFil: () => {}
    })
    notifier('conv-42', FIN)
    notifier('conv-42', FIN)
    notifier('conv-42', FIN)
    expect(faux.creees.map((n) => n.fermee)).toEqual([true, true, false])
  })

  it('deux fils différents : chacun garde la sienne', () => {
    const faux = fausseNotification()
    const notifier = creerNotifieurDeFinDeTour({
      fabrique: faux.fabrique,
      fenetreRegardee: () => false,
      instanceDeTest: false,
      titreDuFil: () => 'Fil',
      ouvrirFil: () => {}
    })
    notifier('conv-1', FIN)
    notifier('conv-2', FIN)
    expect(faux.creees.map((n) => n.fermee)).toEqual([false, false])
  })

  it('fenêtre regardée au moment de la fin : rien n’est créé', () => {
    const faux = fausseNotification()
    const notifier = creerNotifieurDeFinDeTour({
      fabrique: faux.fabrique,
      fenetreRegardee: () => true,
      instanceDeTest: false,
      titreDuFil: () => 'Fil',
      ouvrirFil: () => {}
    })
    notifier('conv-1', FIN)
    expect(faux.creees).toHaveLength(0)
  })

  it('une notification qui jette (plateforme sans support) ne fait jamais tomber la fin du tour', () => {
    const notifier = creerNotifieurDeFinDeTour({
      fabrique: () => {
        throw new Error('Notification non supportée')
      },
      fenetreRegardee: () => false,
      instanceDeTest: false,
      titreDuFil: () => 'Fil',
      ouvrirFil: () => {}
    })
    expect(() => notifier('conv-1', FIN)).not.toThrow()
  })
})
