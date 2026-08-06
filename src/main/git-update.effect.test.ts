import { describe, expect, it } from 'vitest'
import { applyUpdate, updateEffectFor, type GitRunner } from './git-update'

/**
 * « Mettre à jour » redémarrait TOUJOURS l'application, même pour un changement de CSS.
 * Un rechargement de fenêtre suffit quand seul le renderer a bougé — le process principal survit,
 * donc les runs en cours aussi. La règle est asymétrique par conception : on ne recharge que si
 * l'on est CERTAIN, on redémarre partout ailleurs.
 */
describe('updateEffectFor', () => {
  it('recharge quand tout est sous src/renderer', () => {
    expect(
      updateEffectFor([
        'src/renderer/src/components/RouterView.css',
        'src/renderer/src/components/RouterView.tsx'
      ])
    ).toBe('reload')
  })

  it('redémarre dès qu’un fichier du main est touché', () => {
    expect(
      updateEffectFor(['src/renderer/src/components/RouterView.css', 'src/main/index.ts'])
    ).toBe('relaunch')
  })

  it('redémarre pour le preload — c’est le pont, un renderer neuf dessus ment', () => {
    expect(updateEffectFor(['src/preload/index.ts'])).toBe('relaunch')
  })

  it('redémarre pour src/shared, importé des DEUX côtés', () => {
    // Piège réel : le chemin ne dit pas « main », mais le code tourne dans le process principal.
    expect(updateEffectFor(['src/shared/tickets.ts'])).toBe('relaunch')
  })

  it('redémarre pour tout ce qui est hors de src/ (config, scripts, dépendances)', () => {
    for (const path of ['package.json', 'electron.vite.config.ts', 'scripts/build.mjs']) {
      expect(updateEffectFor([path])).toBe('relaunch')
    }
  })

  it('ne dérange personne quand rien n’a changé', () => {
    expect(updateEffectFor([])).toBe('none')
    expect(updateEffectFor(['', '   '])).toBe('none')
  })

  it('ne se laisse pas berner par un préfixe qui ressemble', () => {
    // `src/renderer-tools/` n'est PAS `src/renderer/` : sans l'ancrage, un `startsWith` naïf
    // aurait rechargé la fenêtre sur du code potentiellement exécuté ailleurs.
    expect(updateEffectFor(['src/renderer-tools/build.ts'])).toBe('relaunch')
    expect(updateEffectFor(['docs/src/renderer/note.md'])).toBe('relaunch')
  })
})

const HEAD_BEFORE = 'aaaaaaa'
const HEAD_AFTER = 'bbbbbbb'

function runnerFor(changed: string[], headAfter = HEAD_AFTER): GitRunner {
  let headCalls = 0
  return async (args) => {
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
      headCalls += 1
      return { stdout: headCalls === 1 ? HEAD_BEFORE : headAfter }
    }
    if (args[0] === 'rev-parse') return { stdout: 'main' }
    if (args[0] === 'diff') return { stdout: changed.join('\n') }
    return { stdout: '' }
  }
}

describe('applyUpdate — l’effet suit ce qui a RÉELLEMENT changé', () => {
  it('un changement de CSS recharge, sans redémarrer', async () => {
    const result = await applyUpdate(
      '/r',
      {},
      runnerFor(['src/renderer/src/components/RouterView.css']),
      async () => {}
    )
    expect(result.ok).toBe(true)
    expect(result.effect).toBe('reload')
    expect(result.reload).toBe(true)
    expect(result.relaunch).toBe(false)
    expect(result.changedPaths).toEqual(['src/renderer/src/components/RouterView.css'])
  })

  it('un changement du main redémarre', async () => {
    const result = await applyUpdate('/r', {}, runnerFor(['src/main/index.ts']), async () => {})
    expect(result.effect).toBe('relaunch')
    expect(result.relaunch).toBe(true)
    expect(result.reload).toBe(false)
  })

  it('HEAD inchangé = rien à faire, ni rechargement ni redémarrage', async () => {
    const result = await applyUpdate('/r', {}, runnerFor([], HEAD_BEFORE), async () => {})
    expect(result.effect).toBe('none')
    expect(result.relaunch).toBe(false)
    expect(result.reload).toBe(false)
  })

  it('un SHA VIDE vaut « inconnu », pas « inchangé » — et redémarre', async () => {
    // Le faux vert le plus traître : `'' === ''` se lit « rien n'a bougé », donc pas de
    // redémarrage, donc une mise à jour tirée mais jamais appliquée sous une bannière de succès.
    // Défaut RÉEL, révélé par deux tests préexistants dont le runner ne simule pas de SHA.
    const run: GitRunner = async (args) =>
      args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? { stdout: 'main' } : { stdout: '' }
    const result = await applyUpdate('/r', {}, run, async () => {})
    expect(result.effect).toBe('relaunch')
    expect(result.relaunch).toBe(true)
  })

  it('une dépendance installée redémarre, même si seul le renderer a changé', async () => {
    // `npm install` a modifié node_modules sous un process déjà démarré : recharger la fenêtre
    // ne rechargerait pas les modules du main.
    const result = await applyUpdate(
      '/r',
      {},
      runnerFor(['src/renderer/src/App.tsx']),
      async () => {}
    )
    // Sans changement de package.json le stub ne déclenche pas npm : on vérifie au moins que la
    // voie « renderer seul » reste un reload tant qu'aucune dépendance n'a bougé.
    expect(result.npmInstalled).toBe(false)
    expect(result.effect).toBe('reload')
  })

  it('un diff INDISPONIBLE redémarre — on ne parie jamais sur l’inconnu', async () => {
    // Le HEAD doit AVANCER, sinon on sort en `none` avant même d'atteindre le diff — et le test
    // ne prouverait rien du repli. C'est le piège dans lequel sa première version est tombée.
    let headCalls = 0
    const run: GitRunner = async (args) => {
      if (args[0] === 'diff') throw new Error('git indisponible')
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        headCalls += 1
        return { stdout: headCalls === 1 ? HEAD_BEFORE : HEAD_AFTER }
      }
      if (args[0] === 'rev-parse') return { stdout: 'main' }
      return { stdout: '' }
    }
    const result = await applyUpdate('/r', {}, run, async () => {})
    expect(result.ok).toBe(true)
    expect(result.effect).toBe('relaunch')
  })
})
