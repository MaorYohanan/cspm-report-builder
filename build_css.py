#!/usr/bin/env python3
"""
Concatenates CSS source modules from static/css/src/ into static/css/builder.css.
Run after editing any source file: python3 build_css.py
"""
import os

SRC_DIR = os.path.join('static', 'css', 'src')
OUTPUT = os.path.join('static', 'css', 'builder.css')

FILE_ORDER = [
    'base.css',        # Variables, font import, scrollbars
    'layout.css',      # App shell, sidebar, main content area
    'dashboard.css',   # Dashboard KPIs, charts, cards
    'findings.css',    # Master-detail layout, list items, detail pane
    'components.css',  # Tabs, inputs, buttons, tables, severity chips, forms
    'wizi.css',        # Wizi styles, bulk import, progress bars, modals
    'theme.css',       # Light theme overrides
]

parts = []
for fname in FILE_ORDER:
    path = os.path.join(SRC_DIR, fname)
    if not os.path.exists(path):
        print(f"ERROR: {path} not found!")
        exit(1)
    with open(path, 'r', encoding='utf-8') as f:
        parts.append(f.read())
        parts.append('\n')

output = ''.join(parts)

with open(OUTPUT, 'w', encoding='utf-8') as f:
    f.write(output)

print(f"Built {OUTPUT} ({len(output)} chars) from {len(FILE_ORDER)} source files.")
