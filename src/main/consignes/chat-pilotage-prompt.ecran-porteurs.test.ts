/**
 * QUI PORTE LA REGLE « PAS D'APPLI SUR L'ECRAN DE L'UTILISATEUR » (scout du 05/11, piste 16, conv-1602).
 *
 * Le commentaire de `REGLES_ECRAN_UTILISATEUR` disait « cette prose est le SEUL porteur de la
 * regle ». Faux dans un run : l'orchestrateur y pose `AUTOWIN_HDESK_ID`, et le mod Autowin
 * (mods/autowin/hooks/register.js, mod 1) reecrit alors un lancement graphique vers le bureau cache
 * du run. Vrai dans le chat : la variable n'y est pas posee, le mod laisse passer, et la regle n'y
 * tient que par du texte (ce bloc et `REGLE_BUREAU_CACHE`, ajoutee par le mod 3 a la description du
 * shell). Ce test lie le commentaire a ces trois faits.
 *
 * Entrees qui rendent ce test rouge : le commentaire remis a « SEUL porteur » sans distinguer run et
 * chat ; `AUTOWIN_HDESK_ID` pose par un autre fichier que src/main/orchestration/orchestrator.ts (le chat aurait
 * alors la redirection, et le commentaire mentirait) ; le mod qui redirigerait sans identifiant.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  REGLE_BUREAU_CACHE,
  descriptionAvecRegle,
  redirigerLancementGraphique
} from '../../../mods/autowin/hooks/regles.js'

const SOURCE = readFileSync(join(__dirname, 'chat-pilotage-prompt.ts'), 'utf8')

/** Le bloc de commentaire juste au-dessus de `export const REGLES_ECRAN_UTILISATEUR`. */
function commentaireDuBloc(): string {
  const fin = SOURCE.indexOf('export const REGLES_ECRAN_UTILISATEUR')
  const debut = SOURCE.lastIndexOf('/**', fin)
  return fin > 0 && debut >= 0 ? SOURCE.slice(debut, fin) : ''
}

/** Fichiers de code (hors tests) de src/ qui POSENT `AUTOWIN_HDESK_ID` (`X: …` ou `X = …`). */
function fichiersQuiPosentLeBureau(): string[] {
  const racine = join(__dirname, '../..')
  const trouves: string[] = []
  for (const nom of readdirSync(racine, { recursive: true, encoding: 'utf8' })) {
    if (!/\.tsx?$/.test(nom) || /\.test\.tsx?$/.test(nom)) continue
    const texte = readFileSync(join(racine, nom), 'utf8')
    if (/AUTOWIN_HDESK_ID\s*(:|=(?!=))/.test(texte))
      trouves.push(relative(racine, join(racine, nom)))
  }
  return trouves.map((c) => c.split('\\').join('/'))
}

const LANCEUR = 'D:/AutoWinOS/scripts/hdesk-lancer.ps1'

describe("porteurs de la regle de l'ecran : le mod dans un run, le texte dans le chat (conv-1602)", () => {
  it('le commentaire distingue le run du chat et nomme le mecanisme du run', () => {
    const commentaire = commentaireDuBloc()
    expect(commentaire, 'commentaire au-dessus de REGLES_ECRAN_UTILISATEUR').not.toBe('')
    expect(commentaire).not.toContain('cette prose est le SEUL porteur de la regle')
    expect(commentaire).toMatch(/DANS UN RUN/)
    expect(commentaire).toMatch(/DANS LE CHAT/)
    expect(commentaire).toContain('AUTOWIN_HDESK_ID')
    expect(commentaire).toContain('redirigerLancementGraphique')
    expect(commentaire).toContain('REGLE_BUREAU_CACHE')
  })

  it('dans un run (identifiant de bureau pose) le mod reecrit ; sans lui, il laisse passer', () => {
    const run = redirigerLancementGraphique('Start-Process notepad x.txt', {
      idBureau: 'run-run-1602-1',
      lanceur: LANCEUR
    })
    expect(run.action).toBe('reecrire')
    expect(
      redirigerLancementGraphique('Start-Process notepad x.txt', { lanceur: LANCEUR })
    ).toEqual({
      action: 'laisser'
    })
  })

  it("seul l'orchestrateur pose AUTOWIN_HDESK_ID : le chat n'a donc pas la redirection", () => {
    expect(fichiersQuiPosentLeBureau()).toEqual(['main/orchestration/orchestrator.ts'])
  })

  it('dans le chat, le texte passe aussi par la description du shell (mod 3)', () => {
    expect(descriptionAvecRegle('Executes a bash command.')).toContain(REGLE_BUREAU_CACHE.trim())
  })
})
