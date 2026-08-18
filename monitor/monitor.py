#!/usr/bin/env python3
"""Monitor selected TimeCigar products and send QQ Mail restock notifications."""

from __future__ import annotations

import email.message
import html
import json
import os
import re
import smtplib
import ssl
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass(frozen=True)
class Product:
    key: str
    name: str
    product_url: str
    check_url: str
    identity_terms: tuple[str, ...]


PRODUCTS = (
    Product(
        key="timecigar-4286",
        name="关达拉美拉 美纽杜 雪茄管",
        product_url="https://www.timecigar.com/sc/details/minutos-tubo/4286",
        check_url="https://www.timecigar.com/lb_ps_quick_add?id=4286&form_page_type=open&form_session=view",
        identity_terms=("TC-2100004299", "Minutos Tubo"),
    ),
    Product(
        key="timecigar-7400",
        name="关达拉美拉 美纽杜",
        product_url="https://www.timecigar.com/sc/details/minutos/7400",
        check_url="https://www.timecigar.com/lb_ps_quick_add?id=7400&form_page_type=open&form_session=view",
        identity_terms=("TC-2100007413", "Minutos"),
    ),
    Product(
        key="timecigar-4896",
        name="关达拉美拉 美纽杜 雪茄管",
        product_url="https://www.timecigar.com/sc/details/minutos-tubo/4896",
        check_url="https://www.timecigar.com/lb_ps_quick_add?id=4896&form_page_type=open&form_session=view",
        identity_terms=("TC-2100004909", "Minutos Tubo"),
    ),
)
SOLD_OUT_TERMS = ("已售罄", "售罄", "缺货", "sold out", "out of stock")
IN_STOCK_TERMS = ("加入购物袋", "加至购物袋", "add to bag", "add to cart")
STATE_PATH = Path(os.environ.get("STATE_PATH", "monitor/state.json"))


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def page_text(raw_html: str) -> tuple[str, str]:
    title_match = re.search(r"<title[^>]*>(.*?)</title>", raw_html, flags=re.I | re.S)
    title = html.unescape(title_match.group(1)).strip() if title_match else ""
    visible = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", raw_html, flags=re.I | re.S)
    visible = re.sub(r"<[^>]+>", " ", visible)
    return title, re.sub(r"\s+", " ", html.unescape(visible)).strip()


def fetch_page(product: Product) -> str:
    request = urllib.request.Request(product.check_url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; TimeCigarRestockMonitor/1.0)",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
        "Cache-Control": "no-cache",
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read(3_000_000).decode(response.headers.get_content_charset() or "utf-8", errors="replace")


def classify(product: Product, raw_html: str) -> tuple[str, str]:
    title, text = page_text(raw_html)
    haystack = f"{title} {text}".lower()
    missing = [term for term in product.identity_terms if term.lower() not in haystack]
    if missing:
        return "unknown", f"商品身份校验失败: 缺少 {', '.join(missing)}"
    sold_out = [term for term in SOLD_OUT_TERMS if term.lower() in haystack]
    if sold_out:
        return "out_of_stock", f"检测到缺货标志: {', '.join(sold_out)}"
    in_stock = [term for term in IN_STOCK_TERMS if term.lower() in haystack]
    if in_stock:
        return "in_stock", f"检测到购买标志: {', '.join(in_stock)}"
    return "unknown", "商品存在，但未识别到库存标志"


def load_state() -> dict:
    if not STATE_PATH.exists():
        return {"products": {}}
    return json.loads(STATE_PATH.read_text(encoding="utf-8"))


def save_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATE_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(STATE_PATH)


def subscribers() -> list[dict[str, str]]:
    endpoint = os.environ.get("MONITOR_ENDPOINT", "").rstrip("/")
    token = os.environ.get("MONITOR_TOKEN", "")
    if not endpoint or not token:
        raise RuntimeError("MONITOR_ENDPOINT 和 MONITOR_TOKEN 尚未配置")
    request = urllib.request.Request(
        f"{endpoint}/api/subscribers",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return [item for item in payload.get("subscribers", []) if item.get("email") and item.get("unsubscribe_url")]


def smtp_settings() -> tuple[str, str]:
    username = os.environ.get("QQ_SMTP_USERNAME", "").strip()
    auth_code = os.environ.get("QQ_SMTP_AUTH_CODE", "")
    if not username or not auth_code:
        raise RuntimeError("QQ_SMTP_USERNAME 和 QQ_SMTP_AUTH_CODE 尚未配置")
    return username, auth_code


def send_messages(items: list[tuple[Product, str]], recipients: list[dict[str, str]], test: bool = False) -> None:
    username, auth_code = smtp_settings()
    context = ssl.create_default_context()
    with smtplib.SMTP_SSL("smtp.qq.com", 465, context=context, timeout=30) as server:
        server.login(username, auth_code)
        for recipient in recipients:
            message = email.message.EmailMessage()
            message["From"] = f"美纽杜补货提醒 <{username}>"
            message["To"] = recipient["email"]
            if test:
                message["Subject"] = "[测试成功] TimeCigar 补货提醒"
                message.set_content("QQ 邮箱 SMTP 配置正常。之后补货时会自动发送提醒。")
            else:
                product, detail = items[0]
                message["Subject"] = f"[补货提醒] {product.name}"
                message.set_content(
                    f"{product.name} 可能已经补货。\n\n"
                    f"商品页: {product.product_url}\n"
                    f"检测结果: {detail}\n\n"
                    f"库存以商店页面为准。\n"
                    f"取消订阅: {recipient['unsubscribe_url']}"
                )
            server.send_message(message)


def test_email() -> int:
    username, _ = smtp_settings()
    send_messages([], [{"email": username, "unsubscribe_url": ""}], test=True)
    print("测试邮件已发送到 QQ 发件邮箱。")
    return 0


def main() -> int:
    if os.environ.get("TEST_EMAIL", "").lower() == "true":
        return test_email()

    previous = load_state().get("products", {})
    next_state: dict[str, dict[str, str]] = {}
    alerts: list[tuple[Product, str]] = []
    for product in PRODUCTS:
        old = previous.get(product.key, {})
        try:
            status, detail = classify(product, fetch_page(product))
        except (OSError, urllib.error.URLError, ValueError) as error:
            status, detail = "unknown", f"请求失败: {error}"
        print(f"{product.key} status={status} detail={detail}")

        # Unknown checks do not erase the last confirmed stock status, preventing duplicate alerts.
        confirmed_status = status if status != "unknown" else old.get("status", "unknown")
        next_state[product.key] = {
            "status": confirmed_status,
            "last_checked_status": status,
            "checked_at": now(),
            "detail": detail,
        }
        if status == "in_stock" and old.get("status") != "in_stock":
            alerts.append((product, detail))

    if alerts:
        recipients = subscribers()
        if recipients:
            for alert in alerts:
                send_messages([alert], recipients)
            print(f"已向 {len(recipients)} 位订阅者发送 {len(alerts)} 个补货提醒。")
        else:
            print("没有已订阅的收件人，本次不发送邮件。")

    save_state({"products": next_state})
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, urllib.error.URLError) as error:
        print(f"监控任务失败: {error}", file=sys.stderr)
        raise SystemExit(1)
