import type { UpdateView } from "../shared/contracts/update";
import type { Request } from "./MarketView";
import { Button } from "./components/ui/button";
export function UpdatePanel({
  update,
  request,
  busy,
}: {
  update?: UpdateView;
  request: Request;
  busy: boolean;
}) {
  if (!update) return null;
  return (
    <section
      className="border-t border-border pt-4 space-y-3"
      aria-label="Обновления приложения"
    >
      <div className="flex justify-between">
        <strong>Обновления приложения</strong>
        <span className="caption">Версия {update.currentVersion}</span>
      </div>
      <p className="text-sm" role="status">
        {update.message}
        {update.nextVersion ? " · " + update.nextVersion : ""}
      </p>
      {update.phase === "downloading" && (
        <>
          <progress
            aria-label="Загрузка обновления"
            max={100}
            value={update.percent}
            className="w-full"
          />
          <span className="caption">{update.percent.toFixed(0)}%</span>
        </>
      )}
      <div className="actions">
        <Button
          variant="outline"
          disabled={
            busy ||
            [
              "unavailable",
              "checking",
              "downloading",
              "downloaded",
              "installing",
            ].includes(update.phase)
          }
          onClick={() => void request({ kind: "update.check" })}
        >
          Проверить обновления
        </Button>
        {update.phase === "available" && (
          <Button
            disabled={busy}
            onClick={() => void request({ kind: "update.download" })}
          >
            Скачать обновление
          </Button>
        )}
        {update.phase === "downloaded" && (
          <Button
            disabled={busy}
            onClick={() => void request({ kind: "update.install" })}
          >
            Обновить и перезапустить
          </Button>
        )}
      </div>
      <p className="caption">
        GitHub Releases · данные портфеля сохраняются. Новая версия применяется
        после вашего нажатия.
      </p>
    </section>
  );
}
