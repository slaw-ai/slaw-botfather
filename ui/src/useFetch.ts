import { useCallback, useEffect, useState } from "react";

export function useFetch<T>(fn: () => Promise<T>, deps: unknown[] = [], pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoFn = useCallback(fn, deps);

  const reload = useCallback(() => {
    memoFn()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [memoFn]);

  useEffect(() => {
    reload();
    if (pollMs) {
      const t = setInterval(reload, pollMs);
      return () => clearInterval(t);
    }
  }, [reload, pollMs]);

  return { data, error, loading, reload };
}
