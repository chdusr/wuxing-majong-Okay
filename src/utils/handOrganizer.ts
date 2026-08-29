import { MahjongTileData, MeldType } from '../types/mahjong';
import {
  checkThreeTilesKan,
  CANONICAL_KANS,
  CLASH_PAIRS,
  sortHand,
} from './mahjongRules';

export interface HandGroupSlot {
  id: string;
  name: string;
  type: 'kan' | 'pair';
  maxTiles: number;
  tiles: MahjongTileData[];
}

export interface SlotValidationResult {
  isValid: boolean;
  type?: MeldType | 'pair';
  label: string;
  isComplete: boolean;
}

/**
 * Validate whether the tiles in a slot form a valid Kan (3 tiles) or Pair (2 tiles).
 */
export function validateSlot(tiles: MahjongTileData[], slotType: 'kan' | 'pair'): SlotValidationResult {
  if (tiles.length === 0) {
    return {
      isValid: false,
      isComplete: false,
      label: slotType === 'pair' ? '空将牌槽 (需2张相同字)' : '空砍牌槽 (需3张合规牌)',
    };
  }

  if (slotType === 'pair') {
    if (tiles.length === 1) {
      return {
        isValid: false,
        isComplete: false,
        label: `单张【${tiles[0].name}】(需凑2张相同字对子)`,
      };
    }
    if (tiles.length === 2) {
      if (tiles[0].name === tiles[1].name) {
        return {
          isValid: true,
          isComplete: true,
          type: 'pair',
          label: `雀头将牌：【${tiles[0].name}${tiles[1].name}】对子达标 ✓`,
        };
      }
      const isClash = CLASH_PAIRS[tiles[0].name] === tiles[1].name;
      return {
        isValid: false,
        isComplete: true,
        label: isClash
          ? `冲战对冲【${tiles[0].name}+${tiles[1].name}】(非对子，无法作将)`
          : `非对子【${tiles[0].name} + ${tiles[1].name}】(不同字无法作将)`,
      };
    }
  }

  if (slotType === 'kan') {
    if (tiles.length === 1) {
      return {
        isValid: false,
        isComplete: false,
        label: `单张【${tiles[0].name}】(已放入 1/3 张)`,
      };
    }

    if (tiles.length === 2) {
      const nameA = tiles[0].name;
      const nameB = tiles[1].name;

      // 1. Check if 2 tiles are identical
      if (nameA === nameB) {
        const clash = CLASH_PAIRS[nameA];
        return {
          isValid: false,
          isComplete: false,
          label: `对子【${nameA}${nameB}】(等第3张【${nameA}】或冲战【${clash || ''}】)`,
        };
      }

      // 2. Check if 2 tiles are a Clash Pair (e.g. 甲 and 庚)
      if (CLASH_PAIRS[nameA] === nameB) {
        return {
          isValid: false,
          isComplete: false,
          label: `冲战对冲【${nameA}+${nameB}】(等【${nameA}】或【${nameB}】成冲战砍)`,
        };
      }

      // 3. Check if 2 tiles are 2/3 of a Canonical Kan
      const matched = CANONICAL_KANS.filter(k =>
        k.tiles.includes(nameA) && k.tiles.includes(nameB)
      );
      if (matched.length > 0) {
        const needed = matched[0].tiles.find(t => t !== nameA && t !== nameB);
        return {
          isValid: false,
          isComplete: false,
          label: `待成【${matched[0].name}】(缺【${needed}】)`,
        };
      }

      return {
        isValid: false,
        isComplete: false,
        label: `未成砍【${nameA}+${nameB}】(已放入 2/3 张)`,
      };
    }

    if (tiles.length === 3) {
      const names = tiles.map(t => t.name);
      const res = checkThreeTilesKan(names);
      if (res && res.isValid) {
        return {
          isValid: true,
          isComplete: true,
          type: res.type,
          label: `${res.typeLabel}：【${names.join('·')}】✓`,
        };
      }
      return {
        isValid: false,
        isComplete: true,
        label: `非有效组合【${names.join('·')}】✕`,
      };
    }
  }

  return {
    isValid: false,
    isComplete: false,
    label: '无效状态',
  };
}

interface CandidateKan {
  indices: [number, number, number];
  tiles: [MahjongTileData, MahjongTileData, MahjongTileData];
  type: MeldType;
  typeLabel: string;
  score: number;
}

