#!/usr/bin/env bash
# mkcopy.sh [--force] <nom> [commit]
#
# Cree une copie ISOLEE et PROPRE du depot dans bench/runs/<nom>/, prete a recevoir un bras
# du banc. Idempotent : relance sur un nom deja cree = ne casse rien, ne recree rien.
#
# Pourquoi une copie git (worktree) plutot qu'un cp -r : un cp -r embarque .git, les 8 copies
# deja presentes et node_modules — des giga-octets, et un depot imbrique que git ne sait pas lire.
# La copie git part du commit demande, sans aucune modification locale : c'est la meme ligne de
# depart pour tous les bras, ce qui est la condition pour que le banc mesure le WORKFLOW.
#
# node_modules n'est PAS copie : c'est un lien vers celui du depot principal. Sans lui, aucun
# critere ne tourne dans la copie (constate : une copie nue n'a pas de dependances).
#
# Exit 0 = copie prete et verifiee · 1 = argument absent · 2 = copie non utilisable.
set -u

usage() { echo "usage: bench/mkcopy.sh [--force] <nom> [commit]" >&2; exit 1; }

FORCE=0
if [ "${1:-}" = "--force" ]; then FORCE=1; shift; fi
NOM="${1:-}"
[ -n "$NOM" ] || usage
case "$NOM" in
  */*|.|..|*\*) echo "nom invalide (pas de separateur de chemin) : $NOM" >&2; exit 1 ;;
esac

BENCH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$BENCH/.." && pwd)"
COMMIT="${2:-$(git -C "$SRC" rev-parse HEAD)}"
CIBLE="$BENCH/runs/$NOM"

# Le depot principal (celui qui porte node_modules), meme si on tourne depuis une copie.
COMMON="$(git -C "$SRC" rev-parse --path-format=absolute --git-common-dir)"
PRINCIPAL="$(dirname "$COMMON")"

mkdir -p "$BENCH/runs"

# --- Idempotence : une copie deja saine au bon commit est REUTILISEE telle quelle.
# Mais SEULEMENT si elle est propre. Une copie ou un bras a deja travaille n'est PAS une ligne
# de depart : la reutiliser ferait demarrer le bras suivant sur les modifications du precedent.
# On refuse alors, plutot que de detruire son travail en silence — `--force` pour repartir a neuf.
if [ -e "$CIBLE/.git" ]; then
  ACTUEL="$(git -C "$CIBLE" rev-parse HEAD 2>/dev/null || echo '?')"
  SALE="$(git -C "$CIBLE" status --porcelain 2>/dev/null)"
  if [ "$ACTUEL" = "$COMMIT" ] && [ -z "$SALE" ]; then
    if [ ! -e "$CIBLE/node_modules" ]; then
      ln -s "$PRINCIPAL/node_modules" "$CIBLE/node_modules" 2>/dev/null \
        || cmd //c mklink //J "$(cygpath -w "$CIBLE/node_modules")" "$(cygpath -w "$PRINCIPAL/node_modules")" >/dev/null 2>&1
    fi
    echo "DEJA-PRETE $NOM -> $CIBLE (commit $ACTUEL, propre)"
    exit 0
  fi
  if [ -n "$SALE" ] && [ "$FORCE" != "1" ]; then
    echo "REFUS: la copie $NOM contient du travail non enregistre :" >&2
    echo "$SALE" >&2
    echo "Relance avec --force pour la remplacer par une copie neuve (ce travail sera perdu)." >&2
    exit 2
  fi
  echo "copie $NOM remplacee (commit $ACTUEL, attendu $COMMIT)" >&2
  git -C "$SRC" worktree remove --force "$CIBLE" >/dev/null 2>&1 || rm -rf "$CIBLE"
fi

# Restes d'une copie a moitie creee : on nettoie AVANT, sinon git refuse le dossier non vide.
[ -d "$CIBLE" ] && rm -rf "$CIBLE"
git -C "$SRC" worktree prune >/dev/null 2>&1

if ! git -C "$SRC" worktree add --detach "$CIBLE" "$COMMIT" >/dev/null 2>&1; then
  echo "ECHEC: git worktree add a refuse $CIBLE sur $COMMIT" >&2
  git -C "$SRC" worktree add --detach "$CIBLE" "$COMMIT" >&2
  exit 2
fi

# --- Dependances : lien, jamais copie.
if [ ! -e "$CIBLE/node_modules" ]; then
  ln -s "$PRINCIPAL/node_modules" "$CIBLE/node_modules" 2>/dev/null \
    || cmd //c mklink //J "$(cygpath -w "$CIBLE/node_modules")" "$(cygpath -w "$PRINCIPAL/node_modules")" >/dev/null 2>&1
fi

# --- Verification HORS-MODELE : la copie n'est declaree prete que si elle passe ces 3 sondes.
ETAT="$(git -C "$CIBLE" status --porcelain 2>&1)"
if [ -n "$ETAT" ]; then
  echo "ECHEC: la copie $NOM n'est pas propre :" >&2; echo "$ETAT" >&2; exit 2
fi
if [ ! -d "$CIBLE/node_modules" ]; then
  echo "ECHEC: $CIBLE/node_modules absent — aucun critere ne tournera dans cette copie" >&2; exit 2
fi
if [ ! -e "$CIBLE/package.json" ]; then
  echo "ECHEC: $CIBLE/package.json absent — la copie n'est pas le depot" >&2; exit 2
fi

echo "PRETE $NOM -> $CIBLE"
echo "  commit     : $(git -C "$CIBLE" rev-parse HEAD)"
echo "  propre     : oui (git status --porcelain vide)"
echo "  node_modules: lie vers $PRINCIPAL/node_modules"
