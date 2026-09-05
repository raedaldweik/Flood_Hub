"use client";

import useSWR from "swr";
import {
  endpoints,
  fetchJson,
  type AgentStatus,
  type Alert,
  type Asset,
  type LiveState,
  type LiveWeather,
  type Meta,
  type Timeline,
  type ZoneCollection,
  type ZoneExplanation,
} from "@/lib/api";

const STATIC = { revalidateOnFocus: false, revalidateOnReconnect: false, dedupingInterval: 60_000 };

export function useMeta() {
  return useSWR<Meta>(endpoints.meta, fetchJson, { ...STATIC, refreshInterval: 30_000 });
}
export function useZones() {
  return useSWR<ZoneCollection>(endpoints.zones, fetchJson, STATIC);
}
export function useTimeline() {
  return useSWR<Timeline>(endpoints.timeline, fetchJson, STATIC);
}
export function useAlerts() {
  return useSWR<Alert[]>(endpoints.alerts, fetchJson, STATIC);
}
export function useAssets() {
  return useSWR<Asset[]>(endpoints.assets, fetchJson, STATIC);
}
export function useAgentStatus() {
  return useSWR<AgentStatus>(endpoints.agentStatus, fetchJson, STATIC);
}
export function useLiveWeather(enabled: boolean) {
  return useSWR<LiveWeather>(enabled ? endpoints.liveWeather : null, fetchJson, { refreshInterval: 600_000 });
}
export function useLiveState(enabled: boolean) {
  return useSWR<LiveState>(enabled ? endpoints.liveState : null, fetchJson, { refreshInterval: 600_000 });
}
export function useExplain(zoneId: string | null, tick: number, enabled: boolean) {
  return useSWR<ZoneExplanation>(enabled && zoneId ? endpoints.explain(zoneId, tick) : null, fetchJson, {
    keepPreviousData: true,
    dedupingInterval: 500,
  });
}
