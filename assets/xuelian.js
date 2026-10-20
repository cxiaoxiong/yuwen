// 学历案板块的页面交互（无依赖）：工作台、学习路径的“练一练”、范例页的导出与复制。
// 文档模型、检查、Word 导出在 xuelian-doc.js / xuelian-omml.js / xuelian-docx.js；AI 走同源 /api/ai/chat 的场景请求（提示词在 server/skills/）。
// 学历案只存在本机浏览器：localStorage 的 xuelian:index（目录）与 xuelian:doc:<id>（每一份）。
(function () {
  'use strict';
  const XL = window.XL;
  if (!XL) return;
  const endpoint = '/api/ai';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = XL.esc;
  const store = {
    ok: (() => { try { localStorage.setItem('xuelian:t', '1'); localStorage.removeItem('xuelian:t'); return true; } catch (e) { return false; } })(),
    get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ } },
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const setStatus = (el, text, kind = '') => { if (!el) return; el.textContent = text; el.className = `xl-status${kind ? ' is-' + kind : ''}`; };

  // ───── AI：健康检查与流式请求 ─────
  let health = null;
  const healthReady = fetch(endpoint + '/health').then((r) => r.json()).then((d) => (health = d.xl || { ok: false })).catch(() => (health = { ok: false }));
  const codeOf = () => store.get('xuelian:code', '');

  /** 场景请求：onText(累计文字) 实时回调；返回 { text, truncated } */
  async function ask(body, { onText, signal } = {}) {
    const res = await fetch(endpoint + '/chat', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, code: codeOf() || undefined }),
    });
    if (!res.ok) {
      let j = {};
      try { j = await res.json(); } catch (e) { /* 忽略 */ }
      const err = new Error(j.error || 'AI 暂时不可用，请稍后再试。');
      err.needCode = !!j.code;
      throw err;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', text = '', truncated = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const ev = buf.slice(0, i); buf = buf.slice(i + 2);
        if (!ev.startsWith('data:')) continue;
        const d = JSON.parse(ev.slice(5));
        if (d.error) throw new Error(d.error);
        if (d.warn === 'length') truncated = true;
        if (d.t) { text += d.t; if (onText) onText(text); }
      }
    }
    return { text, truncated };
  }
  const netMsg = (err) => (err.message === 'Failed to fetch' ? 'AI 暂时连不上，请稍后再试。' : err.message);

  /** 有 AI 的区块：服务不可用时禁用按钮并说明原因 */
  async function gateAi(root, offNote) {
    await healthReady;
    const on = !!health.ok;
    $$('[data-ai] button, [data-xl-coach]', root).forEach((b) => { if (!on) b.disabled = true; });
    if (!on && offNote) { offNote.hidden = false; offNote.textContent = 'AI 暂不可用（服务未开启或今天的额度已用完）。所有内容都可以手动编写，检查与导出不受影响。'; }
    return on;
  }

  // ───── 文档存取 ─────
  const IDX = 'xuelian:index';
  const keyOf = (id) => `xuelian:doc:${id}`;
  const listDocs = () => store.get(IDX, []);
  function saveIndex(doc) {
    const list = listDocs().filter((x) => x.id !== doc.id);
    list.unshift({ id: doc.id, title: doc.meta.title || '未命名学历案', updated: Date.now() });
    store.set(IDX, list);
  }
  function newDoc(seed = {}) {
    const d = XL.blank(seed.meta || {});
    return { ...d, id: uid(), source: '', request: '', ...seed, meta: { ...d.meta, ...(seed.meta || {}) }, sec: { ...(seed.sec || {}) } };
  }
  /** 范例页“复制到工作台”：存为新的一份，并设为当前 */
  function adoptDoc(doc) {
    const d = newDoc({ meta: { ...doc.meta }, sec: { ...doc.sec } });
    store.set(keyOf(d.id), d);
    saveIndex(d);
    store.set('xuelian:current', d.id);
    return d;
  }

  // ───── 范例页、工作台共用：导出 ─────
  function exportOpts(root) {
    const ver = $('input[type=radio]:checked', root)?.value || 'student';
    const opt = (k) => !!$(`[data-opt="${k}"]`, root.closest('[data-xl-workbench]') || root)?.checked;
    return { teacher: ver === 'teacher', color: opt('color'), info: $('[data-opt="info"]') ? opt('info') : true, notes: $('[data-opt="notes"]') ? opt('notes') : true };
  }
  function exportDocx(doc, root, statusEl) {
    try {
      XL.downloadDocx(doc, exportOpts(root));
      setStatus(statusEl, `已导出：${XL.docxName(doc, exportOpts(root))}`, 'ok');
    } catch (err) {
      setStatus(statusEl, `导出失败：${err.message}`, 'err');
    }
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ───── 范例页 ─────
  const exRoot = $('[data-xl-example]');
  if (exRoot) {
    const doc = JSON.parse($('[data-xl-doc]', exRoot).textContent);
    const st = $('[data-xl-status]', exRoot);
    $('[data-xl-docx]', exRoot).addEventListener('click', () => exportDocx(doc, exRoot, st));
    $('[data-xl-copy]', exRoot).addEventListener('click', (ev) => {
      if (!store.ok) { ev.preventDefault(); setStatus(st, '浏览器禁止了本地存储，无法复制到工作台。', 'err'); return; }
      adoptDoc(doc);
    });
  }

  // ───── 练一练 ─────
  // 「我的学科」存在 xuelian:subject；分学科组的题按组切换（data-xl-v），顶层那一版的作答沿用原来的存储键，其他组加「:组名」
  const mySubject = () => store.get('xuelian:subject', '');
  const practices = [];
  $$('[data-xl-practice]').forEach((box) => {
    const base = `xuelian:practice:${box.dataset.lesson}:${box.dataset.id}`;
    const input = $('[data-xl-answer]', box);
    const btn = $('[data-xl-coach]', box);
    const st = $('[data-xl-status]', box);
    const out = $('[data-xl-feedback]', box);
    const top = box.dataset.group || '';
    let group = top;
    const key = () => (group && group !== top ? `${base}:${group}` : base);
    const exercise = () => JSON.parse($(group ? `[data-xl-v="${group}"] [data-xl-exercise]` : '[data-xl-exercise]', box).textContent);
    const show = (subject) => {
      if (!top) return;
      const g = XL.groupOf(subject) || top;
      if (g === group && input.dataset.loaded) return;
      group = g;
      $$('[data-xl-v]', box).forEach((el) => { el.hidden = el.dataset.xlV !== group; });
      const chip = $('[data-xl-grp]', box);
      if (chip) chip.textContent = `${group}组`;
      input.value = store.get(key(), '');
      input.dataset.loaded = '1';
      out.hidden = true; out.innerHTML = ''; setStatus(st, '');
    };
    practices.push(show);
    input.value = store.get(key(), '');
    input.addEventListener('input', () => store.set(key(), input.value));
    healthReady.then(() => { btn.disabled = !health.ok; if (!health.ok) setStatus(st, 'AI 暂不可用，可以展开评价要点自查。'); });
    btn.addEventListener('click', async () => {
      const answer = input.value.trim();
      if (!answer) { setStatus(st, '请先写下你的作答。', 'err'); input.focus(); return; }
      btn.disabled = true;
      setStatus(st, 'AI 正在对照评价要点……');
      out.hidden = false;
      out.innerHTML = '';
      try {
        const ex = exercise();
        const text0 = `题目：\n${ex.prompt}\n\n评价要点：\n${ex.criteria}\n\n参考答案（示例）：\n${ex.sample}`;
        const { text } = await ask({ scene: 'xl-coach', exercise: text0, answer, meta: mySubject() ? { subject: mySubject() } : {} }, { onText: (t) => { out.innerHTML = feedbackHtml(t); } });
        out.innerHTML = feedbackHtml(text);
        setStatus(st, 'AI 点评仅供参考。', 'ok');
      } catch (err) {
        out.hidden = true;
        setStatus(st, err.needCode ? '学历案 AI 需要访问码，请先在工作台输入。' : netMsg(err), 'err');
      } finally { btn.disabled = false; }
    });
  });
  $$('[data-xl-my-subject]').forEach((sel) => {
    sel.value = mySubject();
    sel.addEventListener('change', () => { store.set('xuelian:subject', sel.value); practices.forEach((f) => f(sel.value)); });
  });
  if (mySubject()) practices.forEach((f) => f(mySubject()));
  function feedbackHtml(text) {
    return String(text).split('\n').filter((l) => l.trim()).map((l) => {
      const m = /^(结论|逐条对照|这样改)[:：]\s*(.*)$/.exec(l.trim());
      if (m) return `<p><strong>${esc(m[1])}：</strong>${inlineHtml(m[2])}</p>`;
      return `<p>${inlineHtml(l.trim())}</p>`;
    }).join('');
  }
  const inlineHtml = (s) => XL.blocksHtml(s).replace(/^<p>|<\/p>$/g, '');

  // ───── 工作台 ─────
  const wb = $('[data-xl-workbench]');
  if (!wb) return;

  const pick = $('[data-doc-pick]', wb);
  const saveSt = $('[data-save-status]', wb);
  const genSt = $('[data-gen-status]', wb);
  const progress = $('[data-progress]', wb);
  const stream = $('[data-stream]', wb);
  const btnGen = $('[data-generate]', wb), btnStop = $('[data-stop]', wb), btnUndo = $('[data-undo]', wb);
  const checksEl = $('[data-checks]', wb), checkSum = $('[data-check-sum]', wb);
  const auditList = $('[data-audit-list]', wb), auditSum = $('[data-audit-sum]', wb), auditSt = $('[data-audit-status]', wb);
  const codeBox = $('[data-code]', wb), codeInput = $('[data-code-input]', wb);
  const LIMIT = { source: 20000, request: 2000 };
  let doc = null;
  let busy = null; // AbortController

  if (!store.ok) setStatus(saveSt, '浏览器禁止了本地存储（可能是隐私模式），关闭页面后内容会丢失，请及时导出 Word 或备份。', 'err');

  function load(id) {
    doc = (id && store.get(keyOf(id))) || null;
    if (!doc) { doc = newDoc(); persist(true); }
    store.set('xuelian:current', doc.id);
    fill();
  }
  let saveTimer = null;
  function persist(now) {
    clearTimeout(saveTimer);
    const run = () => {
      if (!store.set(keyOf(doc.id), doc)) { setStatus(saveSt, '保存失败：浏览器存储已满或被禁止。请导出备份后删除不用的学历案。', 'err'); return; }
      saveIndex(doc);
      renderPick();
      setStatus(saveSt, `已自动保存 ${new Date().toLocaleTimeString().slice(0, 5)}`);
    };
    if (now) run(); else saveTimer = setTimeout(run, 400);
  }
  function renderPick() {
    const list = listDocs();
    pick.innerHTML = list.map((x) => `<option value="${esc(x.id)}"${x.id === doc.id ? ' selected' : ''}>${esc(x.title)}（${new Date(x.updated).toLocaleDateString()}）</option>`).join('');
  }
  function fill() {
    $$('[data-meta]', wb).forEach((el) => { el.value = doc.meta[el.dataset.meta] ?? ''; });
    $$('[data-field]', wb).forEach((el) => { el.value = doc[el.dataset.field] || ''; });
    $$('.xl-sec-edit', wb).forEach((box) => { $('[data-sec-input]', box).value = doc.sec[box.dataset.key] || ''; refreshSecPreview(box); });
    btnUndo.hidden = !doc.undo;
    counts();
    auditList.innerHTML = ''; auditSum.hidden = true; setStatus(auditSt, '');
    recheck();
    renderPick();
  }
  function counts() {
    for (const k of Object.keys(LIMIT)) {
      const n = (doc[k] || '').length;
      const el = $(`[data-count="${k}"]`, wb);
      if (el) { el.textContent = `${n} / ${LIMIT[k]} 字`; el.style.color = n > LIMIT[k] ? 'var(--seal)' : ''; }
    }
  }

  // 输入 → 文档
  wb.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset.meta) { doc.meta[t.dataset.meta] = t.type === 'number' ? (+t.value || '') : t.value; persist(); recheckSoon(); }
    else if (t.dataset.field) { doc[t.dataset.field] = t.value; counts(); persist(); }
    else if (t.matches('[data-sec-input]')) { const box = t.closest('.xl-sec-edit'); doc.sec[box.dataset.key] = t.value; persist(); recheckSoon(); }
  });
  wb.addEventListener('change', (ev) => { if (ev.target.dataset.meta === 'subject' || ev.target.dataset.meta === 'stage') persist(true); });

  // 编辑 / 预览切换
  wb.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-view]');
    if (!b) return;
    const box = b.closest('.xl-sec-edit');
    const preview = b.dataset.view === 'preview';
    $$('[data-view]', box).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('[data-sec-input]', box).hidden = preview;
    const pv = $('[data-sec-preview]', box);
    pv.hidden = !preview;
    if (preview) refreshSecPreview(box);
  });
  // “查看完整格式”：展开格式说明
  wb.addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-toggle-format]')) return;
    ev.preventDefault();
    const f = $('#xl-format', wb);
    f.open = true;
    f.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  function refreshSecPreview(box) {
    const pv = $('[data-sec-preview]', box);
    if (!pv.hidden) pv.innerHTML = XL.blocksHtml(doc.sec[box.dataset.key] || '') || '<p class="xl-hint">还没有内容。</p>';
  }

  // 本地检查
  let checkTimer = null;
  const recheckSoon = () => { clearTimeout(checkTimer); checkTimer = setTimeout(recheck, 300); };
  function recheck() {
    const issues = XL.check(doc, { texError: XL.texError });
    const n = { error: 0, warn: 0, info: 0 };
    issues.forEach((x) => n[x.level]++);
    checkSum.textContent = issues.length ? `错误 ${n.error} · 提醒 ${n.warn} · 建议 ${n.info}` : '';
    checksEl.innerHTML = issues.length
      ? issues.map((x) => `<li class="is-${x.level}">${x.sec !== 'meta' ? `<a href="#sec-${x.sec}" data-goto="${x.sec}">${esc(XL.BY_KEY[x.sec].label)}</a>` : '<a href="#step-1" data-goto="meta">课题</a>'}${esc(x.msg)}</li>`).join('')
      : '<li class="is-ok">没有发现问题。别忘了再请 AI 体检，并亲自审读一遍。</li>';
    // 每个要素旁边标出最重的问题
    $$('.xl-sec-edit', wb).forEach((box) => {
      const k = box.dataset.key;
      const mine = issues.filter((x) => x.sec === k);
      const st = $('[data-state]', box);
      const md = (doc.sec[k] || '').trim();
      const worst = mine.find((x) => x.level === 'error') || mine.find((x) => x.level === 'warn');
      st.textContent = worst ? (worst.level === 'error' ? '有错误' : '有提醒') : md ? `${md.length} 字` : '空';
      st.className = `xl-sec-state${worst ? (worst.level === 'error' ? ' is-err' : ' is-warn') : ''}`;
    });
  }
  wb.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-goto]');
    if (!a) return;
    ev.preventDefault();
    const k = a.dataset.goto;
    if (k === 'meta') { $('#step-1').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#xl-title').focus({ preventScroll: true }); return; }
    const box = $(`.xl-sec-edit[data-key="${k}"]`, wb);
    box.open = true;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('[data-sec-input]', box).focus({ preventScroll: true });
  });

  // 文档管理
  pick.addEventListener('change', () => { if (busy) busy.abort(); load(pick.value); });
  wb.addEventListener('click', (ev) => {
    const act = ev.target.closest('button[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'new') { if (busy) busy.abort(); doc = newDoc(); persist(true); fill(); $('#xl-title').focus(); }
    if (act === 'dup') { const d = newDoc({ meta: { ...doc.meta, title: `${doc.meta.title || '未命名'}（副本）` }, sec: { ...doc.sec }, source: doc.source, request: doc.request }); doc = d; persist(true); fill(); setStatus(saveSt, '已复制为新的一份。', 'ok'); }
    if (act === 'del') {
      if (!confirm(`删除「${doc.meta.title || '未命名学历案'}」？删除后无法恢复（建议先导出备份）。`)) return;
      store.del(keyOf(doc.id));
      store.set(IDX, listDocs().filter((x) => x.id !== doc.id));
      const next = listDocs()[0];
      load(next ? next.id : null);
    }
    if (act === 'backup') {
      const { undo, ...data } = doc;
      download(`学历案备份-${(doc.meta.title || '未命名').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 30)}.json`, JSON.stringify({ app: 'xuelian', v: 1, doc: data }, null, 2), 'application/json');
    }
  });
  $('input[data-act="import"]', wb).addEventListener('change', async (ev) => {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const d = j.doc || j;
      if (!d || typeof d !== 'object' || !d.meta || !d.sec) throw new Error('不是学历案备份文件');
      const keys = new Set(XL.SECTIONS.map((s) => s.key));
      const sec = {};
      for (const [k, v] of Object.entries(d.sec)) if (keys.has(k) && typeof v === 'string') sec[k] = v;
      doc = newDoc({ meta: d.meta, sec, source: String(d.source || ''), request: String(d.request || '') });
      persist(true); fill();
      setStatus(saveSt, `已导入「${doc.meta.title || '未命名学历案'}」。`, 'ok');
    } catch (err) { setStatus(saveSt, `导入失败：${err.message}`, 'err'); }
  });

  // 访问码
  codeInput.value = codeOf();
  codeInput.addEventListener('input', () => store.set('xuelian:code', codeInput.value.trim()));
  const showCode = () => { codeBox.hidden = false; };

  // AI 写入之前留一份，可以撤销一次
  function snapshot(label) { doc.undo = { label, sec: { ...doc.sec } }; btnUndo.hidden = false; }
  btnUndo.addEventListener('click', () => {
    if (!doc.undo) return;
    doc.sec = { ...doc.undo.sec };
    const label = doc.undo.label;
    delete doc.undo;
    persist(true); fill();
    setStatus(genSt, `已撤销：${label}`, 'ok');
  });
  function applySections(text, allowed) {
    const { sec } = XL.parseSections(text);
    const keys = Object.keys(sec).filter((k) => !allowed || allowed.includes(k)).filter((k) => sec[k].trim());
    for (const k of keys) doc.sec[k] = sec[k].trim();
    return keys;
  }
  const docMd = () => XL.toMarkdown(doc, { meta: false });
  const metaOf = () => ({ ...doc.meta });
  function setBusy(ac) {
    busy = ac;
    btnStop.hidden = !ac;
    $$('[data-ai] button', wb).forEach((b) => { if (b !== btnStop && b !== btnUndo) b.disabled = !!ac || !health?.ok; });
  }
  btnStop.addEventListener('click', () => busy && busy.abort());

  // 一键成稿：分段生成，每段带上前面已写好的部分
  const PARTS = [
    { part: 'frame', label: '主题、课标、目标、评价任务、学法', keys: ['topic', 'standards', 'goals', 'tasks', 'methods'] },
    { part: 'process', label: '学习过程', keys: ['process'] },
    { part: 'assess', label: '作业与检测、学后反思、参考答案', keys: ['assess', 'reflection', 'answers'] },
    { part: 'design', label: '教学设计', keys: ['design'] },
  ];
  btnGen.addEventListener('click', async () => {
    if (busy) return;
    if (!doc.meta.title && !doc.source.trim() && !doc.request.trim()) { setStatus(genSt, '请先填写课题，或粘贴课文、知识点等材料。', 'err'); $('#xl-title').focus(); return; }
    for (const k of Object.keys(LIMIT)) if ((doc[k] || '').length > LIMIT[k]) { setStatus(genSt, `「${k === 'source' ? '原文与材料' : '我的要求'}」超过 ${LIMIT[k]} 字，请删减。`, 'err'); return; }
    const parts = PARTS.filter((p) => p.part !== 'design' || $('[data-gen-design]', wb).checked);
    const filled = parts.flatMap((p) => p.keys).filter((k) => (doc.sec[k] || '').trim());
    if (filled.length && !confirm(`将重新生成并替换已有的 ${filled.length} 个要素（${filled.map((k) => XL.BY_KEY[k].label).join('、')}）。生成后可以用“撤销上一次 AI 修改”恢复。继续吗？`)) return;
    snapshot('一键成稿');
    for (const p of parts) for (const k of p.keys) delete doc.sec[k];
    const ac = new AbortController();
    setBusy(ac);
    progress.hidden = false;
    progress.innerHTML = parts.map((p) => `<li data-part="${p.part}">${esc(p.label)}</li>`).join('');
    stream.hidden = false;
    const warns = [];
    try {
      for (const p of parts) {
        const li = $(`[data-part="${p.part}"]`, progress);
        li.className = 'is-run';
        setStatus(genSt, `正在写：${p.label}……`);
        stream.textContent = '';
        const { text, truncated } = await ask(
          { scene: 'xl-generate', part: p.part, meta: metaOf(), source: doc.source, request: doc.request, doc: docMd() },
          { signal: ac.signal, onText: (t) => { stream.textContent = t; stream.scrollTop = stream.scrollHeight; } },
        );
        const got = applySections(text, p.keys);
        if (!got.length) throw new Error(`“${p.label}”没有按格式输出，请重试。`);
        const miss = p.keys.filter((k) => !got.includes(k));
        li.className = truncated || miss.length ? 'is-warn' : 'is-done';
        if (truncated) warns.push(`“${p.label}”超出单次输出长度被截断，末尾可能不完整`);
        if (miss.length) warns.push(`缺少${miss.map((k) => `「${XL.BY_KEY[k].label}」`).join('')}`);
        persist(true); fill();
      }
      stream.hidden = true;
      setStatus(genSt, warns.length ? `已生成，但请注意：${warns.join('；')}。可以对相应要素“让 AI 改”补全。` : '已生成。请逐项审读，再看右侧的检查结果。', warns.length ? 'err' : 'ok');
      $('#step-3').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      const run = $('.is-run', progress);
      if (run) run.className = 'is-err';
      if (err.needCode) showCode();
      setStatus(genSt, err.name === 'AbortError' ? '已停止。已经写好的部分保留着。' : netMsg(err), 'err');
      persist(true); fill();
    } finally { setBusy(null); }
  });

  // 让 AI 改：单个要素或整份
  async function revise(target, instruction, statusEl) {
    if (busy) return;
    if (!instruction) { setStatus(statusEl, '请写下想怎么改。', 'err'); return; }
    if (!docMd().trim()) { setStatus(statusEl, '学历案还是空的，请先生成或填写。', 'err'); return; }
    const ac = new AbortController();
    setBusy(ac);
    snapshot(`修改${target === '全部' ? '整份' : `「${target}」`}`);
    setStatus(statusEl, 'AI 正在修改……');
    stream.hidden = false; stream.textContent = '';
    try {
      const { text, truncated } = await ask(
        { scene: 'xl-revise', meta: metaOf(), source: doc.source, request: doc.request, doc: docMd(), target, instruction },
        { signal: ac.signal, onText: (t) => { stream.textContent = t; stream.scrollTop = stream.scrollHeight; } },
      );
      const got = applySections(text);
      if (!got.length) throw new Error('AI 没有按格式输出修改结果，请换个说法再试。');
      persist(true); fill();
      stream.hidden = true;
      setStatus(statusEl, `已修改：${got.map((k) => XL.BY_KEY[k].label).join('、')}${truncated ? '（输出被截断，请检查末尾）' : ''}。不满意可以撤销。`, truncated ? 'err' : 'ok');
      return true;
    } catch (err) {
      if (err.needCode) showCode();
      delete doc.undo; btnUndo.hidden = true;
      setStatus(statusEl, err.name === 'AbortError' ? '已停止，内容没有改动。' : netMsg(err), 'err');
    } finally { setBusy(null); }
  }
  wb.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-revise]');
    if (!b) return;
    const box = b.closest('.xl-sec-edit');
    const input = $('[data-revise-input]', box);
    revise(XL.BY_KEY[box.dataset.key].label, input.value.trim(), genSt).then((ok) => { if (ok) input.value = ''; });
    $('#step-2').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('[data-revise-all]', wb).addEventListener('click', () => {
    const input = $('[data-revise-all-input]', wb);
    revise('全部', input.value.trim(), genSt).then((ok) => { if (ok) input.value = ''; });
    $('#step-2').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $$('[data-revise-input], [data-revise-all-input]', wb).forEach((input) => input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); (input.nextElementSibling || {}).click?.(); }
  }));

  // AI 体检
  $('[data-audit]', wb).addEventListener('click', async () => {
    if (busy) return;
    if (!docMd().trim()) { setStatus(auditSt, '学历案还是空的。', 'err'); return; }
    const ac = new AbortController();
    setBusy(ac);
    setStatus(auditSt, '体检中……');
    auditList.innerHTML = ''; auditSum.hidden = true;
    try {
      const { text } = await ask({ scene: 'xl-audit', meta: metaOf(), doc: docMd(), source: doc.source.slice(0, 6000) }, { signal: ac.signal, onText: (t) => renderAudit(t) });
      renderAudit(text);
      setStatus(auditSt, '体检完成。', 'ok');
    } catch (err) {
      if (err.needCode) showCode();
      setStatus(auditSt, err.name === 'AbortError' ? '已停止。' : netMsg(err), 'err');
    } finally { setBusy(null); }
  });
  function renderAudit(text) {
    const items = [];
    let sum = '';
    for (const raw of text.split('\n')) {
      const l = raw.trim();
      const m = /^[-*•]\s*【([^】]+)】\s*[（(](必改|建议)[)）]\s*(.+)$/.exec(l);
      if (m) items.push({ key: XL.sectionKey(m[1]), label: m[1], must: m[2] === '必改', msg: m[3] });
      else if (/^总评[:：]/.test(l)) sum = l.replace(/^总评[:：]\s*/, '');
    }
    auditList.innerHTML = items.map((x) => `<li class="is-${x.must ? 'error' : 'info'}">${x.key ? `<a href="#sec-${x.key}" data-goto="${x.key}">${esc(x.label)}</a>` : `<b>${esc(x.label)}</b> `}${x.must ? '<b>必改</b> ' : ''}${esc(x.msg)}</li>`).join('');
    auditSum.hidden = !sum;
    auditSum.textContent = sum ? `总评：${sum}` : '';
  }

  // 预览与导出
  const dialog = $('[data-preview-dialog]');
  const previewBody = $('[data-preview-body]');
  const previewTeacher = $('[data-preview-teacher]');
  const showPreview = () => { previewBody.innerHTML = XL.toHtml(doc, { teacher: previewTeacher.checked }); };
  $('[data-preview]', wb).addEventListener('click', () => {
    showPreview();
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  });
  previewTeacher.addEventListener('change', showPreview);
  const exportRoot = $('#step-4');
  const exSt = $('[data-xl-status]', exportRoot);
  $('[data-xl-docx]', exportRoot).addEventListener('click', () => {
    const errors = XL.check(doc, { texError: XL.texError }).filter((x) => x.level === 'error');
    if (errors.length && !confirm(`本地检查还有 ${errors.length} 个错误（如 ${errors[0].msg}）。仍然导出吗？`)) return;
    exportDocx(doc, exportRoot, exSt);
  });
  $('[data-md]', wb).addEventListener('click', () => {
    download(`学历案-${(doc.meta.title || '未命名').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 40)}.md`, XL.toMarkdown(doc), 'text/markdown');
  });
  // 导出选项记在本机
  const OPT_KEY = 'xuelian:opts';
  const savedOpts = store.get(OPT_KEY, {});
  $$('[data-opt]', wb).forEach((el) => { if (savedOpts[el.dataset.opt] !== undefined) el.checked = savedOpts[el.dataset.opt]; el.addEventListener('change', () => { savedOpts[el.dataset.opt] = el.checked; store.set(OPT_KEY, savedOpts); }); });

  // 启动
  load(store.get('xuelian:current') || listDocs()[0]?.id);
  gateAi(wb, $('[data-ai-off]', wb)).then((on) => { if (on && health.code) showCode(); setBusy(null); });
})();
