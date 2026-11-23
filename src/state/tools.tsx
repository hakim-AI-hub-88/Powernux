import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, CHANGED_EVENT, PROGRESS_EVENT, type Progress, type ToolsList } from "../lib/api";

interface ToolsContextValue {
  data: ToolsList | null;
  loading: boolean;
  progress: Record<string, Progress>;
  errors: Record<string, string>;
  refresh: (fromNetwork?: boolean) => Promise<void>;
  /** Exécute une opération sur un outil en capturant son erreur. */
  run: (id: string, op: () => Promise<unknown>) => Promise<boolean>;
  clearError: (id: string) => void;
}

const ToolsContext = createContext<ToolsContextValue | null>(null);

/** État partagé du système de modules (liste, progression des téléchargements, erreurs). */
export function ToolsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ToolsList | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const refresh = useCallback(async (fromNetwork = false) => {
    setLoading(true);
    try {
      setData(await api.list(fromNetwork));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh(true);
    const subs = [
      listen(CHANGED_EVENT, () => refresh()),
      listen<Progress>(PROGRESS_EVENT, ({ payload }) => {
        setProgress((p) => {
          const next = { ...p };
          if (payload.stage === "done" || payload.stage === "error") delete next[payload.id];
          else next[payload.id] = payload;
          return next;
        });
      }),
    ];
    return () => {
      subs.forEach((s) => s.then((f) => f()));
    };
  }, [refresh]);

  const clearError = (id: string) =>
    setErrors((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });

  const run = async (id: string, op: () => Promise<unknown>) => {
    clearError(id);
    try {
      await op();
      return true;
    } catch (e) {
      setErrors((x) => ({ ...x, [id]: String(e) }));
      return false;
    } finally {
      refresh();
    }
  };

  return (
    <ToolsContext.Provider value={{ data, loading, progress, errors, refresh, run, clearError }}>
      {children}
    </ToolsContext.Provider>
  );
}

export function useTools() {
  const ctx = useContext(ToolsContext);
  if (!ctx) throw new Error("useTools doit être utilisé dans <ToolsProvider>");
  return ctx;
}
