import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { refusGitDestructeur } from '../shared/garde-git-destructeur'
import { refusArretHote } from '../shared/garde-hote-et-boucle'
import { PROJECT_CONTEXT_MAX_BYTES } from './context-files'

/**
 * Les FAITS d'AGENTS.md, rejoués contre le dépôt.
 *
 * POURQUOI (scout conv-1576, lot conv-1590, 2026-11-05) : AGENTS.md est relu à CHAQUE tour par chaque
 * agent. Un fait périmé (chemin renommé, script retiré, plafond changé) y égare tous les fils, et rien
 * ne le voyait : `context-files.test.ts` et `behaviour-files.test.ts` ne testent que le CHARGEMENT du
 * fichier, jamais ce qu'il affirme.
 *
 * Deux formes :
 *  1. AUTOMATIQUE — tout chemin du dépôt cité entre accents graves doit exister, toute commande
 *     `npm run X` doit être un script de package.json. Un fait ajouté demain est couvert sans
 *     toucher à ce test.
 *  2. PAIRES — une citation d'AGENTS.md, recopiée MOT POUR MOT, et le contrôle qui la prouve. Une
 *     paire dont la citation a disparu rougit aussi : retire-la, ou recopie la nouvelle formulation —
 *     sinon ce test vérifierait un fait que plus aucun agent ne lit.
 *
 * HORS DE PORTÉE (ils dépendent du poste, pas du dépôt) : le distant `origin`, le contenu de
 * `.autowin-data/`, le nom du sous-dossier de données.
 */

// La racine se lit depuis CE fichier, pas depuis le dossier où vitest a été lancé (revue 2026-11-05).
const RACINE = fileURLToPath(new URL('../..', import.meta.url))
const AGENTS = readFileSync(join(RACINE, 'AGENTS.md'), 'utf8')
const lire = (chemin: string): string => readFileSync(join(RACINE, chemin), 'utf8')
const SCRIPTS_NPM: Record<string, string> = JSON.parse(lire('package.json')).scripts
const ASSETS = 'src/renderer/src/assets'

