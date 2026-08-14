// ---------------------------------------------------------------------------
// Pricing Engine — safe expression parser (no eval!)
// Supports: numbers, variables, +,-,*,/, parens, ternary (?:), comparisons
// Functions: min, max, round, avg
// ---------------------------------------------------------------------------

// -- Types ------------------------------------------------------------------

export interface PricingRule {
  name: string
  filters: {
    itemType: string   // "*" | "PART" | "MINIFIG" | "SET"
    condition: string  // "*" | "N" | "U"
    colorId: number[]  // [] = all
    categoryId: number[] // [] = all
    completeness?: string  // "*" | "C" | "I" | "S" — nur bei SETs relevant, "*" default
  }
  formula: string
}

export interface PricingItem {
  itemType: string
  condition: string
  colorId: number
  categoryId: number | null
  completeness?: string | null  // "C" | "I" | "S" bei SETs, sonst null
}

export interface PricingVars {
  [key: string]: number
}

// -- Rule matching ----------------------------------------------------------

export function findMatchingRule(rules: PricingRule[], item: PricingItem): PricingRule | null {
  for (const rule of rules) {
    const f = rule.filters
    if (f.itemType !== '*' && f.itemType !== item.itemType) continue
    if (f.condition !== '*' && f.condition !== item.condition) continue
    if (f.colorId.length > 0 && !f.colorId.includes(item.colorId)) continue
    if (f.categoryId.length > 0 && (item.categoryId === null || !f.categoryId.includes(item.categoryId))) continue
    // Completeness-Filter: nur bei SETs sinnvoll. "*" oder undef matcht immer,
    // sonst muss der Wert des Items dem Filter entsprechen.
    if (f.completeness && f.completeness !== '*') {
      if (item.completeness !== f.completeness) continue
    }
    return rule
  }
  return null
}

// -- Tokenizer --------------------------------------------------------------

type TokenType = 'number' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'question' | 'colon'

interface Token {
  type: TokenType
  value: string
  num?: number
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]

    // Whitespace
    if (/\s/.test(ch)) { i++; continue }

    // Number
    if (/[0-9.]/.test(ch)) {
      let num = ''
      while (i < expr.length && /[0-9.]/.test(expr[i])) { num += expr[i]; i++ }
      tokens.push({ type: 'number', value: num, num: parseFloat(num) })
      continue
    }

    // Identifier (variable or function name)
    if (/[a-zA-Z_]/.test(ch)) {
      let id = ''
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) { id += expr[i]; i++ }
      tokens.push({ type: 'ident', value: id })
      continue
    }

    // Two-char operators
    if (i + 1 < expr.length) {
      const two = ch + expr[i + 1]
      if (['>=', '<=', '==', '!='].includes(two)) {
        tokens.push({ type: 'op', value: two })
        i += 2
        continue
      }
    }

    // Single-char operators
    if ('+-*/><'.includes(ch)) { tokens.push({ type: 'op', value: ch }); i++; continue }
    if (ch === '(') { tokens.push({ type: 'lparen', value: '(' }); i++; continue }
    if (ch === ')') { tokens.push({ type: 'rparen', value: ')' }); i++; continue }
    if (ch === ',') { tokens.push({ type: 'comma', value: ',' }); i++; continue }
    if (ch === '?') { tokens.push({ type: 'question', value: '?' }); i++; continue }
    if (ch === ':') { tokens.push({ type: 'colon', value: ':' }); i++; continue }

    throw new Error(`Unbekanntes Zeichen: '${ch}'`)
  }
  return tokens
}

// -- Parser (recursive descent) ---------------------------------------------
// Precedence (low to high):
//   ternary  ?:
//   comparison  > < >= <= == !=
//   add/sub  + -
//   mul/div  * /
//   unary    - (prefix)
//   primary  number | variable | function call | (expr)

type ASTNode =
  | { type: 'num'; value: number }
  | { type: 'var'; name: string }
  | { type: 'binary'; op: string; left: ASTNode; right: ASTNode }
  | { type: 'unary'; op: string; operand: ASTNode }
  | { type: 'ternary'; cond: ASTNode; then: ASTNode; else_: ASTNode }
  | { type: 'call'; name: string; args: ASTNode[] }

class Parser {
  private tokens: Token[]
  private pos = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  parse(): ASTNode {
    const node = this.parseTernary()
    if (this.pos < this.tokens.length) {
      throw new Error(`Unerwartetes Token: '${this.tokens[this.pos].value}'`)
    }
    return node
  }

