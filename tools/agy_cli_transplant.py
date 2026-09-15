#!/usr/bin/env python3
"""Safely transplant an Antigravity CLI conversation into a placeholder.

The destination conversation must already exist. Its identity and workspace
binding tables are preserved; only portable trajectory tables and the brain
directory are copied from the source. The command is a dry run unless
``--apply`` is supplied.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


COPY_TABLES = (
    "steps",
    "gen_metadata",
    "executor_metadata",
    "parent_references",
    "battle_mode_infos",
)
PRESERVE_TABLES = ("trajectory_meta", "trajectory_metadata_blob")
UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


class TransplantError(RuntimeError):
    pass


@dataclass(frozen=True)
class ConversationPaths:
    root: Path
    conversation_id: str

    @property
    def db(self) -> Path:
        return self.root / "conversations" / f"{self.conversation_id}.db"

    @property
    def brain(self) -> Path:
        return self.root / "brain" / self.conversation_id

    @property
    def annotation(self) -> Path:
        return self.root / "annotations" / f"{self.conversation_id}.pbtxt"


def fail(message: str) -> "None":
    raise TransplantError(message)


def validate_id(value: str, label: str) -> str:
    if not UUID_RE.fullmatch(value):
        fail(f"{label} must be a canonical UUID: {value!r}")
    return value.lower()


def validate_root(value: str, label: str) -> Path:
    root = Path(value).expanduser().resolve()
    if not root.is_dir():
        fail(f"{label} does not exist or is not a directory: {root}")
    if not (root / "conversations").is_dir():
        fail(f"{label} has no conversations directory: {root}")
    return root


def connect_readonly(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        fail(f"conversation database not found: {path}")
    # Open by filesystem path, then enforce query_only. The Apple Python 3.9
    # SQLite build intermittently rejects file: URIs for newly-created temp
    # directories, even though the same path opens normally.
    conn = sqlite3.connect(path, timeout=30)
    conn.execute("PRAGMA query_only=ON")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def connect_writable(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        fail(f"destination conversation database not found: {path}")
    conn = sqlite3.connect(path, timeout=30)
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def integrity(conn: sqlite3.Connection) -> str:
    row = conn.execute("PRAGMA integrity_check").fetchone()
    return str(row[0]) if row else "missing result"


def table_names(conn: sqlite3.Connection) -> set[str]:
    return {
        str(row[0])
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }


def table_columns(conn: sqlite3.Connection, table: str) -> tuple[str, ...]:
    return tuple(str(row[1]) for row in conn.execute(f'PRAGMA table_info("{table}")'))


def row_count(conn: sqlite3.Connection, table: str) -> int:
    return int(conn.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0])


def table_digest(conn: sqlite3.Connection, table: str) -> str:
    digest = hashlib.sha256()
    columns = table_columns(conn, table)
    digest.update(json.dumps(columns).encode())
    cursor = conn.execute(f'SELECT * FROM "{table}" ORDER BY rowid')
    while True:
        rows = cursor.fetchmany(256)
        if not rows:
            break
        for row in rows:
            for value in row:
                if value is None:
                    digest.update(b"N")
                elif isinstance(value, bytes):
                    digest.update(b"B")
                    digest.update(len(value).to_bytes(8, "big"))
                    digest.update(value)
                else:
                    encoded = str(value).encode("utf-8", errors="surrogatepass")
                    digest.update(b"T")
                    digest.update(len(encoded).to_bytes(8, "big"))
                    digest.update(encoded)
    return digest.hexdigest()


def database_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def snapshot_database(source: Path, destination: Path) -> None:
    source_conn = connect_readonly(source)
    try:
        destination_conn = sqlite3.connect(destination)
        try:
            source_conn.backup(destination_conn)
        finally:
            destination_conn.close()
    finally:
        source_conn.close()


def describe(source: ConversationPaths, target: ConversationPaths) -> dict:
    if source.db.resolve() == target.db.resolve():
        fail("source and destination database paths are identical")

    with connect_readonly(source.db) as src, connect_readonly(target.db) as dst:
        src_integrity = integrity(src)
        dst_integrity = integrity(dst)
        if src_integrity != "ok":
            fail(f"source integrity_check failed: {src_integrity}")
        if dst_integrity != "ok":
            fail(f"destination integrity_check failed: {dst_integrity}")

        required = set(COPY_TABLES + PRESERVE_TABLES)
        missing_src = sorted(required - table_names(src))
        missing_dst = sorted(required - table_names(dst))
        if missing_src:
            fail(f"source is missing tables: {', '.join(missing_src)}")
        if missing_dst:
            fail(f"destination is missing tables: {', '.join(missing_dst)}")

        counts: dict[str, dict[str, int]] = {}
        columns: dict[str, list[str]] = {}
        for table in COPY_TABLES:
            src_columns = table_columns(src, table)
            dst_columns = table_columns(dst, table)
            if src_columns != dst_columns:
                fail(
                    f"schema mismatch for {table}: source={src_columns}, "
                    f"destination={dst_columns}"
                )
            columns[table] = list(src_columns)
            counts[table] = {
                "source": row_count(src, table),
                "destination": row_count(dst, table),
            }

        preserved = {table: table_digest(dst, table) for table in PRESERVE_TABLES}

    return {
        "source": {
            "root": str(source.root),
            "conversation_id": source.conversation_id,
            "database": str(source.db),
            "database_sha256": database_sha256(source.db),
            "brain_exists": source.brain.is_dir(),
            "annotation_exists": source.annotation.is_file(),
        },
        "destination": {
            "root": str(target.root),
            "conversation_id": target.conversation_id,
            "database": str(target.db),
            "database_sha256_before": database_sha256(target.db),
            "brain_exists": target.brain.is_dir(),
            "annotation_exists": target.annotation.is_file(),
        },
        "integrity": {"source": "ok", "destination": "ok"},
        "copy_tables": counts,
        "columns": columns,
        "preserved_table_sha256_before": preserved,
    }


def copy_table(
    source: sqlite3.Connection,
    target: sqlite3.Connection,
    table: str,
    columns: Iterable[str],
) -> int:
    column_list = tuple(columns)
    quoted = ", ".join(f'"{column}"' for column in column_list)
    placeholders = ", ".join("?" for _ in column_list)
    target.execute(f'DELETE FROM "{table}"')
    # Every copied table is keyed by idx. Avoid an explicit sort here: large
    # trajectories can otherwise spill SQLite's sorter to a temp file, which
    # is both slower and can fail in sandboxed environments.
    source_cursor = source.execute(f'SELECT {quoted} FROM "{table}"')
    copied = 0
    while True:
        rows = source_cursor.fetchmany(128)
        if not rows:
            break
        target.executemany(
            f'INSERT INTO "{table}" ({quoted}) VALUES ({placeholders})', rows
        )
        copied += len(rows)
    return copied


def title_from_annotation(path: Path) -> str | None:
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8", errors="ignore")
    match = re.search(r'title\s*:\s*"((?:\\.|[^"\\])*)"', text)
    return match.group(1) if match else None


def set_annotation_title(path: Path, title: str) -> None:
    escaped = title.replace("\\", "\\\\").replace('"', '\\"')
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file():
        text = path.read_text(encoding="utf-8", errors="ignore")
        if re.search(r'title\s*:\s*"(?:\\.|[^"\\])*"', text):
            text = re.sub(
                r'title\s*:\s*"(?:\\.|[^"\\])*"',
                f'title:"{escaped}"',
                text,
                count=1,
            )
        else:
            text = f'title:"{escaped}"\n' + text
    else:
        text = f'title:"{escaped}"\n'
    path.write_text(text, encoding="utf-8")


def safe_copy_brain(source: Path, target: Path, backup: Path, stamp: str) -> None:
    if not source.is_dir():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    stage = target.parent / f".{target.name}.transplant-stage-{stamp}"
    if stage.exists():
        fail(f"staging path already exists: {stage}")
    shutil.copytree(source, stage, symlinks=True)
    if target.exists():
        shutil.copytree(target, backup, symlinks=True)
        shutil.rmtree(target)
    os.replace(stage, target)


def apply_transplant(
    source: ConversationPaths,
    target: ConversationPaths,
    plan: dict,
    title: str | None,
) -> dict:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_db = target.db.with_name(f"{target.db.name}.before-transplant-{stamp}.bak")
    backup_brain = target.brain.with_name(
        f"{target.brain.name}.before-transplant-{stamp}.bak"
    )
    backup_annotation = target.annotation.with_name(
        f"{target.annotation.name}.before-transplant-{stamp}.bak"
    )

    with tempfile.TemporaryDirectory(prefix="agy-cli-transplant-") as temp_dir:
        source_snapshot = Path(temp_dir) / "source.db"
        snapshot_database(source.db, source_snapshot)
        snapshot_database(target.db, backup_db)
        if target.annotation.is_file():
            target.annotation.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target.annotation, backup_annotation)

        before_preserved = plan["preserved_table_sha256_before"]
        source_conn = connect_readonly(source_snapshot)
        target_conn = connect_writable(target.db)
        copied: dict[str, int] = {}
        try:
            target_conn.execute("PRAGMA foreign_keys=OFF")
            target_conn.execute("BEGIN IMMEDIATE")
            for table in COPY_TABLES:
                copied[table] = copy_table(
                    source_conn,
                    target_conn,
                    table,
                    plan["columns"][table],
                )
            target_conn.commit()
        except Exception:
            target_conn.rollback()
            raise
        finally:
            source_conn.close()
            target_conn.close()

    safe_copy_brain(source.brain, target.brain, backup_brain, stamp)
    chosen_title = title or title_from_annotation(source.annotation)
    if chosen_title:
        set_annotation_title(target.annotation, chosen_title)

    with connect_readonly(target.db) as verified:
        final_integrity = integrity(verified)
        after_preserved = {
            table: table_digest(verified, table) for table in PRESERVE_TABLES
        }
        final_counts = {table: row_count(verified, table) for table in COPY_TABLES}

    if final_integrity != "ok":
        fail(
            f"destination integrity_check failed after transplant: {final_integrity}. "
            f"Restore {backup_db} before opening agy."
        )
    if after_preserved != before_preserved:
        fail(
            "destination binding tables changed unexpectedly. "
            f"Restore {backup_db} before opening agy."
        )
    expected_counts = {
        table: details["source"] for table, details in plan["copy_tables"].items()
    }
    if final_counts != expected_counts:
        fail(
            f"row-count verification failed: expected={expected_counts}, "
            f"actual={final_counts}. Restore {backup_db} before opening agy."
        )

    result = dict(plan)
    result.update(
        {
            "applied": True,
            "timestamp_utc": stamp,
            "copied_rows": copied,
            "destination_sha256_after": database_sha256(target.db),
            "preserved_table_sha256_after": after_preserved,
            "verification": {
                "destination_integrity": final_integrity,
                "row_counts_match": True,
                "binding_tables_unchanged": True,
            },
            "automatic_backups": {
                "database": str(backup_db),
                "brain": str(backup_brain) if backup_brain.exists() else None,
                "annotation": (
                    str(backup_annotation) if backup_annotation.exists() else None
                ),
            },
        }
    )
    return result


def human_report(report: dict) -> None:
    print("Antigravity CLI conversation transplant")
    print(f"  source:      {report['source']['conversation_id']}")
    print(f"  destination: {report['destination']['conversation_id']}")
    print("  integrity:   source=ok destination=ok")
    print("  rows:")
    for table, counts in report["copy_tables"].items():
        print(
            f"    {table:<20} source={counts['source']:<8} "
            f"destination={counts['destination']}"
        )
    if report.get("applied"):
        verification = report["verification"]
        print("  result:      APPLIED AND VERIFIED")
        print(
            "  checks:      "
            f"integrity={verification['destination_integrity']} "
            f"rows={verification['row_counts_match']} "
            f"bindings={verification['binding_tables_unchanged']}"
        )
        print(f"  backups:     {report['automatic_backups']['database']}")
    else:
        print("  result:      DRY RUN ONLY; no files changed")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Copy an Antigravity CLI trajectory into an existing placeholder "
            "while preserving the placeholder's account/workspace binding."
        )
    )
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--target-root", required=True)
    parser.add_argument("--target-id", required=True)
    parser.add_argument("--title")
    parser.add_argument(
        "--apply", action="store_true", help="perform the transplant"
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="required with --apply to acknowledge target replacement",
    )
    parser.add_argument("--json", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.apply and not args.yes:
            fail("--apply requires --yes; run without --apply for a dry run")
        source = ConversationPaths(
            validate_root(args.source_root, "source root"),
            validate_id(args.source_id, "source id"),
        )
        target = ConversationPaths(
            validate_root(args.target_root, "target root"),
            validate_id(args.target_id, "target id"),
        )
        plan = describe(source, target)
        report = (
            apply_transplant(source, target, plan, args.title)
            if args.apply
            else plan
        )
        report.setdefault("applied", False)
        if args.json:
            print(json.dumps(report, indent=2, ensure_ascii=False))
        else:
            human_report(report)
        return 0
    except (OSError, sqlite3.Error, TransplantError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
