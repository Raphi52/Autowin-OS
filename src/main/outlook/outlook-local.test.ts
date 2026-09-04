import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeFailure, OutlookLocalGateway, resolveOutlookScriptPath } from './outlook-local'

const racines: string[] = []

afterEach(async () => {
  for (const racine of racines.splice(0)) await rm(racine, { recursive: true, force: true })
})

/** Un faux script : il ecrit ce qu'on lui dit a l'endroit demande, comme le vrai. */
function ecrivain(contenu: string | (() => string)) {
  return vi.fn(async (_script: string, outPath: string) => {
    await writeFile(outPath, typeof contenu === 'function' ? contenu() : contenu, 'utf8')
  })
}

async function racineFactice(): Promise<string> {
  const racine = await mkdtemp(join(tmpdir(), 'autowin-test-'))
  racines.push(racine)
  return racine
}

describe('passerelle Outlook locale', () => {
  it('rend l instantane ecrit par le script', async () => {
    const runner = ecrivain(JSON.stringify({ ok: true, mails: [{ id: 'm1' }], evenements: [] }))
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), runner })
    const resultat = await passerelle.snapshot()
    expect(resultat.ok).toBe(true)
    expect((resultat.mails as unknown[]).length).toBe(1)
  })

  it('conserve les accents lus dans la boite', async () => {
    // L'encodage est un point de defaillance MESURE sur ce poste (sortie standard en cp1252) : le
    // canal passe par un fichier UTF-8, et ce test garde cette propriete de bout en bout.
    const runner = ecrivain(
      JSON.stringify({ ok: true, boite: 'Boîte de réception', mails: [], evenements: [] })
    )
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), runner })
    expect((await passerelle.snapshot()).boite).toBe('Boîte de réception')
  })

  it('ne relance pas le script tant que le cache est frais', async () => {
    const runner = ecrivain(JSON.stringify({ ok: true, mails: [], evenements: [] }))
    let horloge = 1000
    const passerelle = new OutlookLocalGateway({
      appRoot: await racineFactice(),
      runner,
      ttlMs: 5000,
      now: () => horloge
    })
    await passerelle.snapshot()
    await passerelle.snapshot()
    expect(runner).toHaveBeenCalledTimes(1)
    horloge += 6000
    await passerelle.snapshot()
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('force la relecture quand on le demande', async () => {
    const runner = ecrivain(JSON.stringify({ ok: true, mails: [], evenements: [] }))
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), runner })
    await passerelle.snapshot()
    await passerelle.snapshot(true)
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('ne lance QU UN script pour deux demandes simultanees', async () => {
    // Deux widgets interrogent la passerelle au meme instant : un appel COM par widget serait deux
    // dialogues avec une application lourde, pour la meme reponse.
    const runner = ecrivain(JSON.stringify({ ok: true, mails: [], evenements: [] }))
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), runner })
    await Promise.all([passerelle.snapshot(), passerelle.snapshot(), passerelle.snapshot()])
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('ne met PAS une panne en cache', async () => {
    // Garder l'echec une minute empecherait de voir qu'Outlook vient d'etre ouvert.
    const runner = ecrivain(JSON.stringify({ ok: false, erreur: 'Outlook est ferme' }))
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), runner })
    await passerelle.snapshot()
    await passerelle.snapshot()
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('nomme la panne quand le script echoue', async () => {
    const runner = vi.fn(async () => {
      throw new Error('spawn powershell ENOENT')
    })
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), runner })
    const resultat = await passerelle.snapshot()
    expect(resultat.ok).toBe(false)
    expect(String(resultat.erreur)).toContain('PowerShell est introuvable')
  })

  it('nomme la panne quand le script n a rien ecrit', async () => {
    const runner = vi.fn(async () => {})
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), runner })
    const resultat = await passerelle.snapshot()
    expect(resultat.ok).toBe(false)
    expect(String(resultat.erreur).length).toBeGreaterThan(0)
  })

  it('nomme la panne quand le JSON est tronque', async () => {
    const runner = ecrivain('{"ok": true, "mails": [')
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), runner })
    const resultat = await passerelle.snapshot()
    expect(resultat.ok).toBe(false)
    expect(String(resultat.erreur)).toContain("s'est interrompue")
  })

  it('vide le cache sur demande', async () => {
    const runner = ecrivain(JSON.stringify({ ok: true, mails: [], evenements: [] }))
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), runner })
    await passerelle.snapshot()
    passerelle.invalidate()
    await passerelle.snapshot()
    expect(runner).toHaveBeenCalledTimes(2)
  })
})

