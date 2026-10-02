// fix-ok: tests edites 3 fois — chaque cas limite du cadrage (deja redirigee, chaine, guillemets, sans fenetre, sans id) ajoute puis verifie par reinjection de defaut
import { describe, expect, it } from 'vitest'
import {
  MARQUE_ECRAN_UTILISATEUR,
  REGLE_BUREAU_CACHE,
  decoderCommande,
  descriptionAvecRegle,
  rappelRetire,
  redirigerLancementGraphique
} from '../../mods/autowin/hooks/regles.js'

/**
 * Cas limites des mods d'Autowin (conv-58, « fais le 1 2 3 ») — mods/autowin/hooks/regles.js.
 * Le branchement réel sur le CLI est prouvé à part, par un run `claude -p --plugin-dir mods/autowin`.
 */
const ctx = { idBureau: 'run-test-1', lanceur: 'D:/Autowin/scripts/hdesk-lancer.ps1' }

function reecrite(commande: string): string {
  const d = redirigerLancementGraphique(commande, ctx)
  if (d.action !== 'reecrire') throw new Error('attendu reecrire, obtenu ' + JSON.stringify(d))
  return d.commande
}

describe('mod 1 — app graphique redirigée vers le bureau caché du run', () => {
  it('nominal : Start-Process notepad x.txt devient un appel au lanceur du bureau du run', () => {
    const c = reecrite('Start-Process notepad x.txt')
    expect(c).toMatch(/^powershell -NoProfile -EncodedCommand [A-Za-z0-9+/=]+$/)
    const script = decoderCommande(c)
    expect(script).toContain("$e = 'notepad'")
    expect(script).toContain(
      "& 'D:/Autowin/scripts/hdesk-lancer.ps1' -Id 'run-test-1' -Executable $e -Arguments 'x.txt'"
    )
    expect(script).toContain('Get-Command $e -CommandType Application')
  })

  it('déjà redirigée : une commande qui passe par hdesk-lancer.ps1 n’est jamais emballée deux fois', () => {
    const deja =
      'powershell -NoProfile -File scripts/hdesk-lancer.ps1 -Id run-test-1 -Executable "C:/x.exe" -Travail t'
    expect(redirigerLancementGraphique(deja, ctx)).toEqual({ action: 'laisser' })
  })

  it('absente, vide ou mal typée : laissée telle quelle, sans planter', () => {
    for (const v of [undefined, null, '', '   ', 42, { command: 'notepad' }]) {
      expect(redirigerLancementGraphique(v, ctx)).toEqual({ action: 'laisser' })
    }
    expect(redirigerLancementGraphique('Start-Process', ctx)).toEqual({ action: 'laisser' })
  })

  it('hors d’un run (pas d’identifiant de bureau) : rien ne change — le refus retiré en conv-631 ne revient pas', () => {
    expect(redirigerLancementGraphique('Start-Process notepad', {})).toEqual({ action: 'laisser' })
    expect(redirigerLancementGraphique('notepad x', { lanceur: ctx.lanceur })).toEqual({
      action: 'laisser'
    })
    expect(
      redirigerLancementGraphique('notepad x', { ...ctx, idBureau: 'id avec espace' })
    ).toEqual({ action: 'laisser' })
  })

  it('ouverture voulue sur l’écran de l’utilisateur : la marque la laisse passer', () => {
    expect(
      redirigerLancementGraphique(`Start-Process notepad x.txt ${MARQUE_ECRAN_UTILISATEUR}`, ctx)
    ).toEqual({
      action: 'laisser'
    })
  })

  it('commandes enchaînées : seul le morceau qui lance l’app est réécrit', () => {
    const c = reecrite('cd D:\\x; Start-Process notepad')
    expect(c.startsWith('cd D:\\x; powershell -NoProfile -EncodedCommand ')).toBe(true)
  })

  it('guillemets et espaces : le chemin et les arguments arrivent intacts au lanceur', () => {
    const script = decoderCommande(
      reecrite(`Start-Process "C:\\a b\\x.exe" -ArgumentList '-o "y z"'`)
    )
    expect(script).toContain("$e = 'C:\\a b\\x.exe'")
    expect(script).toContain(`-Arguments '-o "y z"'`)
    const apostrophe = decoderCommande(reecrite(`& "C:\\Program Files\\L'app\\x.exe" --flag`))
    expect(apostrophe).toContain("$e = 'C:\\Program Files\\L''app\\x.exe'")
    expect(apostrophe).toContain("-Arguments '--flag'")
  })

  it('autres formes : programme graphique nu, opérateur & sur une app installée', () => {
    expect(decoderCommande(reecrite('chrome https://exemple.fr'))).toContain("$e = 'chrome'")
    expect(decoderCommande(reecrite('& "C:\\Program Files\\X\\x.exe"'))).toContain(
      "$e = 'C:\\Program Files\\X\\x.exe'"
    )
  })

  it('formes sans programme à rediriger (Invoke-Item, start, explorer, adresse) : refus avec la commande à employer', () => {
    for (const c of [
      'Invoke-Item f.txt',
      'start "f.txt"',
      'explorer D:\\x',
      'Start-Process "msteams:/l/chat/1"'
    ]) {
      const d = redirigerLancementGraphique(c, ctx)
      expect(d.action, c).toBe('refuser')
      if (d.action === 'refuser') {
        expect(d.motif).toContain('hdesk-lancer.ps1 -Id run-test-1')
        expect(d.motif).toContain(MARQUE_ECRAN_UTILISATEUR)
      }
    }
  })

  it('programme sans fenêtre et commandes ordinaires : laissés tels quels', () => {
    for (const c of [
      'Start-Process powershell -WindowStyle Hidden -ArgumentList x',
      'Start-Process node -NoNewWindow',
      'grep -a notepad fichier.log',
      'npm test',
      'node -e "console.log(\'code\')"'
    ]) {
      expect(redirigerLancementGraphique(c, ctx), c).toEqual({ action: 'laisser' })
    }
  })

  it('le texte d’un heredoc n’est pas lu comme des commandes (faux positif conv-597)', () => {
    const c = "cat > /tmp/a.txt <<'EOF'\nnotepad\ncode\nEOF\nnpm test"
    expect(redirigerLancementGraphique(c, ctx)).toEqual({ action: 'laisser' })
  })
})

describe('mod 2 — rappels automatiques qui contredisent la constitution', () => {
  it('le compte à rebours de tokens est retiré, les autres rappels restent', () => {
    expect(rappelRetire('total_tokens_reminder')).toBe(true)
    for (const t of [
      'date',
      'environment',
      'todo_reminder',
      '',
      undefined,
      'constructor',
      'toString'
    ]) {
      expect(rappelRetire(t), String(t)).toBe(false)
    }
  })
})

describe('mod 3 — règle du bureau caché dans la description du shell', () => {
  it('ajoutée une fois, et identique au passage suivant (cache stable)', () => {
    const une = descriptionAvecRegle('Runs a shell command.')
    expect(une).toBe('Runs a shell command.' + REGLE_BUREAU_CACHE)
    expect(descriptionAvecRegle(une)).toBe(une)
  })

  it('description absente ou mal typée : la règle seule, sans planter', () => {
    expect(descriptionAvecRegle(undefined)).toBe(REGLE_BUREAU_CACHE)
    expect(descriptionAvecRegle(12)).toBe(REGLE_BUREAU_CACHE)
  })
})
