#!/usr/bin/env python3
"""
MicroWatch-LDIR · demo data generator
--------------------------------------
Deterministically generates simulated LDIR particle records that reproduce the
reference statistics stated in the design brief:

  Site1: total 96   · targets 7   · HQI>=0.75 -> 5  · >=20um & >=0.75 -> 5  · mean HQI 0.843 · median(target) 26.46 · median(filtered) 22.57
  Site2: total 138  · targets 34  · HQI>=0.75 -> 14 · >=20um & >=0.75 -> 14 · mean HQI 0.813 · median(target) 40.19
  Site3: total 498  · targets 311 · HQI>=0.75 -> 23 · >=20um & >=0.75 -> 17 · mean HQI 0.705 · median(target) 23.69
  Site4: total 664  · targets 340 · HQI>=0.75 -> 27 · >=20um & >=0.75 -> 24 · mean HQI 0.711 · median(target) 22.01
  all-particle HQI>=0.75 counts: 85/100/121/193 (88.5%/72.5%/24.3%/29.1%)
  all-particle HQI>=0.85 counts: 57/63/58/111
  sweep (no size limit) >=0.70: 6/24/86/74 ; >=0.80: 5/10/5/19
  review-category counts: 4/4/9/67
Output: js/demo-data.js  (MW.DEMO_DATA)
"""
import json
import math
import os
import random
import sys

rng = random.Random(20261102)

REVIEW = ['Rubber', 'Silicone', 'Acrylates', 'Alkyd Varnish', 'Polyether', 'Cellulose Acetate']
NT_KEYS = ['Cellulosic', 'Natural Polyamide', 'Chitin', 'Silica']
NT_WEIGHTS = [0.42, 0.24, 0.14, 0.20]


def expand(comp):
    out = []
    for k, n in comp.items():
        out += [k] * n
    rng.shuffle(out)
    return out


def band(n, lo, hi, skew=1.0):
    vals = []
    for i in range(n):
        q = (i + 0.5) / n
        v = lo + (hi - lo) * (q ** skew)
        v += rng.uniform(-0.004, 0.004)
        vals.append(min(hi, max(lo, v)))
    rng.shuffle(vals)
    return vals


def geom_span(n, lo, hi, skew=0.85):
    out = []
    for i in range(n):
        q = (i + 0.5) / n
        v = lo * (hi / lo) ** (q ** skew)
        out.append(min(hi, max(lo, v)))
    rng.shuffle(out)
    return out


def fit_sum(vals, target, bounds):
    """Water-filling so sum(vals) == target, each value kept in its own bounds[i]."""
    vals = list(vals)
    for _ in range(300):
        delta = target - sum(vals)
        if abs(delta) < 1e-9:
            return vals
        if delta > 0:
            caps = [(hi - v) if (hi - v) > 1e-12 else 0.0 for (_, hi), v in zip(bounds, vals)]
            tot = sum(caps)
            if tot < abs(delta) - 1e-6:
                raise ValueError('infeasible: cannot raise sum to %f' % target)
            vals = [v + delta * (c / tot) for v, c in zip(vals, caps)]
        else:
            caps = [(v - lo) if (v - lo) > 1e-12 else 0.0 for (lo, _), v in zip(bounds, vals)]
            tot = sum(caps)
            if tot < abs(delta) - 1e-6:
                raise ValueError('infeasible: cannot lower sum to %f' % target)
            vals = [v + delta * (c / tot) for v, c in zip(vals, caps)]
        vals = [min(b[1], max(b[0], v)) for v, b in zip(vals, bounds)]
    raise ValueError('fit_sum did not converge')


def snap3(vals, target_sum, bounds):
    """Round to 3 decimals then fix the residual in 0.001 steps (integer milli-units)."""
    out = [round(v, 3) for v in vals]
    resid = int(round(target_sum * 1000)) - int(round(sum(out) * 1000))
    step = 1 if resid > 0 else -1
    i, n, guard = 0, len(out), 0
    while resid != 0:
        idx = i % n
        lo, hi = bounds[idx]
        nv = round(out[idx] + step * 0.001, 3)
        if lo <= nv <= hi:
            out[idx] = nv
            resid -= step
        i += 1
        guard += 1
        if guard > 400000:
            raise ValueError('snap3 failed, residual %d milli-units' % resid)
    return out


