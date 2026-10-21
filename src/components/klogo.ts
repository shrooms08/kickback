// The Kickback "K" mark on a 300x300 grid: two squares and two arcs.
// Each piece has its own entrance (kbK1..kbK4), staggered by 70ms.

export interface KPath { tag: 'rect' | 'path', attrs: Record<string, string>, anim: string, svg: string }

const raw: Array<Omit<KPath, 'svg'>> = [
  { tag: 'rect', attrs: { x: '0', y: '0', width: '100', height: '100', rx: '4' }, anim: 'kbK1' },
  { tag: 'rect', attrs: { x: '0', y: '200', width: '100', height: '100', rx: '4' }, anim: 'kbK2' },
  { tag: 'path', attrs: { d: 'M100 104Q100 100 104 100L137 100A63 63 0 0 0 200 37L200 4Q200 0 204 0L296 0Q300 0 300 4L300 39A161 161 0 0 1 139 200L104 200Q100 200 100 196Z' }, anim: 'kbK3' },
  { tag: 'path', attrs: { d: 'M200 296L200 204Q200 200 204 200.1A100 100 0 0 1 299.9 296Q300 300 296 300L204 300Q200 300 200 296Z' }, anim: 'kbK4' },
]

export const K_PATHS: KPath[] = raw.map(p => ({
  ...p,
  svg: `<${p.tag} ${Object.entries(p.attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`,
}))
