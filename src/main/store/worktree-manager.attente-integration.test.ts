import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, manager, nettoyerRacines, tempRepo } from './worktree-manager.test-helpers'

afterEach(nettoyerRacines)
/*
 * Suites git REELLES : `vi.setConfig` comme les autres suites `worktree-manager.*` (convention
 * maison, cf. `worktree-manager.publication.test.ts:31`). Un depot temporaire, un worktree, un
 * merge : 15 a 30 s seuls, davantage quand quatre workers tournent en parallele. Le plafond global
 * de 20 s les faisait echouer en LOT alors qu'elles passent seules — un faux rouge de charge, qui
 * ferait douter de tests parfaitement valides.
 */
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })


/**
 * BARREAU 1 DE L'ECHELLE — un travail refuse en `base-dirty` est MIS EN ATTENTE D'INTEGRATION,
 * jamais rendu comme un echec sec.
 *
 * Vecu le 2026-08-27 (conv-1450, 1,32 $) : « ⛔ Travail NON integre — ton arbre principal a une base
 * sale », statut echoue, fin du tour. Le travail existait, n'etait pas perdu, et n'atterrissait pas.
 * Sur cet arbre partage par plusieurs sessions, la cause ne disparait pas d'elle-meme : le fichier en
 * cause etait `src/main/agent-pilot.ts`, qu'une autre session editait — le repechage a rejoue trois
 * fois la MEME publication, puis l'echec est devenu definitif.
 *
 * Ce que ce barreau fait, et ce qu'il ne fait pas : il pose une ADRESSE git durable sur le commit que
 * l'agent a DEJA produit, dans le depot de base, SANS toucher une seule ligne de l'arbre de travail.
 * Rien n'est fusionne, rien n'est ecrase, aucun fichier de l'utilisateur n'est committe.
 *
 * Il RENVERSE une regle ecrite (« la garde base-dirty n'ecrit AUCUN ref »,
 * `worktree-manager.publication-decouplee.test.ts`) et il faut le dire plutot que l'effacer : cette
 * regle protegeait les FICHIERS de l'utilisateur d'une publication par-dessus son travail. Une
 * adresse posee sur un commit d'agent ne touche ni ses fichiers, ni ses commits — et l'utilisateur a
 * explicitement autorise l'echelle ce jour-la. Ce que la regle interdisait reste interdit : le ref de
 * SAUVETAGE (`refs/autowin/rescue/*`), qui committe le travail en cours de la copie, n'est toujours
 * pas ecrit sur cette cause.
 */
describe('WorktreeManager — base-dirty met le travail EN ATTENTE, il ne le perd pas', () => {
  /** Empreinte de tout ce qui appartient a l'UTILISATEUR. Aucune de ces valeurs ne doit bouger. */
  const empreinteUtilisateur = (repo: string): Record<string, string> => ({
    status: git(repo, 'status', '--porcelain=v1', '--untracked-files=all'),
    head: git(repo, 'rev-parse', 'HEAD'),
    branche: git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'),
    stash: git(repo, 'stash', 'list'),
    contenu: readFileSync(join(repo, 'a.txt'), 'utf8')
  })

  const baseSaleEnCollision = (): { repo: string; wm: ReturnType<typeof manager> } => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    // Collision REELLE : l'utilisateur a une edition non committee sur le fichier meme que la copie
    // modifie. C'est l'unique entree qui produit `base-dirty` (intersection non vide).
    writeFileSync(join(repo, 'a.txt'), 'travail local non committe\n')
    writeFileSync(join(path, 'a.txt'), 'travail de la copie\n')
    return { repo, wm }
  }

  it('rend une adresse d attente qui pointe sur le commit de la copie', () => {
    const { repo, wm } = baseSaleEnCollision()

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-dirty' })
    const attente = (res as { stagedRef?: string }).stagedRef
    expect(attente).toBe('refs/autowin/integration/builder')
    // L'adresse doit etre RESOLVABLE et porter le travail : une promesse creuse serait pire que rien.
    const sha = git(repo, 'rev-parse', attente as string)
    expect(git(repo, 'show', `${sha}:a.txt`)).toContain('travail de la copie')
  })

  it('ne touche RIEN de ce qui appartient a l utilisateur', () => {
    const { repo, wm } = baseSaleEnCollision()
    const avant = empreinteUtilisateur(repo)

    wm.finalize('builder')

    const apres = empreinteUtilisateur(repo)
    expect(apres).toEqual(avant)
    // Explicite, parce que c'est LA garantie qui autorise ce barreau : son edition, octet pour octet.
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('travail local non committe\n')
    expect(apres.stash).toBe('')
    // Ce que l'ancienne regle interdisait reste interdit : pas de ref de SAUVETAGE sur cette cause.
    expect(() => git(repo, 'rev-parse', '--verify', 'refs/autowin/rescue/builder')).toThrow()
  })

  it('reste silencieuse quand la base est PROPRE : la fusion normale n est pas detournee', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'livrable.txt'), 'travail de l agent\n')

    const res = wm.finalize('builder')

    expect(res.outcome).toBe('merged')
    expect((res as { stagedRef?: string }).stagedRef).toBeUndefined()
    expect(() => git(repo, 'rev-parse', '--verify', 'refs/autowin/integration/builder')).toThrow()
  })
})
