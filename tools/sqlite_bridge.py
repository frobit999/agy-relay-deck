#!/usr/bin/env python3
"""Small cross-platform stdlib bridge for Agy Relay Deck.

Used only when the sqlite3/du command-line tools are unavailable (notably on
Windows). It intentionally has no third-party dependencies.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path


def summary(database: Path, limit: int) -> None:
    connection = sqlite3.connect(f"{database.resolve().as_uri()}?mode=ro", uri=True, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            """
            SELECT conversation_id,title,preview,step_count,last_modified_time,
                   workspace_uris,status,project_id
            FROM conversation_summaries
            ORDER BY last_modified_time DESC
            LIMIT ?
            """,
            (max(1, min(100, limit)),),
        ).fetchall()
        print(json.dumps([dict(row) for row in rows], ensure_ascii=False))
    finally:
        connection.close()


def stats(database: Path) -> None:
    connection = sqlite3.connect(f"{database.resolve().as_uri()}?mode=ro", uri=True, timeout=10)
    try:
        step_count, max_index = connection.execute(
            "SELECT count(*), coalesce(max(idx), -1) FROM steps"
        ).fetchone()
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        print(
            json.dumps(
                {
                    "stepCount": int(step_count),
                    "maxStepIndex": int(max_index),
                    "integrity": integrity,
                }
            )
        )
    finally:
        connection.close()


def directory_sizes(paths: list[str]) -> None:
    result: dict[str, int] = {}
    for raw in paths:
        root = Path(raw)
        total = 0
        if root.exists():
            for directory, _, files in os.walk(root):
                for filename in files:
                    try:
                        total += (Path(directory) / filename).stat().st_size
                    except OSError:
                        pass
        result[root.name] = total
    print(json.dumps(result))


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: sqlite_bridge.py summary|stats|dirsize <args>", file=sys.stderr)
        return 2
    mode = sys.argv[1]
    if mode == "summary":
        summary(Path(sys.argv[2]), int(sys.argv[3] if len(sys.argv) > 3 else "30"))
    elif mode == "stats":
        stats(Path(sys.argv[2]))
    elif mode == "dirsize":
        directory_sizes(sys.argv[2:])
    else:
        print(f"unknown mode: {mode}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
