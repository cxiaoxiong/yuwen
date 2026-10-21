// AI 助教 —— 抽屉式问答（无依赖）。页面文字在浏览器里取，API key 只在后端。
(function () {
  'use strict';
  // 默认同源接口：线上由 Nginx 把 /api/ai/ 反向代理到本机 AI 后端（见 server/deploy/）；本地 npm run serve 也会代理。
  // GitHub Pages 构建设置了 AI_ENDPOINT 时，页面带 <meta name="ai-endpoint">，改走那个跨域地址（CORS 由后端 ALLOWED_ORIGIN 放行）。
  const endpoint = document.querySelector('meta[name="ai-endpoint"]')?.content || '/api/ai';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 忽略 */ } },
  };
  const session = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 忽略 */ } },
  };
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const MAX_CTX = 12000;
  const HIST_KEY = 'ai-history:' + location.pathname;
  const NEXT_KEY = 'ai-next:' + location.pathname;
  let mode = store.get('ai-mode') === 'teacher' ? 'teacher' : 'student';
  let history = session.get(HIST_KEY) || [];
  let next = Array.isArray(session.get(NEXT_KEY)) ? session.get(NEXT_KEY) : [];   // 上一次回答末尾 AI 给出的追问；空时显示固定问题
  let busy = null;       // AbortController
  let selection = '';

  const QUICK = {
    student: ['这一页讲了什么？', '帮我理解选中的这句话', '这个字词怎么解释？', '给我一点做题思路'],
    teacher: ['概括这一页的教学要点', '设计一个课堂提问', '出 3 道检测题', '这一页有哪些易错点？'],
  };

  // 请求带 suggest: true 时，后端让模型在回答末尾另起一行写这个标记，下面几行是追问（见 server/ai-server.mjs 的 NEXT_MARK）
  const NEXT_MARK = '【接着问】';
  function splitNext(text) {
    const i = text.indexOf(NEXT_MARK);
    if (i < 0) {
      // 流式过程中末尾可能只到了标记的前半截（如「【接」），先不显示
      for (let k = NEXT_MARK.length - 1; k > 0; k--) if (text.endsWith(NEXT_MARK.slice(0, k))) return { body: text.slice(0, -k), next: [] };
      return { body: text, next: [] };
    }
    const qs = [];
    for (const raw of text.slice(i + NEXT_MARK.length).split('\n')) {
      const q = raw.trim().replace(/^(?:(?:[-*•]|\d+[.、)])\s*)+/, '').replace(/\*\*/g, '').trim();
      if (q.length >= 2 && q.length <= 40 && !qs.includes(q)) qs.push(q);
    }
    return { body: text.slice(0, i).trimEnd(), next: qs.slice(0, 3) };
  }

  // ───── 取页面文字：当前标签栏优先；学生模式不带折叠答案 ─────
  // 克隆到屏幕外的可渲染容器里再取 innerText，这样段落换行才会保留，各栏目也都按展开状态取
  function pageContext() {
    const main = $('#main');
    const title = document.querySelector('h1')?.textContent.trim() || document.title;
    const base = { title, path: location.pathname };
    if (!main) return { ...base, text: '' };
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:-99999px;top:0;width:800px;pointer-events:none';
    const root = main.cloneNode(true);
    box.appendChild(root);
    document.body.appendChild(box);
    try {
      $$('script,style,svg,nav,.to-top,.tabs,[data-ai-skip]', root).forEach((n) => n.remove());
      if (mode === 'student') $$('details.answer', root).forEach((n) => n.remove());
      $$('details', root).forEach((n) => { n.open = true; });
      const clean = (t) => t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      const panels = $$('.panel[data-panel]', root);
      let text;
      if (panels.length) {
        const activeKey = $('.panel.active', main)?.dataset.panel;
        const active = panels.find((p) => p.dataset.panel === activeKey) || panels[0];
        const label = (p) => $(`#tabbtn-${p.dataset.panel}`, main)?.textContent.replace(/\d+$/, '').trim() || p.dataset.panel;
        panels.forEach((p) => { p.style.display = 'block'; });
        const chunks = [`【当前栏目：${label(active)}】\n${clean(active.innerText)}`];
        panels.forEach((p) => { if (p !== active) chunks.push(`【栏目：${label(p)}】\n${clean(p.innerText)}`); });
        text = chunks.join('\n\n');
      } else {
        text = clean(root.innerText);
      }
      return { ...base, text: text.slice(0, MAX_CTX) };
    } finally {
      box.remove();
    }
  }

  // ───── 界面 ─────
  const root = document.createElement('div');
  root.className = 'ai-root';
  root.setAttribute('data-ai-skip', '');
  root.innerHTML = `
    <button class="ai-fab" type="button" aria-label="打开 AI 助教" aria-expanded="false" aria-controls="ai-drawer">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3c.9 3.3 1.7 4.1 5 5-3.3.9-4.1 1.7-5 5-.9-3.3-1.7-4.1-5-5 3.3-.9 4.1-1.7 5-5Zm6 10c.5 1.8.9 2.2 2.7 2.7-1.8.5-2.2.9-2.7 2.7-.5-1.8-.9-2.2-2.7-2.7 1.8-.5 2.2-.9 2.7-2.7ZM6.5 14c.6 2 1 2.4 3 3-2 .6-2.4 1-3 3-.6-2-1-2.4-3-3 2-.6 2.4-1 3-3Z" fill="currentColor"/></svg>
      <span>问 AI</span>
    </button>
    <aside class="ai-drawer" id="ai-drawer" role="dialog" aria-label="AI 助教" hidden>
      <header class="ai-head">
        <b>AI 助教</b>
        <div class="ai-modes" role="group" aria-label="使用身份">
          <button type="button" data-ai-mode="student" aria-pressed="false">学生</button>
          <button type="button" data-ai-mode="teacher" aria-pressed="false">老师</button>
        </div>
        <button class="ai-clear" type="button" title="清空本页对话">清空</button>
        <button class="ai-close" type="button" aria-label="关闭">×</button>
      </header>
      <div class="ai-log" role="log" aria-live="polite"></div>
      <div class="ai-quick"></div>
      <div class="ai-sel" hidden></div>
      <form class="ai-form">
        <textarea rows="2" maxlength="500" placeholder="问问这一页的内容…" aria-label="输入问题"></textarea>
        <button type="submit" class="ai-send">发送</button>
      </form>
      <p class="ai-note">回答由 AI 生成，可能有误，请以课本和教师用书为准。</p>
    </aside>
    <button class="ai-pick" type="button" hidden>问 AI</button>`;
  document.body.appendChild(root);
  const fab = $('.ai-fab', root), drawer = $('.ai-drawer', root), log = $('.ai-log', root);
  const form = $('.ai-form', root), input = $('textarea', form), quick = $('.ai-quick', root);
  const selBox = $('.ai-sel', root), pick = $('.ai-pick', root), send = $('.ai-send', root);

  // 轻量渲染：转义后只支持粗体、列表、段落
  function render(text) {
    const lines = esc(text).split('\n');
    let html = '', list = null;
    const flush = () => { if (list) { html += `<${list.t}>${list.items.join('')}</${list.t}>`; list = null; } };
    for (const raw of lines) {
      const line = raw.trim();
      const b = line.match(/^[-*•]\s+(.*)/), n = line.match(/^\d+[.、)]\s*(.*)/);
      const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      if (b || n) {
        const t = b ? 'ul' : 'ol';
        if (!list || list.t !== t) { flush(); list = { t, items: [] }; }
        list.items.push(`<li>${inline((b || n)[1])}</li>`);
      } else if (line) { flush(); html += `<p>${inline(line.replace(/^#{1,4}\s*/, ''))}</p>`; }
      else flush();
    }
    flush();
    return html;
  }

  function addMsg(role, text) {
    const el = document.createElement('div');
    el.className = `ai-msg ai-${role}`;
    if (role === 'user') el.textContent = text; else el.innerHTML = render(text);
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function renderAll() {
    log.innerHTML = '';
    if (!history.length) {
      const hello = document.createElement('div');
      hello.className = 'ai-msg ai-assistant ai-hello';
      hello.innerHTML = mode === 'student'
        ? '<p>你好！我可以帮你读懂这一页的课文、注释和练习。做题时我会先给思路和提示，而不是直接给答案。</p>'
        : '<p>您好！我可以结合这一页的资料，帮您梳理教学要点、设计提问、出题或讲解答案。</p>';
      log.appendChild(hello);
    }
    history.forEach((m) => addMsg(m.role, m.content));
  }
  function renderQuick() {
    quick.innerHTML = next.length
      ? next.map((q) => `<button type="button">${esc(q)}</button>`).join('')
      : QUICK[mode].map((q) => `<button type="button" data-static>${esc(q)}</button>`).join('');
  }
  function setNext(list) {
    next = list;
    session.set(NEXT_KEY, next);
    renderQuick();
  }
  function syncMode() {
    $$('[data-ai-mode]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.aiMode === mode)));
    renderQuick();
  }
  function setBusy(b) {
    busy = b;
    send.textContent = b ? '停止' : '发送';
    input.disabled = false;
  }

  async function ask(question) {
    question = question.trim();
    if (!question || busy) return;
    addMsg('user', question);
    const out = addMsg('assistant', '');
    out.classList.add('ai-wait');
    out.textContent = '思考中…';
    const ac = new AbortController();
    setBusy(ac);
    let full = '', stop = '';
    try {
      const res = await fetch(endpoint + '/chat', {
        method: 'POST',
        signal: ac.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, question, selection, suggest: true, page: pageContext(), history: history.slice(-8) }),
      });
      if (!res.ok) {
        let msg = 'AI 暂时不可用，请稍后再试。';
        try { msg = (await res.json()).error || msg; } catch (e) { /* 忽略 */ }
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
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
          if (d.t) { full += d.t; const body = splitNext(full).body; if (body) { out.classList.remove('ai-wait'); out.innerHTML = render(body); log.scrollTop = log.scrollHeight; } }
        }
      }
    } catch (err) {
      stop = err.name === 'AbortError' ? 'abort' : 'error';
      if (stop === 'error') { out.classList.remove('ai-wait'); out.classList.add('ai-err'); out.textContent = err.message === 'Failed to fetch' ? 'AI 暂时连不上，请稍后再试。' : err.message; }
    }
    // 没有完整答完（停止、出错）就不用这次的追问，回到固定问题
    const parsed = splitNext(full);
    setNext(stop ? [] : parsed.next);
    full = parsed.body;
    if (stop === 'error' && !full) { setBusy(null); return; }
    if (stop === 'abort' && full) full += '\n（已停止）';
    if (full) {
      out.classList.remove('ai-wait');
      out.innerHTML = render(full);
      history.push({ role: 'user', content: question }, { role: 'assistant', content: full });
      history = history.slice(-12);
      session.set(HIST_KEY, history);
    } else if (out.classList.contains('ai-wait')) out.remove();
    selection = '';
    showSel();
    setBusy(null);
  }

  function showSel() {
    selBox.hidden = !selection;
    selBox.innerHTML = selection ? `<span>已选：${esc(selection.slice(0, 60))}${selection.length > 60 ? '…' : ''}</span><button type="button" aria-label="取消选段">×</button>` : '';
  }

  function open(v) {
    drawer.hidden = !v;
    fab.setAttribute('aria-expanded', String(v));
    root.classList.toggle('is-open', v);
    if (v) { input.focus({ preventScroll: true }); log.scrollTop = log.scrollHeight; }
  }

  // ───── 事件 ─────
  fab.addEventListener('click', () => open(drawer.hidden));
  $('.ai-close', root).addEventListener('click', () => { open(false); fab.focus(); });
  $('.ai-clear', root).addEventListener('click', () => { if (busy) busy.abort(); history = []; session.set(HIST_KEY, history); setNext([]); renderAll(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !drawer.hidden) { open(false); fab.focus(); } });
  $$('[data-ai-mode]', root).forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.aiMode; store.set('ai-mode', mode); next = []; session.set(NEXT_KEY, next); syncMode(); renderAll();
  }));
  quick.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    const q = btn?.textContent;
    if (!q) return;
    if (btn.hasAttribute('data-static') && q.includes('选中') && !selection) { input.value = ''; input.placeholder = '先在页面上选中一句话，再点「问 AI」'; input.focus(); return; }
    ask(q);
  });
  selBox.addEventListener('click', (ev) => { if (ev.target.closest('button')) { selection = ''; showSel(); } });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (busy) { busy.abort(); return; }
    const q = input.value; input.value = ''; ask(q);
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); form.requestSubmit(); }
  });

  // 选中页面文字 → 浮出「问 AI」
  let pickTimer;
  document.addEventListener('selectionchange', () => {
    clearTimeout(pickTimer);
    pickTimer = setTimeout(() => {
      const sel = getSelection();
      const text = sel && !sel.isCollapsed ? sel.toString().trim() : '';
      if (!text || text.length < 2 || root.contains(sel.anchorNode) || !$('#main')?.contains(sel.anchorNode)) { pick.hidden = true; return; }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      pick.dataset.text = text.slice(0, 1000);
      pick.style.top = `${Math.max(8, r.top + scrollY - 40)}px`;
      pick.style.left = `${Math.min(Math.max(8, r.left + scrollX), document.documentElement.clientWidth - 80)}px`;
      pick.hidden = false;
    }, 200);
  });
  pick.addEventListener('mousedown', (ev) => ev.preventDefault());
  pick.addEventListener('click', () => {
    selection = pick.dataset.text || '';
    pick.hidden = true;
    showSel(); open(true); input.focus();
  });

  // 服务不可用时给出提示（不影响页面其他功能）
  fetch(endpoint + '/health').then((r) => r.json()).then((d) => {
    if (!d.ok) { fab.classList.add('is-off'); fab.title = 'AI 暂不可用'; }
  }).catch(() => { fab.classList.add('is-off'); fab.title = 'AI 暂不可用'; });

  syncMode();
  renderAll();
})();
