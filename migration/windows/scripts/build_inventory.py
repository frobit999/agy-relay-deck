#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def conversation_info(path: Path) -> dict:
    connection = sqlite3.connect(str(path), timeout=10)
    try:
        steps, max_index = connection.execute(
            "SELECT count(*), coalesce(max(idx), -1) FROM steps"
        ).fetchone()
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        connection.close()
    return {
        "id": path.stem,
        "file": path.name,
        "bytes": path.stat().st_size,
        "steps": int(steps),
        "maxStepIndex": int(max_index),
        "integrity": integrity,
        "sha256": sha256(path),
    }


def tree_totals(root: Path) -> tuple[int, int]:
    files = 0
    total = 0
    if not root.exists():
        return files, total
    for directory, _, names in os.walk(root):
        for name in names:
            try:
                total += (Path(directory) / name).stat().st_size
                files += 1
            except OSError:
                pass
    return files, total


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", required=True)
    parser.add_argument("--source-version", default="unknown")
    args = parser.parse_args()
    package = Path(args.package).resolve()
    agy_root = package / "payload" / "antigravity-cli"
    conversations = [conversation_info(path) for path in sorted((agy_root / "conversations").glob("*.db"))]
    brain_files, brain_bytes = tree_totals(agy_root / "brain")
    workspaces: list[str] = []
    summary_database = agy_root / "conversation_summaries.db"
    if summary_database.exists():
        connection = sqlite3.connect(str(summary_database), timeout=10)
        try:
            values = connection.execute(
                "SELECT DISTINCT workspace_uris FROM conversation_summaries WHERE workspace_uris IS NOT NULL AND workspace_uris != ''"
            ).fetchall()
            for (raw,) in values:
                try:
                    parsed = json.loads(raw)
                    items = parsed if isinstance(parsed, list) else [parsed]
                except Exception:
                    items = [raw]
                for item in items:
                    if isinstance(item, str) and item.startswith("file://"):
                        workspaces.append(unquote(urlparse(item).path))
                    elif isinstance(item, str):
                        workspaces.append(item)
        finally:
            connection.close()
    workspaces = sorted(set(workspaces))
    inventory = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sourcePlatform": "macOS",
        "sourceAgyVersion": args.source_version.strip(),
        "conversationCount": len(conversations),
        "conversations": conversations,
        "brain": {"files": brain_files, "bytes": brain_bytes},
        "workspacePaths": workspaces,
        "excludedSecrets": [
            "antigravity-oauth-token",
            "~/.antigravity_tools",
            "~/.gemini/oauth_creds.json",
            "Mac system keychain",
        ],
    }
    (package / "migration-inventory.json").write_text(
        json.dumps(inventory, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (package / "workspace-map.txt").write_text(
        "以下是会话曾使用的 Mac 工作目录；项目代码需另行复制或 clone。\n\n"
        + "\n".join(workspaces)
        + "\n",
        encoding="utf-8",
    )
    print(f"Inventory written: {len(conversations)} conversations, {brain_files} Brain files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

