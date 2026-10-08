import { D, isk } from "../accounting/money";
import { fill, type Level } from "../market/depth";

export interface ChainRecipe {
  id: string;
  /** Stable physical blueprint item ID, shared with the ESI job payload. */
  blueprintId?: string;
  outputTypeId: string;
  outputPerRun: number;
  maxRuns: number;
  /** Remaining BPC runs; null means the blueprint is not currently available. */
  availableRuns: number | null;
  /** BPO runs are reusable; BPC runs are consumed by the plan. */
  reusableBlueprint: boolean;
  facilityId: string;
  timeSecondsForRuns(runs: number): number | null;
  fixedCostForRuns(runs: number): string | null;
  materialsForRuns(runs: number): { typeId: string; quantity: number }[];
}

export interface ChainAction {
  id: string;
  kind: "purchase" | "manufacturing";
  typeId: string;
  quantity: number;
  cost: string;
  facilityId: string | null;
  recipeId: string | null;
  blueprintId?: string | null;
  runs: number | null;
  /** Manufacturing duration for this action; null for purchases. */
  timeSeconds: number | null;
  parents: string[];
  typeName?: string;
  facilityName?: string | null;
  sources?: {
    id: string;
    quantity: number;
    unitCost: string;
    locationId?: string;
    locationName?: string;
    inventoryLotId?: string;
  }[];
}

export interface ChainPlan {
  status: "ready" | "review";
  reasons: string[];
  targetTypeId: string;
  targetQuantity: number;
  totalCost: string | null;
  productionSeconds: number | null;
  slotSeconds: number | null;
  schedule: {
    status: "ready" | "review";
    reasons: string[];
    availableSlots: number;
    occupiedSlots: number;
    calendarSeconds: number | null;
    jobs: { actionId: string; blueprintId: string; slot: number; startAt: string; endAt: string }[];
  } | null;
  actions: ChainAction[];
  searchStates: number;
}

interface State {
  pending: Requirement[];
  surplus: Map<string, number>;
  usedOrders: Map<string, number>;
  usedBlueprintRuns: Map<string, number>;
  actions: Map<string, ChainAction>;
  cost: ReturnType<typeof D>;
  slotSeconds: number;
  productionSeconds: number;
}
interface Requirement {
  typeId: string;
  quantity: number;
  parentIds: string[];
  ancestorPaths: string[][];
}

const clone = (state: State): State => ({
  pending: state.pending.map((requirement) => ({
    ...requirement,
    parentIds: [...requirement.parentIds],
    ancestorPaths: requirement.ancestorPaths.map((path) => [...path]),
  })),
  surplus: new Map(state.surplus),
  usedOrders: new Map(state.usedOrders),
  usedBlueprintRuns: new Map(state.usedBlueprintRuns),
  actions: new Map([...state.actions].map(([id, action]) => [id, { ...action, parents: [...action.parents] }])),
  cost: D(state.cost),
  slotSeconds: state.slotSeconds,
  productionSeconds: state.productionSeconds,
});

function compare(a: State, b: State): number {
  return a.cost.comparedTo(b.cost) || a.productionSeconds - b.productionSeconds || a.actions.size - b.actions.size;
}

/**
 * Searches complete buy/make choices over a dependency graph. Branches carry
 * shared market depth, blueprint runs and surplus forward so a quote cannot
 * spend the same order or BPC run twice. The search is bounded; hitting the
 * bound returns review instead of presenting a partial plan as optimal.
 */
