/**
 * Les deux outils du coffre qui servent à changer un mot de passe, passés par le vrai bus de commandes :
 * `coffre_generer_mot_de_passe` rend nom, longueur et site, JAMAIS la valeur (ni dans le résultat ni
 * dans la trace) ; ses refus arrivent en phrase lisible ; `coffre_ranger_presse_papier` transmet `site` ;
 * et `navigateur_lire` ne rend pas un mot de passe que la page aurait affiché en clair.
 * Le coffre est le vrai (`creerCoffre`) sur un fichier temporaire : c'est lui qui tire la valeur.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Coffre } from '../app/coffre-cles'

const etat = vi.hoisted(() => ({
  coffre: undefined as Coffre | undefined,
  rangements: [] as Array<Record<string, unknown>>
}))

vi.mock('../app/coffre-cles', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../app/coffre-cles')>()
  return {
    ...reel,
    genererMotDePasse: (nom: string, site: string) => etat.coffre!.genererMotDePasse(nom, site),
    masquerValeurs: (texte: string) => etat.coffre!.masquerValeurs(texte)
  }
})
vi.mock('../app/coffre-presse-papier', () => ({
  rangerDepuisPressePapier: async (entree: Record<string, unknown>) => {
    etat.rangements.push(entree)
    return { ok: true, nom: entree.nom, detail: 'rangé' }
  }
}))

import { creerCoffre } from '../app/coffre-cles'
import { AppCommandBus, type NavigateurDeLAgent } from './commands'

let dossier: string
let bus: AppCommandBus

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'autowin-coffre-mdp-'))
  etat.coffre = creerCoffre({
    chemin: () => join(dossier, 'coffre-cles.bin'),
    chiffrement: () => ({
      isEncryptionAvailable: () => true,
      encryptString: (texte) => Buffer.from(texte, 'utf8'),
      decryptString: (donnees) => donnees.toString('utf8')
    }),
    lireRegistre: () => new Map(),
    env: {}
  })
  etat.rangements = []
  bus = new AppCommandBus({ executionWorkspace: process.cwd() } as never, () => undefined)
})
afterEach(() => {
  rmSync(dossier, { recursive: true, force: true })
})

const SITE = 'https://portail.exemple.fr'

describe('coffre_generer_mot_de_passe — la commande', () => {
  it('range un mot de passe lié au site et ne rend que nom, longueur et site', async () => {
    const traces: Record<string, unknown>[] = []
    bus.trace = (_nom, args) => traces.push(args)
    const r = await bus.exec(
      'coffre_generer_mot_de_passe',
      { nom: 'PORTAIL_PASSWORD', site: `${SITE}/Identity/Account/Manage/ChangePassword` },
      'conv-a'
    )
    expect(r.ok).toBe(true)
    const donnees = r.data as Record<string, unknown>
    expect(donnees).toMatchObject({ ok: true, nom: 'PORTAIL_PASSWORD', longueur: 24, site: SITE })
    expect(String(donnees.detail)).toMatch(/depuisCoffre: PORTAIL_PASSWORD/)
    const lu = etat.coffre!.secretPourSaisie('PORTAIL_PASSWORD')
    if (!lu.ok) throw new Error(lu.detail)
    expect(JSON.stringify(r)).not.toContain(lu.valeur)
    expect(JSON.stringify(traces)).not.toContain(lu.valeur)
    expect(etat.coffre!.valeursPourAgent([])).toEqual({})
  })

  it('nom déjà pris ou site non https : refus lisible, sans valeur, et rien de remplacé', async () => {
    etat.coffre!.ajouterCle('PORTAIL_PASSWORD', 'ancien-mot-de-passe-123')
    const pris = await bus.exec(
      'coffre_generer_mot_de_passe',
      { nom: 'PORTAIL_PASSWORD', site: SITE },
      'conv-a'
    )
    const enClair = await bus.exec(
      'coffre_generer_mot_de_passe',
      { nom: 'AUTRE_PASSWORD', site: 'http://portail.exemple.fr' },
      'conv-a'
    )
    const sansSite = await bus.exec(
      'coffre_generer_mot_de_passe',
      { nom: 'AUTRE_PASSWORD' },
      'conv-a'
    )
    expect(pris.data).toMatchObject({ ok: false, detail: expect.stringMatching(/déjà au coffre/) })
    expect(enClair.data).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/Site invalide/)
    })
    expect(sansSite.data).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/Site invalide/)
    })
    expect(JSON.stringify([pris, enClair, sansSite])).not.toContain('ancien-mot-de-passe-123')
    expect(etat.coffre!.listerCles().map((c) => c.nom)).toEqual(['PORTAIL_PASSWORD'])
  })
})

describe('coffre_ranger_presse_papier — argument `site`', () => {
  it('transmet `site` quand il est donné, rien sinon', async () => {
    await bus.exec('coffre_ranger_presse_papier', { nom: 'ANCIEN_PASSWORD', site: SITE }, 'conv-a')
    await bus.exec('coffre_ranger_presse_papier', { nom: 'MISTRAL_API_KEY', site: ' ' }, 'conv-a')
    await bus.exec('coffre_ranger_presse_papier', { nom: 'GITHUB_TOKEN' }, 'conv-a')
    expect(etat.rangements).toEqual([
      { nom: 'ANCIEN_PASSWORD', site: SITE, conversationId: 'conv-a' },
      { nom: 'MISTRAL_API_KEY', conversationId: 'conv-a' },
      { nom: 'GITHUB_TOKEN', conversationId: 'conv-a' }
    ])
  })
})

describe('navigateur_lire — un mot de passe du coffre affiché par la page repart masqué', () => {
  it('bouton « afficher » cliqué : le champ redevenu texte ne rend pas la valeur au modèle', async () => {
    etat.coffre!.genererMotDePasse('PORTAIL_PASSWORD', SITE)
    const lu = etat.coffre!.secretPourSaisie('PORTAIL_PASSWORD')
    if (!lu.ok) throw new Error(lu.detail)
    const page = `[contenu de page]
[4] textbox « Nouveau mot de passe » = ${lu.valeur}`
    bus.navigateur = () =>
      ({
        etat: (fil: string) => ({ conversationId: fil, ongletActif: 'onglet-1', onglets: [] }),
        lire: async () => page
      }) as unknown as NavigateurDeLAgent
    const r = await bus.exec('navigateur_lire', {}, 'conv-a')
    const rendu = String((r.data as { page?: unknown }).page)
    expect(rendu).not.toContain(lu.valeur)
    expect(rendu).toContain('= [secret:PORTAIL_PASSWORD]')
  })
})
