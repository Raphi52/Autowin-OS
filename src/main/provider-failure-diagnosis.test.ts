import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  classifyProviderFailure,
  describeFanoutFailure,
  diagnoseProviderFailure,
  explainRoleFailure,
  repairHint
} from './provider-failure-diagnosis'

const ROLE_CONTEXT_MARKERS = [
  'sendWithRoleContext',
  'explainRoleFailure',
  'describeFanoutFailure',
  'cause: error instanceof'
] as const

function uncoveredSendSites(source: string, callMarker = 'registry.send('): number[] {
  const lines = source.split(/\r?\n/)
  const sites = lines
    .map((line, index) => (line.includes(callMarker) ? index : -1))
    .filter((index) => index >= 0)
  return sites
    .filter((index, rank) => {
      const from = Math.max(0, index - 14)
      const to = rank + 1 < sites.length ? sites[rank + 1] : lines.length
      const block = lines.slice(from, to).join(' ')
      return !ROLE_CONTEXT_MARKERS.some((marker) => block.includes(marker))
    })
    .map((index) => index + 1)
}

/**
 * DIRE POURQUOI un rôle a échoué.
 *
 * Constaté le 2026-07-29 sur un orchestrate réel : « Fan-out scout : aucun modèle n'a produit de sortie
 * (1 échec(s)) ». La cause — le rôle `scout` bindé sur codex, sans session OAuth — était DÉJÀ capturée
 * dans le journal de phase, puis jetée en remontant. Même patron que le coût jeté et la carte jetée :
 * l'information existait, elle n'arrivait pas à l'utilisateur.
 */
describe('classifyProviderFailure — sur les chaînes RÉELLEMENT jetées', () => {
  it('« codex non authentifié — lance npm run codex:login » → auth', () => {
    // Chaine exacte de codex.ts.
    expect(classifyProviderFailure('codex non authentifié — lance npm run codex:login')).toBe(
      'auth'
    )
  })

  it('« spawn claude ENOENT » → binaire introuvable', () => {
    expect(classifyProviderFailure('spawn claude ENOENT')).toBe('cli-missing')
  })

  it('« Codex CLI introuvable : … » → binaire introuvable', () => {
    expect(classifyProviderFailure('Codex CLI introuvable : ni sous le dossier npm…')).toBe(
      'cli-missing'
    )
  })

  it('un 401 ou un « not logged in » anglais comptent aussi comme auth', () => {
    expect(classifyProviderFailure('HTTP 401 Unauthorized')).toBe('auth')
    expect(classifyProviderFailure('Error: not logged in')).toBe('auth')
  })

  it('ce qu’on ne sait pas classer reste « other » — on n’invente pas de diagnostic', () => {
    expect(classifyProviderFailure('codex exec figé (aucune sortie) — tué par le watchdog')).toBe(
      'other'
    )
    expect(classifyProviderFailure('')).toBe('other')
  })

  it('une panne « other » ne propose AUCUN geste (mieux que conseiller au hasard)', () => {
    expect(
      diagnoseProviderFailure({ provider: 'claude', message: 'tué par le watchdog' }).hint
    ).toBeUndefined()
  })
})

describe('describeFanoutFailure — le message qui manquait', () => {
  it('LE CAS RÉEL : nomme le rôle, le provider, la cause ET le geste', () => {
    const message = describeFanoutFailure('scout', 'subagent', [
      {
        provider: 'codex',
        model: 'gpt-5.6-terra',
        message: 'codex non authentifié — lance npm run codex:login'
      }
    ])
    expect(message).toContain('scout')
    expect(message).toContain('codex')
    expect(message).toContain('gpt-5.6-terra')
    expect(message).toContain('non authentifié')
    expect(message).toContain('Se connecter')
  })

  it('des causes de types DIFFÉRENTS → aucun geste commun (il serait trompeur)', () => {
    const message = describeFanoutFailure('build', 'subagent', [
      { provider: 'codex', message: 'codex non authentifié' },
      { provider: 'claude', message: 'tué par le watchdog' }
    ])
    expect(message).toContain('codex')
    expect(message).toContain('claude')
    expect(message).not.toContain('→')
  })

  it('plusieurs membres avec la MÊME cause → le geste est donné une seule fois', () => {
    const message = describeFanoutFailure('scout', 'subagent', [
      { provider: 'codex', message: 'codex non authentifié' },
      { provider: 'codex', message: 'codex non authentifié' }
    ])
    expect(message.match(/→/g)).toHaveLength(1)
  })

  it('sans aucune cause collectée, on ne prétend rien (le décompte reste vrai)', () => {
    expect(describeFanoutFailure('scout', 'subagent', [])).toBe(
      "Fan-out scout : aucun modèle n'a produit de sortie"
    )
  })

  it('un échec sans message n’efface pas la ligne du provider', () => {
    const message = describeFanoutFailure('scout', 'subagent', [
      { provider: 'codex', message: 'échec sans message' }
    ])
    expect(message).toContain('codex')
  })
})

