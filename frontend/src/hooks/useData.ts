"use client";

import useSWR from "swr";
import {
  endpoints,
  fetchJson,
  type AgentStatus,
  type Alert,
  type Asset,
  type BuildingCollection,
  type LiveState,
  type LiveWeather,
  type Meta,
  type Timeline,
  type ZoneCollection,
  type ZoneExplanation,
} from "@/lib/api";

const STATIC = { revalidateOnFocus: false, revalidateOnReconnect: false, dedupingInterval: 60_000 };
const STARTUP_POLL_MS = 2_500;

export function useMeta() {
  return useSWR<Meta>(endpoints.meta, fetchJson, {
    ...STATIC,
    // Poll quickly while the backend is still waiting for Postgres or seeding, then settle down.
    refreshInterval: (data) => (data && data.startup?.phase !== "ready" ? STARTUP_POLL_MS : 30_000),
  });
}
// Data hooks accept `enabled` so a first boot never hammers routes that answer 503 until `ready`.
export function useZones(enabled = true) {
  return useSWR<ZoneCollection>(enabled ? endpoints.zones : null, fetchJson, STATIC);
}
export function useTimeline(enabled = true) {
  return useSWR<Timeline>(enabled ? endpoints.timeline : null, fetchJson, STATIC);
}
export function useAlerts(enabled = true) {
  return useSWR<Alert[]>(enabled ? endpoints.alerts : null, fetchJson, STATIC);
}
export function useAssets(enabled = true) {
  return useSWR<Asset[]>(enabled ? endpoints.assets : null, fetchJson, STATIC);
}
/** Towers are static build-time data; fetched only once the 3D map is up. */
export function useBuildings(enabled: boolean) {
  return useSWR<BuildingCollection>(enabled ? endpoints.buildings : null, fetchJson, STATIC);
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
