#!/usr/bin/env python3
"""Append one completed 460300 purchase to the public remote ledger.

Workflow inputs are read from environment variables so user-provided text is
never interpolated into a shell command.  If confirmed shares are omitted, the
latest confirmed NAV is used temporarily and the entry is visibly marked as an
estimate.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import sys
import urllib.request
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import NoReturn
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LEDGER = ROOT / "data" / "ledger-460300.json"
DEFAULT_QUOTE = ROOT / "data" / "fund-460300.json"
BEIJING = ZoneInfo("Asia/Shanghai")


def fail(message: str) -> NoReturn:
    raise SystemExit(f"登记失败：{message}")


def positive_decimal(raw: str, label: str) -> Decimal:
    try:
        value = Decimal(raw.strip())
    except (InvalidOperation, AttributeError):
        fail(f"{label}不是有效数字")
    if not value.is_finite() or value <= 0:
        fail(f"{label}必须大于0")
    return value


def optional_date(raw: str) -> str:
    if not raw.strip():
        return datetime.now(BEIJING).date().isoformat()
    try:
        return date.fromisoformat(raw.strip()).isoformat()
    except ValueError:
        fail("交易日期必须是 YYYY-MM-DD 格式")


def inputs_from_issue() -> dict[str, str]:
    event_path = os.environ.get("GITHUB_EVENT_PATH", "").strip()
    if not event_path:
        fail("GitHub issue 事件文件缺失")
    event = load_json(Path(event_path))
    body = str(event.get("issue", {}).get("body", ""))
    match = re.search(r"<!-- index-research-ledger-v1:([A-Za-z0-9_=-]+) -->", body)
    if not match:
        fail("登记单缺少可验证的数据载荷")
    try:
        decoded = base64.urlsafe_b64decode(match.group(1)).decode("utf-8")
        payload = json.loads(decoded)
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        fail(f"登记单数据载荷无法解析：{exc}")
    if payload.get("version") != 1 or payload.get("fundCode") != "460300":
        fail("登记单版本或基金代码不正确")
    return {
        "amount": str(payload.get("amount", "")),
        "date": str(payload.get("date", "")),
        "shares": str(payload.get("shares", "") or ""),
        "note": str(payload.get("note", "")),
    }


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"无法读取 {path.name}：{exc}")


def fetch_nav_for_date(code: str, date_str: str):
    """Return the confirmed unit NAV (Decimal) for a specific date, or None."""
    url = (
        "https://api.fund.eastmoney.com/f10/lsjz"
        f"?fundCode={code}&pageIndex=1&pageSize=20&startDate={date_str}&endDate={date_str}"
    )
    try:
        request = urllib.request.Request(
            url,
            headers={
                "Referer": "https://fundf10.eastmoney.com/",
                "User-Agent": "Mozilla/5.0 index-research-nav-updater/1.0",
            },
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
        rows = payload.get("Data", {}).get("LSJZList", [])
        if not rows:
            return None
        value = Decimal(str(rows[0].get("DWJZ", "")))
        return value if value.is_finite() and value > 0 else None
    except Exception:
        return None


def main() -> int:
    ledger_path = Path(os.environ.get("LEDGER_PATH", DEFAULT_LEDGER))
    quote_path = Path(os.environ.get("QUOTE_PATH", DEFAULT_QUOTE))
    if os.environ.get("GITHUB_EVENT_NAME") == "issues":
        inputs = inputs_from_issue()
    else:
        inputs = {
            "amount": os.environ.get("PURCHASE_AMOUNT", ""),
            "date": os.environ.get("PURCHASE_DATE", ""),
            "shares": os.environ.get("CONFIRMED_SHARES", ""),
            "note": os.environ.get("PURCHASE_NOTE", ""),
        }
    amount = positive_decimal(inputs["amount"], "加仓金额")
    trade_date = optional_date(inputs["date"])
    shares_raw = inputs["shares"].strip()
    note = inputs["note"].strip()[:200]

    ledger = load_json(ledger_path)
    if ledger.get("version") != 1 or ledger.get("fundCode") != "460300":
        fail("远程账本版本或基金代码不正确")
    transactions = ledger.get("transactions")
    if not isinstance(transactions, list):
        fail("远程账本交易列表格式不正确")
    if date.fromisoformat(trade_date) > datetime.now(BEIJING).date():
        fail("交易日期不能晚于北京时间今天")
    if date.fromisoformat(trade_date) < date.fromisoformat(ledger["strategyStartDate"]):
        fail("加仓日期不能早于策略账本起始日")

    total = Decimal(str(ledger.get("totalPrincipal")))
    reserve = Decimal(str(ledger.get("reserveCash")))
    invested = sum((Decimal(str(tx.get("amount", 0))) for tx in transactions), Decimal("0"))
    available = total - reserve - invested
    if amount > available + Decimal("0.01"):
        fail(f"加仓金额超过尚未投入建仓资金 {available.quantize(Decimal('0.01'))} 元")

    if shares_raw:
        shares = positive_decimal(shares_raw, "确认份额")
        estimated = False
        nav_used = None
        nav_date = None
    else:
        quote = load_json(quote_path)
        if quote.get("code") != "460300":
            fail("净值文件基金代码不正确")
        nav = positive_decimal(str(quote.get("nav", "")), "最新确认净值")
        nav_date = quote.get("navDate")
        # 交易日与最新净值日不同时，尝试取交易日净值；取不到则回退最新净值（仍标记估算）
        if trade_date != str(nav_date):
            historical = fetch_nav_for_date("460300", trade_date)
            if historical is not None:
                nav = historical
                nav_date = trade_date
        shares = amount / nav
        estimated = True
        nav_used = float(nav)

    now = datetime.now(BEIJING)
    issue_number = os.environ.get("ISSUE_NUMBER", "").strip()
    if issue_number:
        event_identity = f"issue-{issue_number}"
    else:
        # workflow_dispatch：按内容哈希幂等，重复触发同一笔不会重复写入
        key = f"{trade_date}|{amount}|{shares if shares_raw else 'estimated'}|{note}"
        event_identity = "dispatch-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]
    entry_id = f"buy-{trade_date}-{event_identity}"
    if any(tx.get("id") == entry_id for tx in transactions):
        print(f"记录 {entry_id} 已存在，本次不重复写入")
        return 0

    transactions.append(
        {
            "id": entry_id,
            "type": "buy",
            "date": trade_date,
            "amount": float(amount),
            "shares": float(shares),
            "sharesEstimated": estimated,
            "navUsed": nav_used,
            "navDate": nav_date,
            "note": note,
            "recordedAt": now.isoformat(timespec="seconds"),
        }
    )
    ledger["updatedAt"] = now.isoformat(timespec="seconds")

    temporary = ledger_path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(ledger_path)
    print(
        f"已登记 {trade_date} 加仓 {amount} 元，份额 {shares:.8f}"
        + ("（按最新确认净值估算）" if estimated else "（基金确认）")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
