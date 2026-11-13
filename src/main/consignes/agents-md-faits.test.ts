import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { refusGitDestructeur } from '../../shared/garde-git-destructeur'
import { refusArretHote } from '../../shared/garde-hote-et-boucle'
import {
  cheminsCites,
  cheminsPartiels,
  existeAvecMotif,
  scriptsNpmCites
} from '../fichiers/chemins-cites'
import { PROJECT_CONTEXT_MAX_BYTES } from './context-files'

/**
 * Les FAITS d'AGENTS.md, rejoués contre le dépôt.
 *
 * POURQUOI (2026-11-05) : AGENTS.md est relu à CHAQUE tour par chaque
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

/**
 * L'AGENTS.md à vérifier pour `racine` : le sien ; sinon, si `racine` est une copie liée
 * (`git worktree add`), celui du dossier principal du dépôt ; sinon `undefined`.
 *
 * POURQUOI (2026-11-05) : AGENTS.md était alors ignoré par git, et les copies des runs et de
 * `verify` ne l'avaient pas : ce test y plantait (ENOENT). Il est suivi par git depuis le 2026-11-06
 * (le test « suivi par git » plus bas l'y tient), mais une copie posée sur un commit plus ancien
 * n'en a toujours aucun : elle lit celui du dossier principal, vérifié contre le code de la copie.
 */
function agentsMdDe(racine: string): string | undefined {
  const local = join(racine, 'AGENTS.md')
  if (existsSync(local)) return local
  let commun: string
  try {
    commun = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: racine,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    }).trim()
  } catch {
    return undefined // pas un dépôt git : aucun dossier principal à consulter
  }
  const principal = join(dirname(commun), 'AGENTS.md')
  return existsSync(principal) ? principal : undefined
}

// La racine se lit depuis CE fichier, pas depuis le dossier où vitest a été lancé (revue 2026-11-05).
const RACINE = fileURLToPath(new URL('../../..', import.meta.url))
const CHEMIN_AGENTS = agentsMdDe(RACINE)
const SANS_AGENTS =
  'aucun AGENTS.md ici ni dans le dossier principal du dépôt (clone public) : aucun fait à vérifier'
const AGENTS = CHEMIN_AGENTS ? readFileSync(CHEMIN_AGENTS, 'utf8') : ''
const lire = (chemin: string): string => readFileSync(join(RACINE, chemin), 'utf8')
const SCRIPTS_NPM: Record<string, string> = JSON.parse(lire('package.json')).scripts
const ASSETS = 'src/renderer/src/assets'

