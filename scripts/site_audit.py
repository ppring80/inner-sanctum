#!/usr/bin/env python3
"""
The Inner Sanctum — Site Consistency Audit

Scans every page-level .html file in a directory for the specific bug
patterns already found in manual review: duplicate page content (the
compare.html/sanctum.html bug), nav-dropdown labels drifting out of
sync with a page's real title, missing Meta Pixel, paywall/tier
inconsistencies, and non-responsive fixed-px header CSS.

Usage:
    python3 site_audit.py <directory containing .html files>

Exit code 0 = clean, 1 = issues found (so this can gate a CI job).
"""
import os, re, sys, hashlib, html

# test*.html files are scratch/dev pages, not real site pages — skip them
SKIP_PREFIXES = ('test',)

def load_pages(directory):
    pages = {}
    for fname in os.listdir(directory):
        if fname.endswith('.html') and not fname.lower().startswith(SKIP_PREFIXES):
            with open(os.path.join(directory, fname), encoding='utf-8') as f:
                pages[fname] = f.read()
    return pages

def clean(s):
    if not s: return s
    s = html.unescape(s)
    s = re.sub(r'[^\w\s&-]', '', s)
    s = s.replace('-', ' ')
    return re.sub(r'\s+', ' ', s).strip().lower()

def get_page_identity(fname, content):
    for pattern in [
        r'class="hdr-title">([^<]*)</(?:h1|div)>',
        r'<div class="hdr-title">([^<]*)</div>',
        r'<h1 class="hdr-title">([^<]*)</h1>',
        r'<h1>([^<]*)</h1>',
    ]:
        m = re.search(pattern, content)
        if m and m.group(1).strip():
            return m.group(1).strip()
    return None