describe('explainRoleFailure — hors fan-out, le binding est nommé', () => {
  it('préfixe la cause par la phase, le rôle et son binding, sans écraser le message', () => {
    const message = explainRoleFailure('Phase build', 'subagent', {
      provider: 'codex',
      model: 'gpt-5.6-terra',
      message: 'codex non authentifié — lance npm run codex:login'
    })
    expect(message).toContain('Phase build')
    expect(message).toContain('rôle subagent')
    expect(message).toContain('codex (gpt-5.6-terra)')
    // Le message d'origine reste LISIBLE tel quel.
    expect(message).toContain('lance npm run codex:login')
    expect(message).toContain('Se connecter')
  })

  it('le libellé n’est PAS re-préfixé : « Phase sous-tâche X » se lisait mal', () => {
    const message = explainRoleFailure('sous-tâche scout', 'subagent', {
      provider: 'codex',
      message: 'spawn codex ENOENT'
    })
    expect(message.startsWith('sous-tâche scout — le rôle subagent')).toBe(true)
    expect(message).not.toContain('Phase sous-tâche')
  })

  it('cause non classable → pas de geste inventé, juste le contexte', () => {
    const message = explainRoleFailure('Phase clean', 'subagent', {
      provider: 'claude',
      message: 'tué par le watchdog'
    })
    expect(message).toContain('Phase clean')
    expect(message).not.toContain('→')
  })
})

/**
 * CÂBLAGE : le défaut n'était pas l'absence de diagnostic, c'était que l'orchestrateur JETAIT les
 * causes qu'il avait déjà. Ces tests échouent si elles redeviennent perdues.
 */
