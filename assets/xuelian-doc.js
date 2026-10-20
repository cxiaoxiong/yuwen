// 学历案文档模型（无依赖）：浏览器和 Node 共用。
// 一份学历案 = meta（课题、学科、课时……）+ 固定要素（每个要素一段「轻量 Markdown」）。
// 网页预览、本地检查、Word 导出、AI 上下文都从这同一份数据来，见 xuelian-docx.js、xuelian.js。
(function (G) {
  'use strict';
  const XL = G.XL || (G.XL = {});

  // ───── 固定要素（顺序即学历案的版式顺序）─────
  // aliases：AI 或老师写的标题别名；teacher：只在教师版出现
  const SECTIONS = [
    { key: 'topic', label: '学习主题', aliases: ['学习主题与课时', '主题与课时', '课题'] },
    { key: 'standards', label: '课标与学业质量要求', aliases: ['课标要求', '课程标准', '课标与学业质量', '课标要求与学业质量', '课程标准与学业质量'] },
    { key: 'goals', label: '学习目标', aliases: [] },
    { key: 'tasks', label: '评价任务', aliases: [] },
    { key: 'methods', label: '学法建议', aliases: ['学习建议', '学法指导', '资源与学法建议', '资源与建议'] },
    { key: 'process', label: '学习过程', aliases: [] },
    { key: 'assess', label: '作业与检测', aliases: ['检测与作业', '检测与练习', '课后检测', '分层作业', '作业与练习', '当堂检测与分层作业'] },
    { key: 'reflection', label: '学后反思', aliases: ['反思'] },
    { key: 'answers', label: '参考答案', aliases: ['答案', '答案要点', '参考答案与评分要点'], teacher: true },
    { key: 'design', label: '教学设计', aliases: ['教学设计（教师用）', '教师用教学设计'], teacher: true },
  ];
  const BY_KEY = Object.fromEntries(SECTIONS.map((s) => [s.key, s]));
  const BY_LABEL = new Map();
  for (const s of SECTIONS) for (const l of [s.label, ...s.aliases]) BY_LABEL.set(l, s.key);
  const CORE = ['topic', 'goals', 'tasks', 'process', 'assess', 'reflection'];

  const META_FIELDS = [
    ['title', '课题'], ['subject', '学科'], ['stage', '学段'], ['grade', '年级'], ['textbook', '教材与章节'],
    ['lessonType', '课型'], ['periods', '课时数'], ['minutes', '每课时分钟数'],
  ];
  const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '信息技术', '通用技术', '音乐', '美术', '体育'];
  /** 学段：初中按义务教育课程标准（2022 年版），高中按普通高中课程标准 */
  const STAGES = ['高中', '初中'];
  /** 学习路径「练一练」按学科组出题：老师选自己的学科，看本组的题（AI 点评仍按具体学科） */
  const GROUPS = {
    语文: ['语文'],
    英语: ['英语'],
    理科: ['数学', '物理', '化学', '生物', '信息技术', '通用技术'],
    文综: ['政治', '历史', '地理'],
    艺体: ['体育', '音乐', '美术'],
  };
  const groupOf = (subject) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(subject)) || null;

  /** 新建空白学历案 */
  function blank(meta = {}) {
    return { v: 1, meta: { title: '', subject: '语文', stage: '高中', grade: '', textbook: '', lessonType: '新授课', periods: 1, minutes: 40, ...meta }, sec: {} };
  }

  // ───── 文本 → 要素 ─────
  const labelOf = (raw) => raw.replace(/^[\s【\[（(]*|[\s】\]）)]*$/g, '').replace(/^[一二三四五六七八九十]+、|^\d+[.、]\s*/, '').trim();
  /** 识别标题对应的要素 key；不认识返回 null */
  function sectionKey(raw) {
    const t = labelOf(raw);
    if (BY_LABEL.has(t)) return BY_LABEL.get(t);
    for (const s of SECTIONS) if (t.startsWith(s.label)) return s.key;
    return null;
  }

  /**
   * 把「## 学习目标」分节的文字拆成要素。
   * 返回 { sec: {key: md}, unknown: [不认识的标题] }；不认识的二级标题降为三级，并入上一个要素。
   */
  function parseSections(md) {
    const sec = {}, unknown = [];
    let key = null, buf = [];
    const flush = () => {
      if (!key) return;
      const text = buf.join('\n').trim();
      sec[key] = sec[key] ? `${sec[key]}\n\n${text}` : text;
    };
    for (const line of String(md || '').replace(/\r\n?/g, '\n').split('\n')) {
      const m = /^##\s+(.+?)\s*$/.exec(line);
      if (m) {
        const k = sectionKey(m[1]);
        if (k) { flush(); key = k; buf = []; continue; }
        unknown.push(labelOf(m[1]));
        if (key) { buf.push(`### ${labelOf(m[1])}`); continue; }
      }
      if (key) buf.push(line);
    }
    flush();
    return { sec, unknown };
  }

  /** 要素 → 「## 标题」文字（AI 上下文、Markdown 导出用）。keys 省略时输出全部有内容的要素 */
  function toMarkdown(doc, { keys, meta = true } = {}) {
    const out = [];
    if (meta) {
      const m = doc.meta || {};
      out.push(`# ${m.title || '未命名学历案'}`);
      const info = META_FIELDS.filter(([k]) => k !== 'title' && m[k]).map(([k, l]) => `${l}：${m[k]}`);
      if (info.length) out.push(info.join('；'));
    }
    for (const s of SECTIONS) {
      if (keys && !keys.includes(s.key)) continue;
      const md = (doc.sec || {})[s.key];
      if (md && md.trim()) out.push(`## ${s.label}\n\n${md.trim()}`);
    }
    return out.join('\n\n') + '\n';
  }

  // ───── 段内格式 → 块 ─────
  // 块：h3 小标题（一、课前准备）· h4 活动标题 · p 段落 · bullet 列表项 · quote 提示语（楷体）
  //     math 独立公式 · table 表格 · rule 答题横线
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSepRow = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const splitRow = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

  function blocks(md) {
    const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      if (!t || /^-{3,}$/.test(t)) continue;
      // 独立公式：$$…$$ 一行，或 $$ 起止的多行
      if (t.startsWith('$$')) {
        if (t.length > 4 && t.endsWith('$$')) { out.push({ t: 'math', tex: t.slice(2, -2).trim() }); continue; }
        const body = [t.slice(2)];
        while (++i < lines.length && !lines[i].trim().endsWith('$$')) body.push(lines[i]);
        if (i < lines.length) body.push(lines[i].trim().slice(0, -2));
        out.push({ t: 'math', tex: body.join('\n').trim() });
        continue;
      }
      if (isRow(line)) {
        const rows = [];
        let head = false;
        for (; i < lines.length && (isRow(lines[i]) || isSepRow(lines[i])); i++) {
          if (isSepRow(lines[i])) { if (rows.length === 1) head = true; continue; }
          rows.push(splitRow(lines[i]));
        }
        i--;
        const n = Math.max(...rows.map((r) => r.length));
        out.push({ t: 'table', head, rows: rows.map((r) => [...r, ...Array(n - r.length).fill('')].map((c) => c.split(/<br\s*\/?>/i).map(inline))) });
        continue;
      }
      let m;
      if ((m = /^#{3}\s+(.+)$/.exec(t))) { out.push({ t: 'h3', inl: inline(m[1]) }); continue; }
      if ((m = /^#{4,6}\s+(.+)$/.exec(t))) { out.push({ t: 'h4', inl: inline(m[1]) }); continue; }
      if ((m = /^>\s?(.*)$/.exec(t))) {
        const prev = out[out.length - 1];
        if (prev?.t === 'quote' && /^>/.test(lines[i - 1]?.trim() || '')) prev.lines.push(inline(m[1]));
        else out.push({ t: 'quote', lines: [inline(m[1])] });
        continue;
      }
      if ((m = /^[-*•·]\s+(.+)$/.exec(t))) { out.push({ t: 'bullet', inl: inline(m[1]) }); continue; }
      if (/^_{6,}$/.test(t) || /^〔答题(线|区)〕$/.test(t)) { out.push({ t: 'rule' }); continue; }
      out.push({ t: 'p', inl: inline(t) });
    }
    return out;
  }

  // ───── 行内：**加粗**、$公式$、〔此处插图：…〕、填空横线 ─────
  // 返回 [{t:'text', s, b?} | {t:'math', tex} | {t:'fig', s} | {t:'blank', n}]
  function inline(src) {
    const out = [];
    const s = String(src ?? '');
    const re = /\*\*(.+?)\*\*|(?<!\\)\$(?!\$)((?:\\\$|[^$])+?)(?<!\\)\$|〔(?:此处)?插图[:：]([^〕]*)〕|(_{3,})/g;
    let last = 0, m;
    const text = (t, b) => { if (t) out.push(b ? { t: 'text', s: t.replace(/\\\$/g, '$'), b: true } : { t: 'text', s: t.replace(/\\\$/g, '$') }); };
    while ((m = re.exec(s))) {
      text(s.slice(last, m.index));
      if (m[1] !== undefined) {
        // 加粗里也可以有公式
        for (const x of inline(m[1])) out.push(x.t === 'text' ? { ...x, b: true } : x);
      } else if (m[2] !== undefined) out.push({ t: 'math', tex: m[2].replace(/\\\$/g, '\\$').trim() });
      else if (m[3] !== undefined) out.push({ t: 'fig', s: m[3].trim() });
      else out.push({ t: 'blank', n: m[4].length });
      last = re.lastIndex;
    }
    text(s.slice(last));
    return out;
  }
  const plain = (inl) => inl.map((x) => (x.t === 'text' ? x.s : x.t === 'math' ? x.tex : x.t === 'fig' ? `〔插图：${x.s}〕` : '_'.repeat(x.n))).join('');

  // ───── 本地检查（即时、确定的规则；语义层面交给 AI 体检）─────
  const VAGUE = ['了解', '理解', '掌握', '体会', '认识', '感受', '领会', '熟悉', '知道', '明白', '感悟', '领悟'];
  const OBSERVABLE = ['说出', '写出', '说明', '概括', '归纳', '分析', '比较', '解释', '设计', '计算', '推导', '绘制', '画出', '判断', '辨析', '辨别', '默写', '复述', '背诵', '评价', '运用', '应用', '举例', '列出', '完成', '改写', '仿写', '论证', '指出', '梳理', '提炼', '朗读', '翻译', '断句', '识别', '区分', '求出', '证明', '描述', '表达', '撰写', '创作', '制作', '演示', '测量', '估算', '预测', '总结', '质疑', '探究', '构建', '建构', '选择', '填写', '标注', '口述', '展示', '实施', '提出', '找出', '概述', '阐述', '诊断', '纠正', '编写', '命制', '解决', '确定', '推断', '还原', '转化', '演绎', '讲述',
    '写', '圈', '画', '填', '补全', '排序', '连线', '选出', '讲', '说', '读', '背', '算', '做', '演唱', '演奏', '示范', '操作', '绘'];
  const codeRe = (p) => new RegExp(`(?<![A-Za-z])${p}(\\d+)`, 'g');
  const codes = (s, p) => [...new Set([...String(s).matchAll(codeRe(p))].map((m) => `${p}${m[1]}`))];
  const lead = (s, p) => new RegExp(`^[\\s*【\\[（(]*${p}(\\d+)(?!\\d)`).exec(s);

  /** 学习目标：[{id, text}]（行首 G1、表格首列 G1 都算） */
  function goalsOf(md) {
    const out = [];
    for (const b of blocks(md)) {
      if (b.t === 'table') for (const r of b.rows) { const s = r.map((c) => c.map(plain).join(' ')).join(' '); const m = lead(s, 'G'); if (m) out.push({ id: `G${m[1]}`, text: s }); }
      else if (b.inl) { const s = plain(b.inl); const m = lead(s, 'G'); if (m) out.push({ id: `G${m[1]}`, text: s }); }
    }
    return out;
  }
  /** 评价任务：[{id, text, goals:[G…]}]（行首 T1 或表格首列 T1） */
  function tasksOf(md) {
    const out = [];
    const add = (s) => { const m = lead(s, 'T'); if (m) out.push({ id: `T${m[1]}`, text: s, goals: codes(s.slice(m[0].length), 'G') }); };
    for (const b of blocks(md)) {
      if (b.t === 'table') for (const r of b.rows) add(r.map((c) => c.map(plain).join(' ')).join(' '));
      else if (b.inl) add(plain(b.inl));
    }
    return out;
  }
  /** 课中活动用时：只算「课中」小节下的活动标题（没有分小节时算全部） */
  function minutesOf(md) {
    const bs = blocks(md);
    const hasStage = bs.some((b) => b.t === 'h3' && /课中|课前|课后/.test(plain(b.inl)));
    let counting = !hasStage, sum = 0;
    const items = [];
    for (const b of bs) {
      if (b.t === 'h3') { counting = !hasStage || /课中/.test(plain(b.inl)); continue; }
      if (b.t !== 'h4' || !counting) continue;
      const s = plain(b.inl);
      const m = /(\d+)\s*(?:分钟|min|′)/.exec(s);
      if (m) { sum += +m[1]; items.push({ text: s, min: +m[1] }); }
    }
    return { sum, items };
  }

  /**
   * 本地检查。返回 [{level:'error'|'warn'|'info', sec, msg}]，按要素顺序排列。
   * texError(tex) 可选：返回公式错误信息（浏览器里由 temml 提供），没有就不查公式。
   */
  function check(doc, { texError } = {}) {
    const sec = doc.sec || {};
    const out = [];
    const add = (level, k, msg) => out.push({ level, sec: k, msg });
    const m = doc.meta || {};
    if (!String(m.title || '').trim()) add('warn', 'meta', '还没有填写课题。');
    for (const k of CORE) if (!String(sec[k] || '').trim()) add('warn', k, `「${BY_KEY[k].label}」还是空的。`);

    const goals = goalsOf(sec.goals || '');
    const tasks = tasksOf(sec.tasks || '');
    if (sec.goals && !goals.length) add('warn', 'goals', '学习目标没有编号。请在每条目标前写 G1、G2……，评价任务才能逐条对应。');
    if (goals.length > 6) add('info', 'goals', `共 ${goals.length} 条目标，一课时通常 2—5 条为宜。`);
    const seenG = new Set();
    for (const g of goals) {
      if (seenG.has(g.id)) add('error', 'goals', `${g.id} 重复编号。`);
      seenG.add(g.id);
      const body = g.text.replace(/^[\s*【\[（(]*G\d+[\s　:：.、）)】\]]*/, '');
      const vague = VAGUE.filter((v) => body.includes(v));
      const seen = OBSERVABLE.some((v) => body.includes(v));
      if (vague.length && !seen) add('warn', 'goals', `${g.id} 用了「${vague.join('、')}」，课堂上看不见、测不了。请改成可观察的行为，如「能说出……」「能用……解释……」。`);
      else if (!seen) add('info', 'goals', `${g.id} 没有找到明确的行为动词（说出、分析、计算……），请确认它可以观察和检测。`);
    }
    if (sec.tasks && !tasks.length) add('warn', 'tasks', '评价任务没有编号。请在每项任务前写 T1、T2……，并注明对应的目标，如「（对应 G1）」。');
    const goalIds = new Set(goals.map((g) => g.id));
    const covered = new Set();
    for (const t of tasks) {
      if (!t.goals.length) add('error', 'tasks', `${t.id} 没有注明对应哪条学习目标。`);
      for (const gid of t.goals) {
        if (goals.length && !goalIds.has(gid)) add('error', 'tasks', `${t.id} 对应的 ${gid} 不在学习目标里。`);
        covered.add(gid);
      }
    }
    if (tasks.length) for (const g of goals) if (!covered.has(g.id)) add('error', 'goals', `${g.id} 没有评价任务检测它——没有评价任务的目标，等于没写。`);

    const used = new Set([...codes(sec.process || '', 'T'), ...codes(sec.assess || '', 'T')]);
    for (const t of tasks) if (sec.process && !used.has(t.id)) add('warn', 'process', `${t.id} 没有在学习过程中出现。请在对应活动的标题里注明，如「活动一〔${t.id}｜8分钟〕」。`);

    if (sec.process) {
      const total = (+m.periods || 1) * (+m.minutes || 40);
      const { sum, items } = minutesOf(sec.process);
      if (!items.length) add('info', 'process', '课中活动没有标注用时，无法核对时间。可在活动标题里写「〔T1｜8分钟〕」。');
      else if (sum > total) add('error', 'process', `课中活动合计 ${sum} 分钟，超过了 ${total} 分钟。`);
      else if (sum < total * 0.7) add('info', 'process', `课中活动合计 ${sum} 分钟，比 ${total} 分钟少不少，请确认是否漏标了用时。`);
    }
    if (sec.assess && !/(^|\n)\s*[#*【]*\s*(A\s*[组层级类]|A\s*[基保]|【A)/.test(sec.assess)) add('info', 'assess', '作业没有分层。可按「A 基础巩固 / B 能力提升 / C 拔尖挑战」分组。');
    if (sec.reflection && /谈谈(你的)?收获|说说(你的)?收获/.test(sec.reflection)) add('warn', 'reflection', '学后反思不要只写「谈谈收获」，请让学生用证据回答：学会了什么、怎么学会的、还差什么。');

    if (texError) {
      for (const s of SECTIONS) {
        const md = sec[s.key];
        if (!md) continue;
        for (const tex of texList(md)) {
          const err = texError(tex);
          if (err) add('error', s.key, `公式写法有误：$${tex.length > 40 ? tex.slice(0, 40) + '…' : tex}$（${err}）`);
        }
      }
    }
    const order = ['meta', ...SECTIONS.map((s) => s.key)];
    return out.sort((a, b) => order.indexOf(a.sec) - order.indexOf(b.sec));
  }
  /** 一段文字里的全部公式 */
  function texList(md) {
    const out = [];
    const walk = (inl) => inl.forEach((x) => x.t === 'math' && out.push(x.tex));
    for (const b of blocks(md)) {
      if (b.t === 'math') out.push(b.tex);
      else if (b.inl) walk(b.inl);
      else if (b.lines) b.lines.forEach(walk);
      else if (b.rows) b.rows.forEach((r) => r.forEach((c) => c.forEach(walk)));
    }
    return out;
  }

  // ───── 网页预览 HTML ─────
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  /** 公式 → MathML（有 temml 时）；没有就原样显示 */
  function mathHtml(tex, display) {
    const T = G.temml;
    if (T) {
      try { return T.renderToString(tex, { displayMode: display, throwOnError: true, annotate: false }); }
      catch (e) { return `<code class="xl-tex-err" title="${esc(e.message)}">${esc(tex)}</code>`; }
    }
    return `<code class="xl-tex">${esc(tex)}</code>`;
  }
  const inlineHtml = (inl) => inl.map((x) => {
    if (x.t === 'text') return x.b ? `<strong>${esc(x.s)}</strong>` : esc(x.s);
    if (x.t === 'math') return mathHtml(x.tex, false);
    if (x.t === 'fig') return `<span class="xl-fig">〔此处插图：${esc(x.s)}〕</span>`;
    return `<span class="blank" style="--n:${x.n}"></span>`;
  }).join('');
  function blocksHtml(md) {
    return blocks(md).map((b) => {
      switch (b.t) {
        case 'h3': return `<h4 class="xl-h3">${inlineHtml(b.inl)}</h4>`;
        case 'h4': return `<h5 class="xl-h4">${inlineHtml(b.inl)}</h5>`;
        case 'quote': return `<blockquote class="xl-quote">${b.lines.map((l) => `<p>${inlineHtml(l)}</p>`).join('')}</blockquote>`;
        case 'bullet': return `<p class="xl-bullet">${inlineHtml(b.inl)}</p>`;
        case 'math': return `<div class="xl-math">${mathHtml(b.tex, true)}</div>`;
        case 'rule': return '<p class="xl-rule"></p>';
        case 'table': {
          const cell = (tag, c) => `<${tag}>${c.map(inlineHtml).join('<br>')}</${tag}>`;
          const [first, ...rest] = b.rows;
          const head = b.head ? `<thead><tr>${first.map((c) => cell('th', c)).join('')}</tr></thead>` : '';
          const body = (b.head ? rest : b.rows).map((r) => `<tr>${r.map((c) => cell('td', c)).join('')}</tr>`).join('');
          return `<div class="table-wrap"><table>${head}<tbody>${body}</tbody></table></div>`;
        }
        default: return `<p>${inlineHtml(b.inl)}</p>`;
      }
    }).join('\n');
  }
  /** 整份学历案的网页版；teacher=false 时不含参考答案和教学设计 */
  function toHtml(doc, { teacher = true } = {}) {
    const m = doc.meta || {};
    const parts = [`<header class="xl-doc-head"><h2 class="xl-doc-title">${esc(m.title || '未命名学历案')}${/学历案$/.test(m.title || '') ? '' : ' 学历案'}</h2>${subtitle(m) ? `<p class="xl-doc-sub">${esc(subtitle(m))}</p>` : ''}</header>`];
    for (const s of SECTIONS) {
      if (s.teacher && !teacher) continue;
      const md = (doc.sec || {})[s.key];
      if (!md || !md.trim()) continue;
      parts.push(`<section class="xl-sec" data-sec="${s.key}"><h3 class="xl-label">【${s.label}】</h3>${blocksHtml(md)}</section>`);
    }
    return parts.join('\n');
  }
  /** 副标题：——教材与章节｜课型（N课时 M分钟） */
  function subtitle(m) {
    const time = m.periods ? `${m.periods}课时${m.minutes ? `，${(+m.periods || 1) * +m.minutes}分钟` : ''}` : '';
    const bits = [m.grade, m.textbook].filter(Boolean).join(' · ');
    const tail = [m.lessonType, time].filter(Boolean).join('｜');
    return bits || tail ? `——${[bits, tail].filter(Boolean).join('｜')}` : '';
  }

  Object.assign(XL, { SECTIONS, BY_KEY, CORE, META_FIELDS, SUBJECTS, STAGES, GROUPS, groupOf, blank, sectionKey, parseSections, toMarkdown, blocks, inline, plain, goalsOf, tasksOf, minutesOf, check, texList, toHtml, blocksHtml, mathHtml, subtitle, esc });
})(typeof globalThis !== 'undefined' ? globalThis : this);
