"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Número que pisca quando muda. É o único movimento do painel: no refresh de
 * 2 minutos, só os valores que realmente mudaram chamam atenção.
 */
export function Num({
  value,
  format,
  className,
}: {
  value: number | string | null | undefined;
  format: (value: never) => string;
  className?: string;
}) {
  const text = format(value as never);
  const previous = useRef(text);
  const [ticked, setTicked] = useState(false);

  useEffect(() => {
    if (previous.current === text) return;
    previous.current = text;
    setTicked(true);
    const timer = setTimeout(() => setTicked(false), 600);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <span className={cn("tnum", ticked && "ticked", className)}>{text}</span>
  );
}
