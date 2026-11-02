import { describe, expect, it } from 'vitest'
import { cheminsRelatifsCites, relanceCheminsComplets } from './chemins-complets'
import { STYLE_TON } from './response-style'

/*
 * Le rejeu d'origine : conv-1335, clôture du 2026-10-31. L'utilisateur a demandé « il est ou ? »,
 * puis « donne le path complet », parce que ces deux chemins ne se copient nulle part.
 */
const CLOTURE_CONV_1335 =
  'Aucun calcul ne tourne. Original 1080p : `film/sortie/film-rapide/autowin-os-film.mp4` (2 Go). ' +
  'Copie : `.autowin-tmp/conv-1335/autowin-os-film-v2-720p.mp4`. Aucun fichier du dépôt n’a changé.'

describe('cheminsRelatifsCites — ce qui doit déclencher', () => {
  it('rejeu conv-1335 : les deux chemins de la clôture sont repérés', () => {
    expect(cheminsRelatifsCites(CLOTURE_CONV_1335)).toEqual([
      'film/sortie/film-rapide/autowin-os-film.mp4',
      '.autowin-tmp/conv-1335/autowin-os-film-v2-720p.mp4'
    ])
  })

  it('chemin du dépôt, avec numéro de ligne, séparateur Windows ou gras', () => {
    expect(cheminsRelatifsCites('La cause est dans `src/main/agent-pilot.ts:2466-2505`.')).toEqual([
      'src/main/agent-pilot.ts'
    ])
    expect(cheminsRelatifsCites('Voir film\\sortie\\film.mp4 pour le résultat.')).toEqual([
      'film\\sortie\\film.mp4'
    ])
    expect(cheminsRelatifsCites('**outils/son_film.py** corrigé.')).toEqual(['outils/son_film.py'])
  })

  it('un nom de fichier accentué reste un chemin', () => {
    expect(
      cheminsRelatifsCites('Copie dans `sortie/vidéo finale.mp4` et `sortie/vidéo.mp4`.')
    ).toEqual(['sortie/vidéo.mp4'])
  })

  it('un même chemin cité deux fois ne compte qu’une fois', () => {
    expect(cheminsRelatifsCites('`a/b.ts` puis encore `a/b.ts`.')).toEqual(['a/b.ts'])
  })

  it('un lien vers un fichier relatif compte aussi', () => {
    expect(cheminsRelatifsCites('Ouvre [a.ts:80](src/main/a.ts:80).')).toEqual(['src/main/a.ts'])
  })
})

describe('cheminsRelatifsCites — ce qui doit rester silencieux', () => {
  it.each([
    ['disque Windows', '`C:\\Users\\camille\\AppData\\Local\\film\\autowin-os-film.mp4`'],
    ['disque en barres obliques', '`D:/AutoWinOS/src/main/x.ts:12`'],
    ['dossier avec espace', 'Il lance C:\\Program Files\\nodejs\\node.exe ici.'],
    ['chemin façon Bash', '`/c/Users/camille/film/y.mp4`'],
    ['partage réseau', '`//serveur/partage/Projets IA/Dossier/README.md` et `\\\\serveur\\partage\\a.md`'],
    ['dossier personnel', '`~/.claude/settings.json`'],
    ['variable', '`%USERPROFILE%\\.claude\\settings.json` et `$HOME/.claude/settings.json`']
  ])('chemin complet : %s', (_nom, texte) => {
    expect(cheminsRelatifsCites(texte)).toEqual([])
  })

  it.each([
    ['branche', 'Poussé sur `origin/main`.'],
    ['mots', 'Choisir et/ou comparer.'],
    ['nombres et dates', '1/2 du film, le 31/10/2026, ratio 1/2.5.'],
    ['adresse web', 'Voir https://github.com/Raphi52/Autowin-OS/blob/main/README.md ici.'],
    ['domaine sans protocole', 'Sur dev.azure.com/Contoso/rapport.html ce matin.'],
    ['provenance', 'Source `git:src/main/x.ts@9218eaf`.'],
    ['paquet', 'Le paquet `@types/node.d` est là.'],
    ['motif', 'Tous les `src/**/*.ts`.'],
    ['dossier sans fichier', 'Le dossier `film/sortie/` est gardé.'],
    ['nom nu', 'Lance `rendu-film.mjs`.'],
    ['technologies', 'Un projet Vue.js/React.js.']
  ])('autre chose qu’un chemin : %s', (_nom, texte) => {
    expect(cheminsRelatifsCites(texte)).toEqual([])
  })

  it('une commande tapée dans une ligne de code n’est pas une adresse', () => {
    expect(cheminsRelatifsCites('Lancé avec `node outils/rendu-film.mjs --rapide`.')).toEqual([])
  })

  it('un bloc de code est ignoré, ouvert ou fermé', () => {
    expect(cheminsRelatifsCites('Voici :\n```bash\ncat film/a.mp4\n```\nFini.')).toEqual([])
    expect(cheminsRelatifsCites('Voici :\n```bash\ncat film/a.mp4')).toEqual([])
  })

  it('un chemin juste après un bloc de code reste repéré', () => {
    expect(cheminsRelatifsCites('```\ncode\n```\nRésultat : `film/a.mp4`.')).toEqual(['film/a.mp4'])
  })

  it('les lignes techniques invisibles sont ignorées', () => {
    expect(
      cheminsRelatifsCites('Fini.\nAUTOWIN_PROMPT_V1: [80] Ouvre film/sortie/a.mp4 et regarde.')
    ).toEqual([])
  })

  it('texte vide ou absent', () => {
    expect(cheminsRelatifsCites('')).toEqual([])
    expect(cheminsRelatifsCites(undefined as unknown as string)).toEqual([])
  })
})

describe('la consigne servie au modèle', () => {
  it('demande le chemin entier, et son exemple passerait le contrôle', () => {
    expect(STYLE_TON).toContain('TOUJOURS en entier')
    const exemple = /\(`(D:[^`]+)`, jamais/u.exec(STYLE_TON)?.[1] ?? ''
    expect(exemple).not.toBe('')
    expect(cheminsRelatifsCites(`\`${exemple}\``)).toEqual([])
  })
})

describe('relanceCheminsComplets', () => {
  it('nomme les chemins fautifs et demande la réponse entière, sans commande', () => {
    const consigne = relanceCheminsComplets(['film/a.mp4', 'src/b.ts'])
    expect(consigne).toContain('`film/a.mp4`')
    expect(consigne).toContain('`src/b.ts`')
    expect(consigne).toContain('EN ENTIER')
    expect(consigne).toContain('SANS aucune commande')
  })

  it('reste bornée quand la réponse cite beaucoup de chemins', () => {
    const chemins = Array.from({ length: 30 }, (_, i) => `dossier/fichier-${i}.ts`)
    const consigne = relanceCheminsComplets(chemins)
    expect(consigne).toContain('`dossier/fichier-7.ts`')
    expect(consigne).not.toContain('`dossier/fichier-8.ts`')
    expect(consigne).toContain('22 autres')
  })
})
