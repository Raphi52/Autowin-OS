import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { declarerNonProd, OPERATION_DECLARATION, type DeclarerNonProdPorts } from './declarer-non-prod'
import { GuichetProd, type DemandeProdPubliee } from './prod-guichet'
import { basesNonProdDuTexte } from './prod-run-guard'
import type { NiveauProtectionProd } from '../../shared/prod-protection'

/**
 * conv-2195 : « non prod, go, autorisation pour tout » ne menait nulle part — la déclaration ne
 * s'écrivait qu'à la main dans prod-autorite.json. Ici : un clic dans le fil suffit, et seulement
 * pour ce qui n'est ni déclaré prod ni exploité.
 */
function banc(options: {
  fichier?: string
  reponse?: 'confirmer' | 'annuler'
  niveau?: NiveauProtectionProd
  exploitees?: { server: string; database: string }[]
}) {
  const racine = mkdtempSync(join(tmpdir(), 'declarer-non-prod-'))
  const fichier = join(racine, 'prod-autorite.json')
  if (options.fichier !== undefined) writeFileSync(fichier, options.fichier, 'utf8')
  const demandes: DemandeProdPubliee[] = []
  const guichet: GuichetProd = new GuichetProd({
    notifier: (demande) => {
      demandes.push(demande)
      setImmediate(() =>
        options.reponse === 'annuler' ? guichet.annuler(demande.id) : guichet.confirmer(demande.id)
      )
    },
    delaiMs: 5_000
  })
  const ports: DeclarerNonProdPorts = {
    racine,
    conversationId: 'conv-test',
    guichet,
    niveau: () => options.niveau ?? 'confirmation',
    basesExploitees: async () => ({ ok: true, exploitees: options.exploitees ?? [] }),
    maintenant: () => new Date('2026-11-27T12:00:00Z')
  }
  const lire = (): string => (existsSync(fichier) ? readFileSync(fichier, 'utf8') : '')
  return { ports, demandes, lire }
}

describe('declarerNonProd — un clic de l’utilisateur ouvre une copie de test', () => {
  it('ajoute la base après le clic, garde les entrées existantes (même fautives), et le terminal l’accepte', async () => {
    const existant = JSON.stringify([
      { nature: 'base', nom: 'APP_PROD', classe: 'prod' },
      { nature: 'bizarre', nom: 'X', classe: 'prod' }
    ])
    const { ports, demandes, lire } = banc({ fichier: existant })
    const r = await declarerNonProd({ nature: 'base', nom: 'APP_COPIE_QUALIF', motif: 'copie de test' }, ports)
    expect(r).toMatchObject({ ok: true, dejaDeclaree: false })
    expect(demandes).toHaveLength(1)
    expect(demandes[0]).toMatchObject({
      cible: 'base:APP_COPIE_QUALIF',
      operation: OPERATION_DECLARATION,
      niveau: 'confirmation',
      conversationId: 'conv-test'
    })
    const ecrit = JSON.parse(lire())
    expect(ecrit).toHaveLength(3)
    expect(ecrit[1]).toEqual({ nature: 'bizarre', nom: 'X', classe: 'prod' })
    expect(ecrit[2]).toMatchObject({ nature: 'base', nom: 'APP_COPIE_QUALIF', classe: 'non-prod' })
    expect(ecrit[2].motif).toContain('conv-test')
    expect(basesNonProdDuTexte(lire())).toContain('app_copie_qualif')
  })

  it('crée le fichier s’il est absent, et complète la forme { entrees }', async () => {
    const absent = banc({})
    expect((await declarerNonProd({ nom: 'APP_COPIE' }, absent.ports)).ok).toBe(true)
    expect(JSON.parse(absent.lire())).toEqual([expect.objectContaining({ nom: 'APP_COPIE', classe: 'non-prod' })])

    const objet = banc({ fichier: JSON.stringify({ entrees: [{ nature: 'base', nom: 'A', classe: 'prod' }] }) })
    expect((await declarerNonProd({ nature: 'serveur', nom: 'SRV-TEST2' }, objet.ports)).ok).toBe(true)
    expect(JSON.parse(objet.lire()).entrees).toHaveLength(2)
    expect(basesNonProdDuTexte(objet.lire())).toEqual(['serveur:srv-test2'])
  })

  it('demande quand même un clic au niveau « aucun »', async () => {
    const { ports, demandes } = banc({ fichier: '[]', niveau: 'aucun' })
    expect((await declarerNonProd({ nom: 'APP_COPIE' }, ports)).ok).toBe(true)
    expect(demandes[0].niveau).toBe('confirmation')
  })

  it('n’écrit rien si l’utilisateur annule', async () => {
    const { ports, lire } = banc({ fichier: '[]', reponse: 'annuler' })
    const r = await declarerNonProd({ nom: 'APP_COPIE' }, ports)
    expect(r.ok).toBe(false)
    expect(lire()).toBe('[]')
  })

  it('refuse sans rien demander une base déclarée prod ou exploitée, et un serveur qui en héberge', async () => {
    const prod = banc({ fichier: JSON.stringify([{ nature: 'base', nom: 'app_copie', classe: 'prod' }]) })
    expect((await declarerNonProd({ nom: 'APP_COPIE' }, prod.ports)).ok).toBe(false)
    expect(prod.demandes).toHaveLength(0)

    const exploitees = [{ server: 'SRV-PROD', database: 'APP_VIVANTE' }]
    const base = banc({ fichier: '[]', exploitees })
    expect((await declarerNonProd({ nom: 'app_vivante' }, base.ports)).ok).toBe(false)
    const serveur = banc({ fichier: '[]', exploitees })
    expect((await declarerNonProd({ nature: 'serveur', nom: 'srv-prod' }, serveur.ports)).ok).toBe(false)
    expect(base.demandes.length + serveur.demandes.length).toBe(0)
    expect(base.lire()).toBe('[]')

    const catalogue = banc({ fichier: '[]' })
    catalogue.ports.estCatalogue = (nature, nom) => nature === 'base' && nom.toLowerCase() === 'app_catalogue'
    expect((await declarerNonProd({ nom: 'APP_CATALOGUE' }, catalogue.ports)).ok).toBe(false)
    expect(catalogue.demandes).toHaveLength(0)
  })

  it('ne touche pas un fichier illisible, ni un nom suspect', async () => {
    const illisible = banc({ fichier: '{ pas du json' })
    expect((await declarerNonProd({ nom: 'APP_COPIE' }, illisible.ports)).ok).toBe(false)
    expect(illisible.lire()).toBe('{ pas du json')

    const suspect = banc({ fichier: '[]' })
    expect((await declarerNonProd({ nom: 'A"; DROP' }, suspect.ports)).ok).toBe(false)
    expect(suspect.demandes).toHaveLength(0)
  })

  it('au niveau « phrase », un simple clic ne suffit pas', async () => {
    const { ports, lire } = banc({ fichier: '[]', niveau: 'phrase' })
    const r = await declarerNonProd({ nom: 'APP_COPIE' }, ports)
    expect(r.ok).toBe(false)
    expect(lire()).toBe('[]')
  })

  it('une base déjà déclarée hors production passe sans redemander', async () => {
    const { ports, demandes } = banc({
      fichier: JSON.stringify([{ nature: 'base', nom: 'APP_COPIE', classe: 'non-prod' }])
    })
    expect(await declarerNonProd({ nom: 'app_copie' }, ports)).toMatchObject({ ok: true, dejaDeclaree: true })
    expect(demandes).toHaveLength(0)
  })
})
