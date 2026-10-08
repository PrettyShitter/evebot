import { useState } from "react";
import {
  AlertCircle,
  Boxes,
  Factory,
  RefreshCw,
  Settings2,
} from "lucide-react";
import type { AppRequest, AppState } from "../shared/contracts/app";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";

interface Props {
  state: AppState;
  busy: boolean;
  request: (request: AppRequest) => Promise<unknown>;
  openSettings: () => void;
}

function timestamp(value: string | null) {
  return value ? new Date(value).toLocaleString() : "ещё не обновлялись";
}

function isk(value: string | null) {
  return value === null ? "—" : `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ISK`;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="panel">
      <div className="caption">{label}</div>
      <div className="numeric mt-2 text-xl font-semibold">{value}</div>
    </div>
  );
}

function CopyName({ name, onCopy }: { name: string; onCopy: (name: string) => void }) {
  return <button type="button" className="cursor-copy text-left font-medium hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={`Скопировать ${name}`} onClick={() => onCopy(name)}>{name}</button>;
}

function MarketSignalView({ signal }: { signal: AppState["production"]["offers"][number]["marketSignal"] }) {
  const history = signal.history;
  const month = history.month;
  const trend = signal.trendAdjustment;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Спрос: региональная история {month ? `${month.activeDays}/30 активных дней` : "нет данных"} · текущий buy-стакан {signal.currentHub.bidQuantity.toLocaleString("ru-RU")} шт.
      </summary>
      <div className="mt-2 space-y-1 rounded border border-border p-2 text-xs">
        <div>История региона {signal.regionName} · проверка {signal.newestDate ?? "нет даты"} · уверенность {signal.liquidity.confidence}</div>
        <div>7 дней: {history.week ? `${history.week.activeDays} активных · медиана ${Number(history.week.medianDailyVolume).toLocaleString("ru-RU")} шт./день` : "нет данных"}</div>
        <div>30 дней: {month ? `${month.activeDays} активных · медиана ${Number(month.medianDailyVolume).toLocaleString("ru-RU")} шт./день · цена ${Number(month.priceChange ?? 0) >= 0 ? "+" : ""}${(Number(month.priceChange ?? 0) * 100).toFixed(1)}%` : "нет данных"}</div>
        <div>90 дней: {history.quarter ? `${history.quarter.activeDays} активных · медиана ${Number(history.quarter.medianDailyVolume).toLocaleString("ru-RU")} шт./день` : "нет данных"}</div>
        <div>Текущий хаб: buy {signal.currentHub.bidQuantity.toLocaleString("ru-RU")} · sell {signal.currentHub.askQuantity.toLocaleString("ru-RU")} шт. · спред {signal.currentHub.spreadPercent === null ? "—" : `${signal.currentHub.spreadPercent.toFixed(1)}%`} · ожидаемый срок реализации {signal.expectedSellDays === null ? "нет оценки" : `${signal.expectedSellDays.toFixed(1)} дн. по региональной медиане`}{trend === null ? "" : ` · тренд ${trend > 0 ? "+" : ""}${trend}%`}</div>
        {signal.liquidity.riskFlags.map((risk) => <div key={risk} className="text-amber-300">Риск: {risk}</div>)}
        {!month && <div className="text-amber-300">История не загружена: спрос оценивается только по текущей глубине хаба.</div>}
      </div>
    </details>
  );
}

