// 学历案 → Word（.docx），无依赖。浏览器和 Node 共用（依赖 xuelian-doc.js、xuelian-omml.js）。
// 版式：段落式（【学习目标】这类黑体标签 + 正文），A4，宋体五号，行距最小值 20 磅，首行缩进 2 字，页脚居中页码。
// 所有格式都写成命名样式（XL 开头），老师在 Word 里改一个样式，全文跟着变。
// 各属性元素的先后顺序按 ECMA-376 写，Word 对顺序很敏感（顺序错了会提示「无法读取的内容」）。
(function (G) {
  'use strict';
  const XL = G.XL || (G.XL = {});
  const xml = (s) => XL.xml(s);

  // ───── 页面与字体 ─────
  const PAGE = { w: 11906, h: 16838, top: 1440, bottom: 1440, left: 1800, right: 1800, header: 851, footer: 992 };
  const TEXT_W = PAGE.w - PAGE.left - PAGE.right; // 8306 twips
  const fonts = (ea, latin = 'Times New Roman') => `<w:rFonts w:ascii="${latin}" w:eastAsia="${ea}" w:hAnsi="${latin}" w:cs="${latin}"/>`;
  const COLOR = { label: '1F4E79', head: 'DEEAF6', fig: '7F7F7F', err: 'C00000' };

  // ───── styles.xml ─────
  // 段落样式 pPr 子元素顺序：keepNext, pageBreakBefore, pBdr, spacing, ind, jc, outlineLvl
  // rPr 子元素顺序：rFonts, b, bCs, i, color, sz, szCs, lang
  function styles({ color }) {
    const st = (id, name, { based = 'Normal', next, pPr = '', rPr = '', q = true } = {}) =>
      `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${based}"/>${next ? `<w:next w:val="${next}"/>` : ''}${q ? '<w:qFormat/>' : ''}${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}</w:style>`;
    const noInd = '<w:ind w:firstLineChars="0" w:firstLine="0"/>';
    const ind2 = '<w:ind w:firstLineChars="200" w:firstLine="420"/>';
    const labelColor = color ? `<w:color w:val="${COLOR.label}"/>` : '';
    const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>${fonts('宋体')}<w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="400" w:lineRule="atLeast"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr>${ind2}<w:jc w:val="both"/></w:pPr></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:customStyle="1" w:styleId="XLGrid"><w:name w:val="学历案表格"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblCellMar><w:left w:w="85" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
${st('XLTitle', '学历案标题', { next: 'XLSub', pPr: `<w:spacing w:before="0" w:after="120"/>${noInd}<w:jc w:val="center"/><w:outlineLvl w:val="0"/>`, rPr: `${fonts('黑体')}<w:b/><w:bCs/><w:sz w:val="36"/><w:szCs w:val="36"/>` })}
${st('XLSub', '学历案副标题', { pPr: `<w:spacing w:after="60"/>${noInd}<w:jc w:val="center"/>`, rPr: '<w:sz w:val="24"/><w:szCs w:val="24"/>' })}
${st('XLInfo', '学历案信息行', { pPr: `<w:spacing w:after="120"/>${noInd}<w:jc w:val="center"/>` })}
${st('XLLabel', '学历案要素', { next: 'Normal', pPr: `<w:keepNext/><w:spacing w:before="240" w:after="120"/>${noInd}<w:jc w:val="left"/><w:outlineLvl w:val="1"/>`, rPr: `${fonts('黑体')}<w:b/><w:bCs/>${labelColor}<w:sz w:val="28"/><w:szCs w:val="28"/>` })}
${st('XLH3', '学历案小标题', { next: 'Normal', pPr: `<w:keepNext/><w:spacing w:before="120" w:after="60"/>${ind2}<w:outlineLvl w:val="2"/>`, rPr: '<w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/>' })}
${st('XLH4', '学历案活动标题', { next: 'Normal', pPr: `<w:keepNext/><w:spacing w:before="60"/>${ind2}`, rPr: '<w:b/><w:bCs/>' })}
${st('XLQuote', '学历案提示语', { pPr: ind2, rPr: fonts('楷体') })}
${st('XLBullet', '学历案列表', { pPr: '<w:ind w:leftChars="200" w:left="420" w:hangingChars="100" w:hanging="210"/>' })}
${st('XLMath', '学历案公式', { pPr: `<w:spacing w:before="60" w:after="60"/>${noInd}<w:jc w:val="center"/>` })}
${st('XLRule', '学历案答题线', { pPr: `<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="7F7F7F"/></w:pBdr><w:spacing w:before="160"/>${noInd}` })}
${st('XLTable', '学历案表格文字', { pPr: `<w:spacing w:after="0" w:line="300" w:lineRule="auto"/>${noInd}<w:jc w:val="left"/>`, rPr: '<w:sz w:val="20"/><w:szCs w:val="20"/>' })}
${st('XLTableHead', '学历案表头', { based: 'XLTable', pPr: '<w:jc w:val="center"/>', rPr: '<w:b/><w:bCs/>' })}
${st('XLFooter', '学历案页脚', { q: false, pPr: `${noInd}<w:jc w:val="center"/>`, rPr: '<w:sz w:val="18"/><w:szCs w:val="18"/>' })}
</w:styles>`;
  }

  // ───── 正文 ─────
  // run：rPr 顺序 rFonts, b, bCs, color, sz
  function textRun(s, { b, color, ea } = {}) {
    if (!s) return '';
    const rPr = `${ea ? fonts(ea) : ''}${b ? '<w:b/><w:bCs/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}`;
    return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(s)}</w:t></w:r>`;
  }
  function mathRun(tex, display) {
    try { return XL.texToOmml(tex, { display }); }
    catch (err) { return textRun(`$${tex}$（公式有误，请检查）`, { color: COLOR.err }); }
  }
  // 学习目标、评价任务里行首的 G1 / T1 加粗
  function runs(inl, { boldCode } = {}) {
    let first = true;
    return inl.map((x) => {
      const isFirst = first;
      first = false;
      if (x.t === 'text') {
        if (isFirst && boldCode) {
          const m = new RegExp(`^(\\s*[【\\[（(]?${boldCode}\\d+[】\\]）)]?)`).exec(x.s);
          if (m) return textRun(m[1], { b: true }) + textRun(x.s.slice(m[1].length), { b: x.b });
        }
        return textRun(x.s, { b: x.b });
      }
      if (x.t === 'math') return mathRun(x.tex, false);
      if (x.t === 'fig') return textRun(`〔此处插图：${x.s}〕`, { color: COLOR.fig, ea: '楷体' });
      return textRun('_'.repeat(Math.max(4, x.n)));
    }).join('');
  }
  const para = (style, body, extra = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>${body}</w:p>`;

  // 表格列宽：按各列最长内容估算（汉字记 1，西文记 0.55），再按比例分配；每列至少 700 twips
  function colWidths(rows) {
    const n = rows[0].length;
    const len = (c) => c.map((inl) => [...XL.plain(inl)].reduce((a, ch) => a + (/[\x00-\xff]/.test(ch) ? 0.55 : 1), 0)).reduce((a, b) => Math.max(a, b), 0);
    const w = Array.from({ length: n }, (_, i) => Math.min(30, Math.max(2, ...rows.map((r) => len(r[i])))));
    const sum = w.reduce((a, b) => a + b, 0);
    let px = w.map((x) => Math.max(700, Math.round((TEXT_W * x) / sum)));
    const over = px.reduce((a, b) => a + b, 0) - TEXT_W;
    if (over > 0) {
      const big = px.map((x, i) => [x, i]).filter(([x]) => x > 700);
      const room = big.reduce((a, [x]) => a + x - 700, 0);
      for (const [x, i] of big) px[i] = Math.round(x - (over * (x - 700)) / room);
    }
    px[n - 1] += TEXT_W - px.reduce((a, b) => a + b, 0);
    return px;
  }
  function tableXml(b, opts, code) {
    const widths = colWidths(b.rows);
    const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`;
    // tblPr 顺序：tblStyle, tblW, jc, tblBorders, tblLayout, tblCellMar, tblLook
    const tblPr = `<w:tblPr><w:tblStyle w:val="XLGrid"/><w:tblW w:w="${TEXT_W}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="85" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`;
    const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
    const rows = b.rows.map((r, ri) => {
      const head = b.head && ri === 0;
      const trPr = head ? '<w:trPr><w:tblHeader/></w:trPr>' : '';
      const cells = r.map((c, ci) => {
        // tcPr 顺序：tcW, shd, vAlign
        const shd = head && opts.color ? `<w:shd w:val="clear" w:color="auto" w:fill="${COLOR.head}"/>` : '';
        const ps = c.map((inl) => para(head ? 'XLTableHead' : 'XLTable', runs(inl, { boldCode: ci === 0 ? code : null }))).join('') || para('XLTable', '');
        return `<w:tc><w:tcPr><w:tcW w:w="${widths[ci]}" w:type="dxa"/>${shd}<w:vAlign w:val="center"/></w:tcPr>${ps}</w:tc>`;
      }).join('');
      return `<w:tr>${trPr}${cells}</w:tr>`;
    }).join('');
    return `<w:tbl>${tblPr}${grid}${rows}</w:tbl>`;
  }

  function sectionXml(key, md, opts) {
    const code = key === 'goals' ? 'G' : key === 'tasks' ? 'T' : null;
    const bs = XL.blocks(md);
    return bs.map((b, i) => {
      switch (b.t) {
        case 'h3': return para('XLH3', runs(b.inl));
        case 'h4': return para('XLH4', runs(b.inl));
        case 'quote': return b.lines.map((l) => para('XLQuote', runs(l))).join('');
        case 'bullet': return para('XLBullet', textRun('• ') + runs(b.inl));
        case 'rule': return para('XLRule', '');
        case 'math': {
          let om;
          try { om = XL.texToOmml(b.tex, { display: true }); }
          catch (err) { return para('XLMath', textRun(`$$${b.tex}$$（公式有误，请检查）`, { color: COLOR.err })); }
          return para('XLMath', `<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>${om}</m:oMathPara>`);
        }
        // 两张表紧挨着时 Word 会把它们并成一张：中间垫一个空段
        case 'table': return tableXml(b, opts, code) + (bs[i + 1]?.t === 'table' ? para('XLTable', '') : '');
        default: return para(null, runs(b.inl, { boldCode: code }));
      }
    }).join('');
  }

  /**
   * 整份学历案的 document.xml。
   * opts.teacher：教师版（另起一页附参考答案、教学设计）；opts.color：彩色标签与表头；
   * opts.notes：笔记区；opts.info：班级、学号、姓名一行
   */
  function documentXml(doc, opts) {
    const m = doc.meta || {};
    const sec = doc.sec || {};
    const title = String(m.title || '未命名').trim();
    const body = [];
    body.push(para('XLTitle', textRun(/学历案$/.test(title) ? title : `${title} 学历案`)));
    const sub = XL.subtitle(m);
    if (sub) body.push(para('XLSub', textRun(sub)));
    body.push(para('XLInfo', textRun(`设计者：${String(m.designer || '').trim() || '__________'}`)));
    if (opts.info) body.push(para('XLInfo', textRun('班级：__________　学号：__________　姓名：__________')));
    let teacherStarted = false;
    const label = (text, pageBreak) => para('XLLabel', textRun(`【${text}】`), pageBreak ? '<w:pageBreakBefore/>' : '');
    for (const s of XL.SECTIONS) {
      if (s.teacher && !opts.teacher) continue;
      const md = sec[s.key];
      if (!md || !md.trim()) continue;
      if (s.key === 'answers' || s.key === 'design') {
        // 教师部分另起一页，前面先放笔记区
        if (!teacherStarted && opts.notes) body.push(notesXml());
        body.push(label(s.label, true));
        teacherStarted = true;
      } else body.push(label(s.label, false));
      body.push(sectionXml(s.key, md, opts));
    }
    if (!teacherStarted && opts.notes) body.push(notesXml());
    // sectPr 顺序：footerReference, pgSz, pgMar, cols, docGrid
    const sectPr = `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="${PAGE.w}" w:h="${PAGE.h}"/><w:pgMar w:top="${PAGE.top}" w:right="${PAGE.right}" w:bottom="${PAGE.bottom}" w:left="${PAGE.left}" w:header="${PAGE.header}" w:footer="${PAGE.footer}" w:gutter="0"/><w:cols w:space="425"/><w:docGrid w:linePitch="312"/></w:sectPr>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${body.join('')}${sectPr}</w:body></w:document>`;
  }
  function notesXml() {
    return para('XLLabel', textRun('【笔记区】')) + Array.from({ length: 6 }, () => para('XLRule', '')).join('');
  }

  const FOOTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:p><w:pPr><w:pStyle w:val="XLFooter"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  const SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:defaultTabStop w:val="420"/><w:drawingGridVerticalSpacing w:val="156"/><w:characterSpacingControl w:val="compressPunctuation"/><w:compat><w:spaceForUL/><w:balanceSingleByteDoubleByteWidth/><w:doNotLeaveBackslashAlone/><w:ulTrailSpace/><w:doNotExpandShiftReturn/><w:adjustLineHeightInTable/><w:useFELayout/><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat><m:mathPr><m:mathFont m:val="Cambria Math"/><m:brkBin m:val="before"/><m:brkBinSub m:val="--"/><m:smallFrac m:val="0"/><m:dispDef/><m:lMargin m:val="0"/><m:rMargin m:val="0"/><m:defJc m:val="centerGroup"/><m:wrapIndent m:val="1440"/><m:intLim m:val="subSup"/><m:naryLim m:val="undOvr"/></m:mathPr><w:themeFontLang w:val="en-US" w:eastAsia="zh-CN"/><w:decimalSymbol w:val="."/><w:listSeparator w:val=","/></w:settings>`;
  const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;
  // 文档属性只写标题，不写作者（不留个人信息）
  const core = (title, now) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:subject>学历案</dc:subject><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const APP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>北冥有鱼 学历案</Application></Properties>`;

  // ───── 极简 zip（只存储不压缩），够 Word / WPS 打开 ─────
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zip(files, date = new Date()) {
    const enc = new TextEncoder();
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const locals = [], centrals = [];
    let offset = 0;
    for (const [name, content] of files) {
      const nameB = enc.encode(name);
      const data = typeof content === 'string' ? enc.encode(content) : content;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nameB.length, true); lh.setUint16(28, 0, true);
      locals.push(new Uint8Array(lh.buffer), nameB, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nameB.length, true);
      ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      centrals.push(new Uint8Array(ch.buffer), nameB);
      offset += 30 + nameB.length + data.length;
    }
    const cdSize = centrals.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
    const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
    let p = 0;
    for (const part of parts) { out.set(part, p); p += part.length; }
    return out;
  }

  const DEFAULTS = { teacher: false, color: false, notes: true, info: true };
  /** 学历案 → .docx 字节 */
  function toDocx(doc, options = {}, now = new Date()) {
    const opts = { ...DEFAULTS, ...options };
    const title = String(doc.meta?.title || '学历案');
    return zip([
      ['[Content_Types].xml', CONTENT_TYPES],
      ['_rels/.rels', RELS],
      ['docProps/core.xml', core(title, now.toISOString().replace(/\.\d+Z$/, 'Z'))],
      ['docProps/app.xml', APP],
      ['word/document.xml', documentXml(doc, opts)],
      ['word/styles.xml', styles(opts)],
      ['word/settings.xml', SETTINGS],
      ['word/footer1.xml', FOOTER],
      ['word/_rels/document.xml.rels', DOC_RELS],
    ], now);
  }
  /** 下载文件名：学历案-课题-学生版/教师版.docx（去掉文件名不允许的字符） */
  function docxName(doc, options = {}) {
    const t = String(doc.meta?.title || '未命名').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 40) || '未命名';
    return `学历案-${t}-${options.teacher ? '教师版' : '学生版'}.docx`;
  }
  /** 浏览器里直接下载 */
  function downloadDocx(doc, options = {}) {
    const blob = new Blob([toDocx(doc, options)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = docxName(doc, options);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  Object.assign(XL, { toDocx, docxName, downloadDocx, documentXml, docxStyles: styles, zip, crc32 });
})(typeof globalThis !== 'undefined' ? globalThis : this);