def shapes(diam, ident):
    """Length / width / area consistent with the diameter."""
    elong = ident in ('Cellulosic', 'Chitin', 'Natural Polyamide', 'Alkyd Varnish', 'Polyether')
    if elong:
        aspect = 1.3 + rng.random() ** 0.8 * 3.2
    else:
        aspect = 1.02 + rng.random() ** 1.6 * 1.5
    length = diam * math.sqrt(aspect)
    width = diam / math.sqrt(aspect)
    area = math.pi / 4 * diam * diam * (0.82 + 0.17 * rng.random())
    return length, width, area


SITES = {
    'Site1': dict(
        raw='Site1', total=96, mean_hqi=0.843, all_ge75=85, all_ge85=57,
        target_comp={'PA': 2, 'PTFE': 2, 'PE': 1, 'PP': 1, 'PVC': 1},
        filtered_comp={'PA': 1, 'PTFE': 1, 'PE': 1, 'PP': 1, 'PVC': 1},
        review=4,
        target_hqi=[0.91, 0.88, 0.86, 0.83, 0.81, 0.72, 0.66],
        filtered_diam=[20.8, 21.9, 22.57, 28.9, 31.2],
        unfiltered_diam=[26.46, 35.4],
        pool_bands=[(54, 0.852, 0.948), (26, 0.752, 0.845), (9, 0.55, 0.744)],
        nt_diam=(20.2, 120.0, 0.0),
    ),
    'Site2': dict(
        raw='Site2', total=138, mean_hqi=0.813, all_ge75=100, all_ge85=63,
        target_comp={'PE': 9, 'PP': 7, 'PA': 6, 'PTFE': 4, 'PET': 3, 'PVC': 2, 'PU': 1, 'EVA': 1, 'PMMA': 1},
        filtered_comp={'PE': 4, 'PP': 3, 'PA': 2, 'PTFE': 2, 'PET': 1, 'PVC': 1, 'PU': 1},
        review=4,
        target_hqi_bands=[(5, 0.852, 0.918), (5, 0.802, 0.845), (4, 0.752, 0.795), (10, 0.702, 0.745), (10, 0.55, 0.688)],
        diam_median=(39.80, 40.58),
        n_below=16, n_above=16,
        n_filtered_below=6, n_filtered_above=8,
        n_small_filtered=0,
        below_small_count=0,
        diam_range=(20.3, 96.0), above_range=(40.9, 96.0),
        below_range=(20.3, 39.55),
        pool_bands=[(58, 0.852, 0.948), (28, 0.752, 0.845), (18, 0.58, 0.744)],
        nt_diam=(20.4, 130.0, 0.0),
    ),
    'Site3': dict(
        raw='Site 3', total=498, mean_hqi=0.705, all_ge75=121, all_ge85=58,
        target_comp={'PE': 78, 'PP': 64, 'PA': 52, 'PET': 39, 'PVC': 28, 'PTFE': 18, 'HDPE': 12, 'PU': 8, 'EVA': 6, 'PMMA': 4, 'Polyacetal': 2},
        filtered_comp={'PE': 6, 'PP': 5, 'PA': 4, 'PET': 3, 'PVC': 2, 'PTFE': 1, 'HDPE': 1, 'PU': 1},
        n_small_filtered=6,
        review=9,
        target_hqi_bands=[(2, 0.852, 0.898), (3, 0.802, 0.845), (18, 0.752, 0.795), (63, 0.702, 0.745), (225, 0.62, 0.697)],
        median_value=23.69,
        n_below=155, n_above=155,
        n_filtered_below=13,
        n_filtered_above=10,
        below_small_count=60,
        below_range=(10.2, 23.55),
        above_range=(23.85, 170.0),
        pool_bands=[(56, 0.852, 0.948), (42, 0.752, 0.845), (89, 0.58, 0.744)],
        nt_diam=(10.3, 160.0, 0.45),
    ),
    'Site4': dict(
        raw='Site 4', total=664, mean_hqi=0.711, all_ge75=193, all_ge85=111,
        target_comp={'PE': 82, 'PP': 70, 'PA': 55, 'PET': 42, 'PVC': 33, 'PTFE': 20, 'HDPE': 14, 'PU': 9, 'EVA': 7, 'PMMA': 5, 'Polyacetal': 3},
        filtered_comp={'PE': 8, 'PP': 6, 'PA': 5, 'PET': 3, 'PVC': 2, 'PTFE': 1, 'HDPE': 1, 'PU': 1},
        n_small_filtered=3,
        review=67,
        target_hqi_bands=[(8, 0.852, 0.918), (11, 0.802, 0.845), (8, 0.752, 0.795), (47, 0.702, 0.745), (266, 0.62, 0.697)],
        diam_median=(21.80, 22.22),
        n_below=169, n_above=169,
        n_filtered_below=11,
        n_filtered_above=16,
        below_small_count=85,
        below_range=(10.1, 21.7),
        above_range=(22.4, 185.0),
        pool_bands=[(103, 0.852, 0.948), (63, 0.752, 0.845), (158, 0.58, 0.744)],
        nt_diam=(10.1, 170.0, 0.40),
    ),
}