export function ProductionView({ state, busy, request, openSettings }: Props) {
  const [section, setSection] = useState("opportunities");
  const [selectedJobs, setSelectedJobs] = useState<Record<string, string>>({});
  const [saleQuantities, setSaleQuantities] = useState<Record<string, string>>({});
  const [manufacturingRuns, setManufacturingRuns] = useState<Record<string, string>>({});
  const [reprocessingQuantities, setReprocessingQuantities] = useState<Record<string, string>>({});
  const [showAllBlueprintContracts, setShowAllBlueprintContracts] = useState(false);
  const [contractBpcConfirmations, setContractBpcConfirmations] = useState<Record<string, { me: string; te: string; runs: string; evidence: string }>>({});
  const [projectFilter, setProjectFilter] = useState<"all" | "pinned" | "active" | "completed">("all");
  const [reprocessOutputs, setReprocessOutputs] = useState<Record<string, Record<string, string>>>({});
  const [reprocessInputs, setReprocessInputs] = useState<Record<string, string>>({});
  const [reprocessFees, setReprocessFees] = useState<Record<string, string>>({});
  const [reprocessEvidence, setReprocessEvidence] = useState<Record<string, string>>({});
  const [copyMessage, setCopyMessage] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [manufacturing, setManufacturing] = useState(true);
  const [reprocessing, setReprocessing] = useState(false);
  const [accessConfirmed, setAccessConfirmed] = useState(false);
  const [taxRate, setTaxRate] = useState("");
  const [structureOutputTypeId, setStructureOutputTypeId] = useState("");
  const [structureOutputSearch, setStructureOutputSearch] = useState("");
  const [systemCostMultiplier, setSystemCostMultiplier] = useState("1");
  const [materialBonusPercent, setMaterialBonusPercent] = useState("0");
  const [timeBonusPercent, setTimeBonusPercent] = useState("0");
  const [brokerFeePercent, setBrokerFeePercent] = useState("");
  const [reprocessingTaxRate, setReprocessingTaxRate] = useState("");
  const [reprocessingYieldPercent, setReprocessingYieldPercent] = useState("");
  const [evidence, setEvidence] = useState("");
  const [newStructureId, setNewStructureId] = useState("");
  const [newStructureName, setNewStructureName] = useState("");
  const [newStructureSystemId, setNewStructureSystemId] = useState("30000142");
  const [maxBatchCost, setMaxBatchCost] = useState("");
  const [minProductionProfit, setMinProductionProfit] = useState("");
  const [productionTypeFilter, setProductionTypeFilter] = useState("");
  const [exitBasis, setExitBasis] = useState<"immediate" | "sellOrder">("immediate");
  const [activityFilter, setActivityFilter] = useState<"all" | "manufacturing" | "reprocessing">("all");
  const [sortBy, setSortBy] = useState<"profit" | "roi" | "slotHour">("profit");
  const production = state.production;
  const isSyncing = busy || production.syncing;
  const visibleBlueprintContracts = showAllBlueprintContracts
    ? production.blueprintContracts
    : production.blueprintContracts.slice(0, 5);
  const bpcItemsNeedConfirmation = production.blueprintContracts.reduce(
    (count, contract) => count + contract.blueprints.filter((blueprint) => !blueprint.attributesKnown && blueprint.quantity > 0).length,
    0,
  );
  const visibleProjects = production.projects.filter((project) => {
    if (projectFilter === "pinned") return project.status === "pinned";
    if (projectFilter === "active") return !["pinned", "completed", "cancelled"].includes(project.status);
    if (projectFilter === "completed") return ["completed", "cancelled"].includes(project.status);
    return true;
  });
  async function copyName(name: string) {
    try {
      await request({ kind: "clipboard.copy", text: name });
      setCopyMessage(`Скопировано: ${name}`);
    } catch (error) {
      setCopyMessage(`Не удалось скопировать: ${String(error)}`);
    }
  }
  const main = state.characters.find((character) => character.isSeller);
  const isDev = state.devBuild && !state.demo;
  const selectedFacility = production.facilityOptions.find(
    (facility) => facility.id === facilityId,
  );
  const structureManufacturingReady = selectedFacility?.kind !== "structure" || !manufacturing ||
    (!!structureOutputTypeId && !!systemCostMultiplier && !!materialBonusPercent && !!timeBonusPercent && !!brokerFeePercent);
  const structureOutputMatches = structureOutputSearch.trim().length < 2 ? [] : production.manufacturingOutputs
    .filter((output) => output.name.toLocaleLowerCase().includes(structureOutputSearch.trim().toLocaleLowerCase()))
    .slice(0, 8);
  const maxCost = Number(maxBatchCost);
  const costLimit = Number.isFinite(maxCost) && maxCost > 0 ? maxCost : null;
  const minimumProfitValue = Number(minProductionProfit);
  const profitFloor = Number.isFinite(minimumProfitValue) && minimumProfitValue > 0 ? minimumProfitValue : null;
  const typeQuery = productionTypeFilter.trim().toLocaleLowerCase();
  const manufacturingProfit = (offer: AppState["production"]["offers"][number], basis = exitBasis) =>
    offer.blueprintSource.kind === "market_bpo"
      ? offer.estimate.firstCycleProfit[basis]
      : offer.estimate[basis].netProfit;
  const manufacturingRoi = (offer: AppState["production"]["offers"][number], basis = exitBasis) =>
    offer.blueprintSource.kind === "market_bpo"
      ? offer.estimate.firstCycleRoi[basis]
      : offer.estimate[basis].roi;
  const visibleManufacturingOffers = [...production.offers]
    .filter((offer) => costLimit === null || Number((offer.blueprintSource.kind === "market_bpo" ? offer.estimate.cashRequired : offer.estimate.totalCost) ?? Infinity) <= costLimit)
    .filter((offer) => profitFloor === null || Number(manufacturingProfit(offer) ?? -Infinity) >= profitFloor)
    .filter((offer) => !typeQuery || offer.itemName.toLocaleLowerCase().includes(typeQuery) || offer.itemEnglishName.toLocaleLowerCase().includes(typeQuery))
    .sort((left, right) => {
      const profit = (offer: typeof left) => Number(manufacturingProfit(offer) ?? -Infinity);
      if (sortBy === "roi") return Number(manufacturingRoi(right) ?? -Infinity) - Number(manufacturingRoi(left) ?? -Infinity);
      if (sortBy === "slotHour") {
        const perHour = (offer: typeof left) => offer.chainPlan.slotSeconds
          ? profit(offer) / (offer.chainPlan.slotSeconds / 3600)
          : -Infinity;
        return perHour(right) - perHour(left);
      }
      return profit(right) - profit(left);
    });
  const visibleContractOffers = [...production.contractOffers]
    .filter((offer) => costLimit === null || Number(offer.estimate.cashRequired ?? Infinity) <= costLimit)
    .filter((offer) => profitFloor === null || Number(offer.estimate.firstCycleProfit[exitBasis] ?? -Infinity) >= profitFloor)
    .filter((offer) => !typeQuery || offer.itemName.toLocaleLowerCase().includes(typeQuery) || offer.itemEnglishName.toLocaleLowerCase().includes(typeQuery))
    .sort((left, right) => {
      if (sortBy === "roi") return Number(right.estimate.firstCycleRoi[exitBasis] ?? -Infinity) - Number(left.estimate.firstCycleRoi[exitBasis] ?? -Infinity);
      if (sortBy === "slotHour") {
        const perHour = (offer: typeof left) => offer.chainPlan.slotSeconds
          ? Number(offer.estimate.firstCycleProfit[exitBasis] ?? -Infinity) / (offer.chainPlan.slotSeconds / 3600)
          : -Infinity;
        return perHour(right) - perHour(left);
      }
      return Number(right.estimate.firstCycleProfit[exitBasis] ?? -Infinity) - Number(left.estimate.firstCycleProfit[exitBasis] ?? -Infinity);
    });
  const visibleReprocessingOffers = [...production.reprocessingOffers]
    .filter((offer) => costLimit === null || Number(offer.estimate.totalCost ?? Infinity) <= costLimit)
    .filter((offer) => profitFloor === null || Number(offer.estimate[exitBasis].netProfit ?? -Infinity) >= profitFloor)
    .filter((offer) => !typeQuery || offer.itemName.toLocaleLowerCase().includes(typeQuery))
    .sort((left, right) => {
      if (sortBy === "roi") return Number(right.estimate[exitBasis].roi ?? -Infinity) - Number(left.estimate[exitBasis].roi ?? -Infinity);
      return Number(right.estimate[exitBasis].netProfit ?? -Infinity) - Number(left.estimate[exitBasis].netProfit ?? -Infinity);
    });
  return (
    <section className="space-y-5" aria-label="Производство">
      <header className="panel flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Factory size={20} />
            <h1 className="text-xl font-semibold">Производство</h1>
            {isDev && <span className="badge">DEV · live ESI</span>}
            {state.demo && <span className="badge demo">DEMO</span>}
          </div>
          <p className="caption mt-2">
            Jita и Perimeter · manufacturing и reprocessing · расчёты локально
          </p>
        </div>
        <div className="actions">
          <Button variant="outline" onClick={openSettings}>
            <Settings2 size={16} />
            Настроить доступ
          </Button>
          <Button
            disabled={isSyncing || state.demo}
            onClick={() => void request({ kind: "production.sync" })}
          >
            <RefreshCw size={16} className={isSyncing ? "animate-spin" : ""} />
            {isSyncing ? "Обновляем ESI…" : "Обновить данные ESI"}
          </Button>
        </div>
      </header>
      <p className="caption" role="status" aria-label="Статус обновления ESI">
        {production.syncing
          ? "Идёт обновление публичных рынков, контрактов и данных основы…"
          : production.syncError
            ? `Последнее обновление ESI не удалось: ${production.syncError}`
            : production.publicSyncedAt
              ? `Публичные данные ESI обновлены ${timestamp(production.publicSyncedAt)}`
              : "Публичные данные ESI ещё не загружены"}
      </p>
      {copyMessage && <p className="caption" role="status">{copyMessage}</p>}

      <div className="panel flex items-start gap-3" role="status">
        {production.missingScopes.length ? (
          <AlertCircle className="mt-1 shrink-0 text-amber-300" size={18} />
        ) : (
          <Factory className="mt-1 shrink-0 text-emerald-300" size={18} />
        )}
        <div className="min-w-0">
          <div className="font-medium">{production.status}</div>
          <p className="caption mt-1">
            Основа: {main?.name ?? "не подключена"}
            {production.race ? ` · раса ${production.race}` : ""}
            {production.profileAt
              ? ` · профиль ESI ${timestamp(production.profileAt)}`
              : ""}
            {` · публичный ESI ${timestamp(production.publicSyncedAt)}`}
          </p>
          {!!production.missingScopes.length && (
            <div className="mt-3 space-y-2">
              <p className="caption">
                Переподключите основу и подтвердите перечисленные read-only
                разрешения. Пароль EVE приложение не получает.
              </p>
              <ul aria-label="Недостающие ESI scopes" className="space-y-1 break-all font-mono text-xs text-muted-foreground">
                {production.missingScopes.map((scope) => <li key={scope}>{scope}</li>)}
              </ul>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !main}
                onClick={() =>
                  main &&
                  void request({
                    kind: "character.connect",
                    seller: true,
                    expectedId: main.id,
                  })
                }
              >
                Переподключить основу с разрешениями
              </Button>
            </div>
          )}
          {!!production.optionalMissingScopes.length &&
            !production.missingScopes.length && (
              <div className="mt-2 space-y-2">
                <p className="caption">
                  Рынки структур не будут видны, пока основа не выдаст необязательные разрешения {production.optionalMissingScopes.join(", ")}.
                </p>
                <Button size="sm" variant="outline" disabled={busy || !main}
                  onClick={() => main && void request({ kind: "character.connect", seller: true, expectedId: main.id })}>
                  Переподключить основу для рынков структур
                </Button>
              </div>
            )}
        </div>
      </div>

      {!!production.blueprintAcquisitions.length && (
        <div className="panel space-y-3" aria-label="Сверка стоимости BPO">
          <div>
            <h2 className="font-medium">Сверка цены приобретённых BPO</h2>
            <p className="caption mt-1">
              ESI не связывает wallet transaction с item ID чертежа. Сверь историю кошелька и выбери точную покупку по цене и времени; до этого цена BPO остаётся неподтверждённой.
            </p>
          </div>
          {production.blueprintAcquisitions.map((source) => (
            <article key={source.blueprintItemId} className="rounded border border-border p-3">
              <div className="flex flex-wrap justify-between gap-2">
                <span><CopyName name={source.typeName} onCopy={copyName} /> · {source.locationName}</span>
                <span className="caption">{source.status === "confirmed" ? `Подтверждено: ${isk(source.acquisitionPrice)} · tx ${source.transactionId}` : "Стоимость не подтверждена"}</span>
              </div>
              {source.status === "needs_confirmation" && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {source.candidateTransactions.map((transaction) => (
                    <Button key={transaction.transactionId} size="sm" variant="outline" disabled={busy || state.demo}
                      onClick={() => void request({ kind: "production.blueprint.cost.confirm", blueprintItemId: source.blueprintItemId, transactionId: transaction.transactionId })}>
                      Подтвердить {isk(transaction.unitPrice)} · {timestamp(transaction.date)} · tx {transaction.transactionId}
                    </Button>
                  ))}
                  {!source.candidateTransactions.length && <span className="caption">Подходящая покупка не найдена. Сверь кошельки и проверь, что BPO куплен на этой станции; покупка через контракт требует ручной оценки.</span>}
                  <Button size="sm" variant="ghost" disabled={busy || state.demo} onClick={() => void request({ kind: "wallet.sync" })}>Сверить кошельки</Button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <Tabs value={section} onValueChange={setSection}>
        <TabsList className="mb-4">
          <TabsTrigger value="opportunities">Возможности</TabsTrigger>
          <TabsTrigger value="projects">Мои проекты</TabsTrigger>
        </TabsList>
        <TabsContent value="opportunities" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Баланс основы · без торгового haircut" value={isk(production.mainBalance)} />
            <Metric label="Доступно новым проектам" value={isk(production.spendableCapital)} />
            <Metric label="Резерв действующих проектов" value={isk(production.reservedCapital)} />
            <Metric label="Резерв торговых сделок" value={isk(production.tradeReservedCapital)} />
            <Metric
              label="Рецепты производства из SDE"
              value={production.manufacturingRecipes.toLocaleString()}
            />
            <Metric
              label="Типы с составом переработки"
              value={production.reprocessingTypes.toLocaleString()}
            />
            <Metric label="Площадки в Jita/Perimeter" value={production.facilities} />
            <Metric label="Индексы системы и активности" value={production.systemIndices} />
            <Metric label="Adjusted prices для EIV" value={production.adjustedPrices} />
          </div>
          {production.capitalCommitmentConflict && (
            <p className="rounded-md border border-amber-700/50 p-3 text-sm text-amber-200" role="status">
              Совокупные торговые и производственные обязательства превышают баланс основы. Оба вида планов используют один кошелёк; сверьте резерв перед покупками.
            </p>
          )}

          <div className="panel space-y-3" aria-label="Публичные контракты с копиями чертежей">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-medium">BPC в публичных контрактах Jita / Perimeter</h2>
                <p className="caption mt-1">Берём ME/TE/runs из ESI, если они доступны. Неизвестные атрибуты можно сверить в клиенте EVE и подтвердить вручную; это не резервирует контракт и не подтверждает его покупку.</p>
              </div>
              <span className="badge">
                {production.contractCoverage.fetchedContracts}/{production.contractCoverage.candidateContracts} проверено
              </span>
            </div>
            {!production.contractCoverage.complete && (
              <p className="caption rounded border border-amber-700/50 p-3">ESI не дал полный список контрактов. Сохранены предыдущие данные; повторите синхронизацию.</p>
            )}
            {production.contractCoverage.capped && production.contractCoverage.complete && (
              <p className="caption rounded border border-amber-700/50 p-3">Кандидатов больше лимита сканирования; показана ограниченная часть. Полный охват не подтверждён.</p>
            )}
            {production.contractCoverage.itemErrors > 0 && (
              <p className="caption">Не удалось прочитать состав {production.contractCoverage.itemErrors} контрактов.</p>
            )}
            {bpcItemsNeedConfirmation > 0 && (
              <p className="caption rounded border border-amber-700/50 p-3">{bpcItemsNeedConfirmation} записей BPC без атрибутов ESI пока исключены из расчётов. Для свежей записи можно вручную сверить атрибуты одного экземпляра или одинакового стека копий в игре.</p>
            )}
            {!production.blueprintContracts.length ? (
              <p className="caption">Копий чертежей с доступными атрибутами пока не найдено. Контрактные чертежи ещё не включены в готовые расчёты партий.</p>
            ) : (
              <div className="space-y-2">
                {visibleBlueprintContracts.map((contract) => (
                  <article key={contract.contractId} className="rounded border border-border p-3">
                    <div className="flex flex-wrap justify-between gap-2">
                      <div className="font-medium">{contract.title || "Публичный контракт"} · {contract.locationName}</div>
                      <div className="tabular-nums">{isk(contract.price)} · до {timestamp(contract.expiresAt)}</div>
                    </div>
                    <div className="mt-2 space-y-1">
                      {contract.blueprints.map((blueprint) => {
                        const key = `${contract.contractId}:${blueprint.recordId}`;
                        const values = contractBpcConfirmations[key] ?? { me: "", te: "", runs: "", evidence: "" };
                        const valid = [values.me, values.te, values.runs].every((value) => value.trim() !== "" && Number.isInteger(Number(value))) && Number(values.me) >= 0 && Number(values.me) <= 10 && Number(values.te) >= 0 && Number(values.te) <= 20 && Number(values.runs) > 0 && values.evidence.trim().length >= 8;
                        return (
                          <div key={key} className="caption rounded border border-border/60 p-2">
                            <div className="flex flex-wrap justify-between gap-2">
                              <span><CopyName name={blueprint.typeName} onCopy={copyName} /> · {blueprint.quantity} BPC · запись #{blueprint.recordId}</span>
                              <span>{blueprint.attributesKnown ? `ME ${blueprint.materialEfficiency} · TE ${blueprint.timeEfficiency} · ${blueprint.runs} runs${blueprint.attributesSource === "manual" ? ` · вручную ${timestamp(blueprint.confirmedAt)}: ${blueprint.evidence}` : blueprint.attributesSource === "conflict" ? ` · ESI расходится с ручной сверкой от ${timestamp(blueprint.confirmedAt)}; расчёт использует ESI` : " · данные ESI"}` : "Атрибуты неизвестны — требуется сверка в игре"}</span>
                            </div>
                            {!blueprint.attributesKnown && blueprint.quantity > 0 && (
                              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                <Input aria-label={`ME контракта ${contract.contractId}, запись ${blueprint.recordId}`} type="number" min="0" max="10" step="1" placeholder="ME 0–10" value={values.me} onChange={(event) => setContractBpcConfirmations((current) => ({ ...current, [key]: { ...values, me: event.target.value } }))} />
                                <Input aria-label={`TE контракта ${contract.contractId}, запись ${blueprint.recordId}`} type="number" min="0" max="20" step="1" placeholder="TE 0–20" value={values.te} onChange={(event) => setContractBpcConfirmations((current) => ({ ...current, [key]: { ...values, te: event.target.value } }))} />
                                <Input aria-label={`Прогоны контракта ${contract.contractId}, запись ${blueprint.recordId}`} type="number" min="1" step="1" placeholder="Осталось прогонов" value={values.runs} onChange={(event) => setContractBpcConfirmations((current) => ({ ...current, [key]: { ...values, runs: event.target.value } }))} />
                                <Input aria-label={`Свидетельство контракта ${contract.contractId}, запись ${blueprint.recordId}`} placeholder="Где проверено в EVE" value={values.evidence} onChange={(event) => setContractBpcConfirmations((current) => ({ ...current, [key]: { ...values, evidence: event.target.value } }))} />
                                <div className="caption sm:col-span-2 lg:col-span-4">Откройте контракт в игре и сверьте ME, TE и оставшиеся прогоны. Атрибуты применятся ко всем {blueprint.quantity} копиям в записи #{blueprint.recordId}; подтверждайте только если это один одинаковый стек. Цена всего набора всё равно нужна для покупки.</div>
                                <Button type="button" size="sm" disabled={!valid || busy} onClick={() => void request({
                                  kind: "production.contract.blueprint.confirm",
                                  contractId: contract.contractId,
                                  recordId: blueprint.recordId,
                                  blueprintTypeId: blueprint.typeId,
                                  materialEfficiency: Number(values.me),
                                  timeEfficiency: Number(values.te),
                                  runs: Number(values.runs),
                                  evidence: values.evidence.trim(),
                                })}>Подтвердить атрибуты из игры</Button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="caption mt-2">
                      Контракт #{contract.contractId}; {contract.includedItemCount} включённых позиций. {contract.blueprintOnly ? "Только чертежи." : "Смешанный набор: расчёт использует полную цену контракта и не засчитывает остальные предметы как выручку."}
                    </div>
                    <div className="caption">
                      {contract.manufacturingEligibility === "candidate"
                        ? "Копии с известными атрибутами и рецептом; цена контракта оплачивается целиком, а стоимость распределяется по прогонам."
                        : contract.manufacturingEligibility === "mixed_contract"
                          ? "Не участвует в расчёте: цена включает другие предметы, их стоимость/ценность отдельно не оценена."
                          : contract.manufacturingEligibility === "multiple_copies"
                            ? "Не участвует в расчёте: контракт содержит несколько копий или набор копий."
                            : contract.manufacturingEligibility === "unknown_attributes"
                              ? "Не участвует в расчёте: неизвестны ME/TE/runs; проверьте копию в игре."
                              : "Не участвует в расчёте: рецепт не найден в установленном SDE."}
                    </div>
                  </article>
                ))}
                {production.blueprintContracts.length > 5 && (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-expanded={showAllBlueprintContracts}
                    onClick={() => setShowAllBlueprintContracts((value) => !value)}
                  >
                    {showAllBlueprintContracts
                      ? "Свернуть список контрактов"
                      : `Показать все контракты (${production.blueprintContracts.length})`}
                  </Button>
                )}
              </div>
            )}
          </div>

          {activityFilter !== "reprocessing" && <div className="panel space-y-3" aria-label="Предложения по публичным BPC-контрактам">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-medium">Производство с покупкой BPC-контракта</h2>
                <p className="caption mt-1">Для набора требуется вся сумма контракта. Себестоимость выбранной партии получает долю цены BPC по прогонам, оставшиеся копии и их стоимость сохраняются. Покупку нужно выполнить вручную; после синхронизации принадлежащие BPC появятся среди обычных предложений.</p>
              </div>
              <span className="badge">{visibleContractOffers.length} из {production.contractOffers.length}</span>
            </div>
            {production.contractCandidatesTotal > 0 && <p className="caption" role="status">{production.contractScanComplete ? "Проверка BPC-контрактов завершена" : "В фоне проверяются BPC-контракты"}: обработано {production.contractCandidatesScanned} из {production.contractCandidatesTotal}.</p>}
            {!visibleContractOffers.length ? (
              <p className="caption rounded border border-border p-3">{!production.contractScanComplete ? "Список контрактов ещё рассчитывается. Уже найденные предложения появятся здесь автоматически." : "Нет контрактов с известными ME/TE/runs, подходящим рецептом SDE и подтверждённой производственной станцией."}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-sm">
                  <thead><tr className="border-b border-border text-left text-muted-foreground">
                    <th className="p-2">Результат / контракт</th><th className="p-2 text-right">Прогоны / объём</th>
                    <th className="p-2 text-right">Вложения</th><th className="p-2 text-right">Сразу</th><th className="p-2 text-right">Sell-order</th>
                  </tr></thead>
                  <tbody>{visibleContractOffers.map((offer) => (
                    <tr key={offer.id} className="border-b border-border align-top">
                      <td className="p-2"><CopyName name={offer.itemName} onCopy={copyName} />
                        <div className="caption mt-1">{offer.contractTitle} · {offer.pickupLocation} · контракт проверен {timestamp(offer.contractObservedAt)} · рынок {timestamp(offer.observedAt)} · до {timestamp(offer.expiresAt)}</div>
                        <div className="caption">Контракт #{offer.contractId} · {offer.blueprintTypeName} · {offer.facilityName} · {offer.includedItemCount} позиций</div>
                        <div className="caption">Копий этого чертежа в наборе: {offer.blueprintCopies} · суммарно {offer.bundleRuns} прогонов</div>
                        {!offer.blueprintOnly && <div className="caption text-amber-300">Смешанный контракт: в затраты включена вся сумма {isk(offer.contractPrice)}; остальные предметы не оцениваются и не добавляют прибыль.</div>}
                        <MarketSignalView signal={offer.marketSignal} />
                        {offer.estimate.warnings.map((warning) => <div key={warning} className="caption text-amber-300">{warning}</div>)}
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-muted-foreground">Полная цепочка make/buy</summary>
                          <div className="mt-2 space-y-1">
                            {offer.chainPlan.reasons.map((reason) => <div key={reason} className="caption text-amber-300">{reason}</div>)}
                            {offer.chainPlan.actions.map((action) => <div key={action.id} className="flex justify-between gap-3 text-xs">
                              <span>{action.kind === "manufacturing" ? "Изготовить" : "Купить"} <CopyName name={action.typeName ?? `Type ${action.typeId}`} onCopy={copyName} /> · {action.kind === "manufacturing" ? `${action.runs} прог.` : `${action.quantity.toLocaleString("ru-RU")} шт.`}{action.facilityName ? ` · ${action.facilityName}` : ""}
                                {action.kind === "purchase" && action.sources?.map((source) => <span key={source.id} className="caption block pl-2">{source.inventoryLotId ? "Остаток проекта" : "Рыночный ордер"} · {source.locationName ?? source.locationId ?? "площадка неизвестна"} · {source.quantity.toLocaleString("ru-RU")} шт. × {isk(source.unitCost)}</span>)}
                              </span>
                              <span className="shrink-0">{isk(action.cost)}</span>
                            </div>)}
                            <div className="caption border-t border-border pt-1">Полная цепочка: {isk(offer.chainPlan.totalCost)} ISK</div>
                          </div>
                        </details>
                      </td>
                      <td className="p-2 text-right tabular-nums">{offer.runs} прогонов<div className="caption">{offer.estimate.outputQuantity.toLocaleString("ru-RU")} шт.</div></td>
                      <td className="p-2 text-right tabular-nums">{isk(offer.estimate.totalCost)}<div className="caption">Контракт целиком {isk(offer.contractPrice)} · в партии учтено BPC {isk(offer.estimate.blueprintAcquisitionCost ?? "0")} · сырьё {isk(offer.estimate.materialsCost)}</div><div className="caption">Остаётся после партии: {Math.max(0, offer.bundleRuns - offer.estimate.runs)} прогонов копий</div><div className="caption">К оплате для запуска: {isk(offer.estimate.cashRequired)}</div></td>
                      <td className="p-2 text-right tabular-nums"><strong>{isk(offer.estimate.firstCycleProfit.immediate)}</strong><div className="caption">ROI первого цикла {offer.estimate.firstCycleRoi.immediate === null ? "—" : `${(Number(offer.estimate.firstCycleRoi.immediate) * 100).toFixed(1)}%`}</div><div className="caption">Операционная прибыль партии: {isk(offer.estimate.immediate.netProfit)}</div></td>
                      <td className="p-2 text-right tabular-nums"><strong>{isk(offer.estimate.firstCycleProfit.sellOrder)}</strong><div className="caption">цена {isk(offer.estimate.sellOrder.unitPrice)} / шт.</div><div className="caption">ROI первого цикла {offer.estimate.firstCycleRoi.sellOrder === null ? "—" : `${(Number(offer.estimate.firstCycleRoi.sellOrder) * 100).toFixed(1)}%`}</div><div className="caption">Операционная прибыль партии: {isk(offer.estimate.sellOrder.netProfit)}</div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>}

          <div className="panel grid gap-3 sm:grid-cols-2 lg:grid-cols-6" aria-label="Фильтры производственных предложений">
            <label className="space-y-1 text-sm">
              <span className="caption">Вид деятельности</span>
              <select aria-label="Фильтр вида производства" className="field w-full" value={activityFilter} onChange={(event) => {
                const next = event.target.value as typeof activityFilter;
                setActivityFilter(next);
                if (next === "reprocessing" && sortBy === "slotHour") setSortBy("profit");
              }}>
                <option value="all">Все</option>
                <option value="manufacturing">Manufacturing</option>
                <option value="reprocessing">Reprocessing</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="caption">Максимальная себестоимость партии, ISK</span>
              <Input aria-label="Максимальная себестоимость партии" type="number" min="0" step="1" value={maxBatchCost} onChange={(event) => setMaxBatchCost(event.target.value)} placeholder="Без ограничения" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="caption">Минимальная чистая прибыль, ISK</span>
              <Input aria-label="Минимальная чистая прибыль производства" type="number" min="0" step="1" value={minProductionProfit} onChange={(event) => setMinProductionProfit(event.target.value)} placeholder="Без ограничения" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="caption">Тип предмета</span>
              <Input aria-label="Фильтр типа предмета производства" value={productionTypeFilter} onChange={(event) => setProductionTypeFilter(event.target.value)} placeholder="Название предмета" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="caption">Сценарий продажи</span>
              <select aria-label="Сценарий продажи" className="field w-full" value={exitBasis} onChange={(event) => setExitBasis(event.target.value as typeof exitBasis)}>
                <option value="immediate">Сразу в buy-ордера</option>
                <option value="sellOrder">Выставить sell-ордер</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="caption">Сортировка</span>
              <select aria-label="Сортировка производства" className="field w-full" value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}>
                <option value="profit">Чистая прибыль</option>
                <option value="roi">ROI</option>
                <option value="slotHour" disabled={activityFilter === "reprocessing"}>Прибыль за час производственного слота</option>
              </select>
            </label>
          </div>

          {activityFilter !== "reprocessing" && <div className="panel space-y-4" aria-label="Производственные предложения">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-medium">Готовые производственные предложения</h2>
                <p className="caption mt-1">
                  Учитываются имеющиеся чертежи и одиночные sell-ордера BPO на станциях хабов. Для BPO покупки отдельно показаны денежный результат первого цикла и окупаемость; купить и синхронизировать оригинал нужно в игре.
                </p>
              </div>
              <span className="badge">{visibleManufacturingOffers.length} из {production.offers.length} · только полный стакан</span>
            </div>
            {production.marketBpoCandidatesTotal > 0 && <p className="caption" role="status">{production.marketBpoScanComplete ? "Анализ рыночных BPO завершён" : "В фоне анализируются рыночные BPO"}: проверено {production.marketBpoCandidatesScanned} из {production.marketBpoCandidatesTotal}.</p>}
            {!visibleManufacturingOffers.length && production.offers.length ? (
              <p className="caption rounded-md border border-border p-4 text-center">
                Предложения скрыты текущими фильтрами. Снизьте минимальную прибыль, увеличьте лимит себестоимости или очистите поиск типа.
              </p>
            ) : !visibleManufacturingOffers.length ? (
              <div className="rounded-md border border-border p-5 text-center">
                <Boxes className="mx-auto text-muted-foreground" size={22} />
                <p className="mt-2 font-medium">Пока нет подтверждённых прибыльных партий</p>
                <p className="caption mx-auto mt-1 max-w-3xl">
                  Для расчёта нужны свежий рынок, Alpha-профиль основы и подтверждённый профиль Manufacturing. Проверяются как принадлежащие основе чертежи, так и доступные BPO на рынке; после покупки BPO его нужно синхронизировать, прежде чем закреплять проект.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="p-3">Результат / площадка</th>
                      <th className="p-3 text-right">Партия</th>
                      <th className="p-3 text-right">Вложения</th>
                      <th className="p-3 text-right">Продать сразу</th>
                      <th className="p-3 text-right">Выставить ордер</th>
                      <th className="p-3">Данные</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleManufacturingOffers.map((offer) => (
                      <tr key={offer.id} className="border-b border-border align-top">
                        <td className="p-3">
                          <CopyName name={offer.itemName} onCopy={copyName} />
                          <div className="caption mt-1">{offer.blueprintTypeName} · {offer.facilityName} · {offer.systemId}</div>
                          {offer.blueprintSource.kind === "market_bpo" && <div className="caption mt-1 text-amber-300">BPO ещё не принадлежит основе: купить по sell-ордеру #{offer.blueprintSource.purchaseOrderId} за {isk(offer.blueprintSource.purchasePrice)}. Первый цикл и сортировка учитывают полную покупку; после покупки синхронизируйте чертежи, чтобы закрепить план.</div>}
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-muted-foreground">Материалы и расчёт</summary>
                            <div className="mt-2 space-y-1">
                              <div className="rounded border border-border p-2">
                                <div className="flex justify-between gap-3 text-xs font-medium">
                                  <span>Полная цепочка · {offer.chainPlan.status === "ready" ? "план рассчитан" : "нужна проверка"}</span>
                                  <span>{isk(offer.chainPlan.totalCost)}</span>
                                </div>
                                {offer.chainPlan.reasons.map((reason) => <div key={reason} className="caption mt-1 text-amber-300">{reason}</div>)}
                                <div className="mt-2 space-y-1">
                                  {offer.chainPlan.actions.map((action) => (
                                    <div key={action.id} className="flex justify-between gap-3 text-xs">
                                      <span className="min-w-0">
                                        <span className={action.kind === "manufacturing" ? "text-sky-300" : "text-emerald-300"}>
                                          {action.kind === "manufacturing" ? "Изготовить" : "Купить"}
                                        </span>{" "}
                                        <CopyName name={action.typeName ?? `Type ${action.typeId}`} onCopy={copyName} />
                                        {action.kind === "manufacturing" ? ` · ${action.runs} прог.` : ` · ${action.quantity.toLocaleString("ru-RU")} шт.`}
                                        {action.facilityName ? ` · ${action.facilityName}` : ""}
                                        {action.kind === "purchase" && action.sources?.map((source) => <span key={source.id} className="caption block pl-2">{source.inventoryLotId ? "Остаток проекта" : "Рыночный ордер"} · {source.locationName ?? source.locationId ?? "площадка неизвестна"} · {source.quantity.toLocaleString("ru-RU")} шт. × {isk(source.unitCost)}</span>)}
                                      </span>
                                      <span className="shrink-0">{isk(action.cost)}</span>
                                    </div>
                                  ))}
                                </div>
                                {offer.chainPlan.status === "ready" && offer.chainPlan.actions.length === 0 && <div className="caption mt-1">Нет доступного плана полного обеспечения.</div>}
                                {offer.chainPlan.slotSeconds !== null && <div className="caption mt-1">Занятость слотов по цепочке: {(offer.chainPlan.slotSeconds / 3600).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} слот·ч.</div>}
                                {offer.chainPlan.schedule?.status === "ready" && <div className="caption mt-1">Календарный срок по цепочке: {Math.ceil((offer.chainPlan.schedule.calendarSeconds ?? 0) / 3600)} ч. · слотов: {offer.chainPlan.schedule.availableSlots} · уже занято заданиями ESI: {offer.chainPlan.schedule.occupiedSlots}</div>}
                                {offer.chainPlan.schedule?.status === "review" && offer.chainPlan.schedule.reasons.map((reason) => <div key={reason} className="caption mt-1 text-amber-300">Срок не подтверждён: {reason}</div>)}
                                <div className="caption mt-1">Срок включает только производственные задания; ожидание закупки и перевозка не оценены.</div>
                              </div>
                              <div className="caption">Ниже показана прямая закупка компонентов для сравнения; прибыль и вложения рассчитаны по полной цепочке.</div>
                              {offer.estimate.materials.map((material) => (
                                <div key={material.typeId} className="flex justify-between gap-4 text-xs">
                                  <span>
                                    <CopyName name={material.typeName} onCopy={copyName} /> × {material.quantity} · {material.filled} доступно
                                    {material.sources.length > 0 && (
                                      <span className="block pl-2 text-muted-foreground">
                                        {material.sources.map((source) => `${source.locationName}: ${source.quantity.toLocaleString("ru-RU")} шт.`).join(" · ")}
                                      </span>
                                    )}
                                  </span>
                                  <span className="shrink-0">{isk(material.totalCost)}</span>
                                </div>
                              ))}
                              <div className="caption border-t border-border pt-1">
                                EIV {isk(offer.estimate.estimatedItemValue)} · комиссия производства {isk(offer.estimate.installationFee)} · финальное задание {offer.estimate.timeSeconds === null ? "время неизвестно" : `${(offer.estimate.timeSeconds / 3600).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ч`}
                              </div>
                              {offer.estimate.warnings.map((warning) => <div key={warning} className="caption text-amber-300">{warning}</div>)}
                              <div className="caption">
                                Основной продавец: Accounting {offer.estimate.fees.accountingLevel} · Broker Relations {offer.estimate.fees.brokerRelationsLevel} · Advanced Broker Relations {offer.estimate.fees.advancedBrokerRelationsLevel}; standings {offer.estimate.fees.factionStanding}/{offer.estimate.fees.corporationStanding}; налог продажи {(Number(offer.estimate.fees.salesTaxRate) * 100).toFixed(2)}%, брокерская комиссия sell-ордера {(Number(offer.estimate.fees.brokerFeeRate) * 100).toFixed(2)}%.
                              </div>
                            </div>
                          </details>
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {offer.estimate.outputQuantity.toLocaleString("ru-RU")} шт.
                          <div className="mt-1 flex items-center justify-end gap-2">
                            <label className="sr-only" htmlFor={`production-runs-${offer.id}`}>Количество прогонов</label>
                            <Input
                              id={`production-runs-${offer.id}`}
                              aria-label={`Количество прогонов: ${offer.itemName}`}
                              className="h-8 w-24 text-right"
                              type="number"
                              min={1}
                              max={offer.maxRuns}
                              step={1}
                              value={manufacturingRuns[`${offer.id.split(":")[0]}:${offer.estimate.facilityId}`] ?? String(offer.runs)}
                              disabled={offer.blueprintSource.kind === "market_bpo"}
                              onChange={(event) => setManufacturingRuns((current) => ({ ...current, [`${offer.id.split(":")[0]}:${offer.estimate.facilityId}`]: event.target.value }))}
                            />
                            <span className="caption">/ {offer.maxRuns} прогонов</span>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || state.demo || offer.blueprintSource.kind !== "owned"}
                              onClick={() => void request({
                                kind: "production.offer.quote",
                                blueprintItemId: offer.id.split(":")[0]!,
                                facilityId: offer.estimate.facilityId,
                                runs: Number(manufacturingRuns[`${offer.id.split(":")[0]}:${offer.estimate.facilityId}`] ?? offer.runs),
                              })}
                            >Пересчитать</Button>
                          </div>
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {isk(offer.estimate.totalCost)}
                          <div className="caption mt-1">К оплате для запуска: {isk(offer.estimate.cashRequired)}</div>
                          {offer.blueprintSource.kind === "market_bpo" && <div className="caption">Из них цена BPO: {isk(offer.blueprintSource.purchasePrice)}</div>}
                          {offer.estimate.blueprintPurchaseCashCost !== null && offer.blueprintSource.kind !== "market_bpo" && (
                            <div className="caption">Полная покупка чертежа: {isk(offer.estimate.blueprintPurchaseCashCost)}</div>
                          )}
                          {offer.estimate.blueprintAcquisitionCost !== null && offer.estimate.blueprintAcquisitionCost !== "0.00" && (
                            <div className="caption">В себестоимость включена доля BPC: {isk(offer.estimate.blueprintAcquisitionCost)}</div>
                          )}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          <span className="text-emerald-300">{isk(manufacturingProfit(offer, "immediate"))}</span>
                          <div className="caption mt-1">{offer.blueprintSource.kind === "market_bpo" ? "ROI первого цикла" : "ROI"} {manufacturingRoi(offer, "immediate") === null ? "—" : `${(Number(manufacturingRoi(offer, "immediate")) * 100).toFixed(1)}%`}</div>
                          {offer.blueprintSource.kind === "market_bpo" && <div className="caption">Повторная партия: {isk(offer.estimate.immediate.netProfit)}</div>}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          <span className="text-emerald-300">{isk(manufacturingProfit(offer, "sellOrder"))}</span>
                          <div className="caption mt-1">цена {isk(offer.estimate.sellOrder.unitPrice)} / шт.</div>
                          {offer.blueprintSource.kind === "market_bpo" && <div className="caption">Повторная партия: {isk(offer.estimate.sellOrder.netProfit)} · окупаемость {offer.estimate.blueprintPaybackBatches.sellOrder === null ? "не окупается по sell-сценарию" : `${offer.estimate.blueprintPaybackBatches.sellOrder} партий`}</div>}
                        </td>
                      <td className="p-3">
                        <span className="text-emerald-300">ESI стакан</span>
                        <div className="caption mt-1">{timestamp(offer.observedAt)}</div>
                        <MarketSignalView signal={offer.marketSignal} />
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            disabled={busy || state.demo || !offer.chainExecutable}
                            onClick={() => void request({
                              kind: "production.project.pin",
                              projectId: crypto.randomUUID(),
                              offerId: offer.id,
                            })}
                          >
                            Закрепить план
                          </Button>
                          {!offer.chainExecutable && <div className="caption mt-1 text-amber-300">{offer.blueprintSource.kind === "market_bpo" ? "После покупки оригинала и синхронизации он станет доступен для закрепления и старта проекта." : "Полная цепочка не подтверждена, проект нельзя начать."}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>}

          {activityFilter !== "manufacturing" && <div className="panel space-y-4" aria-label="Предложения переработки">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-medium">Переработка с полной оценкой выходов</h2>
                <p className="caption mt-1">Рассматриваются только подтверждённые Reprocess preview, полные порции и стакан каждого выходного материала.</p>
                {activityFilter === "all" && sortBy === "slotHour" && <p className="caption mt-1">Для переработки прибыль за производственный слот не применяется; список переработки отсортирован по чистой прибыли.</p>}
              </div>
              <span className="badge">{visibleReprocessingOffers.length} из {production.reprocessingOffers.length} предложений</span>
            </div>
            {!visibleReprocessingOffers.length && production.reprocessingOffers.length ? (
              <p className="caption rounded-md border border-border p-4 text-center">
                Предложения скрыты текущими фильтрами. Снизьте минимальную прибыль, увеличьте лимит себестоимости или очистите поиск типа.
              </p>
            ) : !visibleReprocessingOffers.length ? (
              <p className="caption rounded-md border border-border p-4 text-center">
                Нет подтверждённых предложений. Нужны свежий стакан, основа с синхронизированными навыками и сохранённый итоговый процент выхода из окна Reprocess на NPC-станции Jita или Perimeter.
              </p>
            ) : visibleReprocessingOffers.map((offer) => (
              <article key={offer.id} className="rounded-md border border-border p-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <h3 className="font-medium"><CopyName name={offer.itemName} onCopy={copyName} /> · {offer.facilityName}</h3>
                    <p className="caption mt-1">{offer.estimate.inputQuantity.toLocaleString("ru-RU")} входных предметов · {offer.estimate.portions} порций · выход {(Number(offer.estimate.yieldPercent)).toFixed(2)}% · остаток {offer.estimate.residualQuantity}</p>
                  </div>
                  <span className="caption">{timestamp(offer.estimate.observedAt)}</span>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {offer.estimate.outputs.map((output) => (
                    <div key={output.typeId} className="flex flex-wrap justify-between gap-2 rounded border border-border p-2 text-sm">
                      <span><CopyName name={output.typeName} onCopy={copyName} /> × {output.quantity}</span>
                      <span className="caption">Стакан выкупает {output.sellFilled} · {isk(output.buyGross)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-1" aria-label={`Региональная история выходов ${offer.itemName}`}>
                  {offer.marketSignals.map((row) => (
                    <div key={row.typeId} className="rounded border border-border p-2">
                      <div className="caption font-medium">Ликвидность выхода: {row.itemName}</div>
                      <MarketSignalView signal={row.signal} />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap justify-between gap-2 text-sm">
                  <span>Сырьё {isk(offer.estimate.inputsCost)} · налог переработки {isk(offer.estimate.reprocessingTax)} · всего {isk(offer.estimate.totalCost)}</span>
                  <span>Сразу после налога <strong className="text-emerald-300">{isk(offer.estimate.immediate.netProfit)}</strong></span>
                  <span>Sell-order прогноз <strong className="text-emerald-300">{isk(offer.estimate.sellOrder.netProfit)}</strong></span>
                  <label className="field min-w-48">
                    Входное количество · максимум {offer.maxInputQuantity.toLocaleString("ru-RU")}
                    <Input aria-label={`Количество переработки ${offer.itemName}`} type="number" min={offer.estimate.portionSize}
                      max={offer.maxInputQuantity} step={offer.estimate.portionSize}
                      value={reprocessingQuantities[`${offer.facilityId}:${offer.estimate.inputTypeId}`] ?? String(offer.estimate.inputQuantity)}
                      onChange={(event) => setReprocessingQuantities({ ...reprocessingQuantities,
                        [`${offer.facilityId}:${offer.estimate.inputTypeId}`]: event.target.value })} />
                  </label>
                  <Button size="sm" variant="outline" disabled={busy || state.demo} onClick={() => void request({
                    kind: "production.reprocessing.quote", facilityId: offer.facilityId,
                    typeId: offer.estimate.inputTypeId,
                    inputQuantity: Number(reprocessingQuantities[`${offer.facilityId}:${offer.estimate.inputTypeId}`] ?? offer.estimate.inputQuantity),
                  })}>Пересчитать количество</Button>
                  <Button size="sm" variant="outline" disabled={busy || state.demo} onClick={() => void request({
                    kind: "production.project.pin", projectId: crypto.randomUUID(), offerId: offer.id,
                  })}>Закрепить план переработки</Button>
                </div>
                {!!offer.estimate.inputSources.length && (
                  <p className="caption mt-2">
                    Источники закупки сырья: {offer.estimate.inputSources.map((source) => `${source.locationName} — ${source.quantity.toLocaleString("ru-RU")} шт. (${isk(source.totalCost)})`).join(" · ")}. Перевозка до площадки не включена.
                  </p>
                )}
              </article>
            ))}
          </div>}

          <div className="panel space-y-4">
            <div>
              <h2 className="font-medium">Проверка площадки</h2>
              <p className="caption mt-1">
                ESI не подтверждает доступ к услугам, поэтому укажите, что вы
                проверили в игре. Неизвестные налоги и услуги не будут считаться нулевыми.
              </p>
            </div>
            <div className="space-y-3 rounded border border-border p-3">
              <div>
                <h3 className="text-sm font-medium">Добавить структуру вручную</h3>
                <p className="caption mt-1">Укажите ID, название и систему из игры. Площадка останется непроверенной, пока вы отдельно не подтвердите доступ и услуги.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="field">
                  ID структуры в Jita/Perimeter
                  <Input aria-label="ID структуры в Jita/Perimeter" inputMode="numeric" value={newStructureId} onChange={(event) => setNewStructureId(event.target.value)} />
                </label>
                <label className="field">
                  Название структуры из игры
                  <Input aria-label="Название структуры из игры" value={newStructureName} onChange={(event) => setNewStructureName(event.target.value)} />
                </label>
                <label className="field">
                  Система структуры
                  <select aria-label="Система структуры" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={newStructureSystemId} onChange={(event) => setNewStructureSystemId(event.target.value)}>
                    {["30000142", "30000144"].map((systemId) => <option key={systemId} value={systemId}>{state.systemNames[systemId] ?? (systemId === "30000142" ? "Jita" : "Perimeter")}</option>)}
                  </select>
                </label>
              </div>
              <Button
                variant="outline"
                disabled={busy || !/^\d{1,20}$/.test(newStructureId) || newStructureId === "0" || newStructureName.trim().length < 3}
                onClick={() => void request({ kind: "production.facility.register", locationId: newStructureId, name: newStructureName.trim(), systemId: newStructureSystemId as "30000142" | "30000144" }).then((result) => {
                  if (result) {
                    setFacilityId(newStructureId);
                    setNewStructureId("");
                    setNewStructureName("");
                  }
                })}
              >Добавить структуру</Button>
            </div>
            <label className="field max-w-2xl">
              Станция или структура
              <select
                aria-label="Площадка производства"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={facilityId}
                onChange={(event) => {
                  const id = event.target.value;
                  setFacilityId(id);
                  const saved = production.facilityProfiles.find((facility) => facility.id === id);
                  setManufacturing(saved ? saved.services.includes("manufacturing") : true);
                  setReprocessing(saved?.services.includes("reprocessing") ?? false);
                  setAccessConfirmed(saved?.accessStatus === "confirmed");
                  setTaxRate(saved?.taxRate ? (Number(saved.taxRate) * 100).toString() : "");
                  setReprocessingTaxRate(saved?.reprocessingTaxRate ? (Number(saved.reprocessingTaxRate) * 100).toString() : "");
                  setReprocessingYieldPercent(saved?.reprocessingYieldPercent
                    ? (Number(saved.reprocessingYieldPercent) * 100).toString()
                    : "");
                  setEvidence(saved?.evidence ?? "");
                }}
              >
                <option value="">Выберите площадку в Jita/Perimeter</option>
                {production.facilityOptions.map((facility) => (
                  <option key={facility.id} value={facility.id}>
                    {facility.name} · {state.systemNames[facility.systemId] ?? facility.systemId} · ID {facility.id}
                  </option>
                ))}
              </select>
            </label>
            {selectedFacility?.kind === "structure" && manufacturing && (
              <label className="field max-w-xs">
                Industry tax, % (из профиля услуги)
                <Input
                  aria-label="Industry tax структуры, %"
                  type="number"
                  min="0"
                  max="10"
                  step="0.01"
                  value={taxRate}
                  onChange={(event) => setTaxRate(event.target.value)}
                />
              </label>
            )}
            {selectedFacility?.kind === "structure" && manufacturing && (
              <div className="grid gap-3 rounded border border-border p-3 md:grid-cols-2 xl:grid-cols-3">
                <p className="caption md:col-span-2 xl:col-span-3">
                  Внесите значения из Industry window и окна выставления sell-ордера. Бонусы сохраняются только для выбранного изделия и не распространяются на другие рецепты.
                </p>
                <div className="field">
                  Изделие для подтверждённых бонусов
                  <Input aria-label="Поиск изделия структуры" placeholder="Введите часть названия (от 2 букв)" value={structureOutputSearch} onChange={(event) => { setStructureOutputSearch(event.target.value); setStructureOutputTypeId(""); }} />
                  {!!structureOutputMatches.length && <div role="listbox" aria-label="Найденные изделия" className="mt-1 max-h-48 overflow-auto rounded border border-border">
                    {structureOutputMatches.map((output) => <button key={output.id} type="button" role="option" aria-selected={structureOutputTypeId === output.id} className="block w-full px-2 py-1 text-left text-sm hover:bg-muted" onClick={() => { setStructureOutputTypeId(output.id); setStructureOutputSearch(output.name); }}>{output.name}</button>)}
                  </div>}
                  {structureOutputTypeId && <span className="caption">Выбрано: {structureOutputSearch} · type {structureOutputTypeId}</span>}
                </div>
                <label className="field">
                  Множитель system cost index
                  <Input aria-label="Множитель system cost index структуры" type="number" min="0" max="2" step="0.0001" value={systemCostMultiplier} onChange={(event) => setSystemCostMultiplier(event.target.value)} />
                </label>
                <label className="field">
                  Снижение материалов для изделия, %
                  <Input aria-label="Бонус материалов структуры, %" type="number" min="0" max="100" step="0.01" value={materialBonusPercent} onChange={(event) => setMaterialBonusPercent(event.target.value)} />
                </label>
                <label className="field">
                  Снижение времени для изделия, %
                  <Input aria-label="Бонус времени структуры, %" type="number" min="0" max="100" step="0.01" value={timeBonusPercent} onChange={(event) => setTimeBonusPercent(event.target.value)} />
                </label>
                <label className="field">
                  Комиссия sell-ордера, %
                  <Input aria-label="Комиссия sell-ордера структуры, %" type="number" min="0" max="100" step="0.01" value={brokerFeePercent} onChange={(event) => setBrokerFeePercent(event.target.value)} />
                </label>
              </div>
            )}
            {reprocessing && (
              <div className="flex flex-wrap gap-3">
                <label className="field max-w-xs">
                  Итоговый выход переработки, % (из игрового Reprocess preview)
                  <Input
                    aria-label="Подтверждённый выход переработки, %"
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={reprocessingYieldPercent}
                    onChange={(event) => setReprocessingYieldPercent(event.target.value)}
                  />
                </label>
                <label className="field max-w-xs">
                  Эффективный налог переработки, % (профиль станции)
                  <Input
                    aria-label="Подтверждённый налог переработки, %"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={reprocessingTaxRate}
                    onChange={(event) => setReprocessingTaxRate(event.target.value)}
                  />
                </label>
              </div>
            )}
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  aria-label="Услуга Manufacturing доступна"
                  type="checkbox"
                  checked={manufacturing}
                  onChange={(event) => setManufacturing(event.target.checked)}
                />
                Manufacturing
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  aria-label="Услуга Reprocessing доступна"
                  type="checkbox"
                  checked={reprocessing}
                  onChange={(event) => setReprocessing(event.target.checked)}
                />
                Reprocessing
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  aria-label="Доступ к площадке подтверждён в игре"
                  type="checkbox"
                  checked={accessConfirmed}
                  onChange={(event) => setAccessConfirmed(event.target.checked)}
                />
                Доступ и эти услуги проверены в игре
              </label>
            </div>
            <label className="field max-w-2xl">
              Где проверили (для структуры — также налог из профиля услуги)
              <Input
                aria-label="Свидетельство профиля площадки"
                placeholder="Например: Structure Browser, профиль Manufacturing"
                value={evidence}
                onChange={(event) => setEvidence(event.target.value)}
              />
            </label>
            <Button
              variant="outline"
              disabled={
                busy ||
                !selectedFacility ||
                (!manufacturing && !reprocessing) ||
                !accessConfirmed ||
                evidence.trim().length < 8 ||
                (reprocessing && (!reprocessingYieldPercent || !reprocessingTaxRate)) ||
                (selectedFacility.kind === "structure" && manufacturing && (!taxRate || !structureManufacturingReady))
              }
              onClick={() =>
                selectedFacility &&
                void request({
                  kind: "production.facility.save",
                  locationId: selectedFacility.id,
                  services: [
                    ...(manufacturing ? (["manufacturing"] as const) : []),
                    ...(reprocessing ? (["reprocessing"] as const) : []),
                  ],
                  accessConfirmed,
                  ...(selectedFacility.kind === "structure" && manufacturing ? { taxRate } : {}),
                  ...(selectedFacility.kind === "structure" && manufacturing ? {
                    outputTypeId: structureOutputTypeId,
                    systemCostMultiplier,
                    materialBonusPercent,
                    timeBonusPercent,
                    brokerFeePercent,
                  } : {}),
                  ...(reprocessing ? { reprocessingYieldPercent, reprocessingTaxRate } : {}),
                  evidence: evidence.trim(),
                })
              }
            >
              Сохранить подтверждённый профиль
            </Button>
            {!!production.facilityProfiles.length && (
              <div aria-label="Сохранённые профили площадок" className="space-y-2 border-t border-border pt-3">
                <div className="caption">Сохранённые профили</div>
                {production.facilityProfiles.map((facility) => (
                  <div key={facility.id} className="flex flex-wrap justify-between gap-2 text-sm">
                    <span>{facility.name} · {facility.services.join(", ") || "услуги не подтверждены"} · {state.systemNames[facility.systemId] ?? facility.systemId} · ID {facility.id}</span>
                    <span className="caption">
                      {facility.accessStatus === "confirmed" ? "доступ подтверждён" : facility.accessStatus === "unavailable" ? "доступ недоступен" : "доступ не подтверждён"}
                      {facility.profileSource === "manual" ? " · ручное добавление/подтверждение" : " · обнаружено через ESI"}
                      {facility.taxRate ? ` · tax ${(Number(facility.taxRate) * 100).toFixed(2)}%` : " · tax неизвестен"}
                      {facility.reprocessingYieldPercent ? ` · reprocess ${(Number(facility.reprocessingYieldPercent) * 100).toFixed(2)}%` : ""}
                      {facility.reprocessingTaxRate ? ` · reprocess tax ${(Number(facility.reprocessingTaxRate) * 100).toFixed(2)}%` : " · reprocess tax неизвестен"}
                      {facility.structureProductProfiles.map((product) => ` · ${product.outputName}: ME ${product.materialBonusPercent}% / TE ${product.timeBonusPercent}% / fee ${(Number(product.brokerFeeRate) * 100).toFixed(2)}% · ${timestamp(product.observedAt)}`)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="flex items-center gap-2 font-medium">
              <Factory size={17} />
              Источники и свежесть данных
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <div className="caption">Основной персонаж · Alpha профиль</div>
                <p className="mt-1">
                  Навыки, чертежи, assets, задания и контракты: {timestamp(production.syncedAt)}
                </p>
                <p className="caption mt-1">
                  Alpha: {production.alphaUsableSkills} доступных навыков
                  {production.alphaCappedSkills
                    ? ` · ${production.alphaCappedSkills} выше Alpha cap и не учитываются`
                    : ""}
                </p>
                <p className="caption mt-1">
                  Найдено в последней сверке: {production.assets} assets · {production.blueprints} чертежей · {production.jobs} заданий · {production.contracts} контрактов
                </p>
              </div>
              <div>
                <div className="caption">Публичные площадки и системные индексы</div>
                <p className="mt-1">Последняя синхронизация: {timestamp(production.publicSyncedAt)}</p>
                <p className="caption mt-1">
                  SDE {production.sdeVersion ?? "не загружен"}; цены и ESI-ответы
                  кешируются по сроку, указанному сервером.
                </p>
                <div className="mt-3 space-y-2">
                  <div className="caption">Рынки структур в Jita/Perimeter</div>
                  {production.structureMarketCoverage.length ? production.structureMarketCoverage.map((source) => {
                    const stateLabel = {
                      not_checked: "не проверено",
                      missing_scope: "нужен scope рынка структур",
                      available: "доступен",
                      stale: "устарел; новый стакан не подтверждён",
                      forbidden: "ESI запретил доступ",
                      capped: "слишком много страниц; сохранён прежний снимок",
                      failed: "ошибка обновления; сохранён прежний снимок",
                    }[source.state];
                    return <div key={source.structureId} className="flex flex-wrap justify-between gap-2 text-sm">
                      <span>{source.structureName} · {source.systemId}</span>
                      <span className="caption">
                        {stateLabel}{source.state === "available" || source.state === "stale" ? ` · последний снимок: ${source.orderCount.toLocaleString("ru-RU")} ордеров, ${timestamp(source.observedAt)}` : ""}
                        {source.message ? ` · ${source.message}` : ""}
                      </span>
                    </div>;
                  }) : <p className="caption">Нет сохранённых профилей структур. Добавьте ID структуры и подтвердите доступ и услуги, чтобы проверить её рынок через ESI.</p>}
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="flex items-center gap-2 font-medium">
              <AlertCircle size={17} />
              Порог достоверности расчёта
            </div>
            <p className="caption mt-2">
              ESI сообщает публичные объекты и системные индексы, но не
              подтверждает доступ основы к услугам структуры, её rig-бонусы и
              проектное потребление материалов. Такие параметры нельзя
              подставлять нулём: до подтверждения площадки предложение должно
              оставаться на проверке.
            </p>
            <p className="caption mt-2">
              Для Alpha прогноз учитывает дополнительный налог 2% по справке
              CCP от 4 февраля 2026. В старых патчноутах Viridian указано 0,25%;
              поэтому ставку нужно подтвердить по окну Industry персонажа.
            </p>
            <p className="caption mt-2">
              Расчёт возможности начнётся только после выбора площадки, синхронизации
              основы и подтверждения чертежа. Неизвестное остаётся помеченным, а не
              превращается в нулевую стоимость.
            </p>
          </div>
        </TabsContent>
        <TabsContent value="projects">
          <div className="space-y-3">
            {!!production.projects.length && (
              <div className="panel flex flex-wrap items-center justify-between gap-3">
                <label className="field max-w-sm">
                  Проекты
                  <select aria-label="Фильтр проектов" className="field w-full" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value as typeof projectFilter)}>
                    <option value="all">Все · {production.projects.length}</option>
                    <option value="pinned">Закреплённые · {production.projects.filter((project) => project.status === "pinned").length}</option>
                    <option value="active">В работе · {production.projects.filter((project) => !["pinned", "completed", "cancelled"].includes(project.status)).length}</option>
                    <option value="completed">Завершённые · {production.projects.filter((project) => ["completed", "cancelled"].includes(project.status)).length}</option>
                  </select>
                </label>
                <span className="badge">{visibleProjects.length} показано</span>
              </div>
            )}
            {!production.projects.length ? (
              <div className="panel empty">
                <Boxes size={32} className="mx-auto text-muted-foreground" />
                <h2>Проектов пока нет</h2>
                <p>Закрепите проверенное предложение; запуск останется отдельным действием и создаст денежный резерв.</p>
              </div>
            ) : !visibleProjects.length ? (
              <div className="panel empty"><h2>В этом разделе пока нет проектов</h2><p>Выберите другой фильтр, чтобы увидеть остальные планы.</p></div>
            ) : visibleProjects.map((project) => (
              <article key={project.id} className="panel space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-medium"><CopyName name={project.itemName} onCopy={copyName} /> × {project.outputQuantity.toLocaleString("ru-RU")}</h2>
                    <p className="caption mt-1">План · обновлён {timestamp(project.updatedAt)}</p>
                  </div>
                  <span className="badge">{{
                    pinned: "Закреплён",
                    purchasing: "Закупка",
                    planning: "Планирование",
                    partially_ready: "Частично обеспечен",
                    in_production: "В производстве",
                    ready_for_sale: "Готов к продаже",
                    partially_sold: "Частично продан",
                    reconciling: "Сверка",
                    completed: "Завершён",
                    cancelled: "Отменён",
                    needs_review: "Нужна проверка",
                  }[project.status]}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Metric label="Исходный прогноз себестоимости" value={isk(project.expectedCost)} />
                  <div>
                    <Metric label="Текущая себестоимость · факт + остаток по рынку" value={isk(project.currentExpectedCost)} />
                    <p className="caption mt-1">{project.currentCostObservedAt ? `Стакан проверен ${timestamp(project.currentCostObservedAt)}` : project.currentExpectedCost ? "Оставшиеся материалы уже куплены; сумма основана на фактических затратах" : "Не хватает свежего стакана или подтверждённых данных о сборе"}</p>
                  </div>
                  <Metric label="Прогноз прибыли сразу" value={isk(project.expectedProfit)} />
                  <Metric label="Сейчас по buy-стакану · весь выпуск" value={isk(project.currentExpectedProfit.immediate)} />
                  <Metric label="Сейчас по sell-ордерам · весь выпуск" value={isk(project.currentExpectedProfit.sellOrder)} />
                  <Metric label="Фактически реализовано" value={isk(project.realizedProfit)} />
                </div>
                {project.productionSchedule && (
                  <div className="rounded-md border border-border p-3">
                    <div className="text-sm font-medium">Оставшееся производство</div>
                    {project.productionSchedule.status === "ready" && project.productionSchedule.calendarSeconds !== null
                      ? <p className="caption mt-1">Оценка: {Math.ceil(project.productionSchedule.calendarSeconds / 3600)} ч. · слотов: {project.productionSchedule.availableSlots} · занято ESI-заданиями: {project.productionSchedule.occupiedSlots}{project.productionSchedule.waitingForPurchases ? " · время закупки не включено" : ""}</p>
                      : project.productionSchedule.reasons.map((reason) => <p key={reason} className="caption mt-1 text-amber-300">Срок не подтверждён: {reason}</p>)}
                    <p className="caption mt-1">Расчёт учитывает завершённые этапы и текущие ESI-задания; перевозка и ожидание закупки не оцениваются.</p>
                  </div>
                )}
                {!!project.boundJobs.length && (
                  <div className="space-y-1 border-t border-border pt-3">
                    <div className="caption">Связанные задания основы · только после явного выбора</div>
                    {project.boundJobs.map((job) => (
                      <div key={job.jobId} className="text-sm">
                        Job #{job.jobId} · {job.status} · {job.runs} прогонов · {timestamp(job.endAt)}
                      </div>
                    ))}
                  </div>
                )}
                {!!project.materials.length && (
                  <div className="space-y-2 border-t border-border pt-3">
                    <div className="caption">Материалы проекта · покупки связываются после подтверждения, остатки других проектов резервируются автоматически</div>
                    {project.materials.map((material) => (
                      <div key={material.typeId} className="flex flex-wrap justify-between gap-2 text-sm">
                        <span><CopyName name={material.typeName} onCopy={copyName} /> · обеспечено {material.purchased.toLocaleString("ru-RU")} / {material.required.toLocaleString("ru-RU")}</span>
                        <span className="caption">Себестоимость обеспеченного: {isk(material.actualCost)}{material.existingLotQuantity ? ` · из остатков проектов ${material.existingLotQuantity.toLocaleString("ru-RU")} шт.` : ""}</span>
                        {material.purchased < material.required && (
                          <div className="w-full caption">
                            {material.currentBuySources.length > 0
                              ? `Текущий стакан покрывает ${material.currentBuyFilled.toLocaleString("ru-RU")} / ${material.currentBuyRequired.toLocaleString("ru-RU")} шт. Доступно для закупки: ${material.currentBuySources.map((source) =>
                                `${source.quantity.toLocaleString("ru-RU")} шт. в ${source.locationName} по ${Number(source.unitPrice).toLocaleString("ru-RU")} ISK/шт.`,
                              ).join("; ")}`
                              : project.currentMarketFresh
                                ? `В текущем sell-стакане нет доступной глубины для недостающих ${material.currentBuyRequired.toLocaleString("ru-RU")} шт.`
                                : `Нет свежего рыночного снимка для оценки недостающих ${material.currentBuyRequired.toLocaleString("ru-RU")} шт.`}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {!!project.inventoryAllocations.length && (
                  <div className="space-y-1 border-t border-border pt-3">
                    <div className="caption">Зарезервированные остатки из других проектов</div>
                    {project.inventoryAllocations.map((allocation) => (
                      <div key={`${allocation.sourceLotId}:${allocation.typeId}`} className="caption">
                        <CopyName name={allocation.typeName} onCopy={copyName} /> · {allocation.quantity} шт. из «{allocation.sourceProjectName}» · использовано {allocation.consumedQuantity} · {isk(allocation.unitCost)} ISK/шт.
                      </div>
                    ))}
                  </div>
                )}
                {!!project.purchases.length && (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <div className="caption">Подходящие покупки из истории кошелька основы</div>
                    {project.purchases.map((purchase) => {
                      const required = project.materials.find((material) => material.typeId === purchase.typeId);
                      const needed = Math.max(0, (required?.required ?? 0) - (required?.purchased ?? 0));
                      const quantity = Math.min(needed, purchase.available);
                      return (
                        <div key={`${purchase.characterId}:${purchase.transactionId}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span>{purchase.typeName} × {purchase.available} доступно · {purchase.unitPrice} ISK/шт. · {purchase.locationName} · {new Date(purchase.date).toLocaleString()}</span>
                          <Button size="sm" variant="outline" disabled={busy || quantity <= 0} onClick={() => void request({
                            kind: "production.purchase.allocate",
                            projectId: project.id,
                            characterId: purchase.characterId,
                            transactionId: purchase.transactionId,
                            quantity,
                          })}>
                            Учесть {quantity} шт.
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {project.kind === "reprocessing" && project.status === "partially_ready" && (
                  <div className="space-y-3 rounded-md border border-border p-3">
                    <div>
                      <div className="font-medium">Подтвердите фактический Reprocess</div>
                      <p className="caption">После ручной переработки в EVE внесите выход из окна результата и фактическую комиссию. Приложение распределит себестоимость по ожидаемой стоимости выходов и сохранит остаток входного материала.</p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="field">
                        Фактически переработано входного материала (порция {project.reprocessingPortionSize})
                        <Input aria-label={`Переработано входа ${project.id}`} type="number" min={project.reprocessingPortionSize ?? 1}
                          max={project.materials[0]?.purchased ?? project.plannedInputQuantity ?? undefined}
                          step={project.reprocessingPortionSize ?? 1}
                          value={reprocessInputs[project.id] ?? String(project.plannedInputQuantity ?? "")}
                          onChange={(event) => setReprocessInputs({ ...reprocessInputs, [project.id]: event.target.value })} />
                      </label>
                      {project.plannedOutputs.map((output) => (
                        <label key={output.typeId} className="field">
                          Фактически получено: <CopyName name={output.typeName} onCopy={copyName} />
                          <Input aria-label={`Фактический выход ${output.typeName}`} type="number" min="0" step="1"
                            value={reprocessOutputs[project.id]?.[output.typeId] ?? String(output.quantity)}
                            onChange={(event) => setReprocessOutputs({ ...reprocessOutputs, [project.id]: {
                              ...reprocessOutputs[project.id], [output.typeId]: event.target.value,
                            } })} />
                        </label>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="field max-w-xs">
                        Фактическая комиссия переработки, ISK
                        <Input aria-label={`Фактическая комиссия проекта ${project.id}`} type="number" min="0" step="0.01"
                          value={reprocessFees[project.id] ?? ""}
                          onChange={(event) => setReprocessFees({ ...reprocessFees, [project.id]: event.target.value })} />
                      </label>
                      <label className="field min-w-64 flex-1">
                        Источник подтверждения
                        <Input aria-label={`Подтверждение переработки ${project.id}`} placeholder="Например: Reprocess preview / результат в игре"
                          value={reprocessEvidence[project.id] ?? ""}
                          onChange={(event) => setReprocessEvidence({ ...reprocessEvidence, [project.id]: event.target.value })} />
                      </label>
                      <Button disabled={busy || !reprocessFees[project.id] || (reprocessEvidence[project.id]?.trim().length ?? 0) < 8 ||
                        !Number(reprocessInputs[project.id] ?? project.plannedInputQuantity) ||
                        project.plannedOutputs.some((output) => reprocessOutputs[project.id]?.[output.typeId] === undefined || reprocessOutputs[project.id]?.[output.typeId] === "")}
                        onClick={() => void request({
                          kind: "production.reprocessing.confirm", projectId: project.id,
                          consumedInput: Number(reprocessInputs[project.id] ?? project.plannedInputQuantity),
                          actualFee: reprocessFees[project.id]!,
                          outputs: project.plannedOutputs.map((output) => ({
                            typeId: output.typeId, quantity: Number(reprocessOutputs[project.id]?.[output.typeId] ?? output.quantity),
                          })),
                          evidence: reprocessEvidence[project.id]!.trim(), actionId: crypto.randomUUID(),
                        })}>
                        Сохранить фактический результат
                      </Button>
                    </div>
                  </div>
                )}
                {project.kind === "manufacturing" && ["partially_ready", "in_production"].includes(project.status) && project.manufacturingNodes.some((node) => node.status !== "complete") && (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <div className="caption">Этапы manufacturing · сначала завершите этапы, которые обеспечивают компоненты следующих работ</div>
                    {project.manufacturingNodes.filter((node) => node.status !== "complete").map((node) => {
                      const selectionKey = `${project.id}:${node.id}`;
                      const matchingJobs = production.availableJobs.filter((job) =>
                        job.blueprintId === node.blueprintItemId && job.blueprintTypeId === node.blueprintTypeId &&
                        job.facilityId === project.facilityId && job.runs === node.runs && job.productTypeId === node.outputTypeId
                      );
                      return <div key={node.id} className="flex flex-wrap items-end gap-2 rounded border border-border p-2">
                        <div className="min-w-56 flex-1 text-sm">
                          {node.isFinal ? "Конечный продукт" : "Компонент цепочки"}: <CopyName name={node.outputName} onCopy={copyName} /> × {node.outputQuantity.toLocaleString("ru-RU")}
                          <div className="caption">{node.runs} прогонов · {node.status === "in_production" ? "задание уже связано" : node.canStart ? "готов к запуску в игре" : "ожидает закупку или предыдущий этап"}</div>
                        </div>
                        <label className="field min-w-64 flex-1">
                          Задание Manufacturing из ESI
                          <select aria-label={`Задание этапа ${node.outputName}`} className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                            disabled={!node.canStart} value={selectedJobs[selectionKey] ?? ""}
                            onChange={(event) => setSelectedJobs({ ...selectedJobs, [selectionKey]: event.target.value })}>
                            <option value="">Выберите совпадающее задание</option>
                            {matchingJobs.map((job) => <option key={job.jobId} value={job.jobId}>#{job.jobId} · {job.status} · {timestamp(job.endAt)}</option>)}
                          </select>
                        </label>
                        <Button size="sm" disabled={busy || !node.canStart || !selectedJobs[selectionKey]} onClick={() => void request({
                          kind: "production.job.bind", projectId: project.id, nodeId: node.id, jobId: selectedJobs[selectionKey]!,
                        })}>Связать этап</Button>
                      </div>;
                    })}
                    <p className="caption">Аппка сопоставляет каждое задание отдельно по чертежу, площадке, продукту и прогонам. Компонентные работы должны завершиться до конечного продукта.</p>
                  </div>
                )}
                {!!project.outputLots.length && (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <div className="caption">Выпуск проекта · остаток учитывается отдельно от проданного</div>
                    {project.outputLots.map((lot) => (
                      <div key={lot.id} className="rounded border border-border p-2">
                        <div className="flex flex-wrap justify-between gap-2 text-sm">
                          <span><CopyName name={lot.typeName} onCopy={copyName} /> · {lot.isFinal ? "финальный продукт" : "промежуточный остаток"} · выпущено {lot.quantity}, свободно {lot.available}, зарезервировано {lot.reserved} · себестоимость {isk(lot.unitCost)} / шт.</span>
                          <span className="caption">{timestamp(lot.createdAt)}</span>
                        </div>
                        {lot.isFinal && lot.available > 0 && project.saleCandidates.filter((sale) => sale.typeId === lot.typeId).map((sale) => {
                          const allocationKey = `${project.id}:${lot.id}:${sale.transactionId}`;
                          const maxQuantity = Math.min(lot.available, sale.available);
                          const quantity = Math.min(maxQuantity, Math.max(0, Number(saleQuantities[allocationKey] ?? maxQuantity)));
                          return (
                            <div key={allocationKey} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                              <span>Продажа {timestamp(sale.date)} · {sale.available}/{sale.transactionQuantity} доступно · чистое поступление {isk(sale.netTotal)}</span>
                              <Input aria-label={`Количество продажи ${sale.transactionId}`} className="w-28" type="number" min="1" max={maxQuantity} value={saleQuantities[allocationKey] ?? String(maxQuantity)} onChange={(event) => setSaleQuantities({ ...saleQuantities, [allocationKey]: event.target.value })} />
                              <Button size="sm" variant="outline" disabled={busy || quantity < 1} onClick={() => void request({
                                kind: "production.sale.allocate", projectId: project.id, outputLotId: lot.id,
                                transactionId: sale.transactionId, quantity, actionId: crypto.randomUUID(),
                              })}>Сверить продажу</Button>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {project.status === "pinned" && (
                    <Button disabled={busy || state.demo} onClick={() => void request({ kind: "production.project.start", projectId: project.id })}>
                      Начать проект
                    </Button>
                  )}
                  {!(["completed", "cancelled"] as string[]).includes(project.status) && (
                    <Button variant="outline" disabled={busy || state.demo} onClick={() => void request({ kind: "production.project.cancel", projectId: project.id })}>
                      Отменить проект
                    </Button>
                  )}
                </div>
                {project.status === "purchasing" && <p className="caption">Резерв локальный. Кошелёк сам не распределяет покупки: подтвердите каждую подходящую транзакцию выше.</p>}
                {project.status === "partially_ready" && <p className="caption">Сверка личных покупок обновляет фактическую себестоимость. Оставшиеся материалы закупайте вручную в EVE.</p>}
                {project.status === "reconciling" && <p className="caption">Все предметы распределены, но ESI не подтвердил одну или несколько производственных комиссий. Фактическая прибыль скрыта до проверки расходов.</p>}
              </article>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