  private peek(): Token | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null
  }

  private consume(): Token {
    return this.tokens[this.pos++]
  }

  private expect(type: TokenType): Token {
    const t = this.peek()
    if (!t || t.type !== type) throw new Error(`Erwartet ${type}, bekommen ${t?.value ?? 'Ende'}`)
    return this.consume()
  }

  private parseTernary(): ASTNode {
    let node = this.parseComparison()
    if (this.peek()?.type === 'question') {
      this.consume() // ?
      const then = this.parseTernary()
      this.expect('colon')
      const else_ = this.parseTernary()
      node = { type: 'ternary', cond: node, then, else_ }
    }
    return node
  }

  private parseComparison(): ASTNode {
    let left = this.parseAddSub()
    while (this.peek()?.type === 'op' && ['>', '<', '>=', '<=', '==', '!='].includes(this.peek()!.value)) {
      const op = this.consume().value
      const right = this.parseAddSub()
      left = { type: 'binary', op, left, right }
    }
    return left
  }

  private parseAddSub(): ASTNode {
    let left = this.parseMulDiv()
    while (this.peek()?.type === 'op' && (this.peek()!.value === '+' || this.peek()!.value === '-')) {
      const op = this.consume().value
      const right = this.parseMulDiv()
      left = { type: 'binary', op, left, right }
    }
    return left
  }

  private parseMulDiv(): ASTNode {
    let left = this.parseUnary()
    while (this.peek()?.type === 'op' && (this.peek()!.value === '*' || this.peek()!.value === '/')) {
      const op = this.consume().value
      const right = this.parseUnary()
      left = { type: 'binary', op, left, right }
    }
    return left
  }

  private parseUnary(): ASTNode {
    if (this.peek()?.type === 'op' && this.peek()!.value === '-') {
      this.consume()
      return { type: 'unary', op: '-', operand: this.parsePrimary() }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): ASTNode {
    const t = this.peek()
    if (!t) throw new Error('Unerwartetes Ende')

    // Number
    if (t.type === 'number') {
      this.consume()
      return { type: 'num', value: t.num! }
    }

    // Identifier: variable or function call
    if (t.type === 'ident') {
      this.consume()
      // Function call?
      if (this.peek()?.type === 'lparen') {
        this.consume() // (
        const args: ASTNode[] = []
        if (this.peek()?.type !== 'rparen') {
          args.push(this.parseTernary())
          while (this.peek()?.type === 'comma') {
            this.consume()
            args.push(this.parseTernary())
          }
        }
        this.expect('rparen')
        return { type: 'call', name: t.value, args }
      }
      return { type: 'var', name: t.value }
    }

    // Parenthesized expression
    if (t.type === 'lparen') {
      this.consume()
      const node = this.parseTernary()
      this.expect('rparen')
      return node
    }

    throw new Error(`Unerwartetes Token: '${t.value}'`)
  }
}

// -- Evaluator --------------------------------------------------------------

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  min: (args) => Math.min(...args),
  max: (args) => Math.max(...args),
  round: (args) => {
    const decimals = args.length > 1 ? args[1] : 2
    const factor = Math.pow(10, decimals)
    return Math.round(args[0] * factor) / factor
  },
  avg: (args) => args.reduce((a, b) => a + b, 0) / args.length,
  abs: (args) => Math.abs(args[0]),
}

function evalAST(node: ASTNode, vars: PricingVars): number {
  switch (node.type) {
    case 'num':
      return node.value
    case 'var': {
      const v = vars[node.name]
      if (v === undefined) return 0 // unknown variable → 0
      return v
    }
    case 'unary':
      return -evalAST(node.operand, vars)
    case 'binary': {
      const l = evalAST(node.left, vars)
      const r = evalAST(node.right, vars)
      switch (node.op) {
        case '+': return l + r
        case '-': return l - r
        case '*': return l * r
        case '/': return r !== 0 ? l / r : 0
        case '>': return l > r ? 1 : 0
        case '<': return l < r ? 1 : 0
        case '>=': return l >= r ? 1 : 0
        case '<=': return l <= r ? 1 : 0
        case '==': return l === r ? 1 : 0
        case '!=': return l !== r ? 1 : 0
        default: throw new Error(`Unbekannter Operator: ${node.op}`)
      }
    }
    case 'ternary': {
      const cond = evalAST(node.cond, vars)
      return cond !== 0 ? evalAST(node.then, vars) : evalAST(node.else_, vars)
    }
    case 'call': {
      const fn = FUNCTIONS[node.name]
      if (!fn) throw new Error(`Unbekannte Funktion: ${node.name}`)
      const args = node.args.map(a => evalAST(a, vars))
      return fn(args)
    }
  }
}