/** Mots des spans entre accents graves (un span peut être une commande : `node scripts/x.mjs --y`). */
function motsCites(texte: string): string[] {
  return [...texte.matchAll(/`([^`\n]+)`/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean)
}

const PREFIXES_DU_DEPOT = /^(src|scripts|skills|\.githooks)\//

/** Les chemins du dépôt cités, placeholders compris (`skills/<nom>/SKILL.md`, `skills/*\/SKILL.md`). */
function cheminsCites(texte: string): string[] {
  const mots = motsCites(texte).filter((m) => PREFIXES_DU_DEPOT.test(m) || m === '.gitignore')
  return [...new Set(mots)]
}

/** Un segment `<nom>` ou `*` vaut n'importe quelle entrée du dossier. */
function existeAvecMotif(segments: string[], base: string): boolean {
  if (segments.length === 0) return existsSync(base)
  const [tete, ...reste] = segments
  if (tete === '') return existeAvecMotif(reste, base)
  if (/[<*]/.test(tete)) {
    if (!existsSync(base) || !statSync(base).isDirectory()) return false
    return readdirSync(base).some((entree) => existeAvecMotif(reste, join(base, entree)))
  }
  return existeAvecMotif(reste, join(base, tete))
}

interface Paire {
  /** Citation exacte d'AGENTS.md. */
  fait: string
  /** Le contrôle : lève (expect) si le fait est devenu faux. */
  verifier: () => void | Promise<void>
}

const PAIRES: Paire[] = [
  {
    fait: 'Plafond : 32 Ko PARTAGÉS',
    // Le PARTAGE avec les dossiers parents, l'ordre et la coupe signalée sont un comportement :
    // `context-files.test.ts` (« le plafond est PARTAGÉ et coupe d’abord le plus éloigné ») le prouve.
    // Ici, la valeur du plafond et le fait qu'AGENTS.md y tienne.
    verifier: () => {
      expect(lire('src/main/context-files.test.ts')).toContain('le plafond est PARTAGÉ')
      expect(PROJECT_CONTEXT_MAX_BYTES).toBe(32 * 1024)
      // AGENTS.md lui-même doit tenir sous le plafond, sinon les agents n'en reçoivent qu'une partie.
      expect(Buffer.byteLength(AGENTS, 'utf8')).toBeLessThanOrEqual(PROJECT_CONTEXT_MAX_BYTES)
    }
  },
  {
    fait: '`npm test` = typage + TOUTE la suite + lint',
    verifier: () => {
      expect(SCRIPTS_NPM.test).toMatch(/typecheck/)
      expect(SCRIPTS_NPM.test).toMatch(/vitest run/)
      expect(SCRIPTS_NPM.test).toMatch(/lint/)
    }
  },
  {
    fait: '`node scripts/ui-capture.mjs --code-dev`',
    verifier: () => expect(lire('scripts/ui-capture.mjs')).toContain("'--code-dev'")
  },
  {
    fait: '`--theme nebuleuse-verre`',
    verifier: () => {
      expect(lire('scripts/ui-capture.mjs')).toContain("'--theme'")
      expect(existsSync(join(RACINE, ASSETS, 'theme-nebuleuse-verre.css'))).toBe(true)
    }
  },
  {
    fait: '`--theme holographique-clair`',
    verifier: () =>
      expect(existsSync(join(RACINE, ASSETS, 'theme-holographique-clair.css'))).toBe(true)
  },
  {
    fait: 'Une couleur passe par un jeton : `var(--text)`, `--text-dim`, `--line`, `--bg-0` à `3`, `--gold`,',
    verifier: () => {
      const theme = lire(`${ASSETS}/theme.css`)
      const jetons = [
        'text',
        'text-dim',
        'line',
        'bg-0',
        'bg-1',
        'bg-2',
        'bg-3',
        'gold',
        'rose',
        'ok',
        'warn',
        'err'
      ]
      const absents = jetons.filter((j) => !new RegExp(`--${j}\\s*:`).test(theme))
      expect(absents).toEqual([])
    }
  },
  {
    fait: 'Jeton neuf : sa valeur dans `assets/theme.css` ET dans le bloc clair de `assets/theme-modes.css`.',
    // La règle elle-même, rejouée avec le contrôle de la suite : tout jeton littéral de theme.css a
    // sa valeur dans le bloc clair (revue 2026-11-05 : la seule existence des deux fichiers ne
    // prouvait rien).
    verifier: async () => {
      const { jetonsSansValeurClaire } = await import(
        pathToFileURL(join(RACINE, 'scripts/couleurs-en-dur.mjs')).href
      )
      const modes = lire(`${ASSETS}/theme-modes.css`)
      expect(modes).toContain(":root[data-base='clair'] {")
      expect(jetonsSansValeurClaire(lire(`${ASSETS}/theme.css`), modes)).toEqual([])
    }
  },
  {
    fait: 'ignoré par git (`.gitignore`)',
    verifier: () => expect(lire('.gitignore')).toMatch(/^\/?entreprise\/\s*$/m)
  },
  {
    fait: '`.githooks/pre-push` refuse trois cas',
    // Lu sur les lignes de CODE seulement : une chaîne restée en commentaire ne refuse rien (revue
    // 2026-11-05).
    verifier: () => {
      const code = lire('.githooks/pre-push')
        .split('\n')
        .filter((ligne) => !/^\s*#/.test(ligne))
        .join('\n')
      expect(code).toMatch(/"\$ALLOW_MAIN_PUSH" != "1"/)
      expect(code).toContain('DOSSIER_PRIVE="entreprise"')
      expect(code).toMatch(/node "\$garde_separation"[^\n]*\|\| exit 1/)
      expect(code).toContain('separation-avant-push.mjs')
      expect(code.match(/^\s*exit 1\s*$/gm)?.length ?? 0).toBeGreaterThanOrEqual(2)
    }
  },
  {
    fait: '(`npm run publier:main` pose la variable)',
    verifier: () => {
      expect(SCRIPTS_NPM['publier:main']).toMatch(/ALLOW_MAIN_PUSH=1/)
      expect(SCRIPTS_NPM['publier:main']).toMatch(/git push origin main/)
    }
  },
  {
    fait: 'le commit (`.githooks/pre-commit`) et la suite refusent',
    verifier: () => expect(lire('.githooks/pre-commit')).toContain('couleurs-en-dur.mjs')
  },
  {
    fait: '`--baisser` enregistre une baisse, sans jamais monter.',
    verifier: () => expect(lire('scripts/couleurs-en-dur.mjs')).toContain('--baisser')
  },
  {
    fait: "Le commit d'une copie de travail d'agent n'y passe pas",
    // Le hook sort d'emblée quand la racine du commit est une copie d'agent (`*/agent__*`).
    verifier: () =>
      expect(lire('.githooks/pre-commit')).toMatch(/^\s*\*\/agent__\*[^\n]*\)\s*exit 0/m)
  },
  {
    fait: "Arrêt d'Electron/node PAR NOM, `git stash`, `reset --hard`, `checkout`/`restore` de tout l'arbre,",
    verifier: () => {
      expect(refusArretHote('taskkill /IM electron.exe /F')).toBeTruthy()
      expect(refusArretHote('taskkill /F /IM node.exe')).toBeTruthy()
      // « Non vu par le hook : arrêter ou relancer Electron par PID » — le PID reste libre.
      expect(refusArretHote('taskkill /PID 4242 /F')).toBeUndefined()
      for (const commande of [
        'git stash',
        'git reset --hard',
        'git checkout -- .',
        'git restore .',
        'git clean -fd',
        'npm run format',
        'npx prettier --write .'
      ]) {
        expect(refusGitDestructeur(commande), commande).toBeTruthy()
      }
      // « `prettier --write <chemin>` reste libre »
      expect(refusGitDestructeur('npx prettier --write src/main/x.ts')).toBeUndefined()
    }
  },
  {
    fait: 'Dossier de données → `src/main/app-data.ts` (`.autowin-data/`)',
    verifier: () => expect(lire('src/main/app-data.ts')).toContain("'.autowin-data'")
  },
  {
    fait: '`scripts/conversations-sur-disque.mjs` est un MODULE à importer',
    verifier: async () => {
      const module = await import(
        pathToFileURL(join(RACINE, 'scripts/conversations-sur-disque.mjs')).href
      )
      for (const nom of ['texteDuMessage', 'lireArchives', 'ajouterArchives']) {
        expect(typeof module[nom], nom).toBe('function')
      }
    }
  }
]

describe('AGENTS.md — ses faits tiennent encore', () => {
  it('chaque chemin du dépôt cité existe', () => {
    const chemins = cheminsCites(AGENTS)
    // Garde du test lui-même : si l'extraction ne trouve plus rien, elle est cassée, pas le fichier.
    expect(chemins.length).toBeGreaterThan(10)
    const absents = chemins.filter((c) => !existeAvecMotif(c.split('/'), RACINE))
    expect(absents).toEqual([])
  })

  it('chaque `npm run X` cité est un script de package.json', () => {
    const cites = [...AGENTS.matchAll(/`npm run ([\w:-]+)`/g)].map((m) => m[1])
    expect(cites.length).toBeGreaterThan(0)
    expect(cites.filter((nom) => !(nom in SCRIPTS_NPM))).toEqual([])
  })

  it.each(PAIRES.map((p) => [p.fait, p] as const))('fait : %s', async (fait, paire) => {
    expect(AGENTS, 'citation disparue d’AGENTS.md : retire ou mets à jour sa paire').toContain(fait)
    await paire.verifier()
  })
})

describe('extraction des chemins cités', () => {
  it('prend les chemins des commandes et ignore les données du poste', () => {
    const texte =
      '`node scripts/ui-capture.mjs --code-dev` · `src/main/` · `turn-journals/<conv>/x.jsonl` · `x.ts` · `.gitignore`'
    expect(cheminsCites(texte)).toEqual(['scripts/ui-capture.mjs', 'src/main/', '.gitignore'])
  })

  it('un placeholder vaut n’importe quelle entrée, mais une entrée doit exister', () => {
    expect(existeAvecMotif('skills/<nom>/SKILL.md'.split('/'), RACINE)).toBe(true)
    expect(existeAvecMotif('skills/*/SKILL-absent.md'.split('/'), RACINE)).toBe(false)
  })
})
