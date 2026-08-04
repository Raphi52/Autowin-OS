import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ClaudeCliAdapter } from './providers/claude'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import type { Message, SendResult, Usage } from './providers/types'

/**
 * MESURE A/B : consomme-t-on VRAIMENT moins en passant par Autowin qu'avec un CLI où l'on injecte
 * tout le kit Claude ?
 *
 * Le transport est IDENTIQUE dans les deux bras (même `ClaudeCliAdapter`, même modèle) : la seule
 * variable est la STRATÉGIE D'ASSEMBLAGE du prompt. C'est ce qu'il faut isoler — comparer deux
 * transports différents ne dirait rien de la façon dont Autowin compose ses tours.
 *
 *   Bras AUTOWIN  : prompt de pilotage seul (préfixe STABLE, donc cachable) + reprise de session,
 *                   donc les tours 2..n n'expédient QUE le nouveau message.
 *   Bras CLI-TOUT : prompt de pilotage + le kit Claude ENTIER (CLAUDE.md + tous les SKILL.md), et
 *                   l'historique COMPLET réinjecté à chaque tour, sans reprise.
 *
 * Les chiffres viennent du provider (`usage`), jamais d'une estimation maison.
 *
 * Lancer :  npx vitest run --config vitest.live.config.ts
 */

/** Le kit Claude entier — ce qu'un CLI « on injecte tout » embarque à chaque appel. */
function toutLeKitClaude(): string {
  const racine = join(homedir(), '.claude')
  const morceaux: string[] = []
  const constitution = join(racine, 'CLAUDE.md')
  if (existsSync(constitution)) morceaux.push(readFileSync(constitution, 'utf8'))
  const skills = join(racine, 'skills')
  if (existsSync(skills)) {
    for (const dossier of readdirSync(skills)) {
      const corps = join(skills, dossier, 'SKILL.md')
      if (existsSync(corps))
        morceaux.push(`=== SKILL ${dossier.toUpperCase()} ===\n${readFileSync(corps, 'utf8')}`)
    }
  }
  return morceaux.join('\n\n')
}

/**
 * Cinq tours, pas trois : un ratio global ne dit pas si l'écart CROÎT. C'est la PENTE — le coût
 * marginal d'un tour de plus dans chaque bras — qui prouve le mécanisme, un ratio isolé pouvant venir
 * d'un simple surcoût fixe au premier tour.
 */
const TOURS = [
  'En une phrase : à quoi sert un préfixe système stable pour un modèle ?',
  'Et en une phrase, quel est le risque si ce préfixe change à chaque tour ?',
  "En une phrase : pourquoi une reprise de session coûte moins qu'un historique réexpédié ?",
  "En une phrase : qu'est-ce qu'une lecture de cache, côté facturation ?",
  'Résume nos échanges en une seule phrase.'
]

type Total = { input: number; output: number; cacheRead: number; cout: number; tours: number }

const vide = (): Total => ({ input: 0, output: 0, cacheRead: 0, cout: 0, tours: 0 })

function cumule(total: Total, usage: Usage | undefined): Total {
  if (!usage) return total
  return {
    input: total.input + (usage.inputTokens ?? 0),
    output: total.output + (usage.outputTokens ?? 0),
    cacheRead: total.cacheRead + (usage.cacheReadTokens ?? 0),
    cout: total.cout + (usage.costUsd ?? 0),
    tours: total.tours + 1
  }
}

async function envoyer(
  adapter: ClaudeCliAdapter,
  messages: Message[],
  opts: { system: string; model: string; resumeSessionId?: string }
): Promise<SendResult> {
  const generator = adapter.send(messages, opts)
  let step = await generator.next()
  while (!step.done) step = await generator.next()
  return step.value as SendResult
}

