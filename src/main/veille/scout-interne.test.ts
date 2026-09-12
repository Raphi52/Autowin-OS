import { describe, expect, it } from 'vitest'
import { construirePromptScoutInterne } from './scout-interne'
import { executerPasseInterne } from './passe'
import { lireStockVeille } from './candidats-store'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const params = { racineDepot: 'C:/depot', racineDonnees: 'C:/donnees' }

describe('scout interne — candidats d’ajout nés de l’app', () => {
  it('le prompt exige un ancrage DÉPÔT et interdit d’inventer', () => {
    const prompt = construirePromptScoutInterne(params)
    expect(prompt).toContain('C:/donnees')
    expect(prompt).toContain('C:/depot')
    expect(prompt).toContain('src/...:ligne')
    expect(prompt).toContain('RECOPIÉE MOT POUR MOT')
    expect(prompt).toContain('MÉTHODE OBLIGATOIRE')
    expect(prompt).toContain('un [] sans lecture citée est un refus de travail')
  })

  /*
   * MESURE DU 2026-09-12 : le scout a rendu « le refus annoncé définitif se réécrit 92 fois » ancré
   * sur `relaunch-resumable-run.ts:416` — la ligne du MESSAGE. La cause vivait dans
   * `orchestration-state.ts` (une écriture de checkpoint encore en vol ressuscitait le fichier
   * effacé). Corriger la ligne citée n'aurait rien réparé : le prompt doit donc exiger l'ancrage de
   * la CAUSE, et autoriser « cause non localisée » plutôt qu'un faux ancrage.
   */
  it('exige d’ancrer la CAUSE et non la ligne qui affiche le défaut', () => {
    const prompt = construirePromptScoutInterne(params)
    expect(prompt).toContain('ANCRE LA CAUSE, PAS LE SYMPTÔME')
    expect(prompt).toContain('jamais la ligne qui l’AFFICHE')
    expect(prompt).toContain('cause non localisée')
    expect(prompt).toContain('qui RECRÉE sa condition')
    expect(prompt).toContain('pas un garde ajouté autour du symptôme')
  })
})

describe('passe interne — le chemin du bouton « En générer plus »', () => {
  it('écrit les candidats internes dans le stock via LE MÊME tri que la passe web', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'aos-veille-'))
    const chemin = join(racine, 'stock.json')
    try {
      const resultat = await executerPasseInterne({
        chemin,
        maintenant: () => '2026-08-13T18:00:00.000Z',
        candidatsInternes: async () => [
          {
            concurrent: 'Autowin OS',
            type: 'ajout',
            titre: 'Vue coût par rôle',
            url: 'src/main/dashboards/cost.ts:42',
            dateSource: '2026-08-13',
            citation: 'const parRole = new Map<string, number>()',
            langue: 'fr',
            pertinence: 80
          },
          // Sans ancrage dépôt → refusé par le tri, avec une raison nommée : le contrôle de
          // citation vaut aussi pour l'interne, aucun chemin privilégié.
          {
            concurrent: 'Autowin OS',
            type: 'ajout',
            titre: 'Candidat sans preuve',
            url: 'une idée en l’air',
            dateSource: '2026-08-13',
            citation: 'aucune',
            langue: 'fr'
          }
        ]
      })
      expect(resultat.retenus).toBe(1)
      expect(resultat.refuses).toHaveLength(1)
      const stock = lireStockVeille(chemin)
      expect(stock.candidats[0].concurrent).toBe('Autowin OS')
      expect(stock.candidats[0].type).toBe('ajout')
      // Le prompt proposé est celui d'un besoin INTERNE, pas l'étude d'une nouveauté concurrente.
      expect(stock.candidats[0].prompt).toContain('observé dans Autowin OS lui-même')
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })
})

  it('les idées déjà au stock sont transmises au scout avec interdiction de les reproposer', () => {
    const prompt = construirePromptScoutInterne({
      ...params,
      dejaConnus: ['Centre de reprise unifié des tours', 'Cockpit des coûts par phase']
    })
    expect(prompt).toContain('DÉJÀ AU STOCK')
    expect(prompt).toContain('- Centre de reprise unifié des tours')
    expect(prompt).toContain('même reformulée')
  })
