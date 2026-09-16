import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { supabase } from "@/integrations/supabase/client";
import { getDeviceInfo } from "@/lib/device";

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
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", auth.user.id)
          .maybeSingle();
        if (error) {
          console.warn("[Profile] Fetch error:", error.message);
        }
        return data ?? { id: auth.user.id, email: auth.user.email };
      } catch {
        return { id: auth.user.id, email: auth.user.email };
      }
    },
  });
}

export function useSecurityEvents(limit = 50) {
  return useQuery({
    queryKey: ["security_events", limit],
    retry: 1,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Your session is not available. Please sign in again.");
      try {
        const { data, error } = await supabase
          .from("security_events")
          .select(
            "id, event_type, ip_address, device_type, browser, os, location_label, risk_score, risk_level, risk_reasons, status, created_at",
          )
          .eq("user_id", auth.user.id)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error) {
          console.warn("[Events] Fetch warning:", error.message);
          return [];
        }
        return (data ?? []) as SecurityEvent[];
      } catch {
        return [];
      }
    },
  });
}

export function useAlerts() {
  return useQuery({
    queryKey: ["security_alerts"],
    retry: 1,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Your session is not available. Please sign in again.");
      try {
        const { data, error } = await supabase
          .from("security_alerts")
          .select("id, title, description, severity, category, read, created_at")
          .eq("user_id", auth.user.id)
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) {
          return [];
        }
        return (data ?? []) as SecurityAlert[];
      } catch {
        return [];
      }
    },
  });
}

export function useDevices() {
  return useQuery({
    queryKey: ["devices"],
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Your session is not available. Please sign in again.");
      const currentDev = getDeviceInfo();
      const defaultDevice = {
        id: "active-browser-device",
        user_id: auth.user.id,
        device_key: currentDev.deviceKey,
        device_name: currentDev.deviceName,
        device_type: currentDev.deviceType,
        browser: currentDev.browser,
        os: currentDev.os,
        trusted: true,
        last_ip: "Current Browser",
        last_seen: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };

      try {
        const { data, error } = await supabase
          .from("devices")
          .select("*")
          .eq("user_id", auth.user.id)
          .order("last_seen", { ascending: false });
        if (error || !data || data.length === 0) {
          return [defaultDevice];
        }
        return data;
      } catch {
        return [defaultDevice];
      }
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
      .on("postgres_changes", { event: "*", schema: "public", table: "devices" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["devices"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["profile"] });
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
