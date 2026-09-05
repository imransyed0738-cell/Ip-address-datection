import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { supabase } from "@/integrations/supabase/client";

export type SecurityEvent = {
  id: string;
  event_type: string;
  ip_address: string | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  location_label: string | null;
  risk_score: number;
  risk_level: string;
  risk_reasons: string[];
  status: string;
  created_at: string;
};

export type SecurityAlert = {
  id: string;
  title: string;
  description: string | null;
  severity: string;
  category: string;
  read: boolean;
  created_at: string;
};

export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", auth.user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useSecurityEvents(limit = 50) {
  return useQuery({
    queryKey: ["security_events", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("security_events")
        .select(
          "id, event_type, ip_address, device_type, browser, os, location_label, risk_score, risk_level, risk_reasons, status, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as SecurityEvent[];
    },
  });
}

export function useAlerts() {
  return useQuery({
    queryKey: ["security_alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("security_alerts")
        .select("id, title, description, severity, category, read, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as SecurityAlert[];
    },
  });
}

export function useDevices() {
  return useQuery({
    queryKey: ["devices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("devices")
        .select("*")
        .order("last_seen", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Live stream: refreshes queries the instant a new event or alert lands. */
export function useSecurityRealtime() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("security-stream")
      .on("postgres_changes", { event: "*", schema: "public", table: "security_events" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["security_events"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "security_alerts" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["security_alerts"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);
}

export function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function prettyEvent(type: string) {
  return type
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
