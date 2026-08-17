#!/usr/bin/env python3

import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "record_purchase.py"


def run(env: dict[str, str], expected: int = 0) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        cwd=ROOT,
        env={**os.environ, **env},
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != expected:
        raise AssertionError(f"exit={result.returncode}, stdout={result.stdout}, stderr={result.stderr}")
    return result


with tempfile.TemporaryDirectory() as directory:
    temp = Path(directory)
    ledger_path = temp / "ledger.json"
    quote_path = temp / "quote.json"
    shutil.copy2(ROOT / "data" / "ledger-460300.json", ledger_path)
    shutil.copy2(ROOT / "data" / "fund-460300.json", quote_path)
    base = {"LEDGER_PATH": str(ledger_path), "QUOTE_PATH": str(quote_path)}

    run({**base, "PURCHASE_AMOUNT": "5000", "PURCHASE_DATE": "2026-08-12", "CONFIRMED_SHARES": "4200.5", "PURCHASE_NOTE": "confirmed"})
    data = json.loads(ledger_path.read_text(encoding="utf-8"))
    confirmed = data["transactions"][-1]
    assert confirmed["amount"] == 5000.0
    assert confirmed["shares"] == 4200.5
    assert confirmed["sharesEstimated"] is False

    run({**base, "PURCHASE_AMOUNT": "1000", "PURCHASE_DATE": "2026-08-12", "CONFIRMED_SHARES": ""})
    data = json.loads(ledger_path.read_text(encoding="utf-8"))
    estimated = data["transactions"][-1]
    assert estimated["sharesEstimated"] is True
    assert abs(estimated["shares"] - 1000 / 1.1873) < 1e-9

    run({**base, "PURCHASE_AMOUNT": "999999", "PURCHASE_DATE": "2026-08-12"}, expected=1)

    payload = {"version": 1, "fundCode": "460300", "amount": 100, "date": "2026-08-12", "shares": 80, "note": "issue"}
    encoded = base64.urlsafe_b64encode(json.dumps(payload, ensure_ascii=False).encode()).decode()
    event_path = temp / "event.json"
    event_path.write_text(json.dumps({"issue": {"body": f"<!-- index-research-ledger-v1:{encoded} -->"}}), encoding="utf-8")
    run({**base, "GITHUB_EVENT_NAME": "issues", "GITHUB_EVENT_PATH": str(event_path), "GITHUB_RUN_ID": "12345", "ISSUE_NUMBER": "99"})
    data = json.loads(ledger_path.read_text(encoding="utf-8"))
    assert data["transactions"][-1]["id"] == "buy-2026-08-12-issue-99"
    assert data["transactions"][-1]["note"] == "issue"
    count = len(data["transactions"])
    run({**base, "GITHUB_EVENT_NAME": "issues", "GITHUB_EVENT_PATH": str(event_path), "GITHUB_RUN_ID": "54321", "ISSUE_NUMBER": "99"})
    data = json.loads(ledger_path.read_text(encoding="utf-8"))
    assert len(data["transactions"]) == count

    # workflow_dispatch 幂等：同一笔（日期/金额/份额/备注相同）重复触发不重复写入
    run({**base, "PURCHASE_AMOUNT": "2000", "PURCHASE_DATE": "2026-08-12", "CONFIRMED_SHARES": "1600", "PURCHASE_NOTE": "dispatch"})
    data = json.loads(ledger_path.read_text(encoding="utf-8"))
    assert data["transactions"][-1]["id"].startswith("buy-2026-08-12-dispatch-")
    dispatch_count = len(data["transactions"])
    run({**base, "PURCHASE_AMOUNT": "2000", "PURCHASE_DATE": "2026-08-12", "CONFIRMED_SHARES": "1600", "PURCHASE_NOTE": "dispatch"})
    data = json.loads(ledger_path.read_text(encoding="utf-8"))
    assert len(data["transactions"]) == dispatch_count

print("remote ledger writer tests: PASS")
