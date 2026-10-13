#!/usr/bin/env python3
"""Analyze and maintain the literal visible Obsidian graph for the Brain."""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from urllib.parse import unquote

import brain_identite

ENTERPRISE_INDEX = Path("knowledge/_maps/vault-inventory.md")
WIKILINK_RE = re.compile(r"(?<!!)\[\[([^\[\]\n]+)\]\]")
MARKDOWN_LINK_RE = re.compile(r"(?<!!)\[[^\]\n]*\]\(([^)\n]+)\)")
FENCE_OPEN_RE = re.compile(r"^[ \t]{0,3}(`{3,}|~{3,})")
CONTROLLED_THEME_QUERIES = {
    "tag:#theme/architecture", "tag:#theme/donnees",
    "tag:#theme/integrations", "tag:#theme/operations", "tag:#theme/ia",
    "tag:#theme/gouvernance", "tag:#theme/autowin-os",
}


def _metier_source():
    """Documentation source du domaine metier (profil `metier`, conv-916) et son index genere :
    (dossier, index, metier) ou None. Sans domaine (version publique), tout le vault va dans
    l'inventaire de l'entreprise."""
    metier = brain_identite.metier()
    if not metier or not metier["documentation"]:
        return None
    return (
        Path("knowledge/domain") / metier["documentation"],
        Path(f"knowledge/_maps/{metier['cle']}-source-mirror.md"),
        metier,
    )


def controlled_theme_queries() -> set:
    metier = brain_identite.metier()
    return CONTROLLED_THEME_QUERIES | ({f"tag:#theme/{metier['cle']}"} if metier else set())


@dataclass(frozen=True)
class GraphReport:
    nodes: frozenset[str]
    edges: frozenset[tuple[str, str]]
    isolates: tuple[str, ...]
    components: tuple[tuple[str, ...], ...]
    unresolved: tuple[str, ...]
    # Liens ORIENTES (source -> cible) : `edges` est trie donc perd le sens, or « qui depend de X »
    # a besoin du sens. Meme analyseur, aucune seconde lecture des notes (cf. brain_graph.py).
    links: frozenset[tuple[str, str]] = frozenset()

    def as_dict(self) -> dict[str, object]:
        return {
            "visible_markdown_nodes": len(self.nodes),
            "resolved_edges": len(self.edges),
            "degree_zero_nodes": len(self.isolates),
            "connected_components": len(self.components),
            "largest_component": len(self.components[0]) if self.components else 0,
            "unresolved_targets": len(self.unresolved),
            "isolates": list(self.isolates),
            "unresolved": list(self.unresolved),
        }


def _visible_markdown(root: Path) -> dict[str, Path]:
    files: dict[str, Path] = {}
    for path in root.rglob("*.md"):
        relative = path.relative_to(root)
        if any(part.startswith(".") for part in relative.parts):
            continue
        if relative.parts and relative.parts[0].startswith("publish-backup-"):
            continue
        files[relative.as_posix()] = path
    return files


def _strip_fenced_blocks(text: str) -> str:
    visible: list[str] = []
    fence_char = ""
    fence_length = 0
    for line in text.splitlines(keepends=True):
        if fence_char:
            if re.match(
                rf"^[ \t]{{0,3}}{re.escape(fence_char)}{{{fence_length},}}[ \t]*$",
                line.rstrip("\r\n"),
            ):
                fence_char = ""
                fence_length = 0
            continue
        opening = FENCE_OPEN_RE.match(line)
        if opening:
            fence_char = opening.group(1)[0]
            fence_length = len(opening.group(1))
            continue
        visible.append(line)
    return "".join(visible)


def _target(raw: str) -> str:
    target = unquote(raw.strip().split("|", 1)[0].split("#", 1)[0].strip())
    if target.startswith("<") and target.endswith(">"):
        target = target[1:-1]
    return target.replace("\\", "/")


