// fix-ok: fichier NOUVEAU écrit en plusieurs pas ; seule correction mesurée : la donnée « Fait : rien » déclenchait l'arrêt « plus rien à faire » déjà existant, au lieu du garde-fou testé (rouge expliqué puis donnée corrigée, 17/17).
import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import type { ModelQuotaSnapshot } from '../../../shared/model-quotas'
import {
  PROMPT_NOUVELLE_CIBLE,
  SEUILS_CHAINE_DEFAUT,
  ancrerSurLaDemande,
  arretChaineAuto,
  deciderRelanceAuto,
  lireSeuilsChaine,
  quotaHebdoClaude,
  toursAutoDAffilee
} from './chat-auto-mode'

/*
 * GARDE-FOU DE LA CHAINE ∞ (demande du 2026-10-02, conv-38) : conv-44 a consomme 226 M tokens
 * d'entree en tours enchaines juste avant le plafond hebdomadaire de Claude du 30/09. La chaine
 * s'arrete quand le quota hebdomadaire Claude atteint 80 %, OU apres 6 tours automatiques
 * d'affilee sans message de l'utilisateur. Seuils reglables, arret DIT dans le fil.
 */
const agent = (t: string): Msg =>
  ({ role: 'assistant', content: t, parts: [{ kind: 'text', text: t }] }) as unknown as Msg
const humain = (t: string): Msg => ({ role: 'user', content: t }) as Msg
const base = {
  actif: true,
  occupe: false,
  dernierTourTraite: null,
  dernierPromptEnvoye: null,
  brouillonPresent: false
}
const REPONSE = '✅ Fait : étape faite.\n\n👉 Recommandé — Lance le test suivant sur src/main'
const DEMANDE = 'Répare le module de paiement'
const auto = (t: string): Msg => humain(ancrerSurLaDemande(t, DEMANDE))

/** Un fil : la demande humaine, puis `n` tours automatiques, chacun suivi de sa réponse. */
function filAvecToursAuto(n: number): Msg[] {
  const fil: Msg[] = [humain(DEMANDE), agent(REPONSE)]
  for (let i = 0; i < n; i++) fil.push(auto(`Étape ${i + 1}`), agent(`${REPONSE} ${i}`))
  return fil
}

const snapshot = (claude7j: number | null, codex7j = 99): ModelQuotaSnapshot => ({
  observedAt: '2026-10-02T08:00:00.000Z',
  summary: { status: 'healthy' },
  models: [
    {
      modelId: 'claude-opus',
      model: 'claude-opus',
      label: 'Claude',
      provider: 'claude',
      shared: false,
      status: 'available',
      source: 'en-têtes',
      windows: [
        { id: 'five-hour', label: '5 h', usedPercent: 99, remainingPercent: 1 },
        ...(claude7j === null
          ? []
          : [
              {
                id: 'seven-day',
                label: '7 j',
                usedPercent: claude7j,
                remainingPercent: 100 - claude7j
              }
            ])
      ]
    },
    {
      modelId: 'gpt',
      model: 'gpt',
      label: 'Codex',
      provider: 'codex',
      shared: false,
      status: 'available',
      source: 'journal',
      windows: [
        { id: 'seven-day', label: '7 j', usedPercent: codex7j, remainingPercent: 100 - codex7j }
      ]
    }
  ]
})