// -- Public API -------------------------------------------------------------

export function evaluateFormula(formula: string, vars: PricingVars): number | null {
  try {
    const tokens = tokenize(formula)
    if (tokens.length === 0) return null
    const ast = new Parser(tokens).parse()
    const result = evalAST(ast, vars)
    if (!isFinite(result)) return null
    return Math.round(result * 10000) / 10000 // 4 decimal precision
  } catch {
    return null
  }
}

export function validateFormula(formula: string): { valid: boolean; error?: string } {
  try {
    const tokens = tokenize(formula)
    if (tokens.length === 0) return { valid: false, error: 'Formel ist leer' }
    new Parser(tokens).parse()
    return { valid: true }
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : 'Syntaxfehler' }
  }
}

// All supported variable names (for UI reference)
export const PRICING_VARIABLES = [
  // Sold - time-based
  'sold7dMedian', 'sold30dMedian', 'sold60dMedian', 'sold90dMedian', 'sold6mMedian',
  'sold7dAvg', 'sold30dAvg', 'sold60dAvg', 'sold90dAvg', 'sold6mAvg',
  'sold6mMin', 'sold6mMax',
  'sold30dCount', 'sold90dCount', 'sold6mCount',
  'sold30dQty', 'sold90dQty', 'sold6mQty',
  // Stock
  'stockMedian', 'stockAvg', 'stockMin', 'stockMax', 'stockCount', 'stockQty',
  // Own
  'myPrice', 'myQty', 'myCost',
] as const

export const PRICING_FUNCTIONS = ['min', 'max', 'round', 'avg', 'abs'] as const

// Human-readable descriptions for the UI
export const PRICING_VAR_DOCS: Record<string, string> = {
  sold7dMedian: 'Median der Verkaufspreise letzte 7 Tage (robust gegen Ausreißer)',
  sold30dMedian: 'Median der Verkaufspreise letzte 30 Tage',
  sold60dMedian: 'Median der Verkaufspreise letzte 60 Tage',
  sold90dMedian: 'Median der Verkaufspreise letzte 90 Tage',
  sold6mMedian: 'Median der Verkaufspreise letzte 6 Monate',
  sold7dAvg: 'Ungewichteter Durchschnitt Verkaufspreis 7 Tage',
  sold30dAvg: 'Ungewichteter Durchschnitt Verkaufspreis 30 Tage',
  sold60dAvg: 'Ungewichteter Durchschnitt Verkaufspreis 60 Tage',
  sold90dAvg: 'Ungewichteter Durchschnitt Verkaufspreis 90 Tage',
  sold6mAvg: 'Ungewichteter Durchschnitt Verkaufspreis 6 Monate',
  sold6mMin: 'Niedrigster Verkaufspreis in den letzten 6 Monaten',
  sold6mMax: 'Höchster Verkaufspreis in den letzten 6 Monaten',
  sold30dCount: 'Anzahl Verkaufs-Transaktionen letzte 30 Tage',
  sold90dCount: 'Anzahl Verkaufs-Transaktionen letzte 90 Tage',
  sold6mCount: 'Anzahl Verkaufs-Transaktionen letzte 6 Monate',
  sold30dQty: 'Summe verkaufter Stückzahl letzte 30 Tage',
  sold90dQty: 'Summe verkaufter Stückzahl letzte 90 Tage',
  sold6mQty: 'Summe verkaufter Stückzahl letzte 6 Monate',
  stockMedian: 'Median der aktuellen Angebotspreise (Marktpreis)',
  stockAvg: 'Ungewichteter Durchschnitt aktueller Angebote',
  stockMin: 'Günstigstes aktuelles Angebot',
  stockMax: 'Höchstes aktuelles Angebot',
  stockCount: 'Anzahl aktueller Angebote am Markt',
  stockQty: 'Gesamte am Markt angebotene Stückzahl',
  myPrice: 'Dein aktueller Verkaufspreis (aus BL/BSX)',
  myQty: 'Deine Bestandsmenge',
  myCost: 'Dein Einkaufspreis pro Stück (myCost/myQty aus BL)',
}

export const PRICING_FUNC_DOCS: Record<string, string> = {
  min: 'Kleinster Wert: min(a, b, c) → gibt den niedrigsten zurück',
  max: 'Größter Wert: max(a, b, c) → gibt den höchsten zurück',
  round: 'Runden: round(preis, 2) → auf 2 Nachkommastellen',
  avg: 'Durchschnitt: avg(a, b, c) → arithmetisches Mittel',
  abs: 'Absolutwert: abs(x) → macht negative Zahlen positiv',
}
