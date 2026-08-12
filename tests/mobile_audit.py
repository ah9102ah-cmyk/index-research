# -*- coding: utf-8 -*-
"""Mobile-viewport layout audit for the HS300 strategy page (390x844 iPhone)."""
import json, sys
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:8765/hs300/'
VIEWPORTS = [(390, 844), (375, 667), (430, 932)]

def audit(pw, w, h):
    b = pw.chromium.launch(channel='msedge', headless=True)
    pg = b.new_page(viewport={'width': w, 'height': h})
    js_errors = []
    pg.on('pageerror', lambda e: js_errors.append(str(e)))
    pg.goto(URL, wait_until='domcontentloaded', timeout=30000)
    pg.wait_for_timeout(9000)  # wait for ledger fetch
    # force-show dashboard if still hidden (fetch may be slow)
    pg.evaluate("() => { const d = document.getElementById('dashboard'); if (d) d.hidden = false; }")
    pg.wait_for_timeout(500)
    res = pg.evaluate("""() => {
      const d = document.documentElement;
      const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return {w: Math.round(r.width), right: Math.round(r.right), left: Math.round(r.left)}; };
      const over = [];
      document.querySelectorAll('body *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > window.innerWidth + 1) {
          const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.split(' ').slice(0,2).join('.') : el.tagName.toLowerCase();
          over.push(cls + ' right=' + Math.round(r.right));
        }
      });
      const tw = document.querySelector('.table-wrap');
      return {
        innerWidth: window.innerWidth,
        docScrollWidth: d.scrollWidth,
        overflowX: d.scrollWidth > window.innerWidth,
        bodyOverflowRight: document.body.scrollWidth > window.innerWidth,
        overCount: over.length,
        overSamples: over.slice(0, 12),
        ruleStrip: vis(document.querySelector('.rule-strip')),
        summaryGrid: vis(document.querySelector('.summary-grid')),
        fundMarket: vis(document.querySelector('.fund-market')),
        resultCard: vis(document.querySelector('.result-card')),
        buyForm: vis(document.querySelector('#buy-form')),
        historyHead: vis(document.querySelector('.history-head')),
        tableWrap: vis(document.querySelector('.table-wrap')),
        tableScroll: tw ? {client: tw.clientWidth, scroll: tw.scrollWidth, overflowX: tw.scrollWidth > tw.clientWidth} : null,
        hero: vis(document.querySelector('.strategy-hero')),
        reviewStamp: vis(document.querySelector('.review-stamp')),
        dashboardShown: !document.getElementById('dashboard').hidden,
        jsErrors: window.__auditJsErrors || []
      };
    }""")
    res['jsErrors'] = js_errors
    b.close()
    return res

with sync_playwright() as pw:
    for w, h in VIEWPORTS:
        try:
            r = audit(pw, w, h)
            print(f'=== viewport {w}x{h} ===')
            print(json.dumps(r, ensure_ascii=False, indent=1))
        except Exception as e:
            print(f'=== viewport {w}x{h} FAILED: {e} ===')