describe('compte des tours automatiques d’affilée', () => {
  it('compte les envois du mode auto depuis le dernier message de l’utilisateur', () => {
    expect(toursAutoDAffilee(filAvecToursAuto(0))).toBe(0)
    expect(toursAutoDAffilee(filAvecToursAuto(4))).toBe(4)
  })
  it('un message de l’utilisateur remet le compte à zéro', () => {
    const fil = [...filAvecToursAuto(5), humain('Continue mais sur le module B'), agent(REPONSE)]
    expect(toursAutoDAffilee(fil)).toBe(0)
  })
  it('la relève « nouvelle cible » compte aussi comme un tour automatique', () => {
    const fil = [...filAvecToursAuto(2), humain(PROMPT_NOUVELLE_CIBLE), agent(REPONSE)]
    expect(toursAutoDAffilee(fil)).toBe(3)
  })
  it('une orientation tapée pendant un tour n’interrompt pas la série', () => {
    const fil = [
      ...filAvecToursAuto(2),
      { role: 'user', content: 'plus vite', orientation: true } as Msg
    ]
    expect(toursAutoDAffilee(fil)).toBe(2)
  })
})

describe('quota hebdomadaire Claude', () => {
  it('lit la fenêtre 7 j de Claude, jamais celle de Codex ni la 5 h', () => {
    expect(quotaHebdoClaude(snapshot(42))).toBe(42)
    expect(quotaHebdoClaude(snapshot(null))).toBeNull()
    expect(quotaHebdoClaude(null)).toBeNull()
  })
  it('ignore une fenêtre sans plafond connu', () => {
    const s = snapshot(90)
    s.models[0].windows[1].limitKnown = false
    expect(quotaHebdoClaude(s)).toBeNull()
  })
})

describe('arrêt de la chaîne ∞', () => {
  it('seuils par défaut : 80 % et 6 tours', () => {
    expect(SEUILS_CHAINE_DEFAUT).toEqual({ quotaHebdoPct: 80, toursAutoMax: 6 })
  })
  it('quota à 80 % : la suite ne part pas, l’arrêt est dit avec le chiffre', () => {
    const d = deciderRelanceAuto({ ...base, fil: filAvecToursAuto(1), quotaHebdoPct: 80 })
    expect(d.action).toBe('arreter')
    if (d.action !== 'arreter') return
    expect(d.raison).toBe('quota-hebdo')
    expect(d.message).toContain('80 %')
  })
  it('quota à 79 % : la suite part', () => {
    expect(
      deciderRelanceAuto({ ...base, fil: filAvecToursAuto(1), quotaHebdoPct: 79 }).action
    ).toBe('envoyer')
  })
  it('6 tours automatiques d’affilée : le 7e ne part pas', () => {
    const d = deciderRelanceAuto({ ...base, fil: filAvecToursAuto(6), quotaHebdoPct: 10 })
    expect(d.action).toBe('arreter')
    if (d.action !== 'arreter') return
    expect(d.raison).toBe('tours-auto-max')
    expect(d.message).toContain('6')
  })
  it('5 tours automatiques : le 6e part', () => {
    expect(deciderRelanceAuto({ ...base, fil: filAvecToursAuto(5) }).action).toBe('envoyer')
  })
  it('le compteur en mémoire compte même si le fil chargé ne montre pas les ancres', () => {
    const d = deciderRelanceAuto({ ...base, fil: filAvecToursAuto(0), toursAutoDAffilee: 6 })
    expect(d.action).toBe('arreter')
  })
  it('seuils réglables : 3 tours / 50 %', () => {
    const seuils = { quotaHebdoPct: 50, toursAutoMax: 3 }
    expect(
      deciderRelanceAuto({ ...base, fil: filAvecToursAuto(3), seuilsChaine: seuils }).action
    ).toBe('arreter')
    expect(
      deciderRelanceAuto({
        ...base,
        fil: filAvecToursAuto(1),
        quotaHebdoPct: 55,
        seuilsChaine: seuils
      }).action
    ).toBe('arreter')
  })
  it('quota inconnu : seul le compte de tours peut arrêter', () => {
    expect(arretChaineAuto({ quotaHebdoPct: null, toursAutoDAffilee: 0 })).toBeNull()
  })
  it('une suite programmée (différée) est arrêtée de la même façon', () => {
    const fil = [
      humain(DEMANDE),
      agent('✅ Fait : statut relu.\n\n👉 Recommandé — Relance le tournoi à 01:05')
    ]
    expect(deciderRelanceAuto({ ...base, fil, maintenant: 0 }).action).toBe('programmer')
    expect(deciderRelanceAuto({ ...base, fil, maintenant: 0, quotaHebdoPct: 95 }).action).toBe(
      'arreter'
    )
  })
})

