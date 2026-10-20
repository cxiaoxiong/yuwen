// LaTeX 公式 → Word 原生公式（OMML），无依赖。浏览器和 Node 共用。
// 解析交给 temml（LaTeX → MathML 树，含 mhchem 化学扩展），这里把 MathML 树逐节点翻译成 OMML：
// 老师在 Word 里双击公式就能编辑。元素顺序严格按 ECMA-376 shared-math 的定义写，Word 对顺序很敏感。
(function (G) {
  'use strict';
  const XL = G.XL || (G.XL = {});

  // XML 不允许的控制字符一律去掉
  const xml = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/;
  const INVISIBLE = new Set(['⁡', '⁢', '⁣', '⁤', '​', '']);
  const LARGE_OPS = new Set(['∑', '∏', '∐', '∫', '∬', '∭', '∮', '∯', '∰', '⋂', '⋃', '⋀', '⋁', '⨁', '⨂', '⨀']);
  const INTEGRALS = new Set(['∫', '∬', '∭', '∮', '∯', '∰']);
  const LIM_FUNCS = new Set(['lim', 'max', 'min', 'sup', 'inf', 'limsup', 'liminf', 'lim sup', 'lim inf']);
  // 上方重音 → OMML 的 acc 字符（组合用字符）
  const ACCENTS = {
    '→': '⃗', '⃗': '⃗', '←': '⃖', '↔': '⃡',
    'ˆ': '̂', '^': '̂', '̂': '̂', '˜': '̃', '~': '̃', '̃': '̃',
    '˙': '̇', '.': '̇', '¨': '̈', 'ˇ': '̌', '´': '́', '`': '̀', '˘': '̆', '˚': '̊',
  };
  const BARS = new Set(['¯', '‾', '_', '̅', '―', '−']);
  const ARROWS = new Set(['→', '←', '↔', '⇌', '⇄', '⇆', '⟶', '⟵', '⟷', '⇒', '⇐', '⇔', '⟹', '⟸', '⟺', '↽', '⇀', '⥂', '⥄', '↦', '⟼']);

  const kids = (n) => (n && n.children) || [];
  const isText = (n) => n && n.type === undefined && typeof n.text === 'string';
  // mphantom 只占位不显示（mhchem 用它对齐核素的上下标），取文字时跳过
  const textOf = (n) => (isText(n) ? n.text : n.type === 'mphantom' ? '' : kids(n).map(textOf).join(''));
  const attr = (n, k) => (n && n.attributes ? n.attributes[k] : undefined);
  const CONTAINERS = new Set(['math', 'mrow', 'mstyle', 'mpadded', 'semantics', 'mlabeledtr']);
  const isFenced = (n) => {
    if (!n || n.type !== 'mrow') return false;
    const k = kids(n);
    return k.length >= 2 && k[0].type === 'mo' && attr(k[0], 'fence') === 'true' && k[k.length - 1].type === 'mo' && attr(k[k.length - 1], 'fence') === 'true';
  };
  // 空：没有可见内容（空白文字、间距、占位，或只由它们组成的容器）
  const isEmpty = (n) => {
    if (!n) return true;
    if (isText(n)) return !n.text.trim();
    if (n.type === 'mspace' || n.type === 'mphantom') return true;
    if (n.type === 'mo') return INVISIBLE.has(textOf(n));
    if (n.type === undefined || CONTAINERS.has(n.type)) return kids(n).every(isEmpty);
    return !textOf(n).trim() && kids(n).every(isEmpty);
  };
  // temml 的内部节点（如换行包装）没有 type，当成 mrow
  const isContainer = (n) => n && !isText(n) && (n.type === undefined || CONTAINERS.has(n.type)) && !isFenced(n);

  // ───── 基本构件 ─────
  function run(text, { sty, nor } = {}) {
    if (!text) return '';
    const mrPr = nor ? '<m:rPr><m:nor/></m:rPr>' : sty ? `<m:rPr><m:sty m:val="${sty}"/></m:rPr>` : '';
    const wrPr = CJK.test(text)
      ? '<w:rPr><w:rFonts w:ascii="Cambria Math" w:eastAsia="宋体" w:hAnsi="Cambria Math" w:hint="eastAsia"/></w:rPr>'
      : '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>';
    const sp = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
    return `<m:r>${mrPr}${wrPr}<m:t${sp}>${xml(text)}</m:t></m:r>`;
  }
  const e = (inner) => `<m:e>${inner}</m:e>`;
  const ctrl = '<m:ctrlPr><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/><w:i/></w:rPr></m:ctrlPr>';

  // ───── 节点序列：展开普通容器，处理「无底数的下标」（mhchem）和大型运算符的被积式 ─────
  function flat(list) {
    const out = [];
    for (const n of list) {
      if (!n) continue;
      if (isText(n)) { if (n.text) out.push(n); continue; }
      if (n.type === 'mspace' || n.type === 'mphantom' || n.type === 'annotation' || n.type === 'annotation-xml') continue;
      if (n.type === 'semantics') { out.push(...flat(kids(n).slice(0, 1))); continue; }
      if (n.type === 'mo' && INVISIBLE.has(textOf(n))) continue;
      if (isContainer(n)) out.push(...flat(kids(n)));
      else out.push(n);
    }
    return out;
  }

  function seq(list, ctx) {
    const items = flat(list);
    const parts = [];
    let prev = null; // 上一项的节点（判断左上下标用）
    for (let i = 0; i < items.length; i++) {
      const n = items[i];
      if (['msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover'].includes(n.type)) {
        // 整组都是占位（mhchem 的对齐手段）：不输出
        if (kids(n).every(isEmpty)) continue;
        const [b] = kids(n);
        const bt = textOf(b).trim();
        // 大型运算符：∑、∫ 等，把紧随其后的一项当作运算对象
        if ((b?.type === 'mo' || b?.type === 'mi') && LARGE_OPS.has(bt)) {
          let body = '';
          const next = items[i + 1];
          if (next && !(next.type === 'mo' && !LARGE_OPS.has(textOf(next).trim()))) { body = conv(next, ctx); i++; }
          parts.push(nary(n, bt, body, ctx));
          prev = n;
          continue;
        }
        if (isEmpty(b) && /^(msub|msup|msubsup)$/.test(n.type)) {
          // 核素写法 {}^{14}_{6}C：前面没有内容或是运算符、后面紧跟一项 → 左上下标
          const next = items[i + 1];
          if (next && (!prev || prev.type === 'mo') && next.type !== 'mo') {
            parts.push(preScript(n, conv(next, ctx), ctx));
            prev = next; i++;
            continue;
          }
          // mhchem 的 H₂：下标的底数是空的，真正的底数是前一项
          if (parts.length) { parts.push(script(n, parts.pop(), ctx)); prev = n; continue; }
        }
      }
      parts.push(conv(n, ctx));
      prev = n;
    }
    return parts.join('');
  }
  function preScript(n, baseXml, ctx) {
    const [, a, c] = kids(n);
    const sub = n.type === 'msup' ? '' : arg(a, ctx);
    const sup = n.type === 'msub' ? '' : arg(n.type === 'msup' ? a : c, ctx);
    return `<m:sPre><m:sPrePr>${ctrl}</m:sPrePr><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup>${e(baseXml)}</m:sPre>`;
  }
  const arg = (n, ctx) => (n ? seq([n], ctx) : '');

  function nary(n, chr, body, ctx) {
    const [, a, b] = kids(n);
    let sub = '', sup = '';
    if (n.type === 'msub' || n.type === 'munder') sub = arg(a, ctx);
    else if (n.type === 'msup' || n.type === 'mover') sup = arg(a, ctx);
    else { sub = arg(a, ctx); sup = arg(b, ctx); }
    const loc = INTEGRALS.has(chr) || !ctx.display ? 'subSup' : 'undOvr';
    const pr = `<m:naryPr><m:chr m:val="${xml(chr)}"/><m:limLoc m:val="${loc}"/>${sub ? '' : '<m:subHide m:val="1"/>'}${sup ? '' : '<m:supHide m:val="1"/>'}${ctrl}</m:naryPr>`;
    return `<m:nary>${pr}<m:sub>${sub}</m:sub><m:sup>${sup}</m:sup>${e(body)}</m:nary>`;
  }

  // 上下标：baseXml 给定时用它当底数（mhchem 的情形）
  function script(n, baseXml, ctx) {
    const [b, a, c] = kids(n);
    const base = baseXml ?? arg(b, ctx);
    if (n.type === 'msub' || n.type === 'munder') return `<m:sSub><m:sSubPr>${ctrl}</m:sSubPr>${e(base)}<m:sub>${arg(a, ctx)}</m:sub></m:sSub>`;
    if (n.type === 'msup' || n.type === 'mover') return `<m:sSup><m:sSupPr>${ctrl}</m:sSupPr>${e(base)}<m:sup>${arg(a, ctx)}</m:sup></m:sSup>`;
    return `<m:sSubSup><m:sSubSupPr>${ctrl}</m:sSubSupPr>${e(base)}<m:sub>${arg(a, ctx)}</m:sub><m:sup>${arg(c, ctx)}</m:sup></m:sSubSup>`;
  }

  // 箭头上写条件（化学方程式、\xrightarrow）：文字在上，箭头在下面拉长
  function arrowWith(chr, over, under, ctx) {
    const o = over && !isEmpty(over) ? arg(over, ctx) : '';
    const u = under && !isEmpty(under) ? arg(under, ctx) : '';
    if (!o && !u) return run(chr, { sty: 'p' });
    if (!o) return `<m:limLow><m:limLowPr>${ctrl}</m:limLowPr>${e(run(chr, { sty: 'p' }))}<m:lim>${u}</m:lim></m:limLow>`;
    const top = `<m:groupChr><m:groupChrPr><m:chr m:val="${xml(chr)}"/><m:pos m:val="bot"/><m:vertJc m:val="bot"/>${ctrl}</m:groupChrPr>${e(o || run(' ', { sty: 'p' }))}</m:groupChr>`;
    return u ? `<m:limLow><m:limLowPr>${ctrl}</m:limLowPr>${e(top)}<m:lim>${u}</m:lim></m:limLow>` : top;
  }

  function overUnder(n, ctx) {
    const [b, a, c] = kids(n);
    // 上方或下方只有间距（mhchem 用来撑宽箭头）：去掉，否则 Word 会显示空占位框
    if (n.type !== 'munderover' && isEmpty(a)) return arg(b, ctx);
    if (n.type === 'munderover' && (isEmpty(a) || isEmpty(c))) {
      if (isEmpty(a) && isEmpty(c)) return arg(b, ctx);
      const m = { type: isEmpty(a) ? 'mover' : 'munder', attributes: n.attributes, children: [b, isEmpty(a) ? c : a] };
      return overUnder(m, ctx);
    }
    const bt = textOf(b).trim();
    const at = textOf(a).trim();
    // 反应箭头 / 可拉长箭头：底数是箭头
    if (b?.type === 'mo' && ARROWS.has(bt)) {
      if (n.type === 'mover') return arrowWith(bt, a, null, ctx);
      if (n.type === 'munder') return arrowWith(bt, null, a, ctx);
      return arrowWith(bt, c, a, ctx);
    }
    // lim、max 等：下方写条件
    if (b?.type === 'mi' && LIM_FUNCS.has(bt) && n.type === 'munder') {
      return `<m:limLow><m:limLowPr>${ctrl}</m:limLowPr>${e(run(bt, { sty: 'p' }))}<m:lim>${arg(a, ctx)}</m:lim></m:limLow>`;
    }
    if (n.type === 'mover' && a?.type === 'mo') {
      if (ACCENTS[at]) return `<m:acc><m:accPr><m:chr m:val="${ACCENTS[at]}"/>${ctrl}</m:accPr>${e(arg(b, ctx))}</m:acc>`;
      if (BARS.has(at)) return `<m:bar><m:barPr><m:pos m:val="top"/>${ctrl}</m:barPr>${e(arg(b, ctx))}</m:bar>`;
      if (at === '⏞' || at === '︷') return `<m:groupChr><m:groupChrPr><m:chr m:val="⏞"/><m:pos m:val="top"/><m:vertJc m:val="bot"/>${ctrl}</m:groupChrPr>${e(arg(b, ctx))}</m:groupChr>`;
    }
    if (n.type === 'munder' && a?.type === 'mo') {
      if (BARS.has(at)) return `<m:bar><m:barPr><m:pos m:val="bot"/>${ctrl}</m:barPr>${e(arg(b, ctx))}</m:bar>`;
      if (at === '⏟' || at === '︸') return `<m:groupChr><m:groupChrPr><m:chr m:val="⏟"/>${ctrl}</m:groupChrPr>${e(arg(b, ctx))}</m:groupChr>`;
    }
    // 其余：\overset、\underset、上下限
    if (n.type === 'mover') return `<m:limUpp><m:limUppPr>${ctrl}</m:limUppPr>${e(arg(b, ctx))}<m:lim>${arg(a, ctx)}</m:lim></m:limUpp>`;
    if (n.type === 'munder') return `<m:limLow><m:limLowPr>${ctrl}</m:limLowPr>${e(arg(b, ctx))}<m:lim>${arg(a, ctx)}</m:lim></m:limLow>`;
    const low = `<m:limLow><m:limLowPr>${ctrl}</m:limLowPr>${e(arg(b, ctx))}<m:lim>${arg(a, ctx)}</m:lim></m:limLow>`;
    return `<m:limUpp><m:limUppPr>${ctrl}</m:limUppPr>${e(low)}<m:lim>${arg(c, ctx)}</m:lim></m:limUpp>`;
  }

  // 表格：带圆括号、方括号、竖线的是矩阵；左花括号（cases）和无括号的（aligned）是方程组
  function table(n, ctx, asMatrix) {
    const rows = kids(n).filter((r) => r.type === 'mtr' || r.type === 'mlabeledtr');
    const cells = rows.map((r) => kids(r).filter((c) => c.type === 'mtd'));
    if (asMatrix) {
      const cols = Math.max(1, ...cells.map((r) => r.length));
      const mr = cells.map((r) => `<m:mr>${Array.from({ length: cols }, (_, i) => e(r[i] ? seq(kids(r[i]), ctx) : '')).join('')}</m:mr>`).join('');
      return `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${cols}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs>${ctrl}</m:mPr>${mr}</m:m>`;
    }
    const lines = cells.map((r) => e(r.map((c) => seq(kids(c), ctx)).join(run(' ', { sty: 'p' }))));
    return `<m:eqArr><m:eqArrPr>${ctrl}</m:eqArrPr>${lines.join('')}</m:eqArr>`;
  }

  function fenced(n, ctx) {
    const k = kids(n);
    const beg = textOf(k[0]);
    const end = textOf(k[k.length - 1]);
    const mid = k.slice(1, -1);
    const onlyTable = flat(mid).length === 1 && flat(mid)[0].type === 'mtable';
    let inner;
    if (onlyTable) inner = table(flat(mid)[0], ctx, beg !== '{' && beg !== '');
    else inner = seq(mid, ctx);
    const v = (s) => xml(INVISIBLE.has(s) ? '' : s);
    return `<m:d><m:dPr><m:begChr m:val="${v(beg)}"/><m:endChr m:val="${v(end)}"/>${ctrl}</m:dPr>${e(inner)}</m:d>`;
  }

  function conv(n, ctx) {
    if (!n) return '';
    if (isText(n)) return run(n.text);
    if (isFenced(n)) return fenced(n, ctx);
    const k = kids(n);
    switch (n.type) {
      case 'mi': {
        const t = textOf(n);
        const v = attr(n, 'mathvariant');
        if (v === 'bold') return run(t, { sty: 'b' });
        if (v === 'bold-italic') return run(t, { sty: 'bi' });
        if (v === 'normal' || [...t].length > 1 || CJK.test(t)) return run(t, { sty: 'p' });
        return run(t);
      }
      case 'mn': return run(textOf(n), { sty: attr(n, 'mathvariant') === 'bold' ? 'b' : 'p' });
      case 'mo': return run(textOf(n), { sty: 'p' });
      case 'mtext': case 'ms': return run(textOf(n), { nor: true });
      case 'mfrac': {
        const lt = attr(n, 'linethickness');
        const noBar = lt !== undefined && parseFloat(lt) === 0;
        return `<m:f><m:fPr>${noBar ? '<m:type m:val="noBar"/>' : ''}${ctrl}</m:fPr><m:num>${arg(k[0], ctx)}</m:num><m:den>${arg(k[1], ctx)}</m:den></m:f>`;
      }
      case 'msqrt': return `<m:rad><m:radPr><m:degHide m:val="1"/>${ctrl}</m:radPr><m:deg/>${e(seq(k, ctx))}</m:rad>`;
      case 'mroot': return `<m:rad><m:radPr>${ctrl}</m:radPr><m:deg>${arg(k[1], ctx)}</m:deg>${e(arg(k[0], ctx))}</m:rad>`;
      case 'msub': case 'msup': case 'msubsup': {
        const bt = textOf(k[0]).trim();
        if (n.type === 'msub' && k[0]?.type === 'mi' && LIM_FUNCS.has(bt)) {
          return `<m:limLow><m:limLowPr>${ctrl}</m:limLowPr>${e(run(bt, { sty: 'p' }))}<m:lim>${arg(k[1], ctx)}</m:lim></m:limLow>`;
        }
        return script(n, null, ctx);
      }
      case 'munder': case 'mover': case 'munderover': return overUnder(n, ctx);
      case 'mtable': return table(n, ctx, false);
      case 'menclose': {
        const nt = String(attr(n, 'notation') || '');
        if (/\btop\b/.test(nt) && !/box/.test(nt)) return `<m:bar><m:barPr><m:pos m:val="top"/>${ctrl}</m:barPr>${e(seq(k, ctx))}</m:bar>`;
        if (/\bbottom\b/.test(nt) && !/box/.test(nt)) return `<m:bar><m:barPr><m:pos m:val="bot"/>${ctrl}</m:barPr>${e(seq(k, ctx))}</m:bar>`;
        if (/strike/.test(nt)) return `<m:borderBox><m:borderBoxPr><m:hideTop m:val="1"/><m:hideBot m:val="1"/><m:hideLeft m:val="1"/><m:hideRight m:val="1"/><m:strikeBLTR m:val="1"/>${ctrl}</m:borderBoxPr>${e(seq(k, ctx))}</m:borderBox>`;
        return `<m:borderBox><m:borderBoxPr>${ctrl}</m:borderBoxPr>${e(seq(k, ctx))}</m:borderBox>`;
      }
      default: return seq(k, ctx);
    }
  }

  /** 一条公式 → <m:oMath>…</m:oMath>。公式有错时抛出（调用方退回成红字原文）。 */
  function texToOmml(tex, { display = false } = {}) {
    const T = G.temml;
    if (!T) throw new Error('公式组件没有加载');
    const tree = T.__renderToMathMLTree(String(tex), { displayMode: display, throwOnError: true, annotate: false, wrap: 'none' });
    return `<m:oMath>${seq([tree], { display })}</m:oMath>`;
  }

  /** 公式能否解析：能返回 null，不能返回简短的错误说明（本地检查用） */
  function texError(tex) {
    const T = G.temml;
    if (!T) return null;
    try { T.__renderToMathMLTree(String(tex), { displayMode: false, throwOnError: true }); return null; }
    catch (err) { return String(err.message || err).replace(/^\s*Temml parse error:\s*/i, '').split('\n')[0].slice(0, 80); }
  }

  Object.assign(XL, { texToOmml, texError, xml });
})(typeof globalThis !== 'undefined' ? globalThis : this);
