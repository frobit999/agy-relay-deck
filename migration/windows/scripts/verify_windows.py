#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", required=True)
    parser.add_argument("--restored-root", required=True)
    args = parser.parse_args()
    package = Path(args.package)
    restored = Path(args.restored_root)
    inventory_file = package / "migration-inventory.json"
    if not inventory_file.exists():
        print("缺少 migration-inventory.json；请先在 Mac 运行最终同步。")
        return 2
    inventory = json.loads(inventory_file.read_text(encoding="utf-8"))
    failures: list[str] = []
    checked = 0
    for expected in inventory.get("conversations", []):
        database = restored / "conversations" / expected["file"]
        if not database.exists():
            failures.append(f"缺少 {expected['file']}")
            continue
        try:
            connection = sqlite3.connect(str(database), timeout=10)
            steps, max_index = connection.execute(
                "SELECT count(*), coalesce(max(idx), -1) FROM steps"
            ).fetchone()
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            connection.close()
            if integrity != "ok":
                failures.append(f"{expected['file']} integrity={integrity}")
            if int(steps) != int(expected["steps"]) or int(max_index) != int(expected["maxStepIndex"]):
                failures.append(
                    f"{expected['file']} 轨迹不一致：{steps}/{max_index}，预期 {expected['steps']}/{expected['maxStepIndex']}"
                )
            checked += 1
        except Exception as error:
            failures.append(f"{expected['file']} 无法读取：{error}")
    if failures:
        print("验证失败：")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print(f"验证通过：{checked} 个会话数据库完整，轨迹数量一致。")
    print("下一步：重新登录 agy 和 Antigravity Tools，再运行 Rebind-Rooms-To-Current-Account.ps1。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