def analyze(root: Path) -> GraphReport:
    root = root.resolve()
    files = _visible_markdown(root)
    stems: dict[str, list[str]] = defaultdict(list)
    for relative in files:
        stems[Path(relative).stem.casefold()].append(relative)
    adjacency = {relative: set() for relative in files}
    edges: set[tuple[str, str]] = set()
    links: set[tuple[str, str]] = set()
    unresolved: set[str] = set()

    def resolve(source: str, raw: str, wiki: bool) -> str | None:
        target = _target(raw)
        if not target or re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I):
            return None
        candidates: list[str] = []
        if wiki:
            direct = target.lstrip("/")
            candidates.extend([direct, direct + ".md"] if not Path(direct).suffix else [direct])
            if "/" not in direct:
                candidates.extend(stems.get(Path(direct).stem.casefold(), []))
        else:
            relative_target = (Path(source).parent / target).as_posix()
            candidates.extend(
                [relative_target, relative_target + ".md"]
                if not Path(relative_target).suffix
                else [relative_target]
            )
            direct = target.lstrip("/")
            candidates.extend([direct, direct + ".md"] if not Path(direct).suffix else [direct])
        for candidate in candidates:
            normalized = Path(candidate).as_posix()
            if normalized in files:
                return normalized
        unresolved.add(("wiki:" if wiki else "md:") + target)
        return None

    for source, path in files.items():
        text = _strip_fenced_blocks(path.read_text(encoding="utf-8", errors="replace"))
        for raw, wiki in [*((raw, True) for raw in WIKILINK_RE.findall(text)), *((raw, False) for raw in MARKDOWN_LINK_RE.findall(text))]:
            destination = resolve(source, raw, wiki)
            if destination is None or destination == source:
                continue
            edge = tuple(sorted((source, destination)))
            edges.add(edge)
            links.add((source, destination))
            adjacency[source].add(destination)
            adjacency[destination].add(source)

    isolates = tuple(sorted(node for node, neighbors in adjacency.items() if not neighbors))
    components: list[tuple[str, ...]] = []
    visited: set[str] = set()
    for start in sorted(adjacency):
        if start in visited:
            continue
        queue = deque([start])
        visited.add(start)
        component: list[str] = []
        while queue:
            current = queue.popleft()
            component.append(current)
            for neighbor in adjacency[current]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)
        components.append(tuple(sorted(component)))
    components.sort(key=lambda component: (-len(component), component))
    return GraphReport(
        nodes=frozenset(files),
        edges=frozenset(edges),
        isolates=isolates,
        components=tuple(components),
        unresolved=tuple(sorted(unresolved)),
        links=frozenset(links),
    )


def graph_errors(root: Path) -> list[str]:
    config_path = root / ".obsidian/graph.json"
    if not config_path.is_file():
        return ["missing .obsidian/graph.json"]
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"invalid .obsidian/graph.json: {exc}"]
    errors: list[str] = []
    if config.get("search", ""):
        errors.append("Obsidian global graph must not hide real files with a search filter")
    if config.get("showAttachments", False):
        errors.append("Obsidian global graph attachments are outside the Markdown connectivity contract")
    if not config.get("hideUnresolved", False):
        errors.append("Obsidian global graph must hide unresolved phantom nodes")
    if not config.get("showOrphans", True):
        errors.append("Obsidian global graph must show orphans so failures remain visible")
    configured_theme_queries = {
        group.get("query")
        for group in config.get("colorGroups", [])
        if isinstance(group, dict) and isinstance(group.get("query"), str)
    }
    missing_theme_queries = sorted(controlled_theme_queries() - configured_theme_queries)
    if missing_theme_queries:
        errors.append(
            "missing controlled theme color groups: " + ", ".join(missing_theme_queries)
        )
    report = analyze(root)
    files = _visible_markdown(root.resolve())
    source = _metier_source()
    prefix = source[0].as_posix() + "/" if source else None
    index_paths = {ENTERPRISE_INDEX.as_posix()} | ({source[1].as_posix()} if source else set())
    expected_enterprise = {
        path
        for path in files
        if not (prefix and path.startswith(prefix)) and path not in index_paths
    }
    expected_indexes = [(ENTERPRISE_INDEX, expected_enterprise)]
    if source:
        expected_indexes.append((source[1], {path for path in files if path.startswith(prefix)}))
    for index_path, expected in expected_indexes:
        absolute = root / index_path
        if not absolute.is_file():
            errors.append(f"missing generated Obsidian index {index_path.as_posix()}")
            continue
        actual = {
            target + ("" if Path(target).suffix else ".md")
            for raw in WIKILINK_RE.findall(
                _strip_fenced_blocks(absolute.read_text(encoding="utf-8"))
            )
            if (target := _target(raw))
        }
        missing = expected - actual
        extra = actual - expected
        if missing or extra:
            errors.append(
                f"stale generated Obsidian index {index_path.as_posix()}: "
                f"{len(missing)} missing, {len(extra)} extra"
            )
    if report.isolates:
        errors.append(f"Obsidian global graph has {len(report.isolates)} degree-zero Markdown nodes")
    if len(report.components) != 1:
        errors.append(f"Obsidian global graph has {len(report.components)} disconnected Markdown components")
    return errors


