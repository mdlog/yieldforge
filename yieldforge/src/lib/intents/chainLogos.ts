// Bundled at build time (see src/assets/chains/LICENSE); no logo is fetched from another site at runtime.
const files = import.meta.glob<string>('../../assets/chains/*.svg', { eager: true, query: '?url', import: 'default' })
const LOGOS: Record<string, string> = Object.fromEntries(Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -4), url]))

/** The bundled logo of a 1Click chain id, or undefined for the few chains without a published logo. */
export function chainLogo(chain: string): string | undefined {
  return LOGOS[chain]
}
