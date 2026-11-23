import { useEffect, useState } from "react";
import { api, type AppUpdate } from "../lib/api";

let cached: Promise<AppUpdate> | null = null;

/** Dernière version publiée sur GitHub (vérifiée une seule fois par lancement). */
export function useAppUpdate(force = 0) {
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (force) cached = null;
    cached ??= api.checkUpdate();
    setChecking(true);
    setError("");
    cached
      .then(setUpdate)
      .catch((e) => {
        cached = null;
        setError(String(e));
      })
      .finally(() => setChecking(false));
  }, [force]);
  return { update, error, checking };
}
