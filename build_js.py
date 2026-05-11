#!/usr/bin/env python3
"""
Concatenates JS source modules from static/js/src/ into static/js/builder.js.
Run after editing any source file: python3 build_js.py
"""
import os

SRC_DIR = os.path.join('static', 'js', 'src')
OUTPUT = os.path.join('static', 'js', 'builder.js')

# Files in load order — the IIFE opens in core.js and closes in init.js
FILE_ORDER = [
    'core.js',        # IIFE open, shared state, utilities
    'ui.js',          # Theme, sidebar, tabs, mesh background, dashboard
    'findings.js',    # Findings table, detail pane, form, batch, drag-drop
    'export.js',      # Report HTML builder, PDF, CSV, JSON, autosave
    'wizi.js',        # Wizi API integration, import functions, bulk import
    'init.js',        # Final initialization, event wiring, IIFE close
]

parts = []
for fname in FILE_ORDER:
    path = os.path.join(SRC_DIR, fname)
    if not os.path.exists(path):
        print(f"ERROR: {path} not found!")
        exit(1)
    with open(path, 'r', encoding='utf-8') as f:
        parts.append(f"// ═══════════════════════════════════════════\n// SOURCE: {fname}\n// ═══════════════════════════════════════════\n")
        parts.append(f.read())
        parts.append('\n\n')

output = ''.join(parts)

with open(OUTPUT, 'w', encoding='utf-8') as f:
    f.write(output)

print(f"Built {OUTPUT} ({len(output)} chars) from {len(FILE_ORDER)} source files.")