describe('traduction des pannes', () => {
  it.each([
    ['spawn powershell ENOENT', 'PowerShell est introuvable'],
    ['ENOENT: no such file', 'script de lecture'],
    ['Command failed: timed out', "n'a pas répondu à temps"],
    ['Unexpected end of JSON input', "s'est interrompue"],
    ['Erreur 0x80080005 serveur d execution', "a refusé l'accès"],
    ['Class not registered', "a refusé l'accès"]
  ])('%s -> %s', (brut, attendu) => {
    expect(describeFailure(new Error(brut))).toContain(attendu)
  })

  it('laisse passer un message inconnu plutot que de l effacer', () => {
    expect(describeFailure(new Error('panne inedite 42'))).toBe('panne inedite 42')
  })
})

describe('ou trouver le script de lecture', () => {
  // PowerShell ne peut pas executer un fichier situe DANS `app.asar`. Sans cette substitution, la
  // passerelle marche en developpement et est introuvable une fois l'application installee — le pire
  // des deux mondes, parce que le developpement ne le montre jamais.
  it('sort de l archive asar en packagé', () => {
    const resolu = resolveOutlookScriptPath(
      ['C:', 'Program Files', 'Autowin OS', 'resources', 'app.asar'].join('\\')
    )
    expect(resolu).toContain('app.asar.unpacked')
    // Le segment `app.asar` NU ne doit plus preceder `scripts` : c'est lui qui rendrait le fichier
    // inatteignable pour PowerShell.
    expect(resolu).not.toMatch(/app\.asar[\\/]scripts/)
    expect(resolu.endsWith('outlook-local-snapshot.ps1')).toBe(true)
  })

  it('gere le separateur POSIX aussi bien que celui de Windows', () => {
    expect(resolveOutlookScriptPath('/opt/autowin/resources/app.asar')).toContain(
      'app.asar.unpacked'
    )
  })

  it('laisse un chemin de developpement intact', () => {
    const resolu = resolveOutlookScriptPath(['C:', 'Amitel', 'Autowin OS'].join('\\'))
    expect(resolu).not.toContain('asar')
    expect(resolu).toContain('scripts')
  })

  it('ne touche pas un dossier qui CONTIENT le mot asar sans en etre une', () => {
    expect(resolveOutlookScriptPath('/home/dev/mon-app.asarnaut')).not.toContain('unpacked')
  })
})

describe('reponse envoyee depuis l accueil', () => {
  it('passe le corps par un FICHIER en UTF-8, jamais par la ligne de commande', async () => {
    // La sortie et l'entree de PowerShell sont en cp1252 sur ce poste : un accent passe en argument
    // arrive abime. Le corps voyage donc par un fichier, comme l'instantane.
    let luDansLeFichier = ''
    const replier = vi.fn(async (_script: string, _id: string, corpsPath: string) => {
      luDansLeFichier = await readFile(corpsPath, 'utf8')
      return 0
    })
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), replier })
    const resultat = await passerelle.replyToItem('A'.repeat(32), 'Réponse à préparer — ça va ?')
    expect(resultat.ok).toBe(true)
    expect(luDansLeFichier).toBe('Réponse à préparer — ça va ?')
  })

  it('refuse un identifiant qui n a pas la forme d un element Outlook', async () => {
    const replier = vi.fn(async () => 0)
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), replier })
    const resultat = await passerelle.replyToItem('../../evil', 'Bonjour')
    expect(resultat.ok).toBe(false)
    expect(replier).not.toHaveBeenCalled()
  })

  it('refuse un corps vide : un envoi est irreversible, on ne devine pas', async () => {
    const replier = vi.fn(async () => 0)
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), replier })
    expect((await passerelle.replyToItem('A'.repeat(32), '   ')).ok).toBe(false)
    expect(replier).not.toHaveBeenCalled()
  })

  it('nomme la cause quand le script echoue', async () => {
    const replier = vi.fn(async () => 3)
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), replier })
    const resultat = await passerelle.replyToItem('A'.repeat(32), 'Bonjour')
    expect(resultat.ok).toBe(false)
    expect(resultat.erreur).toMatch(/n.existe plus/i)
  })

  it('vise le script de reponse, pas celui de lecture', async () => {
    const replier = vi.fn(async (_script: string, _id: string, _corps: string) => 0)
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), replier })
    await passerelle.replyToItem('A'.repeat(32), 'Bonjour')
    expect(replier.mock.calls[0][0]).toMatch(/outlook-local-reply\.ps1$/)
  })

  it('efface le fichier de corps apres l envoi', async () => {
    let chemin = ''
    const replier = vi.fn(async (_s: string, _i: string, corpsPath: string) => {
      chemin = corpsPath
      return 0
    })
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), replier })
    await passerelle.replyToItem('A'.repeat(32), 'Bonjour')
    await expect(readFile(chemin, 'utf8')).rejects.toThrow()
  })
})