def build_targets(site, cfg):
    polys = expand(cfg['target_comp'])
    n = len(polys)
    filt_polys = expand(cfg['filtered_comp'])
    nf = len(filt_polys)

    # --- HQI values for filtered / non-filtered targets (3-decimal grid) ---
    if 'target_hqi' in cfg:
        hqis = sorted([round(v, 3) for v in cfg['target_hqi']], reverse=True)
        filt_hqis = hqis[:nf]
        nf_hqis = hqis[nf:]
        rng.shuffle(filt_hqis)
        rng.shuffle(nf_hqis)
    else:
        filt_hqis, nf_hqis = [], []
        got = 0
        for cnt, lo, hi in cfg['target_hqi_bands']:
            vs = [round(v, 3) for v in band(cnt, lo, hi)]
            if got < nf:
                take = min(cnt, nf - got)
                filt_hqis += vs[:take]
                nf_hqis += vs[take:]
                got += take
            else:
                nf_hqis += vs
        assert got == nf
    rng.shuffle(filt_hqis)
    rng.shuffle(nf_hqis)

    # --- choose which records are filtered (polymer-constrained) ---
    need = dict(cfg['filtered_comp'])
    order = list(range(n))
    rng.shuffle(order)
    filtered_idx = set()
    for idx in order:
        p = polys[idx]
        if need.get(p, 0) > 0:
            filtered_idx.add(idx)
            need[p] -= 1
        if len(filtered_idx) == nf:
            break
    assert len(filtered_idx) == nf, site

    target_hqi = [None] * n
    fi = ni = 0
    for i in range(n):
        if i in filtered_idx:
            target_hqi[i] = filt_hqis[fi]; fi += 1
        else:
            target_hqi[i] = nf_hqis[ni]; ni += 1

    # --- diameters ---
    diams = [None] * n
    if 'filtered_diam' in cfg:                                   # Site1 (explicit)
        sorted_by_hqi = sorted(range(n), key=lambda i: target_hqi[i])
        f_sorted = [i for i in sorted_by_hqi if i in filtered_idx]
        u_sorted = [i for i in sorted_by_hqi if i not in filtered_idx]
        for i, d in zip(f_sorted, sorted(cfg['filtered_diam'])):
            diams[i] = d
        for i, d in zip(u_sorted, sorted(cfg['unfiltered_diam'])):
            diams[i] = d
    elif 'median_value' in cfg:                                  # odd count (Site3)
        m = cfg['median_value']
        nb, na = cfg['n_below'], cfg['n_above']
        n_small = cfg['below_small_count']
        below = [round(rng.uniform(cfg['below_range'][0], 19.9), 2) for _ in range(n_small)]
        below += [round(rng.uniform(20.1, cfg['below_range'][1]), 2) for _ in range(nb - n_small)]
        rng.shuffle(below)
        above = list(geom_span(na, cfg['above_range'][0], cfg['above_range'][1]))
        rng.shuffle(above)
        below.sort()
        filt_idx = sorted(filtered_idx)
        small_f = filt_idx[:cfg['n_small_filtered']]
        rest_f = [i for i in filt_idx if i not in small_f]
        rng.shuffle(rest_f)
        nf_idx = [i for i in range(n) if i not in filtered_idx]
        rng.shuffle(nf_idx)
        # filtered small particles get the smallest diameters
        for i in small_f:
            diams[i] = below.pop(0)
        # remaining filtered-below get values just under the median (take from top of below pool)
        n_f_below_rest = cfg['n_filtered_below'] - cfg['n_small_filtered']
        for i in rest_f[:n_f_below_rest]:
            diams[i] = below.pop()
        # filtered-above: the NEXT filtered records after the below-assigned ones
        for i in rest_f[n_f_below_rest:n_f_below_rest + cfg['n_filtered_above']]:
            diams[i] = above.pop()
        # median itself is a non-filtered target
        median_owner = nf_idx.pop()
        # non-filtered: fill from below pool first, then above
        for i in nf_idx:
            if below:
                diams[i] = below.pop()
            else:
                diams[i] = above.pop()
        diams[median_owner] = m
        assert len(below) == 0 and len(above) == 0
        assert sum(1 for d in diams if d < m) == nb and sum(1 for d in diams if d > m) == na
    else:                                                        # even count (Site2 / Site4)
        m1, m2 = cfg['diam_median']
        nb, na = cfg['n_below'], cfg['n_above']
        n_small = cfg['below_small_count']
        below = [round(rng.uniform(cfg['below_range'][0], 19.9), 2) for _ in range(n_small)]
        below += [round(rng.uniform(max(20.05, cfg['below_range'][0]), m1 - 0.05), 2) for _ in range(nb - n_small)]
        rng.shuffle(below)
        above = list(geom_span(na, cfg['above_range'][0], cfg['above_range'][1]))
        rng.shuffle(above)
        below.sort()
        filt_idx = sorted(filtered_idx)
        small_f = filt_idx[:cfg['n_small_filtered']]
        rest_f = [i for i in filt_idx if i not in small_f]
        rng.shuffle(rest_f)
        nf_idx = [i for i in range(n) if i not in filtered_idx]
        rng.shuffle(nf_idx)
        for i in small_f:
            diams[i] = below.pop(0)
        n_f_below_rest = cfg['n_filtered_below'] - cfg['n_small_filtered']
        for i in rest_f[:n_f_below_rest]:
            diams[i] = below.pop()
        for i in rest_f[n_f_below_rest:n_f_below_rest + cfg['n_filtered_above']]:
            diams[i] = above.pop()
        owner1, owner2 = nf_idx.pop(), nf_idx.pop()
        for i in nf_idx:
            if below:
                diams[i] = below.pop()
            else:
                diams[i] = above.pop()
        diams[owner1] = m1
        diams[owner2] = m2
        assert len(below) == 0 and len(above) == 0
        assert sum(1 for d in diams if d < m1) == nb and sum(1 for d in diams if d > m2) == na

    return [dict(polymer=polys[i], hqi=target_hqi[i], diam=diams[i],
                 filtered=(i in filtered_idx)) for i in range(n)]


