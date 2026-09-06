import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * AUCUN ARRET MUET AU DEMARRAGE.
 *
 * Deux fois le 2026-09-06, le meme mode d'echec a coute des heures : une lecture de disque leve
 * dans le CORPS du module principal, donc AVANT `app.whenReady` et avant les filets de crash. La
 * boucle Electron tourne alors a vide — process VIVANT, aucune fenetre, aucun port de pilotage,
 * aucun message. L'utilisateur voit « l'application ne se lance plus », sans la moindre piste.
 *
 *  1. `loadAgentTopology` sur un profil vierge (aucun modele en cache) ;
 *  2. `persistConversations` sur un `conversations.json` dont un message porte un `status` hors
 *     contrat — reproduit par bissection sur le binaire packagé, gel a 78 ms.
 *
 * Les deux chargements bloquants du demarrage doivent donc NOMMER leur cause et SORTIR. Ce test
 * epingle cette forme : si un futur remaniement retire le filet, l'echec redevient muet.
 */
const source = readFileSync(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')

const APPELS_A_PROTEGER = ['loadAgentTopology(', 'persistConversations(']

describe('demarrage : aucun echec muet avant la fenetre', () => {
  it.each(APPELS_A_PROTEGER)('%s est entoure d un filet qui nomme la cause et sort', (appel) => {
    const position = source.indexOf(appel)
    expect(position, `${appel} introuvable dans index.ts`).toBeGreaterThan(0)
    // Le filet vit juste autour de l'appel : on lit une fenetre large plutot que tout le fichier,
    // sinon un `try` sans rapport, ailleurs dans le module, ferait passer le test pour rien.
    const fenetre = source.slice(Math.max(0, position - 1200), position + 1200)

    expect(fenetre).toContain('try {')
    expect(fenetre).toMatch(/console\.error\(/)
    expect(fenetre).toMatch(/app\.exit\(\d+\)/)
  })

  it('les deux filets sortent avec des codes DISTINCTS : la cause se lit dans le code de sortie', () => {
    const codes = [...source.matchAll(/app\.exit\((\d+)\)/g)].map((trouve) => trouve[1])
    expect(new Set(codes).size).toBe(codes.length)
  })
})