def _frontmatter(uid: str, scope: str, reviewer: str) -> str:
    today = date.today().isoformat()
    metier = brain_identite.metier()
    theme = f"theme/{scope}" if metier and scope == metier["cle"] else "theme/gouvernance"
    reviewed = f'["{reviewer}"]' if reviewer else "[]"
    return (
        "---\n"
        f"schema: {brain_identite.schema('v1')}\n"
        f"uid: {uid}\n"
        "type: domain\n"
        "kind: map\n"
        f"scope: {scope}\n"
        "author_agent: tooling:obsidian-graph\n"
        'model: ""\n'
        f"created: {today}\nupdated: {today}\n"
        "status: active\nconfidence: confirmed\n"
        'sources: ["file:.obsidian/graph.json"]\n'
        "supersedes: []\n"
        f"reviewed_by: {reviewed}\n"
        f"reviewed_at: {today}\n"
        "mocs: []\n"
        f"tags: [obsidian, graph, generated-map, {theme}]\n"
        "---\n"
    )


def _render_index(title: str, intro: str, paths: list[str], uid: str, scope: str, reviewer: str) -> str:
    grouped: dict[str, list[str]] = defaultdict(list)
    for path in paths:
        parent = str(Path(path).parent).replace("\\", "/")
        grouped[parent].append(path)
    lines = [_frontmatter(uid, scope, reviewer), "", f"# {title}", "", intro, ""]
    for parent in sorted(grouped):
        lines.extend((f"## `{parent}`", ""))
        lines.extend(f"- [[{path[:-3]}]]" for path in sorted(grouped[parent]))
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def refresh_indexes(root: Path, reviewer: str = "") -> None:
    root = root.resolve()
    files = _visible_markdown(root)
    metier_source = _metier_source()
    prefix = metier_source[0].as_posix() + "/" if metier_source else None
    index_paths = {ENTERPRISE_INDEX.as_posix()} | ({metier_source[1].as_posix()} if metier_source else set())
    enterprise = sorted(
        path for path in files
        if not (prefix and path.startswith(prefix)) and path not in index_paths
    )
    enterprise_path = root / ENTERPRISE_INDEX
    enterprise_path.parent.mkdir(parents=True, exist_ok=True)
    enterprise_path.write_text(
        _render_index(
            "Inventaire visible du vault",
            "Carte générée : rattache chaque note Markdown hors source documentaire canonique à la carte entreprise.",
            enterprise,
            "global/map/vault-inventory",
            "global",
            reviewer,
        ),
        encoding="utf-8",
    )
    if not metier_source:
        return
    _dossier, source_index, metier = metier_source
    source = sorted(path for path in files if path.startswith(prefix))
    (root / source_index).write_text(
        _render_index(
            f"Source documentaire canonique {metier['libelle']}",
            "Carte générée : rattache les fichiers de la source documentaire canonique au cluster "
            f"{metier['libelle']}.",
            source,
            f"{metier['cle']}/map/source-mirror",
            metier["cle"],
            reviewer,
        ),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--refresh-indexes", action="store_true")
    parser.add_argument("--reviewer", default="")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.refresh_indexes:
        refresh_indexes(args.root, args.reviewer)
    report = analyze(args.root)
    errors = graph_errors(args.root) if args.check else []
    print(json.dumps({"status": "valid" if not errors else "invalid", **report.as_dict(), "errors": errors}, ensure_ascii=False))
    raise SystemExit(0 if not errors else 2)


if __name__ == "__main__":
    main()