def build_site(site, cfg):
    targets = build_targets(site, cfg)
    n_targets = len(targets)
    pool_n = sum(b[0] for b in cfg['pool_bands'])
    assert n_targets + pool_n == cfg['total'], (site, n_targets, pool_n, cfg['total'])

    # pool HQIs fitted so the whole site matches mean_hqi exactly (0.001 grid)
    target_sum = round(sum(t['hqi'] for t in targets), 3)
    pool_target = round(round(cfg['mean_hqi'] * cfg['total'], 3) - target_sum, 3)
    pool, bounds = [], []
    for cnt, lo, hi in cfg['pool_bands']:
        vs = band(cnt, lo, hi)
        pool += vs
        bounds += [(round(lo, 3), round(hi, 3))] * cnt
    pool = fit_sum(pool, pool_target, bounds)
    pool = snap3(pool, pool_target, bounds)
    assert abs(sum(pool) - pool_target) < 1e-9

    # material labels
    review_labels = [REVIEW[(i * 2 + 1) % len(REVIEW)] for i in range(cfg['review'])]
    n_nt = pool_n - cfg['review']
    nt_labels = []
    for i in range(n_nt):
        q = (i + 0.5) / n_nt
        acc, pick = 0.0, NT_KEYS[-1]
        for k, w in zip(NT_KEYS, NT_WEIGHTS):
            acc += w
            if q <= acc:
                pick = k
                break
        nt_labels.append(pick)
    rng.shuffle(nt_labels)
    pool_labels = review_labels + nt_labels

    # pool diameters
    lo, hi, small_share = cfg['nt_diam']
    n_small = int(round(pool_n * small_share))
    dpool = [round(rng.uniform(max(10.05, lo), 19.9), 2) for _ in range(n_small)] if n_small else []
    dpool += geom_span(pool_n - len(dpool), max(20.05, lo), hi)
    rng.shuffle(dpool)

    records = []
    rid = 1
    for t in targets:
        L, W, A = shapes(t['diam'], t['polymer'])
        records.append([cfg['raw'], rid, round(t['diam'], 2), round(L, 2), round(W, 2),
                        round(A, 1), t['polymer'], round(t['hqi'], 3), True])
        rid += 1
    for lab, hqi, d in zip(pool_labels, pool, dpool):
        L, W, A = shapes(d, lab)
        records.append([cfg['raw'], rid, round(d, 2), round(L, 2), round(W, 2),
                        round(A, 1), lab, round(hqi, 3), True])
        rid += 1
    return records


