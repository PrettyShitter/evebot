import { parentPort, workerData } from "node:worker_threads";
import { migrateMarketCache, retireLegacyMarketData } from "../db/market-cache";

const input = workerData as { portfolioPath: string; cachePath: string };
void migrateMarketCache(input.portfolioPath, input.cachePath, {
  onProgress: (phase) => parentPort?.postMessage({ progress: phase }),
})
  .then((result) => {
    parentPort?.postMessage({ progress: "Новая база проверена; удаляем дублируемые данные рынка из портфеля…" });
    retireLegacyMarketData(input.portfolioPath, input.cachePath);
    parentPort?.postMessage({ result });
  })
  .catch((error) =>
    parentPort?.postMessage({
      error: error instanceof Error ? error.message : "Не удалось подготовить рыночный кеш",
    }),
  );
