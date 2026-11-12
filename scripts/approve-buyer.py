#!/usr/bin/env python3
"""Approves one PayPal SANDBOX order as the sandbox buyer (headless Chromium). It only approves; it never captures.

Usage: python3 scripts/approve-buyer.py <approve-url>
Credentials: SANDBOX_BUYER_EMAIL and SANDBOX_BUYER_PASSWORD from the environment (never on the command line).
Run it through the shared buyer pool lock, for example: buyer-run.sh python3 scripts/approve-buyer.py <url>.
The caller (scripts/sandbox-contract.js) reads the order back from PayPal to see whether it became APPROVED.
"""
import os
import re
import sys
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
# The Chromium build the Node Playwright install keeps; the Python package may expect another revision.
EXE = os.path.expanduser("~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome")

if len(sys.argv) != 2 or not re.match(r"^https://www\.sandbox\.paypal\.com/", sys.argv[1]):
    sys.exit("Usage: python3 scripts/approve-buyer.py <https://www.sandbox.paypal.com/... approve url>")
email = os.environ.get("SANDBOX_BUYER_EMAIL", "")
password = os.environ.get("SANDBOX_BUYER_PASSWORD", "")
if not email or not password:
    sys.exit("Set SANDBOX_BUYER_EMAIL and SANDBOX_BUYER_PASSWORD in the environment.")

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path=EXE if os.path.exists(EXE) else None)
    page = browser.new_context().new_page()
    # The order has no return_url on this machine's shop; never let the browser call a local server.
    page.route(re.compile(r"^https?://(127\.0\.0\.1|localhost)"), lambda route: route.abort())
    try:
        page.goto(sys.argv[1], wait_until="domcontentloaded")
        field = page.locator("#email")
        if field.is_visible(timeout=10000):
            field.fill(email)
            if page.locator("#btnNext").is_visible():
                page.locator("#btnNext").click()
            page.locator("#password").fill(password)
            page.locator("#btnLogin").click()
        button = page.locator("button#payment-submit-btn, button[data-id='payment-submit-btn'], button:has-text('Complete Purchase'), button:has-text('Pay Now'), button:has-text('Continue')").first
        button.wait_for(timeout=40000)
        button.click()
        page.wait_for_timeout(8000)
        print("clicked approve")
    except PlaywrightTimeout:
        (ROOT / ".scratch").mkdir(exist_ok=True)
        page.screenshot(path=str(ROOT / ".scratch" / "approve-failed.png"))
        print("approve button not reached, screenshot in .scratch/approve-failed.png")
        sys.exit(2)
    finally:
        browser.close()
