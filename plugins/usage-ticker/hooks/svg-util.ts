// Small, pure helpers for the desktop SVGs: escaping, numbers, ring arcs, text widths, and the checks
// every generated drawing must pass before the engine's Svg element gets it.

export const MAX_SVG_CHARS = 131072

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
// Safe in text and in a double- or single-quoted attribute.
export const escape = (s: string): string => s.replace(/[&<>"']/g, c => ESC[c]!)

// A coordinate as short text: at most two decimals, never "-0", never NaN.
export const n = (x: number): string => {
  if (!Number.isFinite(x)) return '0'
  const r = Math.round(x * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}

export const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0)

// The point a fraction of the way round a circle, starting at twelve o'clock and going clockwise.
export const polar = (cx: number, cy: number, r: number, frac: number): { x: number; y: number } => {
  const a = (frac * 360 - 90) * (Math.PI / 180)
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

// The clockwise arc from one fraction of the circle to another; empty when there is nothing to draw.
// A whole turn is two half arcs, as a single SVG arc cannot end where it starts.
export const arcPath = (cx: number, cy: number, r: number, from: number, to: number): string => {
  const a = clamp01(from)
  const b = clamp01(to)
  if (b - a <= 1e-4) return ''
  const p = polar(cx, cy, r, a)
  if (b - a >= 0.9999) {
    const q = polar(cx, cy, r, a + 0.5)
    return `M${n(p.x)} ${n(p.y)}A${n(r)} ${n(r)} 0 1 1 ${n(q.x)} ${n(q.y)}A${n(r)} ${n(r)} 0 1 1 ${n(p.x)} ${n(p.y)}`
  }
  const q = polar(cx, cy, r, b)
  return `M${n(p.x)} ${n(p.y)}A${n(r)} ${n(r)} 0 ${b - a > 0.5 ? 1 : 0} 1 ${n(q.x)} ${n(q.y)}`
}

// Text widths. The monospace advance is 0.6 em in SF Mono and Menlo; the sans table is a slightly generous
// reading of SF Pro Text, so layout errs toward room to spare.
export const MONO_EM = 0.6
export const monoWidth = (text: string, size: number, letterSpacing = 0): number =>
  [...text].length * (size * MONO_EM + letterSpacing)

const SANS_NARROW = new Set([...`iIjl.,:;'|!·()[] `])
const SANS_WIDE = new Set([...'mwMW@%'])
export const sansWidth = (text: string, size: number): number => {
  let em = 0
  for (const c of text) {
    if (SANS_NARROW.has(c)) em += 0.3
    else if (SANS_WIDE.has(c)) em += 0.88
    else if (c >= 'A' && c <= 'Z') em += 0.68
    else if (c >= '0' && c <= '9') em += 0.62
    else em += 0.56
  }
  return em * size
}

// The longest start of `text` that fits `maxWidth`, ending in an ellipsis when cut.
export const fit = (text: string, maxWidth: number, measure: (s: string) => number): string => {
  if (measure(text) <= maxWidth) return text
  const chars = [...text]
  for (let k = chars.length - 1; k > 0; k--) {
    const s = `${chars.slice(0, k).join('').trimEnd()}…`
    if (measure(s) <= maxWidth) return s
  }
  return ''
}

// A strict little XML reader: enough to prove a drawing is well formed and to walk it in tests.
export type XNode = { name: string; attrs: Record<string, string>; children: XNode[]; text: string }
export type Parsed = { ok: true; root: XNode } | { ok: false; error: string }

const NAME = /[A-Za-z_][\w.:-]*/y
const ENTITY = /^&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/
const DECODE: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

const goodText = (s: string): boolean => {
  if (s.includes('<')) return false
  for (let k = s.indexOf('&'); k !== -1; k = s.indexOf('&', k + 1)) if (!ENTITY.test(s.slice(k))) return false
  return true
}
const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : DECODE[e]!)

export const parseXml = (src: string): Parsed => {
  const doc: XNode = { name: '#doc', attrs: {}, children: [], text: '' }
  const stack = [doc]
  let i = 0
  const fail = (why: string): Parsed => ({ ok: false, error: `${why} at ${i}` })
  const name = (): string | null => {
    NAME.lastIndex = i
    const m = NAME.exec(src)
    if (!m) return null
    i += m[0].length
    return m[0]
  }
  const ws = () => {
    while (i < src.length && /\s/.test(src[i]!)) i++
  }
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    const chunk = src.slice(i, lt === -1 ? src.length : lt)
    const top = stack[stack.length - 1]!
    if (!goodText(chunk)) return fail('bad character data')
    if (top === doc && chunk.trim() !== '') return fail('text outside the root')
    top.text += decode(chunk)
    if (lt === -1) break
    i = lt
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4)
      if (end === -1) return fail('open comment')
      i = end + 3
    } else if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i)
      if (end === -1) return fail('open CDATA')
      top.text += src.slice(i + 9, end)
      i = end + 3
    } else if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i)
      if (end === -1 || top !== doc || doc.children.length > 0) return fail('misplaced declaration')
      i = end + 2
    } else if (src.startsWith('</', i)) {
      i += 2
      const tag = name()
      ws()
      if (tag === null || src[i] !== '>') return fail('bad end tag')
      if (top === doc || top.name !== tag) return fail(`</${tag}> does not close <${top.name}>`)
      stack.pop()
      i++
    } else {
      i++
      const tag = name()
      if (tag === null) return fail('bad start tag')
      if (top === doc && doc.children.length > 0) return fail('second root')
      const node: XNode = { name: tag, attrs: {}, children: [], text: '' }
      for (;;) {
        const before = i
        ws()
        if (src.startsWith('/>', i)) {
          i += 2
          top.children.push(node)
          break
        }
        if (src[i] === '>') {
          i++
          top.children.push(node)
          stack.push(node)
          break
        }
        if (i === before) return fail('attributes must be separated')
        const key = name()
        if (key === null) return fail('bad attribute')
        ws()
        if (src[i] !== '=') return fail('attribute without a value')
        i++
        ws()
        const q = src[i]
        if (q !== '"' && q !== "'") return fail('unquoted attribute')
        const close = src.indexOf(q, i + 1)
        if (close === -1) return fail('open attribute')
        const raw = src.slice(i + 1, close)
        if (!goodText(raw)) return fail('bad attribute value')
        if (key in node.attrs) return fail(`repeated attribute ${key}`)
        node.attrs[key] = decode(raw)
        i = close + 1
      }
    }
  }
  if (stack.length !== 1) return fail(`<${stack[stack.length - 1]!.name}> is never closed`)
  const root = doc.children[0]
  return root ? { ok: true, root } : fail('no root element')
}

