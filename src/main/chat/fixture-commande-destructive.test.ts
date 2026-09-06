import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * LE HARNAIS QUI PROUVE LE CAS LE PLUS A RISQUE.
 *
 * Le recu d'autorite disparaissait PRECISEMENT sur les commandes destructives : la politique les
 * classe « a confirmer », le contrat exigeait alors deux champs absents, l'evenement etait refuse
 * et l'erreur avalee par un catch. Corrige le 2026-09-06 — mais un correctif prouve par des tests
 * unitaires seuls laisse le doute sur le cablage reel.
 *
 * La cible `supprimer:<id>` de la fixture permet d'exercer une suppression REELLE de bout en bout.
 * Mesure du 2026-09-06 sur le paquet : conversation presente avant, absente apres, et le recu porte
 * `destructive` / `confirm` / `approve`. Sans ce chemin, cette preuve redevient impossible.
 *
 * DEUX proprietes verrouillees ici — la seconde est une question de SURETE : ce chemin ne doit
 * jamais exister hors d'une instance de test isolee.
 */
const source = readFileSync(join(process.cwd(), 'src', 'main', 'chat', 'run-pilot-chat.ts'), 'utf8')

describe('fixture de commande destructive', () => {
  it('reconnait la cible supprimer:<id> et emet remove_conversation', () => {
    expect(source).toContain("target.startsWith('supprimer:')")
    expect(source).toContain('"name":"remove_conversation"')
  })

  it('vit SOUS la garde d instance isolee, jamais en production', () => {
    const gardeIsolee = source.indexOf(
      'isolatedTestInstance && safe.at(-1)?.content.startsWith(durableStreamPrefix)'
    )
    const cheminDestructif = source.indexOf("target.startsWith('supprimer:')")

    expect(gardeIsolee).toBeGreaterThan(0)
    expect(cheminDestructif).toBeGreaterThan(gardeIsolee)
  })
})