export function planMakeBuyChain(input: {
  targetTypeId: string;
  targetQuantity: number;
  recipes: ChainRecipe[];
  asksByType: Map<string, Level[]>;
  forceTargetRecipeId?: string;
  maxSearchStates?: number;
}): ChainPlan {
  if (!Number.isSafeInteger(input.targetQuantity) || input.targetQuantity <= 0)
    throw Error("Целевое количество цепочки должно быть положительным целым числом");
  const maxSearchStates = input.maxSearchStates ?? 25_000;
  const recipesByOutput = new Map<string, ChainRecipe[]>();
  for (const recipe of input.recipes) {
    if (!Number.isSafeInteger(recipe.outputPerRun) || recipe.outputPerRun <= 0 ||
        !Number.isSafeInteger(recipe.maxRuns) || recipe.maxRuns <= 0)
      throw Error(`Некорректный рецепт ${recipe.id}`);
    const options = recipesByOutput.get(recipe.outputTypeId) ?? [];
    options.push(recipe);
    recipesByOutput.set(recipe.outputTypeId, options);
  }
  let states = 0;
  let exceeded = false;
  const best: { state: State | null } = { state: null };
  const start: State = {
    pending: [{ typeId: input.targetTypeId, quantity: input.targetQuantity, parentIds: [], ancestorPaths: [[]] }],
    surplus: new Map(),
    usedOrders: new Map(),
    usedBlueprintRuns: new Map(),
    actions: new Map(),
    cost: D(0),
    slotSeconds: 0,
    productionSeconds: 0,
  };

  const visit = (state: State): void => {
    if (exceeded || ++states > maxSearchStates) {
      exceeded = true;
      return;
    }
    if (best.state && state.cost.gt(best.state.cost)) return;
    if (!state.pending.length) {
      if (!best.state || compare(state, best.state) < 0) best.state = state;
      return;
    }

    const [first, ...rest] = state.pending;
    const matching = rest.filter((requirement) => requirement.typeId === first!.typeId);
    const requirement: Requirement = {
      ...first!,
      quantity: first!.quantity + matching.reduce((total, item) => total + item.quantity, 0),
      parentIds: [...new Set([...first!.parentIds, ...matching.flatMap((item) => item.parentIds)])],
      ancestorPaths: [...first!.ancestorPaths, ...matching.flatMap((item) => item.ancestorPaths)],
    };
    state.pending = rest.filter((item) => !matching.includes(item));
    const availableSurplus = state.surplus.get(requirement.typeId) ?? 0;
    const usedSurplus = Math.min(availableSurplus, requirement.quantity);
    const remaining = requirement.quantity - usedSurplus;
    if (usedSurplus) {
      if (availableSurplus === usedSurplus) state.surplus.delete(requirement.typeId);
      else state.surplus.set(requirement.typeId, availableSurplus - usedSurplus);
    }
    if (!remaining) {
      visit(state);
      return;
    }

    const forcedRoot = input.forceTargetRecipeId !== undefined &&
      requirement.parentIds.length === 0 && requirement.typeId === input.targetTypeId;
    // Buy is one complete candidate action. `fill` shares order usage between
    // sibling branches and honors minimum volume constraints.
    if (!forcedRoot) {
      const buyBranch = clone(state);
      const purchase = fill(input.asksByType.get(requirement.typeId) ?? [], remaining, "buy", buyBranch.usedOrders);
      if (purchase.filled > 0) {
        const id = `buy:${requirement.typeId}:${buyBranch.actions.size}`;
        const parents = requirement.parentIds;
        buyBranch.actions.set(id, {
          id, kind: "purchase", typeId: requirement.typeId, quantity: purchase.filled,
          cost: purchase.total, facilityId: null, recipeId: null, runs: null, parents,
          timeSeconds: null,
          sources: purchase.fills.map((fill) => ({
            id: fill.id,
            quantity: fill.quantity,
            unitCost: fill.price,
            ...(fill.locationId ? { locationId: fill.locationId } : {}),
            ...(fill.locationName ? { locationName: fill.locationName } : {}),
            ...(fill.inventoryLotId ? { inventoryLotId: fill.inventoryLotId } : {}),
          })),
        });
        buyBranch.cost = buyBranch.cost.plus(purchase.total);
        if (purchase.filled < remaining)
          buyBranch.pending.unshift({ ...requirement, quantity: remaining - purchase.filled });
        visit(buyBranch);
      }
    }

    for (const recipe of recipesByOutput.get(requirement.typeId) ?? []) {
      if (forcedRoot && recipe.id !== input.forceTargetRecipeId) continue;
      if (requirement.ancestorPaths.some((path) => path.includes(recipe.outputTypeId) || path.includes(recipe.id))) continue;
      if (recipe.availableRuns === null) continue;
      const alreadyUsed = recipe.reusableBlueprint ? 0 : (state.usedBlueprintRuns.get(recipe.id) ?? 0);
      const availableRuns = recipe.reusableBlueprint
        ? recipe.maxRuns
        : Math.min(recipe.maxRuns, recipe.availableRuns - alreadyUsed);
      if (availableRuns <= 0) continue;

      // A BPO can be scheduled in multiple jobs; a BPC is limited by its
      // remaining runs. Partial make followed by buy is a valid candidate.
      const runs = Math.min(Math.ceil(remaining / recipe.outputPerRun), availableRuns);
      const fixedCost = recipe.fixedCostForRuns(runs);
      const seconds = recipe.timeSecondsForRuns(runs);
      if (fixedCost === null || seconds === null || seconds < 0) continue;
      const materials = recipe.materialsForRuns(runs);
      if (materials.some((material) => !Number.isSafeInteger(material.quantity) || material.quantity <= 0)) continue;

      const makeBranch = clone(state);
      const actionId = `make:${recipe.id}:${makeBranch.actions.size}`;
      const made = runs * recipe.outputPerRun;
      const surplus = made - remaining;
      if (surplus > 0) makeBranch.surplus.set(requirement.typeId,
        (makeBranch.surplus.get(requirement.typeId) ?? 0) + surplus);
      if (!recipe.reusableBlueprint)
        makeBranch.usedBlueprintRuns.set(recipe.id, alreadyUsed + runs);
      const parents = requirement.parentIds;
      makeBranch.actions.set(actionId, {
        id: actionId, kind: "manufacturing", typeId: requirement.typeId, quantity: made,
        cost: fixedCost, facilityId: recipe.facilityId, recipeId: recipe.id, runs, parents,
        blueprintId: recipe.blueprintId ?? recipe.id,
        timeSeconds: seconds,
      });
      makeBranch.cost = makeBranch.cost.plus(fixedCost);
      makeBranch.slotSeconds += seconds;
      makeBranch.productionSeconds += seconds;
      const ancestorPaths = requirement.ancestorPaths.map((path) => [...path, recipe.outputTypeId, recipe.id]);
      for (const material of materials)
        makeBranch.pending.push({ typeId: material.typeId, quantity: material.quantity, parentIds: [actionId], ancestorPaths });
      if (made < remaining)
        makeBranch.pending.unshift({ ...requirement, quantity: remaining - made });
      visit(makeBranch);
    }
  };

  visit(start);
  if (exceeded || !best.state) {
    return {
      status: "review",
      reasons: [exceeded ? "План содержит слишком много вариантов; сократите партию или уточните доступные чертежи" : "Не удалось полностью обеспечить цепочку рыночными ордерами и доступными чертежами"],
      targetTypeId: input.targetTypeId,
      targetQuantity: input.targetQuantity,
      totalCost: null,
      productionSeconds: null,
      slotSeconds: null,
      schedule: null,
      actions: [],
      searchStates: states,
    };
  }
  return {
    status: "ready",
    reasons: [],
    targetTypeId: input.targetTypeId,
    targetQuantity: input.targetQuantity,
    totalCost: isk(best.state.cost),
    productionSeconds: best.state.productionSeconds,
    slotSeconds: best.state.slotSeconds,
    schedule: null,
    actions: [...best.state.actions.values()],
    searchStates: states,
  };
}

