import { Link } from "@tanstack/react-router";
import { ShieldCheck, Lock, Trash2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

const points: { icon: LucideIcon; text: string }[] = [
  { icon: Lock, text: "Documents stay in your device storage" },
  { icon: Trash2, text: "Wipe everything with a single tap" },
  { icon: ShieldCheck, text: "Never used for model training" },
];

export function AuthLayout({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 grid-veil" />
      <div className="pointer-events-none absolute inset-0 veil-glow" />

      <div className="relative mx-auto grid min-h-screen max-w-6xl gap-12 px-5 py-10 lg:grid-cols-2 lg:items-center">
        <div className="hidden lg:block">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-signal">
              <span className="size-3 rounded-[3px] bg-signal-foreground" />
            </span>
            <span className="font-display text-lg font-bold">telux</span>
          </Link>
          <h2 className="mt-14 max-w-md text-4xl font-bold">
            The only document tool that keeps <span className="text-signal-gradient">nothing</span>.
          </h2>
          <ul className="mt-10 space-y-4">
            {points.map((p) => (
              <li key={p.text} className="flex items-center gap-3 text-muted-foreground">
                <span className="grid size-9 place-items-center rounded-lg border border-border bg-surface">
                  <p.icon className="size-4 text-signal" />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>

        <div className="surface-card mx-auto w-full max-w-md p-8">
          <Link to="/" className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-8 place-items-center rounded-lg bg-signal">
              <span className="size-3 rounded-[3px] bg-signal-foreground" />
            </span>
            <span className="font-display text-lg font-bold">telux</span>
          </Link>

          <span className="eyebrow">{eyebrow}</span>
          <h1 className="mt-3 text-3xl font-bold">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>

          <div className="mt-8">{children}</div>

          <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  type,
  placeholder,
  autoComplete,
  value,
  onChange,
  required,
  id,
}: {
  label: string;
  type: string;
  placeholder: string;
  autoComplete?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
  id?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        required={required}
        className="mt-2 w-full rounded-xl border border-input bg-surface-2/60 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-signal focus:ring-2 focus:ring-signal/30 focus:outline-none"
      />
    </label>
  );
}
