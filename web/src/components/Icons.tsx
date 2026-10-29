import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "car" | "home" | "status" | "assistant" | "inspect" | "history" | "washer"
  | "calendar" | "cloud" | "mic" | "play" | "pause" | "close" | "plus"
  | "arrow" | "check" | "camera" | "volume" | "spark" | "eye"
  | "refresh" | "bell" | "shield" | "chevron" | "file" | "menu" | "profile" | "settings" | "pin" | "navigation";

export function Icon({ name, size = 24, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  const shared = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const, ...props };
  const paths: Record<IconName, ReactNode> = {
    car: <><path d="M4 11 6 5.8A2 2 0 0 1 7.9 4.5h8.2A2 2 0 0 1 18 5.8L20 11"/><path d="M3.5 11h17v7a1 1 0 0 1-1 1h-2v-2h-11v2h-2a1 1 0 0 1-1-1v-7Z"/><path d="M3.5 12.2 6.5 13m14-0.8-3 0.8M7 15h1m8 0h1"/></>,
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z"/></>,
    status: <><path d="M4.1 18a9 9 0 1 1 15.8 0H4.1Z"/><path d="M12 14.5 16.5 9M7 15h.01M12 7h.01M17 15h.01"/><circle cx="12" cy="14.5" r="1"/></>,
    assistant: <><rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M2 13h2m16 0h2M9 13h.01M15 13h.01M9 17c1.7 1 4.3 1 6 0"/></>,
    inspect: <><path d="M4 11 6 5.8A2 2 0 0 1 7.9 4.5h8.2A2 2 0 0 1 18 5.8L20 11"/><path d="M3.5 11h17v7a1 1 0 0 1-1 1h-16a1 1 0 0 1-1-1v-7Z"/><path d="M8 15h8"/></>,
    history: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 8h7m-7 4h7m-7 4h4"/></>,
    washer: <><path d="M3 13c3-4 15-4 18 0l-3.7 6H6.7L3 13Z"/><path d="M12 13v3m-4-5-2-2m10 2 2-2M6 5l.01-.01M12 3l.01-.01M18 5l.01-.01"/></>,
    calendar: <><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 10h16"/></>,
    cloud: <><path d="M6.5 18a4.5 4.5 0 0 1-.3-9A6 6 0 0 1 17.6 10 4 4 0 0 1 18 18H6.5Z"/><path d="M9 20l1-2m3 2 1-2"/></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4m-4 0h8"/></>,
    play: <path d="m9 6 9 6-9 6V6Z" fill="currentColor" stroke="none"/>,
    pause: <><path d="M9 6v12m6-12v12" strokeWidth="3"/></>,
    close: <path d="M5 5 19 19M19 5 5 19"/>,
    plus: <path d="M12 4v16M4 12h16"/>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6"/></>,
    check: <path d="m4 12 5 5L20 6"/>,
    camera: <><path d="M3 8h4l2-3h6l2 3h4v11H3V8Z"/><circle cx="12" cy="13" r="3"/></>,
    volume: <><path d="M4 9h4l5-4v14l-5-4H4V9Zm12-1a6 6 0 0 1 0 8m2-11a10 10 0 0 1 0 14"/></>,
    spark: <><path d="m12 2 1.9 7.1L21 11l-7.1 1.9L12 20l-1.9-7.1L3 11l7.1-1.9L12 2Zm7 15 .5 1.5L21 19l-1.5.5L19 21l-.5-1.5L17 19l1.5-.5L19 17Z"/></>,
    eye: <><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z"/><circle cx="12" cy="12" r="2.5"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 9a7 7 0 0 1 12-2l2 5M4 12l2 5a7 7 0 0 0 12-2"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 6.5-2.5 8-2.5 10h17C20.5 16 18 14.5 18 8Z"/><path d="M10 21h4"/></>,
    shield: <><path d="M12 2 20 5v6c0 5-3 8-8 11-5-3-8-6-8-11V5l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    file: <><path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
    profile: <><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M9.5 2.8h5l.7 2.2 2 1.2 2.2-.5 2.5 4.3-1.5 1.7v2.5l1.5 1.7-2.5 4.3-2.2-.5-2 1.2-.7 2.2h-5l-.7-2.2-2-1.2-2.2.5-2.5-4.3 1.5-1.7v-2.5l-1.5-1.7 2.5-4.3 2.2.5 2-1.2.7-2.2Z"/></>,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    navigation: <><path d="m4 20 7-16 2 7 7 2-16 7Z"/></>,
  };
  return <svg {...shared}>{paths[name]}</svg>;
}

export function Waveform({ active = false }: { active?: boolean }) {
  return <div className={`waveform${active ? " is-active" : ""}`} aria-hidden="true">
    {Array.from({ length: 33 }, (_, i) => <i key={i} style={{ height: `${5 + (Math.abs(Math.sin(i * .77) * Math.cos(i * .31)) * 22)}px` }} />)}
  </div>;
}