interface CandidatePair {
  indices: [number, number];
  tiles: [MahjongTileData, MahjongTileData];
  score: number;
}

interface CandidatePartialKan {
  indices: [number, number];
  tiles: [MahjongTileData, MahjongTileData];
  label: string;
  score: number;
}

/**
 * High-performance Intelligent Hand Auto-Grouping:
 * Decomposes any hand (1 to 14 tiles) into optimal 4 Kans + 1 Pair arrangement using
 * global branch-and-bound combinatorial optimization.
 */
export function autoGroupHand(
  hand: MahjongTileData[],
  declaredMeldsCount: number = 0
): {
  slots: HandGroupSlot[];
  unassigned: MahjongTileData[];
  isSevenPairs?: boolean;
} {
  if (!hand || hand.length === 0) {
    return {
      slots: [
        { id: 'kan_1', name: '砍一', type: 'kan', maxTiles: 3, tiles: [] },
        { id: 'kan_2', name: '砍二', type: 'kan', maxTiles: 3, tiles: [] },
        { id: 'kan_3', name: '砍三', type: 'kan', maxTiles: 3, tiles: [] },
        { id: 'kan_4', name: '砍四', type: 'kan', maxTiles: 3, tiles: [] },
        { id: 'pair_1', name: '将牌 (雀头)', type: 'pair', maxTiles: 2, tiles: [] },
      ],
      unassigned: [],
    };
  }

  const kanSlots: HandGroupSlot[] = [
    { id: 'kan_1', name: '砍一', type: 'kan', maxTiles: 3, tiles: [] },
    { id: 'kan_2', name: '砍二', type: 'kan', maxTiles: 3, tiles: [] },
    { id: 'kan_3', name: '砍三', type: 'kan', maxTiles: 3, tiles: [] },
    { id: 'kan_4', name: '砍四', type: 'kan', maxTiles: 3, tiles: [] },
  ];
  const pairSlot: HandGroupSlot = {
    id: 'pair_1',
    name: '将牌 (雀头)',
    type: 'pair',
    maxTiles: 2,
    tiles: [],
  };

  const neededKans = Math.max(0, 4 - declaredMeldsCount);

  // 1. Check Seven Pairs (七巧对) condition
  if (declaredMeldsCount === 0 && hand.length >= 10) {
    const counts: Record<string, MahjongTileData[]> = {};
    for (const t of hand) {
      counts[t.name] = counts[t.name] || [];
      counts[t.name].push(t);
    }
    const pairsArr: MahjongTileData[][] = [];
    const leftoverArr: MahjongTileData[] = [];

    Object.values(counts).forEach(arr => {
      const pCount = Math.floor(arr.length / 2);
      for (let p = 0; p < pCount; p++) {
        pairsArr.push([arr[p * 2], arr[p * 2 + 1]]);
      }
      if (arr.length % 2 === 1) {
        leftoverArr.push(arr[arr.length - 1]);
      }
    });

    if (pairsArr.length >= 5 || (hand.length === 14 && pairsArr.length === 7)) {
      // Structure as Seven Pairs layout
      if (pairsArr.length > 0) {
        pairSlot.tiles = pairsArr.shift()!;
      }
      for (let i = 0; i < 4 && pairsArr.length > 0; i++) {
        kanSlots[i].tiles = pairsArr.shift()!;
      }
      // Remaining pairs and leftovers go to unassigned
      const unassignedRemaining = [
        ...pairsArr.flat(),
        ...leftoverArr,
      ];

      return {
        slots: [...kanSlots, pairSlot],
        unassigned: sortHand(unassignedRemaining),
        isSevenPairs: true,
      };
    }
  }

  // 2. Combinatorial Optimization for 4 Kans + 1 Pair
  // Find all candidate 3-tile Kans
  const n = hand.length;
  const candidateKans: CandidateKan[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const names = [hand[i].name, hand[j].name, hand[k].name];
        const check = checkThreeTilesKan(names);
        if (check && check.isValid) {
          let score = 10000;
          if (check.type === 'triplet') score = 10200;
          else if (check.type === 'clash_meld') score = 9800;

          candidateKans.push({
            indices: [i, j, k],
            tiles: [hand[i], hand[j], hand[k]],
            type: check.type,
            typeLabel: check.typeLabel,
            score,
          });
        }
      }
    }
  }

  // Find all candidate 2-tile Pairs
  const candidatePairs: CandidatePair[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (hand[i].name === hand[j].name) {
        candidatePairs.push({
          indices: [i, j],
          tiles: [hand[i], hand[j]],
          score: 3500,
        });
      }
    }
  }

  // Find all candidate 2-tile Partial Kans
  const candidatePartials: CandidatePartialKan[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = hand[i].name;
      const b = hand[j].name;

      if (a === b) {
        candidatePartials.push({
          indices: [i, j],
          tiles: [hand[i], hand[j]],
          label: `对子【${a}${b}】`,
          score: 600,
        });
      } else if (CLASH_PAIRS[a] === b) {
        candidatePartials.push({
          indices: [i, j],
          tiles: [hand[i], hand[j]],
          label: `冲战【${a}+${b}】`,
          score: 700,
        });
      } else {
        const matched = CANONICAL_KANS.find(k => k.tiles.includes(a) && k.tiles.includes(b));
        if (matched) {
          candidatePartials.push({
            indices: [i, j],
            tiles: [hand[i], hand[j]],
            label: `待成【${matched.name}】`,
            score: 800,
          });
        }
      }
    }
  }

  // Backtracking search for optimal disjoint Kans + Pair
  let bestScore = -1;
  let bestChosenKans: CandidateKan[] = [];
  let bestChosenPair: CandidatePair | null = null;

  function evaluatePartition(chosenKans: CandidateKan[], chosenPair: CandidatePair | null) {
    const used = new Set<number>();
    chosenKans.forEach(k => k.indices.forEach(idx => used.add(idx)));
    if (chosenPair) chosenPair.indices.forEach(idx => used.add(idx));

    let score = chosenKans.reduce((sum, k) => sum + k.score, 0);
    if (chosenPair) score += chosenPair.score;

    // Remaining unused indices can form partial kans
    const remainingIndices: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!used.has(i)) remainingIndices.push(i);
    }

    const unusedSet = new Set(remainingIndices);
    const slotsAvailable = neededKans - chosenKans.length;
    let partialsFound = 0;

    for (const partial of candidatePartials) {
      if (partialsFound >= slotsAvailable) break;
      if (unusedSet.has(partial.indices[0]) && unusedSet.has(partial.indices[1])) {
        score += partial.score;
        unusedSet.delete(partial.indices[0]);
        unusedSet.delete(partial.indices[1]);
        partialsFound++;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestChosenKans = [...chosenKans];
      bestChosenPair = chosenPair;
    }
  }

  function search(kanStartIdx: number, currentKans: CandidateKan[], currentPair: CandidatePair | null, usedMask: number) {
    evaluatePartition(currentKans, currentPair);

    // Try adding more Kans if under limit
    if (currentKans.length < neededKans) {
      for (let k = kanStartIdx; k < candidateKans.length; k++) {
        const kan = candidateKans[k];
        const mask = (1 << kan.indices[0]) | (1 << kan.indices[1]) | (1 << kan.indices[2]);
        if ((usedMask & mask) === 0) {
          search(k + 1, [...currentKans, kan], currentPair, usedMask | mask);
        }
      }
    }

    // Try adding Pair if not yet chosen
    if (!currentPair) {
      for (let p = 0; p < candidatePairs.length; p++) {
        const pair = candidatePairs[p];
        const mask = (1 << pair.indices[0]) | (1 << pair.indices[1]);
        if ((usedMask & mask) === 0) {
          search(kanStartIdx, currentKans, pair, usedMask | mask);
        }
      }
    }
  }

  search(0, [], null, 0);

  // Apply best partition
  const usedTileIds = new Set<string>();

  // 1. Assign Complete Kans
  let slotIdx = 0;
  for (const kan of bestChosenKans) {
    if (slotIdx < 4) {
      kanSlots[slotIdx].tiles = [...kan.tiles];
      kan.tiles.forEach(t => usedTileIds.add(t.id));
      slotIdx++;
    }
  }

  // 2. Assign Pair
  if (bestChosenPair) {
    pairSlot.tiles = [...bestChosenPair.tiles];
    bestChosenPair.tiles.forEach(t => usedTileIds.add(t.id));
  }

  // 3. Collect remaining unassigned tiles
  let remainingTiles = hand.filter(t => !usedTileIds.has(t.id));

  // 4. Fill remaining empty Kan slots with 2-tile Partial Kans
  while (slotIdx < neededKans && remainingTiles.length >= 2) {
    let foundPartial = false;
    for (const partial of candidatePartials) {
      const tileA = remainingTiles.find(t => t.id === hand[partial.indices[0]].id);
      const tileB = remainingTiles.find(t => t.id === hand[partial.indices[1]].id);

      if (tileA && tileB && tileA.id !== tileB.id) {
        kanSlots[slotIdx].tiles = [tileA, tileB];
        remainingTiles = remainingTiles.filter(t => t.id !== tileA.id && t !== tileB);
        slotIdx++;
        foundPartial = true;
        break;
      }
    }
    if (!foundPartial) break;
  }

  // 5. If Pair slot is empty and remainingTiles has a pair or single, place it
  if (pairSlot.tiles.length === 0 && remainingTiles.length > 0) {
    // Check if remainingTiles has an identical pair
    const counts: Record<string, MahjongTileData[]> = {};
    for (const t of remainingTiles) {
      counts[t.name] = counts[t.name] || [];
      counts[t.name].push(t);
    }
    const pairCand = Object.values(counts).find(arr => arr.length >= 2);
    if (pairCand) {
      pairSlot.tiles = [pairCand[0], pairCand[1]];
      remainingTiles = remainingTiles.filter(t => t.id !== pairCand[0].id && t.id !== pairCand[1].id);
    } else if (remainingTiles.length === 1 || remainingTiles.length % 3 === 2) {
      // Move 1 tile to pair slot as waiting single
      pairSlot.tiles = [remainingTiles.pop()!];
    }
  }

  return {
    slots: [...kanSlots, pairSlot],
    unassigned: sortHand(remainingTiles),
  };
}

