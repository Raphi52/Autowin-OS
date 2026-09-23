import { describe, expect, it } from 'vitest'
import { extraireDossiersProjetsClaude, lireDossiersProjetsClaude } from './dossiers-claude-cli'

/**
 * L'import des projets claude.exe dans la liste des dossiers du Chat (conv-5, 2026-09-23).
 *
 * La fixture reproduit la FORME du profil réel mesuré ce jour-là : 24 entrées dans `projects`
 * dont seulement 5 vrais projets — le reste est le dossier personnel, des doublons de
 * séparateurs, des copies de travail (`.claude\worktrees`) et des dossiers jetables
 * (`AppData\…\scratch-workspaces`). Les valeurs sensibles (jeton, compte) sont là pour prouver
 * qu'AUCUNE valeur du fichier ne franchit la fonction : seules les clés de `projects` sortent.
 */
const PERSONNEL = 'C:\\Users\\quelquun'
const SECRET = 'sk-jeton-qui-ne-doit-jamais-sortir'

function profil(projets: Record<string, unknown>): string {
  return JSON.stringify({
    userID: 'id-prive',
    oauthAccount: { accessToken: SECRET, emailAddress: 'prive@example.org' },
    projects: projets
  })
}

const PROJETS_REALISTES: Record<string, unknown> = {
  [PERSONNEL]: {},
  'E:\\SOURCES\\GitLab\\Edp\\siteslocauxcore': {},
  'E:/SOURCES/GitLab/Edp/siteslocauxcore': {},
  'E:\\SOURCES\\GitLab\\Edp\\siteslocauxcore\\.claude\\worktrees\\sleepy-wright-861700': {},
  'C:\\Users\\quelquun\\AppData\\Roaming\\Claude\\scratch-workspaces\\a\\b\\scratch-2026-09-10': {},
  'E:\\PERSO\\Divers\\VideoToMp3': {},
  'E:\\SOURCES\\AzureDevOps\\AutoWinOS': {},
  'E:\\SOURCES\\AzureDevOps\\AutoWinOS\\.autowin-data\\autowin-os\\worktrees\\x\\agent__y': {},
  // Un libellé de classement n'est pas un chemin : même frontière que la liste du Chat (conv-81).
  'Clients/Amitel': {}
}

describe('extraireDossiersProjetsClaude', () => {
  it('garde les vrais projets, canonisés, et fusionne les doublons de séparateurs', () => {
    const dossiers = extraireDossiersProjetsClaude(profil(PROJETS_REALISTES), PERSONNEL)
    expect(dossiers).toEqual([
      'E:\\SOURCES\\GitLab\\Edp\\siteslocauxcore',
      'E:\\PERSO\\Divers\\VideoToMp3',
      'E:\\SOURCES\\AzureDevOps\\AutoWinOS'
    ])
  })

  it('exclut le dossier personnel, les copies de travail et les dossiers jetables', () => {
    const dossiers = extraireDossiersProjetsClaude(profil(PROJETS_REALISTES), PERSONNEL)
    expect(dossiers).not.toContain(PERSONNEL)
    for (const chemin of dossiers) {
      expect(chemin.toLowerCase()).not.toMatch(/worktrees|scratch-workspaces|appdata|\\\./)
    }
  })

  it('ne laisse JAMAIS sortir une valeur du profil — uniquement des clés de projects', () => {
    const sortie = JSON.stringify(
      extraireDossiersProjetsClaude(profil(PROJETS_REALISTES), PERSONNEL)
    )
    expect(sortie).not.toContain(SECRET)
    expect(sortie).not.toContain('prive@example.org')
    expect(sortie).not.toContain('id-prive')
  })

  it('rend [] sur un profil corrompu, sans projects, ou de forme inattendue', () => {
    expect(extraireDossiersProjetsClaude('{pas du json', PERSONNEL)).toEqual([])
    expect(extraireDossiersProjetsClaude('{"autre": 1}', PERSONNEL)).toEqual([])
    expect(extraireDossiersProjetsClaude('{"projects": ["liste"]}', PERSONNEL)).toEqual([])
    expect(extraireDossiersProjetsClaude('null', PERSONNEL)).toEqual([])
  })
})

describe('lireDossiersProjetsClaude', () => {
  it('sonde les bases dans l’ordre et lit la PREMIÈRE qui porte un .claude.json', () => {
    // Cas réel du poste : HOME=Z:\ sans profil, USERPROFILE porte le vrai fichier.
    const lues: string[] = []
    const dossiers = lireDossiersProjetsClaude({
      candidats: ['Z:\\', PERSONNEL, undefined],
      existe: (chemin) => chemin === `${PERSONNEL}\\.claude.json`,
      lire: (chemin) => {
        lues.push(chemin)
        return profil({ 'E:\\SOURCES\\AzureDevOps\\AutoWinOS': {} })
      }
    })
    expect(lues).toEqual([`${PERSONNEL}\\.claude.json`])
    expect(dossiers).toEqual(['E:\\SOURCES\\AzureDevOps\\AutoWinOS'])
  })

  it('rend [] quand aucune base ne porte de profil, ou quand la lecture échoue', () => {
    expect(lireDossiersProjetsClaude({ candidats: ['Z:\\'], existe: () => false })).toEqual([])
    expect(
      lireDossiersProjetsClaude({
        candidats: [PERSONNEL],
        existe: () => true,
        lire: () => {
          throw new Error('EACCES')
        }
      })
    ).toEqual([])
  })

  it('ne sonde pas deux fois la même base (USERPROFILE et homedir sont souvent identiques)', () => {
    let sondes = 0
    lireDossiersProjetsClaude({
      candidats: [PERSONNEL, PERSONNEL.toLowerCase()],
      existe: () => {
        sondes += 1
        return false
      }
    })
    expect(sondes).toBe(1)
  })
})