describe('câblage — l’orchestrateur remonte les causes au lieu de les jeter', () => {
  const source = readFileSync(join(__dirname, 'orchestrator.ts'), 'utf8')

  it('chaque membre en échec conserve sa cause', () => {
    expect(source).toContain('cause: error instanceof Error ? error.message : String(error)')
  })

  it('l’échec de fan-out est décrit, et c’est CE message qui est jeté', () => {
    expect(source).toContain('describeFanoutFailure(phase, ')
    expect(source).toContain('throw new Error(explained)')
    // L'ancien message opaque ne doit plus etre la seule information remontee.
    expect(source).not.toMatch(/throw new Error\(\s*`Fan-out \$\{phase\} : aucun modèle/)
  })

  it('le chemin mono-modèle nomme aussi le rôle et son binding', () => {
    // Ce test épinglait le littéral `'subagent'` — et VERROUILLAIT donc le défaut : sur une phase de
    // juge dédié, `roleDeLaPhase` vaut `'judge'`, si bien qu'un échec de juge s'affichait sous le
    // rôle subagent. Il vérifie désormais l'INTENTION (le rôle réel est nommé, son binding est
    // transmis) au lieu d'une forme d'écriture qui interdisait la correction.
    expect(source).toContain('explainRoleFailure(')
    expect(source).toContain('roleDeLaPhase,')
    expect(source).toMatch(/roles\.getBinding\(roleDeLaPhase\)\.provider/)
  })

  /**
   * GARDE STRUCTURELLE : le defaut n'etait pas un site oublie, c'etait qu'un site puisse laisser
   * passer une erreur NUE. Constate a l'ecran le 2026-07-29 : le site de sous-tache greedy n'avait
   * aucun `catch`, et l'utilisateur voyait `spawn … ENOENT` sans savoir quel role pointait ou. Ce test
   * echoue si un NOUVEL appel de provider est ajoute sans contexte de role.
   */
  it('CHAQUE appel de provider porte un contexte de rôle', () => {
    const uncovered = uncoveredSendSites(source)
    expect(uncovered, `sites sans contexte de rôle (lignes) : ${uncovered.join(', ')}`).toEqual([])
  })

  it('la garde SAIT échouer — sinon elle ne prouve rien', () => {
    // Source synthetique : un appel sans aucune gestion d'erreur autour.
    const fautif = ['const a = 1', 'await registry.send(provider, msgs, opts)', 'return a'].join(
      String.fromCharCode(10)
    )
    expect(uncoveredSendSites(fautif)).toEqual([2])
    // Et le meme appel, enveloppe : plus de signalement.
    const correct = [
      'try {',
      '  await registry.send(provider, msgs, opts)',
      '} catch (error) {',
      '  throw new Error(explainRoleFailure(phase, role, f))',
      '}'
    ].join(String.fromCharCode(10))
    expect(uncoveredSendSites(correct)).toEqual([])
  })

  it('il y a bien plusieurs appels de provider audités (le test ne passe pas à vide)', () => {
    const count = source.split(/\r?\n/).filter((l) => l.includes('registry.send(')).length
    expect(count).toBeGreaterThanOrEqual(6)
  })
})

describe('un repli ne doit pas se faire passer pour un réglage', () => {
  // Signalé par l'utilisateur : « Phase build — le rôle subagent est bindé sur codex (gpt-5.6-sol) »
  // alors qu'Agent Studio ne montrait codex NULLE PART. Vérifié : ses cinq sources de configuration
  // (deux `roles.json`, `agent-topology.json`, les défauts codés, `workflow-profiles.json`) étaient
  // intégralement claude. Le codex venait de `bindingDeRepliPourPhase`, qui lit un INSTANTANÉ de
  // rôles pris au démarrage du run. Le message affirmait donc un binding en lisant une panne, et
  // envoyait chercher un réglage inexistant.
  // La panne témoin est une VRAIE panne (`spawn … ENOENT`). Elle portait « codex exec annulé »
  // jusqu'au 2026-08-18 : or une annulation n'est pas une panne et a désormais son propre libellé —
  // la garder ici aurait fait tester la divergence de binding sur le seul message qui, par
  // construction, ne parle plus de binding.
  const panne = { provider: 'codex', model: 'gpt-5.6-sol', message: 'spawn codex ENOENT' }

  it('NOMME la divergence quand l’appel part ailleurs que le binding', () => {
    const texte = explainRoleFailure('Phase build', 'subagent', panne, 'claude')
    expect(texte).toContain('parti sur codex (gpt-5.6-sol)')
    expect(texte).toContain('bindé sur claude')
    // Ce qui aurait épargné la fausse piste : dire de ne PAS chercher codex dans la configuration.
    expect(texte).toMatch(/repli/i)
    expect(texte).not.toMatch(/le rôle subagent est bindé sur codex/)
  })

  it('reste inchangé quand le provider appelé EST celui du binding', () => {
    const texte = explainRoleFailure('Phase build', 'subagent', panne, 'codex')
    expect(texte).toContain('le rôle subagent est bindé sur codex (gpt-5.6-sol)')
    expect(texte).not.toMatch(/repli/i)
  })

  it('sans binding connu, le message d’origine est conservé', () => {
    const texte = explainRoleFailure('Phase build', 'subagent', panne)
    expect(texte).toContain('le rôle subagent est bindé sur codex (gpt-5.6-sol)')
  })

  it('le site de phase ne code plus le rôle EN DUR : un juge n’est plus dit « subagent »', () => {
    // `roleDeLaPhase` vaut `'judge'` sur une phase de juge dédié ; le site passait le littéral
    // `'subagent'`, donc un échec de juge s'affichait sous le mauvais rôle.
    const orchestrateur = readFileSync(join(__dirname, 'orchestrator.ts'), 'utf8')
    // ANCRE sur le marqueur du site de PHASE, pas sur le premier `explainRoleFailure` du fichier :
    // celui-là est le site des sous-tâches, et ma première version l'attrapait — un test qui vise à
    // côté échoue pour la mauvaise raison, ou passe pour la mauvaise raison.
    const debut = orchestrateur.indexOf('`Phase ${phase}`')
    expect(debut, 'le site de phase doit être trouvé, sinon ce test ment').toBeGreaterThan(-1)
    const appel = orchestrateur.slice(debut - 200, debut + 400)
    expect(appel).toContain('roleDeLaPhase')
    expect(appel).toMatch(/roles\.getBinding\(roleDeLaPhase\)\.provider/)
    expect(appel).not.toMatch(/explainRoleFailure\(\s*`Phase \$\{phase\}`,\s*'subagent'/)
  })
})

describe('une annulation ne doit pas se faire passer pour une panne du provider', () => {
  /**
   * Signalé par l'utilisateur le 2026-08-18 : « Échec du workflow : Phase frame — le rôle subagent
   * est bindé sur codex (gpt-5.6-sol) : codex exec annulé ». Vérifié dans le store live
   * (`.autowin-data/autowin-os/roles.json`) : le binding codex était bien le réglage réel, et
   * `codex exec annulé` n'est jeté qu'à UN endroit — `codex.ts:462`, sur le listener `abort` du
   * signal. Rien n'avait donc échoué : l'appel avait été COUPÉ. Le message nommait pourtant le
   * provider et le binding, ce qui a envoyé chercher un défaut de codex qui n'existait pas.
   */
  const messagesDAnnulation = [
    // Libelles ACTUELS (`providers/abort-diagnostic.ts`), avec la raison enfin portee ET le marqueur
    // `[abort]` de son emetteur. Le marqueur a ete ajoute le 2026-08-18 apres qu'un juge externe a
    // montre que reconnaitre le mot « interrompu » seul capturait `claude.ts:990` — une panne
    // TERMINALE du CLI — et la faisait annoncer « rien a reparer cote provider ». Ces fixtures
    // portent donc desormais ce que l'emetteur emet reellement.
    "[abort] codex exec interrompu : raison non rapportee par l'appelant",
    '[abort] claude CLI interrompu : conversation-deleted',
    '[abort] Kimi Code interrompu : run remplace',
    '[abort] Envoi Gemini interrompu : arret demande',
    // Libelles HISTORIQUES : ils vivent dans les traces et les runs persistes d'avant le 18/08.
    'codex exec annulé',
    'claude CLI annulé',
    'This operation was aborted'
  ]

  it.each(messagesDAnnulation)('« %s » est classé cancelled, pas other', (message) => {
    expect(classifyProviderFailure(message)).toBe('cancelled')
  })

  it("n'accuse NI le provider NI le binding du rôle", () => {
    const texte = explainRoleFailure(
      'Phase frame',
      'subagent',
      { provider: 'codex', model: 'gpt-5.6-sol', message: 'codex exec annulé' },
      'codex'
    )
    // Le libellé exact qui a induit en erreur ne doit plus pouvoir être produit.
    expect(texte).not.toContain('le rôle subagent est bindé sur codex')
    expect(texte).toContain('INTERROMPU')
    expect(texte).toMatch(/n'est pas une panne/)
    // Le message brut reste lisible : on requalifie, on n'efface pas.
    expect(texte).toContain('codex exec annulé')
  })

  /**
   * LE CAS QUI A COUTE TROIS TOURS a l'utilisateur le 2026-08-18. La raison etant desormais portee,
   * un arret impose par le devis se classe `budget` : il cesse d'etre une « annulation » indistincte,
   * et le geste propose devient le bon (relever le devis, pas relancer betement).
   */
  it('un abort dont la RAISON est un budget se classe budget, pas cancelled', () => {
    expect(
      classifyProviderFailure('codex exec interrompu : budget duree depasse (600000 ms)')
    ).toBe('budget')
    expect(classifyProviderFailure('codex exec interrompu : Budget USD depasse (12/10)')).toBe(
      'budget'
    )
  })

  it('le diagnostic du provider joint a l abort atteint l ECRAN', () => {
    // Le tampon de codex portait « usage limit » : c'est precisement ce que l'agent n'a pas eu, et
    // ce qui l'a pousse a l'inventer depuis les traces d'autres appels.
    const message = [
      "codex exec interrompu : raison non rapportee par l'appelant",
      'last-event={"type":"error","message":"You have hit your usage limit."}',
      'stderr=none'
    ].join(String.fromCharCode(10))
    const texte = explainRoleFailure(
      'Phase frame',
      'subagent',
      { provider: 'codex', model: 'gpt-5.6-sol', message },
      'codex'
    )
    expect(texte).toContain('usage limit')
  })

  it('propose un geste au lieu de laisser sans suite (le défaut de `other`)', () => {
    expect(repairHint('codex', 'cancelled')).toMatch(/coup[ée]/i)
    expect(
      diagnoseProviderFailure({ provider: 'codex', message: 'codex exec annulé' }).hint
    ).toBeDefined()
  })

  it('une VRAIE panne garde son libellé de binding — la requalification ne déborde pas', () => {
    const texte = explainRoleFailure(
      'Phase frame',
      'subagent',
      { provider: 'codex', model: 'gpt-5.6-sol', message: 'spawn codex ENOENT' },
      'codex'
    )
    expect(texte).toContain('le rôle subagent est bindé sur codex (gpt-5.6-sol)')
    expect(texte).not.toContain('INTERROMPU')
  })
})

describe('une panne TERMINALE ne doit pas être requalifiée en annulation', () => {
  /**
   * Défaut trouvé par un juge externe le 2026-08-18, sur du code déjà poussé.
   *
   * La règle de classification acceptait le mot « interrompu » seul. Or `claude.ts:990` lève
   * `new ProviderCallError("Claude a interrompu l'appel : " + detail, { retryable: false })` quand le
   * CLI Claude rend un event `result` avec `is_error === true` — un échec TERMINAL, sans aucun rapport
   * avec un signal d'abort. Conséquence : cette panne était classée `cancelled` et l'utilisateur
   * lisait « Rien à réparer côté provider : l'appel a été coupé. Relance la phase », c'est-à-dire un
   * message rassurant collé sur un vrai défaut. Le correctif visait à cesser de mentir sur les
   * causes ; sur ce chemin il en fabriquait un nouveau.
   *
   * Le dépôt avait DÉJÀ tiré cette leçon ailleurs (`auto-kaizen-supervisor.ts` : « le mot "aborted"
   * seul n'est PAS retenu, une transaction annulée par une base de données étant un vrai échec »).
   *
   * D'où le marqueur `[abort]`, posé par `abortFailure` et par lui seul : on ne devine plus une
   * annulation à partir d'un mot de la langue courante, on exige la signature de l'émetteur.
   */
  it('« Claude a interrompu l’appel : … » reste une panne, PAS une annulation', () => {
    const reel = "Claude a interrompu l'appel : error_max_turns · 0.1234 USD"
    expect(classifyProviderFailure(reel)).not.toBe('cancelled')
    const texte = explainRoleFailure(
      'Phase build',
      'subagent',
      { provider: 'claude', model: 'claude-opus-5', message: reel },
      'claude'
    )
    // Le message rassurant ne doit PAS apparaître : il enverrait relancer au lieu d'investiguer.
    expect(texte).not.toMatch(/Rien à réparer côté provider/)
    expect(texte).not.toContain('INTERROMPU avant sa fin')
  })

  it('une VRAIE annulation, elle, porte le marqueur de son émetteur et reste reconnue', () => {
    expect(classifyProviderFailure('[abort] codex exec interrompu : arret utilisateur')).toBe(
      'cancelled'
    )
    expect(classifyProviderFailure('[abort] claude CLI interrompu : arret utilisateur')).toBe(
      'cancelled'
    )
  })

  it('les libellés HISTORIQUES restent reconnus : ils vivent dans les runs déjà persistés', () => {
    expect(classifyProviderFailure('codex exec annulé')).toBe('cancelled')
    expect(classifyProviderFailure('claude CLI annulé')).toBe('cancelled')
    expect(classifyProviderFailure('This operation was aborted')).toBe('cancelled')
  })

  it('un abort imposé par le DEVIS reste classé budget — la cause prime sur le moyen', () => {
    expect(
      classifyProviderFailure('[abort] codex exec interrompu : Budget USD depasse (12.00)')
    ).toBe('budget')
  })
})
