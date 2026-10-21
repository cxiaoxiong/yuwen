// 学历案学习路径（无依赖）：练一练的选择／排序／归类／行动卡、学习进度（左栏、总览、页头、每节末尾）、前测推荐、
// 左栏本节目录的当前位置、符号（G1、T2、L3）的点按说明与符号速查。开放题的作答与 AI 点评在 xuelian.js。
// 进度只存在本机浏览器：localStorage 的 xuelian:progress = { v:1, items:{"<节>:<题>":{t,ok,a,g,done}}, mark:{<节>:true|false}, seen:{<节>:t} }；
// 开放题看 xuelian.js 存的 xuelian:practice:<节>:<题>[:<学科组>] 有没有内容。
(function () {
  'use strict';
  const XL = window.XL;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const KEY = 'xuelian:progress';
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  const blank = () => ({ v: 1, items: {}, mark: {}, seen: {} });
  const load = () => {
    const p = store.get(KEY, null);
    if (!p || p.v !== 1 || typeof p.items !== 'object' || !p.items) return blank();
    return { v: 1, items: p.items || {}, mark: p.mark || {}, seen: p.seen || {} };
  };
  let P = load();
  const save = () => store.set(KEY, P);
  const dataEl = $('[data-xl-path]');
  let PATH = null;
  try { PATH = dataEl ? JSON.parse(dataEl.textContent) : null; } catch (e) { PATH = null; }
  const GROUPS = XL ? Object.keys(XL.GROUPS) : [];
  const mySubject = () => store.get('xuelian:subject', '');
  const groupFor = (top) => (top ? (XL && XL.groupOf(mySubject())) || top : '');

  // ───── 进度计算 ─────
  const openDone = (lid, id) => { const base = `xuelian:practice:${lid}:${id}`; return [base, ...GROUPS.map((g) => `${base}:${g}`)].some((k) => String(store.get(k, '') || '').trim()); };
  const itemDone = (lid, it) => {
    if (it.t === 'open') return openDone(lid, it.id);
    const r = P.items[`${lid}:${it.id}`];
    return !!r && (it.t !== 'action' || !!r.done);
  };
  function stateOf(L) {
    const req = L.items.filter((it) => it.r);
    const done = req.filter((it) => itemDone(L.id, it)).length;
    const complete = req.length > 0 && done === req.length;
    const mark = P.mark[L.id];
    const finished = mark === true || (mark !== false && complete);
    const touched = L.items.some((it) => itemDone(L.id, it)) || !!P.seen[L.id];
    return { done, total: req.length, complete, finished, state: finished ? 'done' : touched ? 'doing' : 'todo' };
  }
  const allSteps = () => (PATH ? [PATH.start, ...PATH.lessons] : []);
  const label = { done: '已学完', doing: '学习中', todo: '未开始' };

  function render() {
    if (!PATH) return;
    const st = Object.fromEntries(allSteps().map((L) => [L.id, stateOf(L)]));
    const lessons = PATH.lessons;
    const doneN = lessons.filter((L) => st[L.id].finished).length;
    const total = PATH.start.min + lessons.reduce((n, L) => n + L.min, 0);
    const spent = (st.start.finished ? PATH.start.min : 0) + lessons.reduce((n, L) => n + (st[L.id].finished ? L.min : 0), 0);
    const left = total - spent;
    // 各节状态：左栏、总览卡片、「开始之前」卡片
    $$('[data-xl-l]').forEach((el) => {
      const s = st[el.dataset.xlL];
      if (!s) return;
      el.dataset.xlState = s.state;
      const icon = $('.xl-st', el);
      if (icon) icon.title = label[s.state];
      const card = $('[data-xl-card-st]', el);
      if (card) card.textContent = s.state === 'todo' ? '' : s.state === 'done' ? '✓ 已学完' : `学习中 ${s.done}/${s.total}`;
    });
    $$('[data-xl-ph]').forEach((el) => {
      const ls = lessons.filter((L) => L.ph === el.dataset.xlPh);
      el.textContent = `${ls.filter((L) => st[L.id].finished).length}/${ls.length}`;
    });
    // 左栏总进度
    const bar = (el, n, max) => { if (!el) return; el.setAttribute('aria-valuenow', n); el.setAttribute('aria-valuetext', `${n}/${max}`); const i = $('i', el); if (i) i.style.width = `${max ? (n / max) * 100 : 0}%`; };
    $$('[data-xl-prog]').forEach((box) => {
      box.hidden = false;
      bar($('[role="progressbar"]', box), doneN, lessons.length);
      $('[data-xl-prog-t]', box).textContent = `已学完 ${doneN}/${lessons.length} 节 · 剩约 ${left} 分钟`;
    });
    $$('[data-xl-nav-sum]').forEach((el) => { el.textContent = `学习路径 · 已学完 ${doneN}/${lessons.length}`; });
    // 进度面板
    const next = !st.start.finished && !lessons.some((L) => st[L.id].state !== 'todo') ? PATH.start : lessons.find((L) => !st[L.id].finished);
    $$('[data-xl-dash]').forEach((box) => {
      box.hidden = false;
      $('[data-xl-dash-done]', box).textContent = doneN;
      $('[data-xl-dash-spent]', box).textContent = spent;
      $('[data-xl-dash-left]', box).textContent = left;
      $$('[data-xl-seg]', box).forEach((seg) => {
        const ls = lessons.filter((L) => L.ph === seg.dataset.xlSeg);
        const n = ls.filter((L) => st[L.id].finished).length;
        bar($('[role="progressbar"]', seg), n, ls.length);
        $('[data-xl-seg-t]', seg).textContent = `${n}/${ls.length}`;
      });
      const go = $('[data-xl-continue]', box);
      const note = $('[data-xl-dash-note]', box);
      if (!next) { go.href = PATH.learn; go.textContent = '全部学完了：回到学习路径'; note.textContent = '可以去工作台为下一节课做一份学历案，或者再用第 11—13 节磨一节课。'; }
      else if (next === PATH.start) { go.href = PATH.start.url; go.textContent = '从「开始之前」学起'; note.textContent = '约 15 分钟：符号、核心概念、关系图和前测。'; }
      else { go.href = next.url; go.textContent = `${st[next.id].state === 'doing' ? '继续学习' : '下一节'}：第 ${next.n} 节 ${next.title}`; note.textContent = `约 ${next.min} 分钟${next.field ? '，另需课堂实践' : ''}`; }
    });
    // 本页（某一节或开始之前）
    const fin = $('[data-xl-finish]');
    if (fin) {
      const L = allSteps().find((x) => x.id === fin.dataset.xlFinish);
      const s = L && st[L.id];
      if (s) {
        fin.hidden = false;
        const head = $('[data-xl-lesson-st]');
        if (head) { head.hidden = false; head.textContent = s.finished ? '✓ 已学完' : `已做 ${s.done}/${s.total}`; head.dataset.state = s.state; }
        const t = $('[data-xl-finish-t]', fin);
        const nextL = L === PATH.start ? lessons[0] : lessons[lessons.indexOf(L) + 1];
        const nextHtml = nextL ? ` 下一节：<a href="${nextL.url}">第 ${nextL.n} 节 ${XL ? XL.esc(nextL.title) : nextL.title}</a>（约 ${nextL.min} 分钟）。` : ' 整条路径学完了。';
        if (s.finished) t.innerHTML = `<b>✓ 这一${L === PATH.start ? '步' : '节'}已学完。</b>${nextHtml}`;
        else if (s.complete) t.innerHTML = '计入完成的练习都做完了，但你把这一节标成了「未学完」。';
        else t.textContent = `计入完成的练习：已做 ${s.done}/${s.total}。都做完后，这一${L === PATH.start ? '步' : '节'}会自动记为学完；也可以手动标记。`;
        fin.dataset.state = s.state;
        $('[data-xl-mark]', fin).textContent = s.finished ? '改回「未学完」' : '标记为已学完';
      }
    }
    renderRec();
  }

  // ───── 练一练：选择、排序、归类、行动卡 ─────
  const recKey = (art) => `${art.dataset.lesson}:${art.dataset.id}`;
  const activeBody = (art) => $$(':scope > [data-xl-body]', art).find((b) => !b.hidden) || $(':scope > [data-xl-body]', art);
  const show = (el, on) => { if (el) el.hidden = !on; };

  function readAnswer(art, body) {
    const t = art.dataset.type;
    if (t === 'choice') return $$('input', body).filter((i) => i.checked).map((i) => +i.value);
    if (t === 'sort') return $$('[data-xl-sort] > li', body).map((li) => +li.dataset.k);
    if (t === 'match') return $$('.xl-match select', body).map((s) => s.value);
    return { steps: $$('.xl-act input', body).filter((i) => i.checked).map((i) => +i.value), note: ($('[data-xl-note]', body) || {}).value || '' };
  }
  /** 判分并标出对错；返回 { ok, msg } */
  function grade(art, body, a) {
    const t = art.dataset.type;
    if (t === 'choice') {
      const opts = $$('.xl-opt', body);
      const right = opts.map((o, i) => (o.dataset.ok === '1' ? i : -1)).filter((i) => i >= 0);
      const ok = right.length === a.length && right.every((i) => a.includes(i));
      opts.forEach((o, i) => {
        o.classList.toggle('is-picked', a.includes(i));
        o.classList.toggle('is-right', o.dataset.ok === '1');
        o.classList.toggle('is-wrong', a.includes(i) && o.dataset.ok !== '1');
        show($('.xl-why', o), true);
        $('input', o).disabled = true;
      });
      const keys = right.map((i) => 'ABCDEFGH'[i]).join('、');
      return { ok, msg: ok ? '✓ 答对了。每一项的解析都在选项下面。' : `✗ 正确答案是 ${keys}。看看每一项对在哪、错在哪。` };
    }
    if (t === 'sort') {
      const lis = $$('[data-xl-sort] > li', body);
      let wrong = 0;
      lis.forEach((li, i) => { const r = +li.dataset.k === i; if (!r) wrong++; li.classList.toggle('is-right', r); li.classList.toggle('is-wrong', !r); $$('button', li).forEach((b) => { b.disabled = true; }); });
      const key = $('.xl-key', body);
      if (key) { key.hidden = false; key.open = wrong > 0; }
      return { ok: !wrong, msg: wrong ? `✗ 有 ${wrong} 项位置不对，正确顺序列在下面。` : '✓ 顺序完全正确。' };
    }
    if (t === 'match') {
      const lis = $$('.xl-match > li', body);
      let wrong = 0;
      lis.forEach((li) => {
        const sel = $('select', li);
        const r = sel.value === li.dataset.cat;
        if (!r) wrong++;
        li.classList.toggle('is-right', r);
        li.classList.toggle('is-wrong', !r);
        sel.disabled = true;
        let ans = $('.xl-match-ans', li);
        if (!r) { if (!ans) { ans = document.createElement('span'); ans.className = 'xl-match-ans'; li.insertBefore(ans, $('.xl-why', li)); } ans.textContent = `应归入「${sel.options[+li.dataset.cat + 1].textContent}」`; }
        else if (ans) ans.remove();
        show($('.xl-why', li), true);
      });
      return { ok: !wrong, msg: wrong ? `✗ ${lis.length} 条里有 ${wrong} 条归错了，已标出正确的类别和理由。` : `✓ ${lis.length} 条全部归对。` };
    }
    return { ok: true, msg: '' };
  }
  function clearMarks(art, body) {
    $$('.is-picked, .is-right, .is-wrong', body).forEach((el) => el.classList.remove('is-picked', 'is-right', 'is-wrong'));
    $$('.xl-why', body).forEach((el) => { el.hidden = true; });
    $$('.xl-match-ans', body).forEach((el) => el.remove());
    $$('input, select, button', body).forEach((el) => { el.disabled = false; });
    if (art.dataset.type === 'sort') { const key = $('.xl-key', body); if (key) { key.hidden = true; key.open = false; } }
  }
  /** 把存下的作答放回题身 */
  function putAnswer(art, body, a) {
    const t = art.dataset.type;
    if (t === 'choice') $$('input', body).forEach((i) => { i.checked = a.includes(+i.value); });
    else if (t === 'sort') { const ol = $('[data-xl-sort]', body); const lis = $$(':scope > li', ol); a.forEach((k) => { const li = lis.find((x) => +x.dataset.k === k); if (li) ol.appendChild(li); }); }
    else if (t === 'match') $$('.xl-match select', body).forEach((s, i) => { s.value = a[i] || ''; });
    else { $$('.xl-act input', body).forEach((i) => { i.checked = (a.steps || []).includes(+i.value); }); const n = $('[data-xl-note]', body); if (n) n.value = a.note || ''; }
  }

  function initItem(art) {
    const t = art.dataset.type;
    if (!['choice', 'sort', 'match', 'action'].includes(t)) return;
    art.classList.add('is-live');
    const top = art.dataset.group || '';
    const res = $('[data-xl-result]', art);
    const btn = $('[data-xl-check]', art);
    const retry = $('[data-xl-retry]', art);
    const explain = $('[data-xl-explain]', art);
    const optional = art.hasAttribute('data-optional');
    let group = '';
    const setRes = (msg, kind = '') => { if (!res) return; res.textContent = msg; res.className = `xl-status${kind ? ' is-' + kind : ''}`; };
    // 有内联解析的题，不再显示整块「答案与解析」（没有 JS 时才用它）
    $$('.xl-key', art).forEach((k) => { if (t !== 'sort') k.remove(); else k.hidden = true; });

    function showGroup() {
      group = groupFor(top);
      if (top) $$(':scope > [data-xl-body]', art).forEach((b) => { b.hidden = b.dataset.xlV !== group; });
      const body = activeBody(art);
      const r = P.items[recKey(art)];
      clearMarks(art, body);
      if (t === 'action') {
        if (r && (r.g || '') === group) putAnswer(art, body, r.a || {});
        actionState(body);
        return;
      }
      if (r && (r.g || '') === group) {
        putAnswer(art, body, r.a);
        const g = grade(art, body, r.a);
        setRes(g.msg, g.ok ? 'ok' : 'err');
        show(btn, false); show(retry, true);
        show(explain, true);
      } else {
        if (t === 'choice') $$('input', body).forEach((i) => { i.checked = false; });
        setRes(r ? '你在另一个学科组的版本里答过这道题；这一版可以再做一次。' : '');
        show(btn, true); show(retry, false);
        show(explain, !!r);
      }
    }
    function actionState(body) {
      const boxes = $$('.xl-act input', body);
      const k = boxes.filter((i) => i.checked).length;
      const all = k === boxes.length;
      setRes(all ? `✓ ${boxes.length} 项都做完了。${optional ? '' : '这张行动卡计入本节完成。'}` : `已完成 ${k}/${boxes.length} 项${optional ? '（选做：可以学完后带回课堂再做，不计入本节完成）' : '（全部勾选后计入本节完成）'}。`, all ? 'ok' : '');
    }
    if (btn) btn.addEventListener('click', () => {
      const body = activeBody(art);
      const a = readAnswer(art, body);
      if (t === 'choice' && !a.length) { setRes('请先选一项。', 'err'); return; }
      if (t === 'match' && a.some((v) => v === '')) { setRes(`还有 ${a.filter((v) => v === '').length} 条没有归类。`, 'err'); return; }
      const g = grade(art, body, a);
      P.items[recKey(art)] = { t: Date.now(), ok: g.ok, a, g: group };
      save();
      setRes(g.msg, g.ok ? 'ok' : 'err');
      show(btn, false); show(retry, true);
      if (explain && explain.hidden) { explain.hidden = false; }
      render();
    });
    if (retry) retry.addEventListener('click', () => {
      const body = activeBody(art);
      clearMarks(art, body);
      if (t === 'choice') $$('input', body).forEach((i) => { i.checked = false; });
      setRes('再做一次：答过的记录会被这次的结果替换。');
      show(btn, true); show(retry, false);
      const first = $('input, select, button', body);
      if (first) first.focus();
    });
    if (t === 'sort') art.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-up], [data-down]');
      if (!b || b.disabled) return;
      const li = b.closest('li');
      const up = b.hasAttribute('data-up');
      const sib = up ? li.previousElementSibling : li.nextElementSibling;
      if (!sib) return;
      li.parentNode.insertBefore(li, up ? sib : sib.nextElementSibling);
      b.focus();
    });
    if (t === 'action') {
      const update = () => {
        const body = activeBody(art);
        const a = readAnswer(art, body);
        const all = a.steps.length === $$('.xl-act input', body).length;
        P.items[recKey(art)] = { t: Date.now(), a, g: group, done: all };
        if (!a.steps.length && !a.note) delete P.items[recKey(art)];
        save();
        actionState(body);
        render();
      };
      art.addEventListener('change', (ev) => { if (ev.target.matches('.xl-act input')) update(); });
      art.addEventListener('input', (ev) => { if (ev.target.matches('[data-xl-note]')) update(); });
    }
    showGroup();
    return showGroup;
  }
  const regroup = $$('[data-xl-item]').map(initItem).filter(Boolean);
  $$('[data-xl-my-subject]').forEach((sel) => sel.addEventListener('change', () => setTimeout(() => regroup.forEach((f) => f()), 0)));
  // 开放题、追问写了字就重算进度（xuelian.js 先存，这里后算）
  document.addEventListener('input', (ev) => { if (ev.target.matches('[data-xl-answer]')) render(); });

  // ───── 前测：做完给出起点建议 ─────
  function renderRec() {
    const box = $('[data-xl-rec]');
    if (!box || !PATH) return;
    const items = PATH.start.items;
    const recs = items.map((it) => P.items[`start:${it.id}`]);
    const n = recs.filter(Boolean).length;
    box.hidden = false;
    if (n < items.length) { box.innerHTML = `<p>已答 ${n}/${items.length} 题。全部做完后，这里会给出建议。</p>`; return; }
    const arts = $$('[data-xl-item][data-lesson="start"]');
    const wrong = items.map((it, i) => (recs[i].ok ? null : arts.find((a) => a.dataset.id === it.id))).filter(Boolean);
    const right = items.length - wrong.length;
    const links = wrong.map((a) => $('.xl-q-goal a', a)).filter(Boolean).map((a) => `<li><a href="${a.getAttribute('href')}">${XL ? XL.esc(a.textContent) : a.textContent}</a></li>`);
    box.innerHTML = wrong.length
      ? `<p><b>前测答对 ${right}/${items.length} 题。</b>建议重点学下面这几节；其余各节可以快速浏览，直接做练一练检验自己。</p><ul>${links.join('')}</ul><p>不管从哪里开始，第 9 节（逆向设计）和第 11—13 节（带进课堂）都建议完整学。</p>`
      : `<p><b>前测全部答对。</b>阶段一可以快速浏览、直接做练一练；建议从阶段二「会设计」开始细学，第 9 节和第 11—13 节完整学。</p>`;
  }

  // ───── 本节标记、来访记录 ─────
  const fin = $('[data-xl-finish]');
  if (fin && PATH) {
    const id = fin.dataset.xlFinish;
    P.seen[id] = P.seen[id] || Date.now();
    save();
    $('[data-xl-mark]', fin).addEventListener('click', () => {
      const L = allSteps().find((x) => x.id === id);
      const s = stateOf(L);
      if (s.finished) P.mark[id] = false;
      else P.mark[id] = true;
      if (P.mark[id] === s.complete) delete P.mark[id];   // 与自动判定一致时不必另记
      save();
      render();
    });
  }
  // 别的标签页里做了题，这里跟着更新
  window.addEventListener('storage', (ev) => { if (ev.key === KEY || (ev.key || '').startsWith('xuelian:practice:')) { P = load(); render(); } });
  render();

  // ───── 左栏：本节目录的当前位置 ─────
  const toc = $$('[data-xl-toc] a');
  if (toc.length && 'IntersectionObserver' in window) {
    const targets = toc.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1)))).filter(Boolean);
    const vis = new Set();
    const pick = () => {
      const cur = targets.filter((t) => vis.has(t)).pop() || targets.filter((t) => t.getBoundingClientRect().top < 120).pop();
      toc.forEach((a) => { const on = cur && a.hash === `#${cur.id}`; a.classList.toggle('is-on', !!on); if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
    };
    const io = new IntersectionObserver((es) => { es.forEach((en) => { if (en.isIntersecting) vis.add(en.target); else vis.delete(en.target); }); pick(); }, { rootMargin: '-80px 0px -60% 0px' });
    targets.forEach((t) => io.observe(t));
  }

  // ───── 符号：点按看说明；符号速查 ─────
  const tip = document.createElement('div');
  tip.className = 'xl-tip';
  tip.setAttribute('role', 'tooltip');
  tip.id = 'xl-tip';
  tip.hidden = true;
  document.body.appendChild(tip);
  let tipFor = null;
  const hideTip = () => { tip.hidden = true; if (tipFor) tipFor.removeAttribute('aria-describedby'); tipFor = null; };
  const showTip = (el) => {
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 24);
    tip.style.maxWidth = `${w}px`;
    const x = Math.max(12, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - tip.offsetWidth - 12));
    tip.style.left = `${x}px`;
    tip.style.top = `${r.bottom + window.scrollY + 6}px`;
    el.setAttribute('aria-describedby', 'xl-tip');
    tipFor = el;
  };
  $$('abbr.xl-sym').forEach((el) => { el.dataset.tip = el.title; el.removeAttribute('title'); });
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('abbr.xl-sym');
    if (el) { if (tipFor === el) hideTip(); else showTip(el); return; }
    if (tipFor) hideTip();
  });
  document.addEventListener('mouseover', (ev) => { const el = ev.target.closest && ev.target.closest('abbr.xl-sym'); if (el && el !== tipFor) showTip(el); });
  document.addEventListener('mouseout', (ev) => { const el = ev.target.closest && ev.target.closest('abbr.xl-sym'); if (el && el === tipFor && !el.contains(ev.relatedTarget)) hideTip(); });
  document.addEventListener('focusin', (ev) => { if (ev.target.matches && ev.target.matches('abbr.xl-sym')) showTip(ev.target); });
  document.addEventListener('focusout', (ev) => { if (ev.target === tipFor) hideTip(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && tipFor) { const el = tipFor; hideTip(); el.focus(); } });
  window.addEventListener('scroll', () => { if (tipFor) hideTip(); }, { passive: true });

  const dlg = $('[data-xl-sym-dlg]');
  $$('[data-xl-sym-open]').forEach((b) => {
    if (!dlg || typeof dlg.showModal !== 'function') return;
    b.hidden = false;
    b.addEventListener('click', () => dlg.showModal());
  });
  if (dlg) dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
})();
