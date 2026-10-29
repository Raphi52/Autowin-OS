import { describe, expect, it } from 'vitest'
import { REMEMBER_SOURCE_SCHEMES } from './brain-remember'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { outilsDuChat } from './chat-mcp'
import { CATALOG } from './commands'
import { outilsPublies } from './skill-node-mcp'

/**
 * LISTE DES COMMANDES SANS DOUBLON (conv-1229, 2026-10-28).
 *
 * Mesure sur le texte réellement envoyé (prompt-observability, conv-1229) : la consigne du chat
 * pesait 59 974 caractères, dont 21 107 pour la liste des commandes — et 46 des 55 commandes de cette
 * liste arrivaient AUSSI au modèle comme outils directs, avec la même description et des arguments
 * plus détaillés. Quand les outils directs sont servis, la consigne ne détaille plus que les
 * commandes texte seul ; quand ils ne démarrent pas, la liste complète repart (texte `<cmd>` seul).
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE FICHIER : ignorer `outilsDirects` (la liste reste entière),
 * retirer une commande texte seul de la liste (`ask`, `orchestrate`, fichiers), ou couper les
 * précisions de `remember` sur le chemin texte, où le modèle ne voit que les noms d'arguments.
 */
describe('consigne du chat — commandes déjà servies en outils directs', () => {
  const servies = outilsDuChat(CATALOG)
  const complet = buildChatPilotagePrompt(CATALOG)
  const court = buildChatPilotagePrompt(CATALOG, { outilsDirects: servies })
  const ligne = (nom: string): string => `\n- ${nom}(`

  it('sans outils directs : chaque commande garde sa ligne détaillée', () => {
    for (const c of CATALOG) expect(complet).toContain(ligne(c.name))
  })

  it('avec outils directs : seules les commandes texte seul gardent leur ligne', () => {
    const texteSeul = CATALOG.filter((c) => c.horsCanalNatif !== undefined).map((c) => c.name)
    expect(texteSeul).toEqual(
      expect.arrayContaining(['ask', 'orchestrate', 'edit_file', 'read_file'])
    )
    for (const nom of texteSeul) expect(court).toContain(ligne(nom))
    for (const nom of servies) expect(court).not.toContain(ligne(nom))
  })

  it('les commandes servies restent NOMMÉES, pour un modèle dont les outils seraient repoussés', () => {
    const phrase = /- Et en outils directs `mcp__autowin__<nom>`[^\n]*: ([^\n]*)\./u.exec(court)
    expect(phrase).not.toBeNull()
    expect(phrase![1]!.split(', ').sort()).toEqual([...servies].sort())
    expect(complet).not.toContain('Et en outils directs')
  })

  it('rien n’est perdu : chaque commande retirée part en outil avec la MÊME description', () => {
    const outils = outilsPublies(
      { catalogue: () => CATALOG, exec: async () => ({ ok: true }) },
      { outils: servies, refus: () => '' }
    )
    expect(outils.map((o) => o.name).sort()).toEqual([...servies].sort())
    for (const outil of outils) {
      const spec = CATALOG.find((c) => c.name === outil.name)!
      expect(outil.description).toBe(spec.description)
      expect(Object.keys(outil.inputSchema.properties).sort()).toEqual(
        Object.keys(spec.args).sort()
      )
    }
  })

  /*
   * Coupe 2 : les précisions de `remember` (où ranger, fait autoporté, formes de source) ne partent
   * plus dans la prose quand l'outil `remember` les porte déjà dans ses arguments.
   */
  it('remember servi : la prose ne redit plus ses arguments, que l’outil porte en entier', () => {
    expect(complet).toContain('Les formes acceptées, en ENTIER')
    expect(complet).toContain('`portee` — OÙ ranger')
    expect(court).not.toContain('Les formes acceptées, en ENTIER')
    expect(court).not.toContain('`portee` — OÙ ranger')
    const remember = CATALOG.find((c) => c.name === 'remember')!
    const args = remember.args as Record<string, string>
    for (const schema of REMEMBER_SOURCE_SCHEMES) expect(args.source).toContain(`${schema}:`)
    expect(args.fact).toMatch(/autoporté[\s\S]*3 mois/u)
    expect(args.portee).toMatch(/equipe \| perso[\s\S]*rangement/u)
    expect(remember.description).toMatch(/règle de comportement ni ce qui ne vaut que ce tour-ci/u)
  })

  it('remember servi : les règles que l’outil ne porte pas restent dans la prose', () => {
    for (const texte of [complet, court]) {
      expect(texte).toContain('`lesson` — une leçon réutilisable')
      expect(texte).toContain('Un refus « aucun Brain perso » se dit tel quel')
      expect(texte).toContain('garde ce préfixe pour `brain_read`')
      expect(texte).toContain('prends `session:` comme source')
    }
  })

  it('allège réellement la consigne envoyée avec les outils directs', () => {
    expect(complet.length - court.length).toBeGreaterThan(18_000)
  })
})
