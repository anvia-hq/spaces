import { useCallback, useEffect, useRef, useState } from "react";

export interface Polled<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  stale: boolean;
  refresh: () => Promise<void>;
  setData: (value: T | null) => void;
}

export function usePoll<T>(loader: () => Promise<T>, ms = 2000): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const mounted = useRef(true);

  const tick = useCallback(async () => {
    try {
      const value = await loader();

      if (mounted.current) {
        setData(value);
        setError(null);
        setStale(false);
      }
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : String(e));
        setStale(true);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void tick();
    const id = setInterval(() => void tick(), ms);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [tick, ms]);

  return { data, error, loading, stale, refresh: tick, setData };
}
