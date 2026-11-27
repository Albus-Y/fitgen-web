"""用连续的逆播放速度，将完整原子动作排入一个八拍。"""

import math
from numbers import Integral

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix


def solve_astra(period, events, repeats, beat_edges, rate_bounds=(0.8, 1.5)):
    """返回从组内音乐秒到展开动作秒的分段线性采样，以及优化诊断。"""
    edges = np.asarray(beat_edges, dtype=float)
    local = np.asarray(events, dtype=float)
    if (edges.shape != (9,) or not np.isfinite(edges).all()
            or edges[0] != 0 or np.any(np.diff(edges) <= 0)):
        raise ValueError("需要从零开始的九个递增拍边界")
    if (not math.isfinite(period) or period <= 0 or not isinstance(repeats, Integral)
            or isinstance(repeats, bool) or repeats <= 0):
        raise ValueError("周期和整数重复数必须为正")
    if (local.ndim != 1 or not len(local) or not np.isfinite(local).all()
            or np.any(local < 0) or np.any(local >= period) or np.any(np.diff(local) <= 0)):
        raise ValueError("轮内事件必须递增，并位于 [0, P)")
    source_end, duration = float(period * repeats), float(edges[-1])
    slow, fast = rate_bounds
    if not 0 < slow <= fast or not math.isfinite(fast):
        raise ValueError("倍率范围必须为有限的正数区间")
    window, slack = 0.1, 0.01
    if not slow - 1e-12 <= source_end / duration <= fast + 1e-12:
        raise ValueError("重复数超出全组倍率界")
    knots = np.linspace(0, source_end, int(math.ceil(source_end * 20 - 1e-10)) + 1)
    h = np.diff(knots)
    turns = np.concatenate([local + i * period for i in range(repeats)])
    size = len(knots)
    lower, upper, integer = [], [], []
    rows, cols, vals, lhs, rhs = [], [], [], [], []

    def variable(lo=0, hi=np.inf, binary=False):
        lower.append(lo)
        upper.append(hi)
        integer.append(int(binary))
        return len(lower) - 1

    def constraint(terms, lo=-np.inf, hi=np.inf):
        for col, value in terms:
            rows.append(len(lhs))
            cols.append(col)
            vals.append(value)
        lhs.append(lo)
        rhs.append(hi)

    speed = [variable(1 / fast, 1 / slow) for _ in knots]

    def integral(s):
        # 各节点线性帽函数在 [0, s] 的精确积分。
        length = np.clip(s - knots[:-1], 0, h)
        right = length ** 2 / (2 * h)
        weights = np.zeros(size)
        weights[:-1] += length - right
        weights[1:] += right
        return [(i, w) for i, w in zip(speed, weights) if w]

    constraint(integral(source_end), duration, duration)
    constraint([(speed[0], 1), (speed[-1], -1)], 0, 0)
    variations = []
    for i in range(size - 1):
        delta = variable()
        variations.append(delta)
        for sign in (-1, 1):
            constraint([(speed[i], sign), (speed[i + 1], -sign), (delta, -1)], hi=0)

    hits, errors = [], []
    beat_hits = [[] for _ in edges]
    mid = (edges[:-1] + edges[1:]) / 2
    for s in turns:
        lo = max(s / fast, duration - (source_end - s) / slow)
        hi = min(s / slow, duration - (source_end - s) / fast)
        clock = variable(lo - 1e-10, hi + 1e-10)
        constraint(integral(s) + [(clock, -1)], 0, 0)
        error = variable()
        errors.append(error)
        labels = []
        for j, b in enumerate(edges):
            if (j and mid[j - 1] > hi + 1e-10) or (j < 8 and mid[j] < lo - 1e-10):
                continue
            label = variable(0, 1, True)
            labels.append(label)
            for sign in (-1, 1):
                big = max(0, sign * (hi - b), sign * (lo - b)) + 1e-9
                constraint([(clock, sign), (error, -1), (label, big)], hi=big + sign * b)
        constraint([(j, 1) for j in labels], 1, 1)
        candidates = []
        for j, b in enumerate(edges):
            if lo - window - 1e-10 <= b <= hi + window + 1e-10:
                hit = variable(0, 1, True)
                hits.append((hit, len(errors) - 1, j))
                candidates.append(hit)
                beat_hits[j].append(hit)
                for sign in (-1, 1):
                    big = max(0, sign * (hi - b), sign * (lo - b)) + 1e-9
                    constraint([(clock, sign), (hit, big)], hi=big + sign * b + window)
        constraint([(j, 1) for j in candidates], hi=1)
    for group in beat_hits:
        constraint([(j, 1) for j in group], hi=1)
    # 在非均匀拍间隔中也保证配对顺序。
    for pos, (i, event, beat) in enumerate(hits):
        for j, later_event, later_beat in hits[pos + 1:]:
            if later_event > event and later_beat < beat:
                constraint([(i, 1), (j, 1)], hi=1)

    def optimize(terms):
        cost = np.zeros(len(lower))
        for i, w in terms:
            cost[i] = w
        matrix = coo_matrix((vals, (rows, cols)), shape=(len(lhs), len(lower))).tocsc()
        result = milp(cost, integrality=integer, bounds=Bounds(lower, upper),
                      constraints=LinearConstraint(matrix, lhs, rhs),
                      options={"mip_rel_gap": 0.0})
        if not result.success:
            raise RuntimeError(f"八拍优化未完成，HiGHS 状态 {result.status}: {result.message}")
        return result.x

    sol = optimize([(i, -1) for i, _, _ in hits])
    count = round(sum(sol[i] for i, _, _ in hits))
    constraint([(i, 1) for i, _, _ in hits], count, count)
    sol = optimize([(i, 1) for i in errors])
    best_mean = sum(sol[i] for i in errors) / len(errors)
    constraint([(i, 1) for i in errors], hi=(best_mean + slack) * len(errors))
    sol = optimize([(i, 1) for i in variations])
    variation_limit = sum(sol[i] for i in variations) + 1e-8
    constraint([(i, 1) for i in variations], hi=variation_limit)
    # 平滑程度相同时，按动作时长加权，优先接近原速。
    deviations = []
    for i, weight in integral(source_end):
        deviation = variable()
        constraint([(i, 1), (deviation, -1)], hi=1)
        constraint([(i, -1), (deviation, -1)], hi=-1)
        deviations.append((deviation, weight))
    sol = optimize(deviations)
    inverse = sol[speed]
    music_knots = np.r_[0, np.cumsum(h * (inverse[:-1] + inverse[1:]) / 2)]

    def music_at(s):
        index = np.clip(np.searchsorted(knots, s, side="right") - 1, 0, size - 2)
        d = s - knots[index]
        return (music_knots[index] + d * inverse[index]
                + d ** 2 * (inverse[index + 1] - inverse[index]) / (2 * h[index]))

    # 对线性逆速度作二次积分，弦插值的误差上界为 |u'| ds²/8。
    pieces = []
    for i, width in enumerate(h):
        curvature = abs(inverse[i + 1] - inverse[i]) / width
        divisions = max(1, math.ceil(width * max(inverse[i:i + 2]) * 200),
                        math.ceil(width * math.sqrt(curvature * fast / (8 * 0.00009))))
        pieces.append(np.linspace(knots[i], knots[i + 1], divisions, endpoint=False))
    source = np.r_[np.concatenate(pieces), source_end]
    music = music_at(source)
    music[0], music[-1] = 0, duration
    rates = np.diff(source) / np.diff(music)
    if np.any(rates < slow - 1e-7) or np.any(rates > fast + 1e-7):
        raise RuntimeError("输出映射倍率核验失败")
    observed = music_at(turns)
    nearest = np.abs(observed[:, None] - edges).min(axis=1)
    matches = [{"eventIndex": e, "beatIndex": j, "errorSec": float(observed[e] - edges[j])}
               for i, e, j in hits if sol[i] > 0.5]
    if any(abs(pair["errorSec"]) > window + 1e-7 for pair in matches):
        raise RuntimeError("配对残差核验失败")
    return {"musicTimes": music.tolist(), "sourceTimes": source.tolist(), "diagnostics": {
        "method": "分段线性逆速度积分，HiGHS 四阶段混合整数线性规划",
        "status": "optimal", "matches": matches, "hitCount": count,
        "eventCount": len(turns), "eventMusicTimes": observed.tolist(),
        "nearestErrorsSec": nearest.tolist(), "meanErrorSec": float(nearest.mean()),
        "minimumMeanErrorSec": float(best_mean), "hitWindowSec": window,
        "meanToleranceSec": slack, "averageRate": source_end / duration,
        "rateRange": [float(1 / inverse.max()), float(1 / inverse.min())],
        "inverseSpeedVariation": float(np.abs(np.diff(inverse)).sum()),
        "sourceKnots": knots.tolist(), "inverseSpeedKnots": inverse.tolist(),
    }}
