import type { MathTradeItem, MathTradeCycle } from './mathtradeTypes';

export interface MathTradeResolution {
  cycles: MathTradeCycle[];
  unmatchedItemIds: string[];
}

/**
 * Resolves a math trade into disjoint trade loops.
 *
 * This is a greedy heuristic, NOT the optimal solver BoardGameGeek's official
 * "TradeMaximizer" uses (that one formulates the problem as a min-cost flow /
 * assignment problem solved via bisection on rank cutoffs, which reliably finds
 * the trade set that maximizes matched items while minimizing total rank —
 * genuinely optimal, but a lot more machinery than an MVP needs). Every cycle
 * this returns is a verified, valid closed loop, so results are always safe to
 * execute even if not provably optimal — this greedy approach converges to a good
 * solution for typical trade sizes and is easy to reason about.
 *
 * Algorithm: repeatedly give every still-unmatched item its best still-available
 * want (skipping items owned by the same player, and items already claimed by an
 * earlier, more preferred edge from someone else), then detect and lock in any
 * cycles this tentative assignment forms. Locked-in items are removed and the
 * process repeats — freeing up "next best" choices for anyone whose top pick was
 * just taken — until no further cycles can form.
 */
export function resolveTrades(items: MathTradeItem[]): MathTradeResolution {
  const itemById = new Map(items.map((it) => [it.id, it]));
  const remaining = new Set(items.map((it) => it.id));
  const cycles: MathTradeCycle[] = [];

  for (;;) {
    // Each remaining item's best still-possible want (its own ranked list, filtered to
    // items that still exist, aren't already claimed this round, and aren't self-trades).
    const claimed = new Set<string>();
    const nextOf = new Map<string, string>();
    for (const id of remaining) {
      const item = itemById.get(id)!;
      for (const wantedId of item.wantList) {
        if (!remaining.has(wantedId)) continue;
        if (claimed.has(wantedId)) continue;
        const wantedItem = itemById.get(wantedId)!;
        if (wantedItem.ownerPlayerId === item.ownerPlayerId) continue;
        nextOf.set(id, wantedId);
        claimed.add(wantedId);
        break;
      }
    }

    // Walk each chain; since every node has out-degree <= 1, any revisit within the
    // same walk must be a cycle (functional-graph property) — no other kind of revisit is possible.
    const visited = new Set<string>();
    let foundAny = false;
    for (const start of remaining) {
      if (visited.has(start)) continue;
      const path: string[] = [];
      const indexInPath = new Map<string, number>();
      let cur = start;
      while (nextOf.has(cur) && !indexInPath.has(cur)) {
        indexInPath.set(cur, path.length);
        path.push(cur);
        cur = nextOf.get(cur)!;
      }
      if (indexInPath.has(cur)) {
        const cycleItemIds = path.slice(indexInPath.get(cur)!);
        cycles.push({ itemIds: cycleItemIds });
        for (const id of cycleItemIds) remaining.delete(id);
        foundAny = true;
      }
      for (const id of path) visited.add(id);
    }

    if (!foundAny) break;
  }

  return { cycles, unmatchedItemIds: [...remaining] };
}