/**
 * Conservative list scheduler for the selected make/buy DAG. Existing ESI
 * manufacturing jobs reserve both a character slot and their physical BPO/BPC
 * until their reported end time. Reusing one blueprint also serializes jobs.
 */
export function scheduleChainPlan(input: {
  plan: ChainPlan;
  availableSlots: number;
  activeJobs: { blueprintId: string; endAt: string; status: string }[];
  dependenciesByAction?: Record<string, string[]>;
  completedActions?: Record<string, string>;
  now?: number;
}): ChainPlan {
  if (input.plan.status !== "ready") return input.plan;
  const now = input.now ?? Date.now();
  const slots = Math.max(1, Math.floor(input.availableSlots));
  const activeCandidates = input.activeJobs.filter((job) => ["active", "paused"].includes(job.status));
  const active = activeCandidates.filter((job) => Date.parse(job.endAt) > now)
    .sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt));
  const review = (reason: string): ChainPlan => ({
    ...input.plan,
    productionSeconds: null,
    schedule: {
      status: "review", reasons: [reason], availableSlots: slots,
      occupiedSlots: active.length, calendarSeconds: null, jobs: [],
    },
  });
  if (activeCandidates.some((job) => !Number.isFinite(Date.parse(job.endAt))))
    return review("Время окончания активного задания неизвестно; срок цепочки нельзя подтвердить");
  if (activeCandidates.some((job) => job.status === "paused"))
    return review("В ESI есть приостановленное manufacturing-задание; срок его возобновления неизвестен");
  if (active.length > slots)
    return review(`В ESI активно ${active.length} заданий, но профиль подтверждает только ${slots} производственных слотов`);

  const slotFreeAt = Array.from({ length: slots }, (_, index) =>
    index < active.length ? Date.parse(active[index]!.endAt) : now,
  );
  const blueprintFreeAt = new Map(active.map((job) => [job.blueprintId, Date.parse(job.endAt)]));
  const manufacturing = input.plan.actions.filter((action) => action.kind === "manufacturing");
  const byId = new Map(manufacturing.map((action) => [action.id, action]));
  const completedAt = new Map<string, number>();
  for (const [actionId, at] of Object.entries(input.completedActions ?? {})) {
    const time = Date.parse(at);
    if (!Number.isFinite(time)) return review("У завершённого или связанного ESI-этапа некорректная дата");
    completedAt.set(actionId, time);
  }
  const pending = new Set(byId.keys());
  for (const actionId of completedAt.keys()) pending.delete(actionId);
  const prerequisites = new Map(manufacturing.map((action) => [
    action.id,
    input.dependenciesByAction?.[action.id] ?? manufacturing.filter((candidate) => candidate.parents.includes(action.id)).map((candidate) => candidate.id),
  ]));
  const jobs: NonNullable<ChainPlan["schedule"]>["jobs"] = [];
  while (pending.size) {
    const ready = [...pending].map((id) => byId.get(id)!).filter((action) =>
      (prerequisites.get(action.id) ?? []).every((child) => completedAt.has(child)),
    );
    if (!ready.length) return review("В производственной цепочке обнаружена циклическая или неполная зависимость");
    ready.sort((a, b) => (b.timeSeconds ?? -1) - (a.timeSeconds ?? -1) || a.id.localeCompare(b.id));
    let scheduled = false;
    for (const action of ready) {
      if (action.timeSeconds === null || action.timeSeconds < 0 || !action.recipeId || !action.blueprintId)
        return review("Для одного из производственных заданий нет длительности или физического чертежа");
      const dependencyReadyAt = Math.max(now, ...(prerequisites.get(action.id) ?? []).map((child) => completedAt.get(child) ?? now));
      let selectedSlot = -1;
      let selectedStart = Number.POSITIVE_INFINITY;
      for (let index = 0; index < slotFreeAt.length; index++) {
        const start = Math.max(dependencyReadyAt, slotFreeAt[index]!, blueprintFreeAt.get(action.blueprintId) ?? now);
        if (start < selectedStart) { selectedStart = start; selectedSlot = index; }
      }
      const end = selectedStart + action.timeSeconds * 1000;
      slotFreeAt[selectedSlot] = end;
      blueprintFreeAt.set(action.blueprintId, end);
      completedAt.set(action.id, end);
      jobs.push({
        actionId: action.id, blueprintId: action.blueprintId, slot: selectedSlot + 1,
        startAt: new Date(selectedStart).toISOString(), endAt: new Date(end).toISOString(),
      });
      pending.delete(action.id);
      scheduled = true;
      break;
    }
    if (!scheduled) return review("Не удалось построить расписание производственной цепочки");
  }
  const calendarSeconds = Math.max(0, ...Array.from(completedAt.values(), (value) => (value - now) / 1000));
  return {
    ...input.plan,
    productionSeconds: calendarSeconds,
    schedule: {
      status: "ready", reasons: [], availableSlots: slots, occupiedSlots: active.length,
      calendarSeconds, jobs: jobs.sort((a, b) => a.startAt.localeCompare(b.startAt)),
    },
  };
}