describe('le message d’arrêt ne promet que ce que le code permet', () => {
  // Objection du juge : ∞ est éteint à l'arrêt ; un message de l'utilisateur remet le compte à
  // zéro (ChatView envoyer()) mais ne réarme PAS ∞ → « écris un message pour relancer » était faux.
  it('arrêt « tours » : dit que ∞ est éteint et qu’il faut le rallumer après ton message', () => {
    const arret = arretChaineAuto({ quotaHebdoPct: 10, toursAutoDAffilee: 6 })
    expect(arret?.message).not.toMatch(/pour relancer la chaîne/i)
    expect(arret?.message).toMatch(/∞ est éteint sur ce fil/)
    expect(arret?.message).toMatch(/écris un message[^.]*puis rallume ∞/)
  })
  // Objection du juge (2026-10-02) : « rallume ∞ pour continuer » était faux — rallumer ne remet
  // pas le compte à zéro (fil + poste) et aucun moyen ne passe outre le quota.
  it('arrêt « tours » : écrire un message relance vraiment, relever le seuil aussi', () => {
    const arret = arretChaineAuto({ quotaHebdoPct: 10, toursAutoDAffilee: 6 })
    expect(arret?.message).not.toMatch(/rallume ∞ pour continuer/i)
    expect(arret?.message).toContain('écris un message')
    expect(arret?.message).toContain('Settings › Budget')
    const filApres = [...filAvecToursAuto(6), humain('continue sur le point 2')]
    expect(toursAutoDAffilee(filApres)).toBe(0)
    expect(
      arretChaineAuto({
        quotaHebdoPct: 10,
        toursAutoDAffilee: 6,
        seuils: { quotaHebdoPct: 80, toursAutoMax: 7 }
      })
    ).toBeNull()
  })
  it('arrêt « quota » : ne promet pas de passer outre, renvoie au seuil réglable', () => {
    const arret = arretChaineAuto({ quotaHebdoPct: 85, toursAutoDAffilee: 0 })
    expect(arret?.message).not.toMatch(/quand même/i)
    // Objection du juge : ∞ est éteint à l'arrêt et rien ne le rallume seul → pas de reprise automatique promise.
    expect(arret?.message).not.toMatch(/reprendra/i)
    expect(arret?.message).toMatch(/rallume ∞ quand le quota/i)
    expect(arret?.message).not.toMatch(/rallume ∞ pour continuer/i)
    expect(arret?.message).toContain('Settings › Budget')
    expect(
      arretChaineAuto({
        quotaHebdoPct: 85,
        toursAutoDAffilee: 0,
        seuils: { quotaHebdoPct: 90, toursAutoMax: 6 }
      })
    ).toBeNull()
  })
})

describe('lecture des seuils réglés', () => {
  it('reprend les défauts quand rien n’est réglé ou que la valeur est illisible', () => {
    expect(lireSeuilsChaine(null)).toEqual(SEUILS_CHAINE_DEFAUT)
    expect(lireSeuilsChaine('pas du json')).toEqual(SEUILS_CHAINE_DEFAUT)
  })
  it('garde un réglage valide et borne les valeurs absurdes', () => {
    expect(lireSeuilsChaine('{"quotaHebdoPct":90,"toursAutoMax":10}')).toEqual({
      quotaHebdoPct: 90,
      toursAutoMax: 10
    })
    expect(lireSeuilsChaine('{"quotaHebdoPct":500,"toursAutoMax":0}')).toEqual({
      quotaHebdoPct: 100,
      toursAutoMax: 1
    })
  })
})
