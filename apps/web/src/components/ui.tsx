import type { ButtonHTMLAttributes } from "react";

const BASE =
  "rounded-xl px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";

export function PrimaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`${BASE} bg-accent text-white hover:bg-accent/90 ${props.className ?? ""}`} />;
}

export function SecondaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`${BASE} border border-line bg-surface hover:border-accent ${props.className ?? ""}`} />;
}

export const FIELD =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-accent";
