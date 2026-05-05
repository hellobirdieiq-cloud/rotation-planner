// Generate a fresh defensive rotation from scratch.
// Heuristics adapted from v7-reference.html:
//   pitcher selection         lines 539-566
//   bench picker              lines 609-653
//   catcher selection         lines 656-682
//   IF/OF balance sort        lines 697-702
//   tightest-position-first   lines 728-757
//   reconciliation pass       lines 761-779
// V1 lean adaptations:
//   - 11 positions incl. CF (VF9)
//   - layoutFor() per H13/AF5 (8 → 2 OF; 9 → 3 OF; 10+ → 4 OF)
//   - No season totals (lean cut)
//   - No mid-inning splits (lean cut)
//   - Hard stops H3, H4, H5 enforced as filters; H2/H8 implicit via no-rejoin sequencing
//
// Inputs:
//   presentPlayers:    string[]               ordered list of present player IDs
//   rosterSnapshot:    { [pid]: { firstName, age, restrictions: bool[11], ... } }
//   totalInnings:      number                 typically 6
//   locks:             [{ inning, playerId, position }]   pre-game locks
//   pitchAppearances:  { [pid]: { perInning: { [inn]: pitches }, removed } }   optional
//
// When pitchAppearances is provided, players already at or above the age pitch
// limit (H4) are excluded from the pitcher pool.
//
// Output:
//   { schedule: InningRecord[], warnings: string[] }
//   schedule[i].cells[pid] = { assignment, locked, manual }

import { POSITION_INDEX, layoutFor, isInfield, isOutfield } from './positions.js';

const PITCH_MAX_BY_AGE = { 8: 50, 9: 75, 10: 75, 11: 75, 12: 0 };

function totalEnteredPitches(pitchAppearances, pid) {
  const ap = pitchAppearances && pitchAppearances[pid];
  if (!ap || !ap.perInning) return 0;
  return Object.values(ap.perInning).reduce((a, b) => a + (b || 0), 0);
}

