import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  contextValueRoot,
  loadContextValue,
  pruneContextValues,
  putContextValue,
  sliceContextValue
} from './context-value'

/**
 * LE PRIMITIF DU RLM : le contexte cesse d'etre un flux de messages reassemble a chaque tour pour
 * devenir une VALEUR adressable, persistee, decoupable, et passee par REFERENCE.
 *
 * Pourquoi ce module existe, mesure sur ce depot le 2026-08-11 (magasin `prompt-observability`,
 * 688 appels reels) : cote `subagent`, 243 431 485 tokens d'entree NON caches contre 302 352 327 de
 * cache lu, soit **44,6 % de l'entree re-payee** — environ 450 k tokens non caches PAR APPEL sur 541
 * appels. Cote `judge`, 10,6 % de cache seulement. Le gisement n'est pas theorique.
 *
 * Trois proprietes non negociables, chacune adossee a un item de la DoD du RUN :
 *  1. ADRESSABLE — un handle identifie le contenu, et deux contenus identiques donnent le MEME
 *     handle (content-addressed). C'est ce qui permet a N membres d'un fan-out de partager une seule
 *     copie au lieu de N.
 *  2. SURVIT AU REDEMARRAGE — la valeur vit sur disque, pas dans une `Map` memoire. Aujourd'hui
 *     `agent-pilot.ts:309` garde les sessions dans une `Map`, donc un redemarrage perd tout.
 *  3. DECOUPABLE SANS RECOPIE COUTEUSE — decouper produit un nouveau handle ; l'original reste
 *     intact et reutilisable. C'est le « contexte comme variable » du RLM.
 */
describe('valeur de contexte — le primitif RLM', () => {
  const racine = () => mkdtempSync(join(tmpdir(), 'aos-ctxval-'))

  it('rend un handle qui decrit le contenu sans le transporter', () => {
    const root = racine()
    const h = putContextValue('bonjour le contexte', root)
    expect(h.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(h.bytes).toBe(Buffer.byteLength('bonjour le contexte', 'utf8'))
    expect(h.id).toContain(h.sha256.slice(0, 16))
    // Le handle ne porte PAS le texte : c'est tout l'interet.
    expect(JSON.stringify(h)).not.toContain('bonjour le contexte')
  })

  it('CONTENT-ADDRESSED : le meme contenu donne le meme handle, une seule copie sur disque', () => {
    const root = racine()
    const a = putContextValue('meme contenu exactement', root)
    const b = putContextValue('meme contenu exactement', root)
    expect(b.id).toBe(a.id)
    expect(readdirSync(contextValueRoot(root)).length).toBe(1)
  })

  it('un contenu DIFFERENT donne un handle different', () => {
    const root = racine()
    const a = putContextValue('contenu A', root)
    const b = putContextValue('contenu B', root)
    expect(b.id).not.toBe(a.id)
  })

  it('SURVIT AU REDEMARRAGE : relire depuis un processus qui ne connait que le handle', () => {
    const root = racine()
    const h = putContextValue('a retrouver apres redemarrage', root)
    // Aucun etat en memoire : on repart du handle seul, comme le ferait un processus neuf.
    expect(loadContextValue(h.id, root)).toBe('a retrouver apres redemarrage')
  })

  it('DECOUPABLE : la tranche est une nouvelle valeur, l originale reste intacte', () => {
    const root = racine()
    const h = putContextValue('0123456789', root)
    const t = sliceContextValue(h.id, 2, 5, root)
    expect(loadContextValue(t.id, root)).toBe('234')
    expect(loadContextValue(h.id, root)).toBe('0123456789')
    expect(t.id).not.toBe(h.id)
  })

  it('REFUSE une tranche hors bornes plutot que de rendre une valeur tronquee en silence', () => {
    const root = racine()
    const h = putContextValue('court', root)
    expect(() => sliceContextValue(h.id, 3, 99, root)).toThrow(/bornes/i)
    expect(() => sliceContextValue(h.id, 4, 2, root)).toThrow(/bornes/i)
  })

  it('REFUSE un handle inconnu, et un handle FORGE ne peut pas sortir du magasin', () => {
    const root = racine()
    // Refuse sur la FORME avant meme de toucher au disque — plus strict que « introuvable », et
    // c'est voulu : un handle qui n'a pas la bonne forme n'a aucune raison d'atteindre le systeme
    // de fichiers. Un handle BIEN forme mais absent, lui, tombe sur « inconnue ».
    expect(() => loadContextValue('inexistant', root)).toThrow(/invalide/i)
    expect(() => loadContextValue('ctx-0000000000000000-00000000', root)).toThrow(/inconnue/i)
    // Traversal : un handle est un identifiant, jamais un chemin.
    for (const forge of ['../../secrets', 'C:\\Windows\\system32\\config\\SAM', 'a/../../b']) {
      expect(() => loadContextValue(forge, root)).toThrow(/handle|inconnu|introuvable/i)
    }
  })

  it('DETECTE une valeur corrompue au lieu de la servir (le sha est verifie a la lecture)', () => {
    const root = racine()
    const h = putContextValue('contenu authentique', root)
    const fichier = join(contextValueRoot(root), readdirSync(contextValueRoot(root))[0])
    // Un tiers altere le fichier sous nous.
    writeFileSync(fichier, 'contenu FALSIFIE', 'utf8')
    expect(() => loadContextValue(h.id, root)).toThrow(/integrite|sha/i)
  })

  it('la purge supprime les valeurs anciennes et garde les recentes', () => {
    const root = racine()
    const vieux = putContextValue('a purger', root)
    const recent = putContextValue('a garder', root)
    // On vieillit artificiellement la premiere valeur (pas d'attente : on pose la date).
    const chemin = join(contextValueRoot(root), `${vieux.id}.txt`)
    const passe = new Date(Date.now() - 40 * 24 * 3600 * 1000)
    utimesSync(chemin, passe, passe)
    const supprimes = pruneContextValues(root, 30)
    expect(supprimes).toBe(1)
    expect(() => loadContextValue(vieux.id, root)).toThrow()
    expect(loadContextValue(recent.id, root)).toBe('a garder')
  })

  it('estime un ordre de grandeur de tokens, et le declare comme une ESTIMATION', () => {
    const root = racine()
    const h = putContextValue('x'.repeat(4000), root)
    // ~4 octets par token : approximation grossiere, assumee comme telle par le nom du champ.
    expect(h.tokensEstimate).toBeGreaterThan(500)
    expect(h.tokensEstimate).toBeLessThan(2000)
  })
})