def main():
    directory = sys.argv[1] if len(sys.argv) > 1 else '.'
    pages = load_pages(directory)
    issues = []

    # ── CHECK 1: Duplicate content across pages that should be distinct ──
    hashes = {}
    for fname, content in pages.items():
        body = re.search(r'<body>(.*)</body>', content, re.S)
        body_text = body.group(1) if body else content
        h = hashlib.md5(re.sub(r'\s+', '', body_text).encode()).hexdigest()
        hashes.setdefault(h, []).append(fname)
    for h, fnames in hashes.items():
        if len(fnames) > 1:
            issues.append(('DUPLICATE CONTENT', f"{', '.join(fnames)} have byte-identical <body> content — likely a copy-paste error"))

    page_titles = {}
    for fname, content in pages.items():
        identity = get_page_identity(fname, content)
        if identity:
            slug = '/' + fname.replace('.html', '')
            if slug == '/index': slug = '/'
            page_titles[slug] = identity

    # ── CHECK 2: <title> tag vs on-page header ──
    for fname, content in pages.items():
        title_m = re.search(r'<title>(.*?)</title>', content, re.S)
        identity = get_page_identity(fname, content)
        if title_m and identity:
            title_core = re.split(r'\s+[—-]\s+', title_m.group(1))[0]
            t = clean(title_core)
            h = clean(identity)
            t_words = set(t.split()) - {'the', 'inner', 'sanctum'}
            h_words = set(h.split()) - {'the', 'inner', 'sanctum'}
            if t_words and h_words and not (t_words & h_words):
                issues.append(('TITLE MISMATCH', f"{fname}: <title> says '{title_m.group(1)}' but on-page header says '{identity}'"))

    # ── CHECK 3: nav-dropdown-menu link labels specifically ──
    nav_menu_blocks = []
    for fname, content in pages.items():
        for block in re.findall(r'<div class="nav-dropdown-menu">(.*?)</div>', content, re.S):
            nav_menu_blocks.append((fname, block))
    label_variants = {}
    link_re = re.compile(r'<a href="(/[a-z-]*)">([^<]*)</a>')
    for fname, block in nav_menu_blocks:
        for href, label in link_re.findall(block):
            label_variants.setdefault(href, {}).setdefault(clean(label), set()).add(fname)

    for href, variants in label_variants.items():
        if len(variants) > 1:
            detail = '; '.join(f"'{v}' (in {', '.join(sorted(fnames))})" for v, fnames in variants.items())
            issues.append(('INCONSISTENT NAV LABEL', f"{href} is labeled differently across pages: {detail}"))
        real_title = page_titles.get(href)
        if real_title:
            real_words = set(clean(real_title).split()) - {'the'}
            for v in variants:
                v_words = set(v.split()) - {'the'}
                if v_words and real_words and not (v_words <= real_words or real_words <= v_words):
                    issues.append(('NAV LABEL VS REAL TITLE', f"{href} nav dropdown says '{v}' but its actual page title is '{real_title}'"))

    # ── CHECK 4: Meta Pixel presence ──
    for fname, content in pages.items():
        if fname == 'join.html':
            pass  # still expected to have it, don't skip
        if "fbq('init', '1748852649483750')" not in content:
            issues.append(('MISSING META PIXEL', f"{fname} does not have the Meta Pixel base code"))

    # ── CHECK 5: paywall gate presence vs. homepage's stated free/acolyte badge ──
    # NOTE: known limitation — only recognizes the standard `.gate-overlay`
    # hard-paywall pattern. sanctum.html's gate has a "Continue as free
    # Apprentice" skip button (soft upsell, not a real paywall) and
    # risers-fallers.html gates its full list via a differently-named
    # `paywallArea` div — both are correctly excluded below so they don't
    # false-positive.
    index_content = pages.get('index.html', '')
    tool_badges = {}
    for m in re.finditer(r'tool-name">([^<]*)</div>\s*<span class="tool-badge (\w+)"', index_content):
        tool_badges[clean(m.group(1))] = m.group(2)
    SOFT_GATE_PAGES = {'sanctum.html'}
    ALT_GATE_PAGES = {'risers-fallers.html': 'paywallArea'}
    for fname, content in pages.items():
        if fname == 'index.html' or fname in SOFT_GATE_PAGES:
            continue
        has_gate = 'gate-overlay' in content
        if fname in ALT_GATE_PAGES:
            has_gate = ALT_GATE_PAGES[fname] in content
        identity = get_page_identity(fname, content)
        if not identity: continue
        id_words = set(clean(identity).split())
        for tool_name, badge in tool_badges.items():
            tool_words = set(tool_name.split())
            if tool_words & id_words and len(tool_words & id_words) >= min(2, len(tool_words)):
                if badge == 'acolyte' and not has_gate:
                    issues.append(('PAYWALL MISMATCH', f"{fname} ('{identity}') is listed as Acolyte-only on homepage but has NO paywall gate"))
                if badge == 'free' and has_gate:
                    issues.append(('PAYWALL MISMATCH', f"{fname} ('{identity}') is listed as Free on homepage but HAS a paywall gate"))
                break

    # ── CHECK 6: fixed-px header font-sizes instead of clamp() ──
    for fname, content in pages.items():
        for sel in ['.hdr-title', '.hdr-brand', '.hdr-eyebrow', '.top h1', '.top-eyebrow']:
            pattern = re.escape(sel) + r'\{[^}]*font-size:\s*(\d+px)'
            m = re.search(pattern, content)
            if m:
                issues.append(('NON-RESPONSIVE HEADER', f"{fname}: {sel} uses a fixed {m.group(1)} instead of clamp()"))

    # ── CHECK 7: pages not linked from any nav menu ──
    all_slugs = set(page_titles.keys())
    linked_slugs = set()
    for fname, content in pages.items():
        linked_slugs.update(re.findall(r'href="(/[a-z-]*)"', content))
    for slug in all_slugs:
        if slug not in linked_slugs and slug != '/':
            issues.append(('ORPHANED PAGE', f"{slug} is not linked from any nav menu across the site"))

    # ── REPORT ──
    if not issues:
        print(f"✅ No issues found across {len(pages)} pages.")
        return 0

    print(f"Audited {len(pages)} pages, found {len(issues)} issue(s):\n")
    by_type = {}
    for kind, msg in issues:
        by_type.setdefault(kind, []).append(msg)
    for kind, msgs in by_type.items():
        print(f"── {kind} ({len(msgs)}) " + "─" * max(1, 40 - len(kind)))
        for m in msgs:
            print(f"  • {m}")
        print()
    return 1

if __name__ == '__main__':
    sys.exit(main())
