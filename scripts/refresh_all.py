"""Run a full data refresh from the terminal (no need to wait for the 15-min scheduler).

Usage (from repo root, venv active):
    python scripts/refresh_all.py
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.main import FETCHERS  # noqa: E402

print("Starting full refresh...")
for fn in FETCHERS:
    print(f"  {fn.__name__}...", end=" ", flush=True)
    result = fn()
    print(f"done ({result} updated)" if result is not None else "done")

print("Refresh complete — reload the frontend.")
