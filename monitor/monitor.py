#!/usr/bin/env python3
"""Check TimeCigar inventory and report it to the private notification worker."""

from __future__ import annotations

import html
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

CHECK_URL = "https://www.timecigar.com/lb_ps_quick_add?id=4286&form_page_type=open&form_session=view"
PRODUCT_URL = "https://www.timecigar.com/sc/details/minutos-tubo/4286"
PRODUCT_KEY = "timecigar-4286"
PRODUCT_NAME = "关达拉美拉 美纽杜 雪茄管"
IDENTITY_TERMS = ("TC-2100004299", "Minutos Tubo")
SOLD_OUT_TERMS = ("已售罄", "售罄", "缺货", "sold out", "out of stock")
IN_STOCK_TERMS = ("加入购物袋", "加至购物袋", "add to bag", "add to cart")


def page_text(raw_html: str) -> tuple[str, str]:
    title_match = re.search(r"<title[^>]*>(.*?)</title>", raw_html, flags=re.I | re.S)
    title = html.unescape(title_match.group(1)).strip() if title_match else ""
    visible = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", raw_html, flags=re.I | re.S)
    visible = re.sub(r"<[^>]+>", " ", visible)
    return title, re.sub(r"\s+", " ", html.unescape(visible)).strip()


def fetch_page() -> str:
    request = urllib.request.Request(CHECK_URL, headers={
        "User-Agent": "Mozilla/5.0 (compatible; TimeCigarRestockMonitor/1.0)",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
        "Cache-Control": "no-cache",
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read(3_000_000).decode(response.headers.get_content_charset() or "utf-8", errors="replace")


def classify(raw_html: str) -> tuple[str, str]:
    title, text = page_text(raw_html)
    haystack = f"{title} {text}".lower()
    missing = [term for term in IDENTITY_TERMS if term.lower() not in haystack]
    if missing:
        return "unknown", f"商品身份校验失败: 缺少 {', '.join(missing)}"
    sold_out = [term for term in SOLD_OUT_TERMS if term.lower() in haystack]
    if sold_out:
        return "out_of_stock", f"检测到缺货标志: {', '.join(sold_out)}"
    in_stock = [term for term in IN_STOCK_TERMS if term.lower() in haystack]
    if in_stock:
        return "in_stock", f"检测到购买标志: {', '.join(in_stock)}"
    return "unknown", "商品存在，但未识别到库存标志"


def report(status: str, detail: str) -> None:
    endpoint = os.environ.get("MONITOR_ENDPOINT", "").rstrip("/")
    token = os.environ.get("MONITOR_TOKEN", "")
    if not endpoint or not token:
        print("MONITOR_ENDPOINT / MONITOR_TOKEN 尚未配置；仅输出本次库存状态。")
        return
    payload = json.dumps({
        "productKey": PRODUCT_KEY,
        "productName": PRODUCT_NAME,
        "productUrl": PRODUCT_URL,
        "status": status,
        "detail": detail,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
    }).encode("utf-8")
    request = urllib.request.Request(
        f"{endpoint}/api/monitor",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        print("通知服务:", response.read().decode("utf-8", errors="replace"))


def main() -> int:
    try:
        status, detail = classify(fetch_page())
    except (OSError, urllib.error.URLError, ValueError) as error:
        status, detail = "unknown", f"请求失败: {error}"
    print(f"{datetime.now().isoformat(timespec='seconds')} status={status} detail={detail}")
    try:
        report(status, detail)
    except (OSError, urllib.error.URLError) as error:
        print(f"通知服务失败: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
