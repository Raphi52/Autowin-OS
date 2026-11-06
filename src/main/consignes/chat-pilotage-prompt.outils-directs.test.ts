import { describe, expect, it } from 'vitest'
import { REMEMBER_SOURCE_SCHEMES } from '../brain/brain-remember'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { outilsDuChat } from '../chat/chat-mcp'
import { CATALOG } from '../commands/commands'
import { outilsPublies } from '../skills/skill-node-mcp'

/**
 * LISTE DES COMMANDES SANS DOUBLON (2026-10-28).
 *
 * Mesure sur le texte réellement envoyé (prompt-observability) : la consigne du chat
 * pesait 59 974 caractères, dont 21 107 pour la liste des commandes — et 46 des 55 commandes de cette
 * liste arrivaient AUSSI au modèle comme outils directs, avec la même description et des arguments
 * plus détaillés. Quand les outils directs sont servis, la consigne ne détaille plus que les
 * commandes texte seul ; quand ils ne démarrent pas, la liste complète repart (texte `<cmd>` seul).
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE FICHIER : ignorer `outilsDirects` (la liste reste entière),
 * retirer `ask` ou `orchestrate` de la liste, laisser une commande de fichiers citée dans la
 * consigne courte, ou couper les précisions de `remember` sur le chemin texte, où le modèle ne voit
 * que les noms d'arguments.
 */
describe('consigne du chat — commandes déjà servies en outils directs', () => {
  const servies = outilsDuChat(CATALOG)
  const complet = buildChatPilotagePrompt(CATALOG)
  const court = buildChatPilotagePrompt(CATALOG, { outilsDirects: servies })
  const ligne = (nom: string): string => `\n- ${nom}(`

  it('sans outils directs : chaque commande garde sa ligne détaillée', () => {
    for (const c of CATALOG) expect(complet).toContain(ligne(c.name))
  })

  it('avec outils directs : seuls `ask` et `orchestrate` gardent leur ligne', () => {
    for (const nom of ['ask', 'orchestrate']) expect(court).toContain(ligne(nom))
    for (const nom of servies) expect(court).not.toContain(ligne(nom))
  })

  /*
   * COMMANDES DE FICHIERS EN TEXTE (2026-10-31) : 3 appels en 676 tours, le modèle passe
   * par Read, Grep, Glob, Edit et Write. Retirer leurs lignes sans leurs règles laisserait la
   * consigne ordonner des commandes qu'elle ne décrit plus : le test porte donc sur tout le texte.
   */
  describe('commandes de fichiers en texte', () => {
    const fichiers = CATALOG.filter((c) => c.fichierCouvertParLeModele)
      .map((c) => c.name)
      .sort()

    it('les sept restent au catalogue : un `<cmd>` émis s’exécute toujours', () => {
      expect(fichiers).toEqual([
        'create_file',
        'delete_file',
        'edit_file',
        'find_in_files',
        'list_files',
        'move_file',
        'read_file'
      ])
    })

    it('avec outils directs : aucune n’est citée, même dans une règle', () => {
      expect(fichiers.length).toBeGreaterThan(0)
      for (const nom of fichiers) expect(court).not.toContain(nom)
    })

    it('avec outils directs : les règles pointent vers les outils du modèle', () => {
      expect(court).toContain('Oui → correction ponctuelle : `Edit` puis `verify`')
      expect(court).toContain('Les fichiers passent par tes propres outils')
      // Retirés avec leurs règles (revue 2026-11-06) : `Edit` et `Write` écrivent un chemin absolu
      // de fait, et lire avant de répondre est tenu par les relances de fin de tour.
      expect(court).not.toContain("PÉRIMÈTRE D'ÉCRITURE")
    })

    // « Face à un blocage — relis avant d'écrire » part avec son « 1 bis » (revue 2026-11-06) :
    // `Edit` refuse une édition sans lecture préalable et ne vérifie rien après.
    it('avec outils directs : le bloc « face à un blocage » et sa règle 1 bis partent', () => {
      expect(court).not.toContain('1 bis.')
      expect(court).not.toContain('FACE A UN BLOCAGE')
    })

    it('sans outils directs, le texte reste le seul chemin : tout est gardé', () => {
      for (const nom of fichiers) expect(complet).toContain(ligne(nom))
      expect(complet).toContain('Oui → correction ponctuelle : `edit_file` puis `verify`')
      expect(complet).toContain('1 bis. `edit_file`')
      expect(complet).toMatch(/création d[’']un fichier PAR `edit_file`/u)
      expect(complet).toContain('1. CHERCHE')
    })
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

  it('remember : son mode d’emploi arrive par sa description, avec ou sans outils directs', () => {
    const remember = CATALOG.find((c) => c.name === 'remember')!
    // Sans outils directs, la description est recopiée dans la liste texte ; avec, l'outil la porte.
    expect(complet).toContain(remember.description)
    expect(remember.description).toContain('`lesson` — une leçon réutilisable')
    expect(remember.description).toContain('prends `session:` comme source')
    // Pas en double : la consigne courte ne redéfinit pas les types que l'outil porte déjà.
    expect(court).not.toContain('`lesson` — une leçon réutilisable')
    // Le préfixe `perso:` est dit par `brain_read`, dans les deux chemins ; le refus « aucun Brain
    // perso » par le compte-rendu de la commande (commands.brain-perso.test.ts).
    const brainRead = CATALOG.find((c) => c.name === 'brain_read')!
    expect(brainRead.description).toContain('garde le préfixe perso:')
    expect(complet).toContain(brainRead.description)
  })

  it('allège réellement la consigne envoyée avec les outils directs', () => {
    expect(complet.length - court.length).toBeGreaterThan(18_000)
  })
})
