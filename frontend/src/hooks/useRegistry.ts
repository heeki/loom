import { useState, useEffect, useCallback } from "react";
import type { RegistryRecord } from "@/api/types";
import * as registryApi from "@/api/registry";

export function useRegistry() {
  const [records, setRecords] = useState<RegistryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecords = useCallback(async (params?: { status?: string; descriptorType?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const data = await registryApi.listRegistryRecords(params);
      setRecords(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch registry records");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  return { records, loading, error, fetchRecords };
}
