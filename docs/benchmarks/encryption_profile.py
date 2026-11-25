"""Collect paired release timings and plot them at the SDK's pre-transmit boundary."""

import json
import math
import subprocess
from collections import Counter, deque
from itertools import groupby
from statistics import median
from time import monotonic

import matplotlib.pyplot as plt


WORKLOADS = {4096: ("4 KiB", "µs", 1_000), 8 * 1024**2: ("8 MiB", "ms", 1_000_000)}
MODES = (("plain_samples_ns", "Plain", "#216681"), ("samples_ns", "Encrypted", "#A84024"))
MARKER = "BROWS3_ENCRYPTION_NS "


def checked_results(rows):
    by_size = {}
    for row in rows:
        size = row["bytes"]
        if size in by_size:
            raise ValueError(f"Duplicate timing record for {size} bytes")
        for key, mode, _ in MODES:
            values = row[key]
            if len(values) != 21 or any(type(n) is not int or n <= 0 for n in values):
                raise ValueError(f"Expected 21 positive nanosecond samples for {size} bytes, {mode}")
        by_size[size] = row
    if by_size.keys() != WORKLOADS.keys():
        raise ValueError(f"Expected payload sizes {list(WORKLOADS)}, got {list(by_size)}")
    return by_size


def fresh_results(root):
    command = [
        "cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--release",
        "--lib", "profile_encryption_before_wire", "--", "--ignored", "--nocapture",
        "--test-threads=1",
    ]
    print("Running the release benchmark. The first build can take several minutes.", flush=True)
    records, tail = [], deque(maxlen=18)
    start = last_update = monotonic()
    with subprocess.Popen(command, cwd=root, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, text=True) as process:
        for line in process.stdout:
            tail.append(line.rstrip())
            if MARKER in line:
                records.append(json.loads(line.split(MARKER, 1)[1]))
            elif monotonic() - last_update >= 15:
                print(f"{monotonic() - start:.0f}s  {line.strip()}", flush=True)
                last_update = monotonic()
        if process.wait():
            raise RuntimeError("Cargo benchmark failed.\n" + "\n".join(tail))
    return checked_results(records)


def nearest_rank_p95(values):
    return sorted(values)[math.ceil(0.95 * len(values)) - 1]


def paired_figure(runs):
    fig, axes = plt.subplots(len(runs), len(WORKLOADS), squeeze=False, sharey="col",
                             figsize=(9, 0.8 + 3.4 * len(runs)), layout="constrained")
    for row, (run_name, records) in enumerate(runs.items()):
        for col, (size, (label, unit, divisor)) in enumerate(WORKLOADS.items()):
            ax = axes[row, col]
            data = records[size]
            plain, encrypted = ([n / divisor for n in data[key]] for key, _, _ in MODES)
            for left, right in zip(plain, encrypted):
                ax.plot([0, 1], [left, right], color="#C3CDD1", linewidth=0.85, zorder=1)
            for x, (points, (_, _, color)) in enumerate(zip([plain, encrypted], MODES)):
                center = median(points)
                ax.scatter([x] * len(points), points, s=26, c=color, alpha=0.55,
                           edgecolors="white", linewidths=0.4, zorder=2)
                ax.scatter(x, center, marker="D", s=78, c=color, edgecolors="white", zorder=3)
                ax.annotate(f"{center:.3g} {unit}", (x, center),
                            xytext=(-9 if x == 0 else 9, 0), textcoords="offset points",
                            ha="right" if x == 0 else "left", va="center",
                            color=color, fontsize=10, fontweight="bold")
            ax.set(title=f"{run_name} · {label}", ylabel=f"Time before transmit ({unit})",
                   xticks=[0, 1], xticklabels=["Plain", "Encrypted"], xlim=(-0.48, 1.48))
            ax.set_ylim(bottom=0)
            ax.set_axisbelow(True)
            ax.grid(axis="y", color="#DFE5E8", linewidth=0.8)
            ax.spines[["top", "right", "left"]].set_visible(False)
            ax.spines["bottom"].set_color("#ABB7BC")
            ax.tick_params(length=0, pad=5)
    return fig