export const walk = (node: XNode, visit: (node: XNode, ancestors: readonly XNode[]) => void, ancestors: XNode[] = []): void => {
  visit(node, ancestors)
  for (const c of node.children) walk(c, visit, [...ancestors, node])
}

export const textOf = (node: XNode): string => node.text + node.children.map(textOf).join('')

const BANNED_ELEMENTS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'image', 'audio', 'video', 'a'])
const LOCAL_URL = /url\(\s*(?!['"]?#)/i

// What would make the engine refuse the drawing, or make it unsafe or unable to stand alone. Empty means fine.
export const svgProblems = (markup: string): string[] => {
  const out: string[] = []
  if (markup.length > MAX_SVG_CHARS) out.push(`${markup.length} characters, over ${MAX_SVG_CHARS}`)
  const parsed = parseXml(markup)
  if (!parsed.ok) return [...out, `not well formed: ${parsed.error}`]
  const root = parsed.root
  if (root.name !== 'svg') out.push('the root is not <svg>')
  const { width, height, viewBox } = root.attrs
  if (!width || !height || !viewBox) out.push('width, height and viewBox are all required')
  else if (viewBox !== `0 0 ${width} ${height}`) out.push(`viewBox ${viewBox} does not match ${width} x ${height}`)
  let styled = false
  walk(root, node => {
    const tag = node.name.toLowerCase()
    if (BANNED_ELEMENTS.has(tag)) out.push(`<${node.name}> is not allowed`)
    if (tag === 'style') {
      const css = textOf(node).replace(/\s+/g, '')
      if (css.includes(':root{color-scheme:lightdark}') && css.includes('svg{background:transparent}')) styled = true
      if (/@import|url\(\s*['"]?(?!#)/i.test(css)) out.push('the style loads something from outside')
    }
    for (const [key, value] of Object.entries(node.attrs)) {
      if (/^xmlns(:|$)/.test(key)) continue // a namespace name, never fetched
      if (/^on/i.test(key)) out.push(`event attribute ${key} on <${node.name}>`)
      if (/(^|:)href$/i.test(key) && !value.startsWith('#')) out.push(`${key} points outside the drawing`)
      if (LOCAL_URL.test(value)) out.push(`${key} on <${node.name}> points outside the drawing`)
      if (/(?:javascript|https?|data|file):/i.test(value)) out.push(`${key} on <${node.name}> holds a URL`)
    }
  })
  if (!styled) out.push('missing the color-scheme and transparent background style')
  return out
}

// Text that may reach outside the drawing. Each <text> is measured at the wider of the two width estimates,
// from its x, anchor and font size; text under a clip-path or mask is bounded by it and is skipped.
export const textOverflow = (markup: string): string[] => {
  const parsed = parseXml(markup)
  if (!parsed.ok) return [parsed.error]
  const W = Number(parsed.root.attrs.width)
  const H = Number(parsed.root.attrs.height)
  const out: string[] = []
  walk(parsed.root, (node, ancestors) => {
    if (node.name !== 'text' || ancestors.some(a => a.attrs['clip-path'] || a.attrs.mask)) return
    const content = textOf(node)
    const size = Number(node.attrs['font-size'] ?? 16)
    const w = Math.max(monoWidth(content, size, Number(node.attrs['letter-spacing'] ?? 0)), sansWidth(content, size))
    const x = Number(node.attrs.x ?? 0)
    const y = Number(node.attrs.y ?? 0)
    const anchor = node.attrs['text-anchor']
    const left = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x
    if (left < 0 || left + w > W || y - 0.8 * size < 0 || y + 0.25 * size > H) out.push(`"${content}" at ${n(left)},${n(y)} (${n(w)} wide)`)
  })
  return out
}
