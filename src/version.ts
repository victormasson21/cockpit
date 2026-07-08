// version.ts — pure formatter for the header's app-version tag (dev vs packaged build).
export function versionLabel(version: string | null, dev: boolean): string {
  const v = version ? `v${version}` : "";
  if (!dev) return v;
  return v ? `${v} · dev` : "dev";
}