export function generate({ presentPlayers, rosterSnapshot, totalInnings, locks, pitchAppearances }) {
  const present = (presentPlayers || []).slice();
  const n = present.length;
  const layout = layoutFor(n);
  if (!layout) {
    return { schedule: null, warnings: [`Need at least 8 players present (have ${n}).`] };
  }
  const fieldPositions = layout;
  const benchSlots = Math.max(0, n - fieldPositions.length);
  const totalI = Math.max(1, parseInt(totalInnings, 10) || 6);

  // Per-game tracking.
  const pitchInn = {}, catchInn = {}, benchCnt = {}, ifCnt = {}, ofCnt = {};
  const lastPos = {}, caughtLast = {}, benchedLast = {};
  const posCount = {};
  present.forEach((pid) => {
    pitchInn[pid] = catchInn[pid] = benchCnt[pid] = ifCnt[pid] = ofCnt[pid] = 0;
    lastPos[pid] = null;
    caughtLast[pid] = benchedLast[pid] = false;
    posCount[pid] = {};
  });

  // Pre-process locks: locksByInning[i] = Map(playerId -> position)
  const locksByInning = Array.from({ length: totalI }, () => new Map());
  (locks || []).forEach(({ inning, playerId, position }) => {
    if (inning >= 0 && inning < totalI && present.includes(playerId)) {
      locksByInning[inning].set(playerId, position);
    }
  });

  const schedule = [];
  const warnings = [];
  let curPitcher = null;
  // H8 — once a pitcher is replaced by a different pitcher in a later inning,
  // they cannot return to the mound for the rest of the game. Tracked across
  // the inning loop so the eligibility filter excludes them.
  const removedPitchers = new Set();

  for (let inn = 0; inn < totalI; inn++) {
    const lockMap = locksByInning[inn];
    const lockedAtPEntry = [...lockMap].find(([, pos]) => pos === 'P');
    const lockedAtCEntry = [...lockMap].find(([, pos]) => pos === 'C');
    const lockedAtP = lockedAtPEntry ? lockedAtPEntry[0] : null;
    const lockedAtC = lockedAtCEntry ? lockedAtCEntry[0] : null;
    const lockedAtBN = new Set([...lockMap].filter(([, pos]) => pos === 'BN').map(([pid]) => pid));

    const cells = {};

    // 1) Pick pitcher.
    // Score-based selection every inning so pitching spreads across the roster.
    // The previous inning's pitcher is treated like any other candidate; the
    // scoring (lowest pitchInn first) naturally rotates through unused players.
    let pitcherId = lockedAtP;
    if (!pitcherId) {
      const eligible = (pid) => {
        if (lockMap.has(pid) && lockMap.get(pid) !== 'P') return false;
        if (lockedAtBN.has(pid)) return false;
        if (removedPitchers.has(pid)) return false;     // H8
        const player = rosterSnapshot[pid];
        if (!player) return false;
        if (player.age === 12) return false;             // H5
        if (player.restrictions && player.restrictions[POSITION_INDEX['P']]) return false;
        if (catchInn[pid] >= 4) return false;            // H3
        const max = PITCH_MAX_BY_AGE[player.age];
        if (!max) return false;
        // H4: exclude pitchers already at or over their entered pitch limit.
        const entered = totalEnteredPitches(pitchAppearances, pid);
        if (entered >= max) return false;
        return true;
      };
      const candidates = present.filter(eligible);
      // Soft preference order:
      //   fewer pitch innings → not caught last → not yet caught this game → random
      candidates.sort((a, b) => {
        if (pitchInn[a] !== pitchInn[b]) return pitchInn[a] - pitchInn[b];
        if (caughtLast[a] !== caughtLast[b]) return caughtLast[a] ? 1 : -1;
        if ((catchInn[a] > 0) !== (catchInn[b] > 0)) return (catchInn[a] > 0) ? 1 : -1;
        return Math.random() - 0.5;
      });
      pitcherId = candidates[0] || null;
      if (!pitcherId) {
        warnings.push(`Inning ${inn + 1}: no eligible pitcher.`);
      }
    }
    if (pitcherId) {
      cells[pitcherId] = { assignment: 'P', locked: !!lockedAtP, manual: false };
      pitchInn[pitcherId]++;
      ifCnt[pitcherId]++;
      lastPos[pitcherId] = 'P';
      posCount[pitcherId]['P'] = (posCount[pitcherId]['P'] || 0) + 1;
      // When the pitcher changes from inning to inning, the previous one is
      // permanently removed (H8). curPitcher is preserved across pitcher-less
      // innings so a later replacement still triggers removal of the prior actual
      // pitcher.
      if (curPitcher && pitcherId !== curPitcher) {
        removedPitchers.add(curPitcher);
      }
      curPitcher = pitcherId;
    }

    // 2) Apply non-P locks.
    for (const [pid, pos] of lockMap) {
      if (pid === pitcherId) continue;
      cells[pid] = { assignment: pos, locked: true, manual: false };
      bumpCounters(pid, pos, posCount, ifCnt, ofCnt, catchInn, benchCnt, lastPos);
    }

    // 3) Pick bench (avoid back-to-back; prefer fewer total bench innings).
    const alreadyBench = present.filter((pid) => cells[pid] && cells[pid].assignment === 'BN').length;
    let slotsLeft = benchSlots - alreadyBench;
    if (slotsLeft > 0) {
      const cand = present.filter((pid) => !cells[pid] && !lockMap.has(pid) && !benchedLast[pid]);
      let pool = cand.slice();
      if (pool.length < slotsLeft) {
        const fallback = present.filter((pid) => !cells[pid] && !lockMap.has(pid) && benchedLast[pid]);
        pool = pool.concat(fallback);
        if (fallback.length > 0) warnings.push(`Inning ${inn + 1}: had to allow back-to-back bench.`);
      }
      pool.sort((a, b) => {
        if (benchCnt[a] !== benchCnt[b]) return benchCnt[a] - benchCnt[b];
        if (benchedLast[a] !== benchedLast[b]) return benchedLast[a] ? 1 : -1;
        return Math.random() - 0.5;
      });
      for (let i = 0; i < Math.min(slotsLeft, pool.length); i++) {
        const pid = pool[i];
        cells[pid] = { assignment: 'BN', locked: false, manual: false };
        benchCnt[pid]++;
      }
    }

    // 4) Pick catcher.
    let catcherId = lockedAtC;
    if (!catcherId) {
      const eligibleC = (pid) => {
        if (cells[pid]) return false;
        if (lockMap.has(pid)) return false;
        const player = rosterSnapshot[pid];
        if (!player) return false;
        if (player.restrictions && player.restrictions[POSITION_INDEX['C']]) return false;
        return true;
      };
      const candidates = present.filter(eligibleC);
      candidates.sort((a, b) => {
        if (catchInn[a] !== catchInn[b]) return catchInn[a] - catchInn[b];
        const aRepeat = lastPos[a] === 'C' ? 1 : 0;
        const bRepeat = lastPos[b] === 'C' ? 1 : 0;
        if (aRepeat !== bRepeat) return aRepeat - bRepeat;
        return Math.random() - 0.5;
      });
      catcherId = candidates[0] || null;
      if (!catcherId) warnings.push(`Inning ${inn + 1}: no eligible catcher.`);
    }
    if (catcherId && !cells[catcherId]) {
      cells[catcherId] = { assignment: 'C', locked: !!lockedAtC, manual: false };
      catchInn[catcherId]++;
      ifCnt[catcherId]++;
      lastPos[catcherId] = 'C';
      posCount[catcherId]['C'] = (posCount[catcherId]['C'] || 0) + 1;
    }

    // 5) Bucket remaining present players into IF / OF by ifCnt-ofCnt delta.
    const ifPositions = fieldPositions.filter((p) => isInfield(p) && !someAssignedAt(cells, p));
    const ofPositions = fieldPositions.filter((p) => isOutfield(p) && !someAssignedAt(cells, p));
    const remaining = present.filter((pid) => !cells[pid]);
    remaining.sort((a, b) => {
      const da = ifCnt[a] - ofCnt[a];
      const db = ifCnt[b] - ofCnt[b];
      if (da !== db) return da - db;
      if (ifCnt[a] !== ifCnt[b]) return ifCnt[a] - ifCnt[b];
      return Math.random() - 0.5;
    });
    const numIF = Math.min(ifPositions.length, remaining.length);
    let ifGroup = remaining.slice(0, numIF);
    let ofGroup = remaining.slice(numIF, numIF + ofPositions.length);

    const canBucket = (pid, positions) =>
      positions.some((p) => !rosterSnapshot[pid].restrictions || !rosterSnapshot[pid].restrictions[POSITION_INDEX[p]]);

    for (let i = 0; i < ifGroup.length; i++) {
      if (!canBucket(ifGroup[i], ifPositions)) {
        const j = ofGroup.findIndex((op) => canBucket(op, ifPositions) && canBucket(ifGroup[i], ofPositions));
        if (j >= 0) { const t = ifGroup[i]; ifGroup[i] = ofGroup[j]; ofGroup[j] = t; }
      }
    }
    for (let i = 0; i < ofGroup.length; i++) {
      if (!canBucket(ofGroup[i], ofPositions)) {
        const j = ifGroup.findIndex((ip) => canBucket(ip, ofPositions) && canBucket(ofGroup[i], ifPositions));
        if (j >= 0) { const t = ofGroup[i]; ofGroup[i] = ifGroup[j]; ifGroup[j] = t; }
      }
    }

    // 6) Tightest-position-first within bucket; score by -posCount + non-repeat + first-time.
    assignBucket(ifGroup, ifPositions, true, cells, rosterSnapshot, posCount, ifCnt, ofCnt, lastPos);
    assignBucket(ofGroup, ofPositions, false, cells, rosterSnapshot, posCount, ifCnt, ofCnt, lastPos);

    // 7) Reconcile: any unfilled fielding position, fill from any unassigned eligible player.
    const fillablePos = fieldPositions.filter((p) => p !== 'P' && p !== 'C');
    for (const pos of fillablePos) {
      if (someAssignedAt(cells, pos)) continue;
      const eligible = present.filter((pid) =>
        !cells[pid]
        && (!rosterSnapshot[pid].restrictions || !rosterSnapshot[pid].restrictions[POSITION_INDEX[pos]])
      );
      if (eligible.length > 0) {
        eligible.sort((a, b) => (posCount[a][pos] || 0) - (posCount[b][pos] || 0));
        const pid = eligible[0];
        cells[pid] = { assignment: pos, locked: false, manual: false };
        posCount[pid][pos] = (posCount[pid][pos] || 0) + 1;
        lastPos[pid] = pos;
        if (isInfield(pos)) ifCnt[pid]++; else ofCnt[pid]++;
      } else {
        warnings.push(`Inning ${inn + 1}: no eligible player for ${pos}.`);
      }
    }

    // 8) Anyone still unassigned → BN.
    for (const pid of present) {
      if (!cells[pid]) {
        cells[pid] = { assignment: 'BN', locked: false, manual: false };
        benchCnt[pid]++;
      }
    }

    // 9) Update next-inning state.
    for (const pid of present) {
      const a = cells[pid].assignment;
      caughtLast[pid] = (a === 'C');
      benchedLast[pid] = (a === 'BN');
    }

    schedule.push({ index: inn, cells });
  }

  return { schedule, warnings };
}

