import type { UpdateView } from "../shared/contracts/update";
export interface UpdateBackend {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  allowPrerelease: boolean;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(silent?: boolean, runAfter?: boolean): void;
}
export class UpdateController {
  private value: UpdateView;
  private operation = false;
  constructor(
    private backend: UpdateBackend,
    version: string,
    reason: string | null,
    private prepare: () => Promise<void>,
    private clock: () => number = Date.now,
    private resetInstall: () => void = () => {},
  ) {
    this.value = {
      currentVersion: version,
      phase: reason ? "unavailable" : "idle",
      nextVersion: null,
      percent: 0,
      message: reason ?? "Проверка обновлений через GitHub Releases",
      checkedAt: null,
    };
    backend.autoDownload = false;
    backend.autoInstallOnAppQuit = false;
    backend.allowDowngrade = false;
    backend.allowPrerelease = false;
    backend.on("update-available", (info) => {
      const version = (info as { version?: unknown })?.version;
      if (typeof version !== "string") return;
      this.patch({
        phase: "available",
        nextVersion: version.slice(0, 100),
        message: "Доступна новая версия",
      });
    });
    backend.on("update-not-available", () =>
      this.patch({
        phase: "idle",
        nextVersion: null,
        message: "Установлена последняя версия",
      }),
    );
    backend.on("download-progress", (progress) => {
      const percent = (progress as { percent?: unknown })?.percent;
      this.patch({
        phase: "downloading",
        percent:
          typeof percent === "number" && Number.isFinite(percent)
            ? Math.max(0, Math.min(100, percent))
            : 0,
        message: "Загрузка обновления",
      });
    });
    backend.on("update-downloaded", () =>
      this.patch({
        phase: "downloaded",
        percent: 100,
        message: "Обновление готово. Можно перезапустить приложение.",
      }),
    );
    // Do not pass raw updater errors/URLs/tokens into renderer or logs.
    backend.on("error", () => {
      if (this.value.phase === "installing") this.resetInstall();
      this.failed();
    });
  }
  reportRollback() {
    this.patch({
      message:
        "Предыдущее обновление не запустилось. Восстановлены прежняя версия и резервная копия данных.",
    });
  }
  get view(): UpdateView {
    return { ...this.value };
  }
  private patch(patch: Partial<UpdateView>) {
    this.value = { ...this.value, ...patch };
  }
  private failed() {
    this.patch({
      phase: "error",
      message:
        "Не удалось обновить приложение. Проверьте сеть и повторите проверку. Текущая версия и данные сохранены.",
    });
  }
  async check(automatic = false) {
    if (
      this.operation ||
      ["unavailable", "downloaded", "installing"].includes(this.value.phase)
    )
      return;
    if (
      automatic &&
      this.value.checkedAt &&
      this.clock() - Date.parse(this.value.checkedAt) < 3600000
    )
      return;
    this.operation = true;
    this.patch({
      phase: "checking",
      message: "Проверяем новые версии…",
      percent: 0,
      checkedAt: new Date(this.clock()).toISOString(),
    });
    try {
      await this.backend.checkForUpdates();
    } catch {
      this.failed();
    } finally {
      this.operation = false;
    }
  }
  async download() {
    if (this.operation || this.value.phase !== "available") return;
    this.operation = true;
    this.patch({
      phase: "downloading",
      percent: 0,
      message: "Загрузка обновления",
    });
    try {
      await this.backend.downloadUpdate();
    } catch {
      this.failed();
    } finally {
      this.operation = false;
    }
  }
  async install() {
    if (this.operation || this.value.phase !== "downloaded") return;
    this.operation = true;
    this.patch({
      phase: "installing",
      message: "Сохраняем резервную копию перед перезапуском…",
    });
    try {
      await this.prepare();
      this.backend.quitAndInstall(false, true);
    } catch {
      this.resetInstall();
      this.patch({
        phase: "downloaded",
        message:
          "Перезапуск отложен: дождитесь окончания операций и проверьте свободное место для резервной копии. Затем повторите.",
      });
    } finally {
      this.operation = false;
    }
  }
}
