import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Settings2,
  Orbit,
  ArrowLeftRight,
  History,
  Radio,
  Database,
  ChevronRight,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import type {
  AppState,
  Bridge,
  Settings,
  AppRequest,
} from "../shared/contracts/app";
import "./styles.css";
import { MarketView } from "./MarketView";
import { DealsView } from "./DealsView";
import { UpdatePanel } from "./UpdatePanel";
import { money } from "./lib/format";
declare global {
  interface Window {
    eve: Bridge;
  }
}
function App() {
  const [state, setState] = useState<AppState | null>(null),
    [error, setError] = useState(""),
    [settingsOpen, setSettingsOpen] = useState(false),
    [draft, setDraft] = useState<Settings | null>(null),
    [busy, setBusy] = useState(false);
  const lastAlert = useRef<string | null>(null);
  useEffect(() => {
    const alert = state?.notifications.at(-1);
    if (!alert || lastAlert.current === alert.id) return;
    const initial = lastAlert.current === null;
    lastAlert.current = alert.id;
    if (initial || !state?.settings.sound) return;
    const context = new AudioContext();
    const tone = context.createOscillator(),
      gain = context.createGain();
    tone.frequency.value = 660;
    gain.gain.value = 0.08;
    tone.connect(gain);
    gain.connect(context.destination);
    tone.start();
    tone.stop(context.currentTime + 0.18);
    tone.onended = () => void context.close();
  }, [state]);
  async function request(r: AppRequest) {
    setBusy(true);
    setError("");
    try {
      const s = await window.eve.request(r);
      setState(s);
      return s;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось выполнить действие",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const refresh = () => {
      if (inFlight) return;
      inFlight = true;
      void window.eve
        .request({ kind: "state" })
        .then((s) => {
          if (alive) setState(s);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        })
        .finally(() => {
          inFlight = false;
        });
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  if (!state)
    return (
      <main className="app">
        <div className="brand">EVE / TRADER</div>
        <div className="empty">
          <h2>{error ? "Не удалось открыть базу" : "Подготовка портфеля…"}</h2>
          {error && <p role="alert">{error}</p>}
        </div>
      </main>
    );
  return (
    <main className="app">
      <header className="topbar">
        <div>
          <div className="brand">EVE / TRADER</div>
          <div className="caption mt-5">Доступно для закупок</div>
          <div className="wallet numeric">
            {money(state.available)}{" "}
            <span className="text-base text-muted-foreground">ISK</span>
          </div>
          <div className="caption">
            Основа:{" "}
            {state.mainBalance === null
              ? "не подключена"
              : money(state.mainBalance)}{" "}
            · Защищённый резерв 20%
          </div>
        </div>
        <details className="caption">
          <summary>Баланс и резервы</summary>
          <p>
            Общий баланс: {money(state.wallet, 2)} ISK · резерв сделок:{" "}
            {money(state.reserved, 2)} ISK
          </p>
          {state.characters.map((c) => (
            <p key={c.id}>
              {c.name}: {money(c.balance, 2)} ISK · {c.status}
            </p>
          ))}
        </details>
        <div className="text-right">
          <div className="actions justify-end">
            <span className={`badge ${state.demo ? "demo" : ""}`}>
              {state.demo ? "DEMO" : "Локальный портфель"}
            </span>
            <Button
              variant="outline"
              onClick={() => {
                setDraft(state.settings);
                setSettingsOpen(true);
              }}
            >
              <Settings2 size={16} />
              Настройки
            </Button>
          </div>
          <div className="caption mt-5">
            {state.characters.filter((c) => c.status !== "revoked").length}/3
            персонажей подключено
          </div>
          <div className="caption mt-2 flex items-center justify-end gap-2">
            <Radio size={12} />
            {state.sync}
          </div>
        </div>
      </header>
      {state.update &&
        ["available", "downloading", "downloaded", "installing"].includes(
          state.update.phase,
        ) && (
          <div className="panel flex items-center justify-between gap-4 mt-4">
            <span>
              {state.update.message} {state.update.nextVersion}
            </span>
            <Button
              variant="outline"
              onClick={() => {
                setDraft(state.settings);
                setSettingsOpen(true);
              }}
            >
              Обновление приложения
            </Button>
          </div>
        )}

      {state.notifications.length > 0 && (
        <details className="panel text-sm">
          <summary>Новые возможности · {state.notifications.length}</summary>
          {state.notifications.slice(-5).map((n) => (
            <p key={n.id}>
              {n.name} · прогноз {n.profit} ISK ·{" "}
              {new Date(n.at).toLocaleTimeString()}
            </p>
          ))}
        </details>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <Tabs defaultValue="market" className="mt-8">
        <TabsList className="mb-5">
          <TabsTrigger value="market">
            <Orbit size={15} />
            Рынок
          </TabsTrigger>
          <TabsTrigger value="current">
            <ArrowLeftRight size={15} />
            Текущие сделки
          </TabsTrigger>
          <TabsTrigger value="closed">
            <History size={15} />
            Закрытые сделки
          </TabsTrigger>
        </TabsList>
        <TabsContent value="market">
          {state.opportunities.length || state.characters.length === 3 ? (
            <MarketView state={state} request={request} busy={busy} />
          ) : (
            <section className="panel empty">
              <Orbit size={34} className="mx-auto text-muted-foreground" />
              <h2>Начните с подключения персонажей</h2>
              <p>
                Укажите Client ID приложения EVE в настройках. Три кошелька
                нужны для подтверждённого бюджета.
              </p>
              <Button
                onClick={() => {
                  setDraft(state.settings);
                  setSettingsOpen(true);
                }}
              >
                Открыть настройки
                <ChevronRight size={16} />
              </Button>
            </section>
          )}
        </TabsContent>
        <TabsContent value="current">
          <DealsView state={state} request={request} busy={busy} />
        </TabsContent>
        <TabsContent value="closed">
          <DealsView state={state} request={request} busy={busy} closed />
        </TabsContent>
      </Tabs>
      <footer className="footer">
        <span className="flex gap-2 items-center">
          <Database size={13} />
          SQLite · {(state.databaseSize / 1024).toFixed(0)} КБ · хранится на
          этом компьютере
        </span>
        <span>Покупка и продажа — вручную в EVE</span>
      </footer>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Настройки портфеля</DialogTitle>
            <DialogDescription>
              Настройки сохраняются локально. Пароль EVE приложению не нужен.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <>
              <UpdatePanel
                update={state.update}
                request={request}
                busy={busy}
              />
              <label className="field">
                Client ID приложения EVE
                <Input
                  aria-label="Client ID"
                  value={draft.clientId}
                  onChange={(e) =>
                    setDraft({ ...draft, clientId: e.target.value })
                  }
                />
              </label>
              <p className="caption">
                Регистрация и scopes описаны в SSO_SETUP.md. Callback:
                http://localhost:43827/callback. Первый персонаж — основной
                продавец.
              </p>
              <div className="space-y-2">
                {state.characters.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span>
                      {c.name} {c.isSeller ? "· основной продавец" : ""} ·{" "}
                      {c.status}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || state.demo}
                      onClick={() =>
                        void request({ kind: "character.disconnect", id: c.id })
                      }
                    >
                      Отключить
                    </Button>
                    {c.status === "revoked" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || state.demo}
                        onClick={() =>
                          void request({
                            kind: "character.connect",
                            seller: c.isSeller,
                            expectedId: c.id,
                          })
                        }
                      >
                        Подключить снова
                      </Button>
                    )}
                  </div>
                ))}
                <div className="actions">
                  <Button
                    variant="outline"
                    disabled={
                      busy || state.demo || state.characters.length >= 3
                    }
                    onClick={() =>
                      void request({
                        kind: "character.connect",
                        seller: !state.characters.some((c) => c.isSeller),
                      })
                    }
                  >
                    {state.characters.some((c) => c.isSeller)
                      ? "Подключить персонажа"
                      : "Подключить основного продавца"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || state.characters.length !== 3}
                    onClick={() => void request({ kind: "wallet.sync" })}
                  >
                    Сверить кошельки
                  </Button>
                </div>
              </div>
              <div className="settings-grid">
                <label className="field">
                  Минимальная прибыль позиции, ISK
                  <Input
                    aria-label="Минимальная прибыль"
                    value={draft.minProfit}
                    onChange={(e) =>
                      setDraft({ ...draft, minProfit: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Минимальная прибыль рейса, ISK
                  <Input
                    value={draft.minTripProfit}
                    onChange={(e) =>
                      setDraft({ ...draft, minTripProfit: e.target.value })
                    }
                  />
                </label>
              </div>
              <div className="settings-grid">
                <label className="field">
                  Порог уведомления, ISK
                  <Input
                    value={draft.notificationThreshold}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        notificationThreshold: e.target.value,
                      })
                    }
                  />
                </label>
                <label className="field">
                  Звук уведомлений
                  <input
                    type="checkbox"
                    checked={draft.sound}
                    onChange={(e) =>
                      setDraft({ ...draft, sound: e.target.checked })
                    }
                  />
                </label>
              </div>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void request({ kind: "export" })}
              >
                Экспорт истории и признаков
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  const s = await request({
                    kind: "settings.save",
                    value: draft,
                  });
                  if (s) setSettingsOpen(false);
                }}
              >
                Сохранить настройки
              </Button>
              <div className="border-t border-border pt-4 actions">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void request({ kind: "backup" })}
                >
                  Резервная копия
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void request({ kind: "restore" })}
                >
                  Восстановить
                </Button>
              </div>
              <Button
                variant="outline"
                disabled={busy || state.demo}
                onClick={() => void request({ kind: "static.update" })}
              >
                Обновить официальный SDE {state.market.version}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  await request({
                    kind: state.demo ? "demo.disable" : "demo.enable",
                  });
                  setSettingsOpen(false);
                }}
              >
                {state.demo
                  ? "Вернуться к реальному портфелю"
                  : "Открыть DEMO отдельно"}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