# ----------------------------------------------------------------------------
EXPECTED = {
    'Site1': dict(total=96, screening=7, f75=5, f75s20=5, mean=0.843, med_t=26.46, med_f=22.57, ge70=6, ge80=5, allge75=85, allge85=57, review=4),
    'Site2': dict(total=138, screening=34, f75=14, f75s20=14, mean=0.813, med_t=40.19, ge70=24, ge80=10, allge75=100, allge85=63, review=4),
    'Site3': dict(total=498, screening=311, f75=23, f75s20=17, mean=0.705, med_t=23.69, ge70=86, ge80=5, allge75=121, allge85=58, review=9),
    'Site4': dict(total=664, screening=340, f75=27, f75s20=24, mean=0.711, med_t=22.01, ge70=74, ge80=19, allge75=193, allge85=111, review=67),
}
TARGET_SET = set(['PA', 'PTFE', 'PVC', 'PP', 'PET', 'PE', 'HDPE', 'PU', 'EVA', 'PMMA',
                  'Polyacetal', 'Polysulfone', 'Polyvinyl alcohol', 'Polyacrylamide'])
REVIEW_SET = set(REVIEW)


def median(vals):
    s = sorted(vals)
    n = len(s)
    return None if not n else (s[(n - 1) // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2)


def verify(records):
    ok = True
    for site, exp in EXPECTED.items():
        recs = [r for r in records if r[0].replace(' ', '') == site]
        total = len(recs)
        screening = [r for r in recs if r[6] in TARGET_SET and r[8]]
        f75 = [r for r in screening if r[7] >= 0.75]
        f75s20 = [r for r in f75 if r[2] >= 20]
        ge70 = [r for r in screening if r[7] >= 0.70]
        ge80 = [r for r in screening if r[7] >= 0.80]
        allge75 = [r for r in recs if r[7] >= 0.75]
        allge85 = [r for r in recs if r[7] >= 0.85]
        review_n = len([r for r in recs if r[6] in REVIEW_SET])
        mean_hqi = sum(r[7] for r in recs) / total
        med_t = median([r[2] for r in screening])
        med_f = median([r[2] for r in f75])
        checks = [
            ('total', total, exp['total']),
            ('screening', len(screening), exp['screening']),
            ('f75', len(f75), exp['f75']),
            ('f75 & >=20um', len(f75s20), exp['f75s20']),
            ('sweep>=0.70', len(ge70), exp['ge70']),
            ('sweep>=0.80', len(ge80), exp['ge80']),
            ('all>=0.75', len(allge75), exp['allge75']),
            ('all>=0.85', len(allge85), exp['allge85']),
            ('review', review_n, exp['review']),
            ('mean HQI', round(mean_hqi, 3), exp['mean']),
            ('median(target)', round(med_t, 2), exp['med_t']),
        ]
        if 'med_f' in exp:
            checks.append(('median(filtered)', round(med_f, 2), exp['med_f']))
        site_ok = True
        for name, got, want in checks:
            tol = 0.0011 if name == 'mean HQI' else 0.011
            good = abs(got - want) <= tol
            if not good:
                site_ok = ok = False
            print('  %-18s got %-8s want %-8s %s' % (name, got, want, 'OK' if good else 'FAIL'))
        print('%s %s\n' % (site, 'PASS' if site_ok else 'FAIL'))
    return ok


def write_js(all_records):
    headers = ['Site', 'Id', 'Diameter', 'Length', 'Width', 'Area', 'Identification', 'Quality', 'Is Valid']
    fileA = all_records['Site1'] + all_records['Site2']
    fileB = all_records['Site3'] + all_records['Site4']

    def rows_literal(rows):
        lines = []
        for r in rows:
            lines.append('        ' + json.dumps(r))
        return ',\n'.join(lines)

    js = (
        '/* ============================================================\n'
        ' * MicroWatch-LDIR · demo data (SIMULATED, generated offline)\n'
        ' * ------------------------------------------------------------\n'
        ' * Deterministic synthetic particle records that reproduce the\n'
        ' * reference statistics of the course design brief so that every\n'
        ' * page can be demonstrated without the original Excel exports.\n'
        ' * NOT real measurement data. Raw site names intentionally mix\n'
        ' * "Site1"/"Site2" and "Site 3"/"Site 4" to exercise normalisation.\n'
        ' * Regenerate with:  python3 tools/gen_demo_data.py\n'
        ' * ============================================================ */\n'
        'window.MW = window.MW || {};\n'
        'MW.DEMO_DATA = {\n'
        '  note: "Simulated course demo data — reproduces the reference statistics; not real measurements.",\n'
        '  files: [\n'
        '    {\n'
        '      name: "site 1 2 (demo).xlsx",\n'
        '      sheet: "Particles",\n'
        '      headers: ' + json.dumps(headers) + ',\n'
        '      rows: [\n' + rows_literal(fileA) + '\n      ]\n'
        '    },\n'
        '    {\n'
        '      name: "site 3 4 (demo).xlsx",\n'
        '      sheet: "Particles",\n'
        '      headers: ' + json.dumps(headers) + ',\n'
        '      rows: [\n' + rows_literal(fileB) + '\n      ]\n'
        '    }\n'
        '  ]\n'
        '};\n'
    )
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'js', 'demo-data.js')
    with open(out, 'w') as f:
        f.write(js)
    print('written:', out, '(%.1f KB)' % (len(js) / 1024))


def main():
    all_records = {}
    for site, cfg in SITES.items():
        recs = build_site(site, cfg)
        all_records[site] = recs
        print('%s: %d records' % (site, len(recs)))
    records = sum(all_records.values(), [])
    print('\n=== verification against design-brief reference values ===')
    ok = verify(records)
    print('grand total:', len(records))
    write_js(all_records)
    if not ok:
        sys.exit(1)


if __name__ == '__main__':
    main()
