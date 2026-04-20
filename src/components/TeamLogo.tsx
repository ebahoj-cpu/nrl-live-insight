import { logoUrl } from "@/lib/teams";
import { useState } from "react";

export function TeamLogo({ themeKey, name, size = 48, light = true }: { themeKey: string; name: string; size?: number; light?: boolean }) {
  const [err, setErr] = useState(false);
  if (err || !themeKey) {
    return (
      <div
        className="rounded-full bg-surface-2 border border-border flex items-center justify-center text-xs font-bold text-muted-foreground"
        style={{ width: size, height: size }}
        aria-label={name}
      >
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={logoUrl(themeKey, light)}
      alt={`${name} logo`}
      width={size}
      height={size}
      onError={() => setErr(true)}
      className="object-contain"
      style={{ width: size, height: size }}
      loading="lazy"
    />
  );
}