describe('consommation : Autowin contre un CLI où tout est injecté (appels modèle RÉELS)', () => {
  it('Autowin consomme moins de tokens envoyés pour la même conversation', async () => {
    const adapter = new ClaudeCliAdapter()
    const model = 'sonnet'
    const pilotage = buildChatPilotagePrompt([])
    const kit = toutLeKitClaude()
    expect(kit.length).toBeGreaterThan(50_000) // sinon la comparaison n'a aucun sens

    /** Volume facturé PAR TOUR, pour lire la pente et non un simple total. */
    const parTour: { tour: number; autowin: number; cli: number; coutA: number; coutC: number }[] =
      []
    const volume = (u: Usage | undefined) => (u?.inputTokens ?? 0) + (u?.cacheReadTokens ?? 0)

    // ---- Bras AUTOWIN : préfixe stable + reprise de session ----
    let autowin = vide()
    let sessionId: string | undefined
    const volumesAutowin: number[] = []
    const coutsAutowin: number[] = []
    for (const tour of TOURS) {
      const res = await envoyer(adapter, [{ role: 'user', content: tour }], {
        system: pilotage,
        model,
        ...(sessionId ? { resumeSessionId: sessionId } : {})
      })
      autowin = cumule(autowin, res.usage)
      volumesAutowin.push(volume(res.usage))
      coutsAutowin.push(res.usage?.costUsd ?? 0)
      sessionId = res.sessionId ?? sessionId
    }

    // ---- Bras CLI-TOUT : kit entier + historique complet, aucune reprise ----
    let cli = vide()
    const historique: string[] = []
    const volumesCli: number[] = []
    const coutsCli: number[] = []
    for (const tour of TOURS) {
      historique.push(`UTILISATEUR: ${tour}`)
      const res = await envoyer(adapter, [{ role: 'user', content: historique.join('\n\n') }], {
        system: `${pilotage}\n\n${kit}`,
        model
      })
      cli = cumule(cli, res.usage)
      volumesCli.push(volume(res.usage))
      coutsCli.push(res.usage?.costUsd ?? 0)
      historique.push(`AGENT: ${(res.text ?? '').slice(0, 400)}`)
    }

    console.log('\n=== VOLUME FACTURE PAR TOUR (input + lecture de cache) ===')
    console.log('tour |    AUTOWIN |   CLI-TOUT | facteur | cout AUTOWIN | cout CLI')
    for (let i = 0; i < TOURS.length; i++) {
      const a = volumesAutowin[i]
      const c = volumesCli[i]
      parTour.push({ tour: i + 1, autowin: a, cli: c, coutA: coutsAutowin[i], coutC: coutsCli[i] })
      console.log(
        `  ${i + 1}  | ${String(a).padStart(10)} | ${String(c).padStart(10)} |` +
          ` x${(c / Math.max(a, 1)).toFixed(1).padStart(6)} |` +
          ` $${coutsAutowin[i].toFixed(4)}      | $${coutsCli[i].toFixed(4)}`
      )
    }
    const penteA = (volumesAutowin.at(-1)! - volumesAutowin[0]) / (TOURS.length - 1)
    const penteC = (volumesCli.at(-1)! - volumesCli[0]) / (TOURS.length - 1)
    console.log(`\nPENTE (tokens factures par tour supplementaire) :`)
    console.log(`  AUTOWIN  : ${Math.round(penteA)} / tour`)
    console.log(`  CLI-TOUT : ${Math.round(penteC)} / tour`)
    console.log(
      `  la pente du CLI est ${(penteC / Math.max(penteA, 1)).toFixed(1)}x celle d'Autowin`
    )

    const ligne = (nom: string, t: Total) =>
      `${nom.padEnd(12)} input=${String(t.input).padStart(8)}  cacheRead=${String(t.cacheRead).padStart(8)}` +
      `  output=${String(t.output).padStart(6)}  cout=$${t.cout.toFixed(4)}  tours=${t.tours}`
    console.log('\n=== CONSOMMATION MESUREE (chiffres du provider) ===')
    console.log('kit Claude injecte par le bras CLI :', kit.length, 'chars')
    console.log(ligne('AUTOWIN', autowin))
    console.log(ligne('CLI-TOUT', cli))
    /**
     * Le volume FACTURÉ en entrée = input non caché + lecture de cache. Mesuré le 2026-08-04 :
     * `inputTokens` valait 6 dans LES DEUX bras — presque tout le prompt part en cache, donc ce
     * compteur seul ne voit RIEN et une comparaison bâtie sur lui conclurait « aucun gain ». Le
     * poste dominant est la relecture de cache, et c'est là que le kit entier se paie.
     */
    const volumeAutowin = autowin.input + autowin.cacheRead
    const volumeCli = cli.input + cli.cacheRead
    const facteur = volumeAutowin > 0 ? volumeCli / volumeAutowin : Infinity
    console.log(`\nvolume d entree facture : ${volumeAutowin} contre ${volumeCli}`)
    console.log(`facteur x${facteur.toFixed(2)} en faveur d'Autowin`)
    console.log(`economie : ${volumeCli - volumeAutowin} tokens sur ${TOURS.length} tours`)
    if (cli.cout > 0 && autowin.cout > 0) {
      console.log(
        `cout : $${autowin.cout.toFixed(4)} contre $${cli.cout.toFixed(4)}` +
          ` (x${(cli.cout / autowin.cout).toFixed(1)})`
      )
    }

    // Les deux bras ont bien répondu aux 3 tours — sinon on comparerait des travaux inégaux.
    expect(autowin.tours).toBe(TOURS.length)
    expect(cli.tours).toBe(TOURS.length)
    // L'affirmation testée : Autowin fait FACTURER strictement moins d'entrée. Falsifiable — si le
    // kit n'était pas le poste dominant, ou si la reprise de session ne servait à rien, ça casse.
    expect(volumeAutowin).toBeLessThan(volumeCli)
    // Et le gain n'est pas marginal : au moins un facteur 2 sur le volume comme sur le coût.
    expect(facteur).toBeGreaterThan(2)
    expect(autowin.cout).toBeLessThan(cli.cout / 2)
    /**
     * LA FORME DU GAIN, mesurée sur 5 tours le 2026-08-04 — et elle RÉFUTE l'hypothèse d'une pente
     * divergente qui figurait ici avant : le bras CLI est PLAT (~78,7k/tour, pente ≈ 0), parce que
     * son volume est dominé par le kit réinjecté, constant d'un tour à l'autre ; l'historique ajouté
     * est négligeable devant lui. C'est même Autowin qui monte un peu (+97/tour), sa session reprise
     * accumulant du contexte.
     *
     * Donc : le gain est un MULTIPLICATEUR CONSTANT par tour, pas un écart qui s'accélère. Ce qui
     * croît linéairement avec les tours, c'est l'économie ABSOLUE (~74k tokens par tour de plus).
     * On teste cette forme-là, la seule que les chiffres soutiennent.
     */
    for (const ligne of parTour) {
      expect(ligne.cli / ligne.autowin).toBeGreaterThan(3)
    }
    // Économie absolue proportionnelle au nombre de tours : au moins 30k par tour, en moyenne.
    expect((volumeCli - volumeAutowin) / TOURS.length).toBeGreaterThan(30_000)
    // Le bras CLI reste plat à l'échelle du kit : sa pente est petite devant son volume par tour.
    expect(Math.abs(penteC)).toBeLessThan(volumesCli[0] / 10)
  }, 600_000)
})