function someAssignedAt(cells, position) {
  for (const c of Object.values(cells)) {
    if (c && c.assignment === position) return true;
  }
  return false;
}

function bumpCounters(pid, pos, posCount, ifCnt, ofCnt, catchInn, benchCnt, lastPos) {
  posCount[pid][pos] = (posCount[pid][pos] || 0) + 1;
  if (pos === 'BN') {
    benchCnt[pid]++;
  } else if (pos === 'C') {
    catchInn[pid]++;
    ifCnt[pid]++;
    lastPos[pid] = 'C';
  } else if (isInfield(pos)) {
    ifCnt[pid]++;
    lastPos[pid] = pos;
  } else if (isOutfield(pos)) {
    ofCnt[pid]++;
    lastPos[pid] = pos;
  }
}

function assignBucket(group, positions, isIfBucket, cells, rosterSnapshot, posCount, ifCnt, ofCnt, lastPos) {
  // Tightest-position-first: positions with fewest eligible candidates go first.
  const orderedPos = positions.slice().sort((a, b) => {
    const ac = group.filter((pid) =>
      !cells[pid]
      && (!rosterSnapshot[pid].restrictions || !rosterSnapshot[pid].restrictions[POSITION_INDEX[a]])
    ).length;
    const bc = group.filter((pid) =>
      !cells[pid]
      && (!rosterSnapshot[pid].restrictions || !rosterSnapshot[pid].restrictions[POSITION_INDEX[b]])
    ).length;
    if (ac !== bc) return ac - bc;
    return Math.random() - 0.5;
  });
  for (const pos of orderedPos) {
    let best = null, bestScore = -Infinity;
    for (const pid of group) {
      if (cells[pid]) continue;
      const r = rosterSnapshot[pid] && rosterSnapshot[pid].restrictions;
      if (r && r[POSITION_INDEX[pos]]) continue;
      let score = -((posCount[pid][pos] || 0) * 5);
      if (lastPos[pid] !== pos) score += 8;
      if (Object.keys(posCount[pid]).length === 0) score += 3;
      // tiny random tiebreak
      score += Math.random() * 0.5;
      if (score > bestScore) { bestScore = score; best = pid; }
    }
    if (best) {
      cells[best] = { assignment: pos, locked: false, manual: false };
      posCount[best][pos] = (posCount[best][pos] || 0) + 1;
      lastPos[best] = pos;
      if (isIfBucket) ifCnt[best]++; else ofCnt[best]++;
    }
  }
}