def read_cpu_stacks(path):
    """Read pprof's weighted, leaf-first stack listing from a capture."""
    import gzip
    import re

    with gzip.open(path, "rt") as stream:
        blocks = re.split(r"^-+\+-+$", stream.read(), flags=re.MULTILINE)
    stacks = []
    for block in blocks[1:]:
        lines = block.strip().splitlines()
        if not lines:
            continue
        count, leaf = lines[0].split(maxsplit=1)
        frames = [leaf, *(line.strip() for line in lines[1:])]
        stacks.append((int(count), tuple(frame.removesuffix(" (inline)") for frame in frames)))
    if not stacks or any(n <= 0 for n, _ in stacks):
        raise ValueError(f"Expected positive CPU sample counts in {path}")
    return stacks


def collect_cpu_profiles(directory):
    return {(size, mode): read_cpu_stacks(directory / f"{size}-{mode}.stacks.gz")
            for size in ("4kib", "8mib") for mode in ("plain", "encrypted")}


def short_symbol(symbol, limit=42):
    name = symbol.replace("brows3_lib::", "").replace("::<>", "").replace("{closure#0}", "closure")
    return name if len(name) <= limit else "…" + name[-(limit - 1):]


def cpu_hotspots(profiles):
    fig, axes = plt.subplots(2, 2, figsize=(12, 6.8), layout="constrained", sharex=True)
    colors = {"plain": "#236880", "encrypted": "#AA472A"}
    for row, (size, label) in enumerate((("4kib", "4 KiB"), ("8mib", "8 MiB"))):
        for col, mode in enumerate(colors):
            ax = axes[row, col]
            leaves = Counter()
            for count, stack in profiles[size, mode]:
                leaves[stack[0]] += count
            total = leaves.total()
            top = leaves.most_common(5)
            for y, (name, count) in enumerate(top):
                pct = 100 * count / total
                ax.barh(y, pct, color=colors[mode], height=0.25, align="edge")
                ax.text(0, y - 0.08, short_symbol(name, 53), fontsize=8.5, va="bottom")
                ax.text(pct + 1.1, y + 0.12, f"{pct:.1f}%", fontsize=8, va="center")
            ax.set(ylim=(len(top) - 0.42, -0.73), xlim=(0, 104), yticks=[],
                   xticks=[0, 25, 50, 75, 100])
            ax.set_title(f"{label}  ·  {mode.capitalize()}  ·  {total:,} samples", loc="left",
                         fontsize=12, fontweight="bold", color=colors[mode])
            ax.grid(axis="x", color="#DCE4E7", lw=0.65)
            ax.set_axisbelow(True)
            ax.spines[:].set_visible(False)
            ax.tick_params(length=0, labelsize=8)
            if row == 1:
                ax.set_xlabel("Share of on-CPU samples (%)", fontsize=9)
    return fig


def cpu_callers(stacks, title, levels=5):
    """Draw a leaf-first flame graph. Each nested block represents one caller."""
    from matplotlib.patches import Rectangle

    paths = Counter()
    for count, stack in stacks:
        paths[stack[:levels]] += count
    total = paths.total()
    colors = ("#164D65", "#1D6474", "#317D80", "#4D8C81", "#649384")
    fig, ax = plt.subplots(figsize=(12, 3.25), layout="constrained")
    ordered = sorted(paths.items())
    for depth in range(levels):
        x = 0
        for prefix, entries in groupby(ordered, lambda pair: pair[0][:depth + 1]):
            width = 100 * sum(count for _, count in entries) / total
            if len(prefix) > depth:
                ax.add_patch(Rectangle((x, depth - 0.435), width, 0.87, facecolor=colors[depth],
                                       edgecolor="white", linewidth=0.55))
                capacity = int(width * 1.45)
                if capacity >= 8:
                    ax.text(x + width / 2, depth, short_symbol(prefix[-1], capacity),
                            ha="center", va="center", color="white", fontsize=8)
            x += width
    ax.set(xlim=(0, 100), ylim=(levels - 0.45, -0.54), yticks=list(range(levels)),
           yticklabels=["Sampled function", *[f"Caller {i}" for i in range(1, levels)]],
           xlabel="Share of on-CPU samples (%)")
    ax.set_title(title, loc="left", fontsize=12, fontweight="bold")
    ax.spines[:].set_visible(False)
    ax.tick_params(length=0, labelsize=9)
    return fig
