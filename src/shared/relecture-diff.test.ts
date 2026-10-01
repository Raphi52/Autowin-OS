import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from './git-read'
import {
  cleEmplacement,
  composerRelecture,
  relireCommentaires,
  repererLigne,
  type CommentaireRelecture
} from './relecture-diff'

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -10,5 +10,5 @@',
  ' const un = 1',
  ' const deux = 2',
  '-const trois = 3',
  '+const trois = 33',
  ' const quatre = 4',
  ' const cinq = 5',
  '@@ -40,2 +40,3 @@',
  ' fin()',
  '+ajout()',
  ' fin2()'
].join('\n')

const lignes = parseUnifiedDiff(DIFF)
const indexDe = (texte: string): number => lignes.findIndex((l) => l.text === texte)

function commentaire(
  partiel: Partial<CommentaireRelecture> & { texte: string }
): CommentaireRelecture {
  const repere = repererLigne(lignes, indexDe('+const trois = 33'))
  if (!repere) throw new Error('repère introuvable')
  return { id: 'c1', chemin: 'src/a.ts', ...repere, ...partiel }
}

describe('repererLigne', () => {
  it('ajout : numéro du fichier MODIFIÉ, texte sans marqueur, voisinage de 2 lignes de chaque côté', () => {
    const r = repererLigne(lignes, indexDe('+const trois = 33'))
    expect(r).toEqual({
      cote: 'apres',
      ligne: 12,
      extrait: 'const trois = 33',
      voisinage: [
        ' const deux = 2',
        '-const trois = 3',
        '+const trois = 33',
        ' const quatre = 4',
        ' const cinq = 5'
      ],
      indexDansVoisinage: 2
    })
  })

  it('suppression : numéro d’ORIGINE, côté « avant »', () => {
    const r = repererLigne(lignes, indexDe('-const trois = 3'))
    expect(r?.cote).toBe('avant')
    expect(r?.ligne).toBe(12)
    expect(r?.extrait).toBe('const trois = 3')
  })

  it('le voisinage s’arrête au bord du bloc : jamais l’en-tête @@ ni le bloc voisin', () => {
    const r = repererLigne(lignes, indexDe(' fin()'))
    expect(r?.voisinage).toEqual([' fin()', '+ajout()', ' fin2()'])
    expect(r?.indexDansVoisinage).toBe(0)
    expect(r?.ligne).toBe(40)
  })

  it('un en-tête de fichier ou de bloc ne se commente pas', () => {
    expect(repererLigne(lignes, indexDe('@@ -10,5 +10,5 @@'))).toBeNull()
    expect(repererLigne(lignes, 0)).toBeNull()
    expect(repererLigne(lignes, 999)).toBeNull()
  })
})

describe('composerRelecture', () => {
  it('aucun commentaire non vide → chaîne vide : jamais de relecture creuse', () => {
    expect(composerRelecture([])).toBe('')
    expect(composerRelecture([commentaire({ texte: '   ' })])).toBe('')
  })

  it('porte le fichier:ligne, le texte exact marqué « ici » et la consigne de ne rien toucher d’autre', () => {
    const message = composerRelecture([commentaire({ texte: 'Pourquoi 33 ?' })])
    expect(message).toContain('1 commentaire sur 1 fichier.')
    expect(message).toContain('1. src/a.ts:12\n')
    expect(message).toContain('+const trois = 33    ⟵ ici')
    expect(message).toContain('Commentaire : Pourquoi 33 ?')
    expect(message).toContain("ne modifie rien d'autre")
    expect(message).toContain("retrouve l'endroit grâce au texte")
  })

  it('une ligne supprimée est annoncée avec son numéro d’origine', () => {
    const repere = repererLigne(lignes, indexDe('-const trois = 3'))!
    const message = composerRelecture([
      { id: 'x', chemin: 'src/a.ts', ...repere, texte: 'garde-la' }
    ])
    expect(message).toContain("src/a.ts:12 (ligne supprimée, numéro d'origine)")
  })

  it('groupe par fichier dans l’ordre du premier commentaire, puis trie par ligne', () => {
    const repereFin = repererLigne(lignes, indexDe('+ajout()'))!
    const message = composerRelecture([
      { id: '1', chemin: 'src/b.ts', ...repereFin, texte: 'B-41' },
      { id: '2', chemin: 'src/a.ts', ...repereFin, texte: 'A-41' },
      commentaire({ id: '3', chemin: 'src/b.ts', texte: 'B-12' })
    ])
    expect(message).toContain('3 commentaires sur 2 fichiers.')
    const ordre = ['B-12', 'B-41', 'A-41'].map((t) => message.indexOf(t))
    expect(ordre).toEqual([...ordre].sort((a, b) => a - b))
    expect(message).toMatch(/1\. src\/b\.ts:12[\s\S]*2\. src\/b\.ts:41[\s\S]*3\. src\/a\.ts:41/)
  })

  it('un contenu avec des accents graves n’ouvre pas de faille dans le bloc cité', () => {
    const message = composerRelecture([
      commentaire({ voisinage: ['+const s = ```x```'], indexDansVoisinage: 0, texte: 'ok' })
    ])
    expect(message).toContain('````diff\n+const s = ```x```    ⟵ ici\n````')
  })

  it('un commentaire sur plusieurs lignes reste indenté sous son numéro', () => {
    const message = composerRelecture([commentaire({ texte: 'ligne 1\nligne 2' })])
    expect(message).toContain('Commentaire : ligne 1\n   ligne 2')
  })
})

describe('relireCommentaires', () => {
  it('garde les éléments bien formés, écarte le reste sans rien réparer', () => {
    const bon = commentaire({ texte: 'ok' })
    expect(relireCommentaires([bon, { id: 1 }, null, 'x', { ...bon, cote: 'milieu' }])).toEqual([
      bon
    ])
    expect(relireCommentaires('pas une liste')).toEqual([])
  })
})

describe('cleEmplacement', () => {
  it('distingue le côté : la ligne 12 supprimée n’est pas la ligne 12 ajoutée', () => {
    expect(cleEmplacement('a', 'avant', 12)).not.toBe(cleEmplacement('a', 'apres', 12))
  })
})