/**
 * Returns a complete, smartly organized linear hand array.
 * Places complete Kans first, then the Pair, then partial Kans, then sorted loose tiles.
 */
export function getSmartOrganizedHand(
  hand: MahjongTileData[],
  declaredMeldsCount: number = 0
): MahjongTileData[] {
  const grouped = autoGroupHand(hand, declaredMeldsCount);
  
  // Arrange in natural visual priority:
  // Complete Kans (3 tiles) -> Pair (2 tiles) -> Partial Kans (2 tiles) -> Single Pair -> Loose unassigned tiles
  const completeKans: MahjongTileData[] = [];
  const partialKans: MahjongTileData[] = [];
  const pairTiles: MahjongTileData[] = [];

  for (let i = 0; i < 4; i++) {
    const slot = grouped.slots[i];
    if (slot.tiles.length === 3) {
      completeKans.push(...slot.tiles);
    } else if (slot.tiles.length > 0) {
      partialKans.push(...slot.tiles);
    }
  }

  const pairSlot = grouped.slots[4];
  if (pairSlot && pairSlot.tiles.length > 0) {
    pairTiles.push(...pairSlot.tiles);
  }

  return [
    ...completeKans,
    ...pairTiles,
    ...partialKans,
    ...grouped.unassigned,
  ];
}

/**
 * Reorder hand by Clash / Combat pairs
 */
export function sortByClashPairs(hand: MahjongTileData[]): MahjongTileData[] {
  const result: MahjongTileData[] = [];
  const remaining = [...hand];

  while (remaining.length > 0) {
    const current = remaining.shift()!;
    result.push(current);

    // Look for matching identical or clash opposite
    const clashTarget = CLASH_PAIRS[current.name];
    
    // First pull identical matching tiles
    let sameIdx = remaining.findIndex(t => t.name === current.name);
    while (sameIdx !== -1) {
      result.push(remaining.splice(sameIdx, 1)[0]);
      sameIdx = remaining.findIndex(t => t.name === current.name);
    }

    // Then pull clash partner tiles
    if (clashTarget) {
      let clashIdx = remaining.findIndex(t => t.name === clashTarget);
      while (clashIdx !== -1) {
        result.push(remaining.splice(clashIdx, 1)[0]);
        clashIdx = remaining.findIndex(t => t.name === clashTarget);
      }
    }
  }

  return result;
}
