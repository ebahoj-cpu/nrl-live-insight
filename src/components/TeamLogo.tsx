import { logoUrl } from "@/lib/teams";
import { useState } from "react";

export function TeamLogo({ themeKey, name, size = 48, light = true }: { themeKey: string; name: string; size?: number; light?: boolean }) {
  // 0 = primary (light if requested), 1 = retry with non-light, 2 = give up -> initials
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  if (stage === 2 || !themeKey) {
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
  const src = logoUrl(themeKey, stage === 0 ? light : false);
  return (
    <img
      src={src}
      alt={`${name} logo`}
      width={size}
      height={size}
      onError={() => setStage((s) => (s === 0 ? 1 : 2))}
      className="object-contain"
      style={{ width: size, height: size }}
      loading="lazy"
    />
  );
}