// L'extraction des chemins cités vit dans `chemins-cites.ts` depuis le 05/11 : la même règle passe
// aussi sur la constitution, la consigne du chat, les consignes d'étape et les SKILL.md
// (`chemins-cites.test.ts`).
// fix-ok: cheminsCites et existeAvecMotif étaient privés à ce test, donc aucun autre texte des agents
// n'était vérifié ; ce test reste vert (77/77 avec chemins-cites.test.ts, 05/11) après le déplacement.

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
      expect(lire('src/main/consignes/context-files.test.ts')).toContain('le plafond est PARTAGÉ')
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
    fait: 'Jeton neuf : sa valeur dans `src/renderer/src/assets/theme.css` ET dans le bloc clair de `src/renderer/src/assets/theme-modes.css`.',
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
    fait: 'Dossier de données → `src/main/app/app-data.ts` (`.autowin-data/`)',
    verifier: () => expect(lire('src/main/app/app-data.ts')).toContain("'.autowin-data'")
  },
  {
    fait: '`--json` donne `sources` et `carte` à ses `--top` premiers appelants',
    // Le comportement est prouvé par `scripts/gels-classement.test.mjs` ; ici, que le fait cité
    // désigne bien la branche `--json` qui résout les appelants jusqu'au rang `top`.
    verifier: () =>
      expect(lire('scripts/gels-classement.mjs')).toMatch(
        /rang < top \? \{ \.\.\.a, \.\.\.sourcesFiables\(a\.appelant/
      )
  },
  {
    fait: 'porte `derniereFois` (une chaîne seule = ancien format, sans date)',
    verifier: () =>
      expect(lire('src/main/runs/murs-store.ts')).toContain(
        'export type EntreeDeMur = string | { signature: string; derniereFois: string }'
      )
  },
  {
    fait: "`controle` = à l'outil suivant, `tour` = entre deux appels au modèle, `rendue` = en fin de tour",
    verifier: () =>
      expect(lire('src/shared/orientations-en-cours.ts')).toContain(
        "par: 'controle' | 'tour' | 'rendue'"
      )
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
  it('chaque chemin du dépôt cité existe', ({ skip }) => {
    if (!CHEMIN_AGENTS) skip(SANS_AGENTS)
    const chemins = cheminsCites(AGENTS)
    // Garde du test lui-même : si l'extraction ne trouve plus rien, elle est cassée, pas le fichier.
    expect(chemins.length).toBeGreaterThan(10)
    const absents = chemins.filter((c) => !existeAvecMotif(c.split('/'), RACINE))
    expect(absents).toEqual([])
  })

  it('aucun chemin cité n’est tronqué : chacun s’ouvre tel quel depuis la racine', ({ skip }) => {
    if (!CHEMIN_AGENTS) skip(SANS_AGENTS)
    const suivis = execFileSync('git', ['ls-files'], {
      cwd: RACINE,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    })
      .split('\n')
      .filter(Boolean)
    expect(cheminsPartiels(AGENTS, RACINE, suivis)).toEqual([])
  })

  it('aucun renvoi à un fil : la provenance d’un fait vit dans le commit', ({ skip }) => {
    if (!CHEMIN_AGENTS) skip(SANS_AGENTS)
    // Le lecteur d'AGENTS.md n'ouvrira pas le fil cité ; `git log -p AGENTS.md` retrouve la source.
    expect(AGENTS.match(/\bconv-\d+\b/g) ?? []).toEqual([])
  })

  it('AGENTS.md est suivi par git : partagé, historisé, réversible', () => {
    // Ignoré par git, il n'avait ni historique ni copie ailleurs que sur ce poste : un fait effacé
    // par erreur était perdu, et un collègue ou une copie de travail n'en recevait aucun.
    expect(() =>
      execFileSync('git', ['ls-files', '--error-unmatch', 'AGENTS.md'], {
        cwd: RACINE,
        stdio: 'ignore',
        windowsHide: true
      })
    ).not.toThrow()
    expect(lire('.gitignore')).not.toMatch(/^\/?AGENTS\.md\s*$/m)
  })

  it('chaque `npm run X` cité est un script de package.json', ({ skip }) => {
    if (!CHEMIN_AGENTS) skip(SANS_AGENTS)
    const cites = scriptsNpmCites(AGENTS)
    expect(cites.length).toBeGreaterThan(0)
    expect(cites.filter((nom) => !(nom in SCRIPTS_NPM))).toEqual([])
  })

  it.for(PAIRES.map((p) => [p.fait, p] as const))('fait : %s', async ([fait, paire], { skip }) => {
    if (!CHEMIN_AGENTS) skip(SANS_AGENTS)
    expect(AGENTS, 'citation disparue d’AGENTS.md : retire ou mets à jour sa paire').toContain(fait)
    await paire.verifier()
  })
})

describe('AGENTS.md à vérifier : copie liée et clone', () => {
  const racines: string[] = []
  afterAll(() => {
    for (const racine of racines) rmSync(racine, { recursive: true, force: true })
  })

  it('une copie liée lit celui du dossier principal ; un clone n’en a aucun (conv-1590)', () => {
    // Mesure du 2026-11-05 : dans une copie de run (git worktree), sans AGENTS.md à sa racine, ce test
    // plantait en ENOENT. Jumeaux : la copie liée trouve celui du dossier principal, le clone aucun.
    const git = (cwd: string, ...args: string[]): void => {
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd,
        stdio: 'ignore',
        windowsHide: true
      })
    }
    const principal = mkdtempSync(join(tmpdir(), 'autowin-agents-md-'))
    racines.push(principal)
    writeFileSync(join(principal, '.gitignore'), 'AGENTS.md\n')
    writeFileSync(join(principal, 'AGENTS.md'), '# faits\n')
    writeFileSync(join(principal, 'a.txt'), 'a\n')
    git(principal, 'init', '-q')
    git(principal, 'add', '.')
    git(principal, 'commit', '-q', '--no-verify', '-m', 'init')
    const copie = join(principal, 'copie-liee')
    git(principal, 'worktree', 'add', '-q', '--detach', copie)
    const clone = mkdtempSync(join(tmpdir(), 'autowin-agents-md-clone-'))
    racines.push(clone)
    git(clone, 'clone', '-q', principal, '.')
    const vrai = (chemin: string | undefined): string | undefined =>
      chemin === undefined ? undefined : realpathSync.native(chemin)

    expect(existsSync(join(copie, 'AGENTS.md'))).toBe(false)
    expect(vrai(agentsMdDe(principal))).toBe(vrai(join(principal, 'AGENTS.md')))
    expect(vrai(agentsMdDe(copie))).toBe(vrai(join(principal, 'AGENTS.md')))
    expect(agentsMdDe(clone)).toBeUndefined()
    // Six processus git : 42,8 s mesurées le 05/11 sur un poste chargé, au-delà des 20 s
    // par défaut de vitest.config.ts ; même convention qu'edit-file-copie-desynchronisee.test.ts.
  }, 120_000)
})
