# -*- coding: utf-8 -*-
"""Fetch the latest confirmed NAV for fund 460300.

Only public fund NAV is written. No personal ledger/account data is read.
"""
from __future__ import annotations

import json
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

CODE = "460300"
NAME = "华泰柏瑞沪深300ETF联接A"
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / f"fund-{CODE}.json"
URL = (
    "https://api.fund.eastmoney.com/f10/lsjz"
    f"?fundCode={CODE}&pageIndex=1&pageSize=2&startDate=&endDate="
)


def fetch() -> dict:
    request = urllib.request.Request(
        URL,
        headers={
            "Referer": "https://fundf10.eastmoney.com/",
            "User-Agent": "Mozilla/5.0 index-research-nav-updater/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    rows = payload.get("Data", {}).get("LSJZList", [])
    if not rows:
        raise RuntimeError("NAV response contains no rows")
    row = rows[0]
    nav = float(row["DWJZ"])
    daily_change = float(row["JZZZL"])
    if nav <= 0:
        raise RuntimeError("NAV must be positive")
    return {
        "code": CODE,
        "name": NAME,
        "navDate": row["FSRQ"],
        "nav": nav,
        "cumulativeNav": float(row["LJJZ"]),
        "dailyChangePct": daily_change,
        "source": "eastmoney_f10_lsjz",
        "updatedAt": datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds"),
    }


def main() -> int:
    new_data = fetch()
    if OUTPUT.exists():
        old_data = json.loads(OUTPUT.read_text(encoding="utf-8"))
        stable_fields = ("code", "name", "navDate", "nav", "cumulativeNav", "dailyChangePct", "source")
        if all(old_data.get(key) == new_data.get(key) for key in stable_fields):
            print(f"{CODE} {new_data['navDate']} NAV unchanged")
            return 0
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(new_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{CODE} {new_data['navDate']} NAV={new_data['nav']:.4f} change={new_data['dailyChangePct']:+.2f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