describe('marquage lu depuis l accueil', () => {
  it('passe les identifiants par un FICHIER, un par ligne', async () => {
    // Un fil peut compter des dizaines de messages, et un identifiant Outlook fait jusqu'a 512
    // caracteres : la ligne de commande a une longueur maximale, un fichier n'en a pas.
    let luDansLeFichier = ''
    const marqueur = vi.fn(async (_script: string, idsPath: string) => {
      luDansLeFichier = await readFile(idsPath, 'utf8')
      return 0
    })
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), marqueur })
    const resultat = await passerelle.markRead(['A'.repeat(32), 'B'.repeat(40)])
    expect(resultat.ok).toBe(true)
    expect(luDansLeFichier.split('\n')).toEqual(['A'.repeat(32), 'B'.repeat(40)])
  })

  it('vise le script de marquage, pas celui de lecture', async () => {
    const marqueur = vi.fn(async (_script: string, _idsPath: string) => 0)
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), marqueur })
    await passerelle.markRead(['A'.repeat(32)])
    expect(marqueur.mock.calls[0][0]).toMatch(/outlook-local-marquer-lu\.ps1$/)
  })

  it('ecarte les identifiants qui n ont pas la forme d un element Outlook', async () => {
    let lu = ''
    const marqueur = vi.fn(async (_script: string, idsPath: string) => {
      lu = await readFile(idsPath, 'utf8')
      return 0
    })
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), marqueur })
    await passerelle.markRead(['../../evil', 'A'.repeat(32)])
    expect(lu.split('\n')).toEqual(['A'.repeat(32)])
  })

  it('ne lance RIEN quand aucun identifiant n est utilisable', async () => {
    const marqueur = vi.fn(async () => 0)
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), marqueur })
    const resultat = await passerelle.markRead(['../../evil'])
    expect(resultat.ok).toBe(false)
    expect(marqueur).not.toHaveBeenCalled()
  })

  it('VIDE le cache apres un marquage : sinon la pastille reste une minute', async () => {
    // C'est le defaut releve par l'utilisateur le 2026-09-04 : « la notif reste meme apres avoir lu
    // le message ». Marquer lu dans Outlook sans oublier l'instantane deja lu ne changerait rien a
    // l'ecran pendant toute la duree de vie du cache.
    const runner = ecrivain(JSON.stringify({ ok: true, mails: [], evenements: [] }))
    const marqueur = vi.fn(async () => 0)
    const passerelle = new OutlookLocalGateway({
      appRoot: await racineFactice(),
      runner,
      marqueur,
      ttlMs: 600_000
    })
    await passerelle.snapshot()
    await passerelle.markRead(['A'.repeat(32)])
    await passerelle.snapshot()
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('ne vide PAS le cache quand le marquage a echoue', async () => {
    const runner = ecrivain(JSON.stringify({ ok: true, mails: [], evenements: [] }))
    const marqueur = vi.fn(async () => 1)
    const passerelle = new OutlookLocalGateway({
      appRoot: await racineFactice(),
      runner,
      marqueur,
      ttlMs: 600_000
    })
    await passerelle.snapshot()
    expect((await passerelle.markRead(['A'.repeat(32)])).ok).toBe(false)
    await passerelle.snapshot()
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('nomme la cause quand les elements ont disparu', async () => {
    const marqueur = vi.fn(async () => 3)
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), marqueur })
    const resultat = await passerelle.markRead(['A'.repeat(32)])
    expect(resultat.ok).toBe(false)
    expect(resultat.erreur).toMatch(/n.existe/i)
  })

  it('efface le fichier d identifiants apres le marquage', async () => {
    let chemin = ''
    const marqueur = vi.fn(async (_s: string, idsPath: string) => {
      chemin = idsPath
      return 0
    })
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), marqueur })
    await passerelle.markRead(['A'.repeat(32)])
    await expect(readFile(chemin, 'utf8')).rejects.toThrow()
  })
})
