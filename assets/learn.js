// 学习中心：首页（今日复习、学习范围、错题、设置、备份）与练习页。题分三类：默写（第一期）、文言实词语境、文化常识（第 1.5 期）。
// 进度只存在本机：localStorage 的 learn:v1；做到一半的一组题存在 sessionStorage 的 learn:session（刷新后接着做）。
// 判分、调度、校验在 learn-core.js（window.LearnCore）。
(() => {
  'use strict';
  const C = window.LearnCore;
  if (!C) return;
  const KEY = 'learn:v1';
  const CORRUPT = 'learn:v1:corrupt'; // 读到损坏的数据时，原文另存在这里，不覆盖
  const BEFORE = 'learn:v1:before-import'; // 恢复备份前的进度
  const SESSION = 'learn:session';
  const TEMP = 'learn:temp';
  const SIZE = 10; // 一组最多几句

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const today = () => C.dayStr(new Date());
  const probe = (name) => {
    try {
      const s = window[name];
      s.setItem('learn:t', '1');
      s.removeItem('learn:t');
      return s;
    } catch (e) {
      return null;
    }
  };
  const ls = probe('localStorage');
  const ss = probe('sessionStorage');

  // ───────── 本机进度 ─────────
  // 每次记分都先读最新的再写回（update），另一个标签页同时练习也只会各改各的句子，不会整份覆盖。
  // 临时模式（或浏览器不让用 localStorage）：进度放在 sessionStorage，关闭标签页就没了；两样都不能用时只在内存里。
  const temp = !ls || (!!ss && ss.getItem(TEMP) === '1');
  const box = temp ? ss : ls;
  const Store = {
    blocked: !ls,
    temp,
    mem: null,
    corrupt: false,
    failed: false,
    read() {
      if (!box) return this.mem || (this.mem = C.emptyState());
      let raw = null;
      try {
        raw = box.getItem(KEY);
      } catch (e) {
        return C.emptyState();
      }
      if (!raw) return C.emptyState();
      try {
        const r = C.validateState(JSON.parse(raw));
        if (r.ok) return r.state;
      } catch (e) {
        /* 落到下面 */
      }
      try {
        if (!box.getItem(CORRUPT)) box.setItem(CORRUPT, raw);
      } catch (e) {
        /* 另存失败也不清空原数据：下面的 write 才会覆盖 */
      }
      this.corrupt = true;
      return C.emptyState();
    },
    write(state) {
      if (!box) {
        this.mem = state;
        return true;
      }
      const text = JSON.stringify(state);
      try {
        box.setItem(KEY, text);
        this.failed = box.getItem(KEY) !== text;
      } catch (e) {
        this.failed = true;
      }
      return !this.failed;
    },
    update(fn) {
      const s = this.read();
      fn(s);
      return { state: s, ok: this.write(s) };
    },
    raw(key) {
      try {
        return box ? box.getItem(key) : null;
      } catch (e) {
        return null;
      }
    },
  };

  const Sess = {
    get() {
      try {
        return ss ? JSON.parse(ss.getItem(SESSION)) : null;
      } catch (e) {
        return null;
      }
    },
    set(v) {
      try {
        if (ss) ss.setItem(SESSION, JSON.stringify(v));
      } catch (e) {
        /* 存不下就只是刷新后不能接着做 */
      }
    },
    clear() {
      try {
        if (ss) ss.removeItem(SESSION);
      } catch (e) {
        /* 忽略 */
      }
    },
  };

  // ───────── 题库 ─────────
  // 三类题：mx 默写（第一期）、sc 文言实词语境、cs 文化常识。一组题只练一类；复习调度、进度、备份共用。
  // grades：作答评价在这一类里的叫法（错题列表、本组小结用），right 统一叫「答对」
  const TRACK = {
    mx: { name: '默写', unit: '句', fresh: '新句', min: 0.8, grades: { typo: '有错别字', mix: '记混或漏句', forgot: '没想起来' } },
    sc: { name: '文言实词', unit: '题', fresh: '新题', min: 0.4, grades: { typo: '大体对', mix: '想错了', forgot: '没想起来' } },
    cs: { name: '文化常识', unit: '题', fresh: '新题', min: 0.5, grades: { mix: '答错' } },
  };
  const TRACK_IDS = Object.keys(TRACK);
  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  }
  async function loadData(root) {
    const idx = await getJSON(root.dataset.index);
    const shards = idx.shards.filter((s) => TRACK[s.id]);
    const banks = await Promise.all(shards.map((s) => getJSON(s.url)));
    const tracks = {};
    shards.forEach((s, i) => {
      const b = banks[i];
      tracks[s.id] = { id: s.id, items: b.items, ctx: b.ctx || [], byId: new Map(b.items.map((it) => [it.id, it])) };
    });
    if (!tracks.mx) throw new Error('缺少默写题库');
    return {
      books: idx.books,
      lessonList: idx.lessons,
      lessons: new Map(idx.lessons.map((l) => [l.id, l])),
      wordList: idx.words || [],
      words: new Map((idx.words || []).map((w) => [w.id, w])),
      topicList: idx.topics || [],
      topics: new Map((idx.topics || []).map((x) => [x.id, x])),
      tracks,
      items: tracks.mx.items,
      byId: tracks.mx.byId,
      idsOf: (lessonId) => tracks.mx.items.filter((it) => it.l === lessonId).map((it) => it.id),
    };
  }
  const bookName = (data, k) => (data.books.find((b) => b.k === k) || {}).name || '';
  const whenText = (t, d) => {
    const n = C.daysBetween(t, d);
    return n <= 0 ? '今天' : n === 1 ? '明天' : `${n} 天后`;
  };
  const stampDay = (iso) => (iso ? C.dayStr(new Date(iso)) : null);
  /** 这一类题有没有题库、学生有没有在设置里关掉 */
  const trackOn = (data, st, id) => !!data.tracks[id] && (!st.prefs.tracks || st.prefs.tracks.includes(id));
  /** 一类题的今日复习：默写只从选的课文里出题，另两类从全部题里出 */
  const todayOf = (data, st, id, t) => C.todayQueue(data.tracks[id].items, st, id === 'mx' ? new Set(st.scope || []) : null, t, SIZE, C.NEW_KEY[id]);
  const trackHref = (practice, id, query) => `${practice}?${id === 'mx' ? '' : `track=${id}&`}${query}`;
  /** 实词卡、常识题怎么称呼（错题列表、练习页顶部） */
  const wordOf = (data, it) => data.words.get(it.l) || { w: '', url: '' };
  const topicOf = (data, it) => data.topics.get(it.l) || null;
  const csTag = (it) => ({ 真题: '高考真题', 仿真: '仿真题' })[it.k] || '';

  // ───────── 提示条 ─────────
  function banners(st, t) {
    const out = [];
    if (Store.blocked) out.push('<p class="callout warn">这个浏览器不允许网站保存数据（可能是无痕模式，或关闭了网站数据）。进度只在这个标签页里，关闭后不保留。</p>');
    else if (Store.temp) out.push('<p class="callout">临时模式：进度只在这个标签页里，关闭后不留记录。<button type="button" class="lx-link" data-act="temp-off">退出临时模式</button></p>');
    if (Store.failed) out.push('<p class="callout warn">最近一次没有保存成功，进度可能没记下来。可以先在下面「进度备份」里下载备份。</p>');
    if (Store.corrupt || Store.raw(CORRUPT)) out.push('<p class="callout warn">之前保存的进度数据已损坏，无法读取，原始数据已另存一份。<button type="button" class="lx-link" data-act="corrupt-dl">下载原始数据</button></p>');
    return out.join('');
  }


  // ───────── 首页 ─────────
  function home(root, data) {
    const app = root.querySelector('[data-learn-app]');
    const practice = root.dataset.practice;
    let editing = false;
    let importBox = ''; // 备份区下方的临时内容：导出文本、粘贴框、恢复预览、结果
    let pendingImport = null; // 已校验、等确认的导入进度

    const scopeView = (st) => {
      const chosen = new Set(st.scope || []);
      const books = data.books
        .map((b) => {
          const inBook = data.lessonList.filter((l) => l.k === b.k);
          const all = inBook.every((l) => chosen.has(l.id));
          return `<fieldset class="lx-scope-book"><legend><label><input type="checkbox" data-book="${esc(b.k)}"${all && inBook.length ? ' checked' : ''}> ${esc(b.name)}<small>全选</small></label></legend>
<div class="lx-scope-grid">${inBook.map((l) => `<label><input type="checkbox" name="lesson" value="${esc(l.id)}" data-in="${esc(b.k)}"${chosen.has(l.id) ? ' checked' : ''}><span>《${esc(l.t)}》</span><small>${l.n} 句</small></label>`).join('')}</div></fieldset>`;
        })
        .join('');
      return `<section class="lx-card lx-scope" aria-labelledby="lx-scope-title">
  <h2 id="lx-scope-title">${st.scope ? '调整学习范围' : '先选你正在学的课文'}</h2>
  <p class="lx-sub">今日复习的默写只从选中的课文里出题，以后随时可以调整。</p>
  ${books}
  <p class="lx-error" data-scope-error hidden>至少选一篇。</p>
  <div class="lx-actions"><button type="button" class="lx-btn" data-act="scope-save">保存</button>${st.scope ? '<button type="button" class="lx-btn lx-btn-ghost" data-act="scope-cancel">取消</button>' : ''}</div>
</section>`;
    };

    /** 进度条 + 一行统计（默写的课文、常识的专题、实词的总体共用） */
    const statHtml = (s, unit) => {
      const pc = (n) => (s.total ? Math.round((n / s.total) * 100) : 0);
      return `<div class="lx-bar" aria-hidden="true"><span class="lx-bar-stable" style="width:${pc(s.stable)}%"></span><span class="lx-bar-covered" style="width:${pc(s.covered - s.stable)}%"></span></div>
    <small class="lx-l-stat">${s.covered ? `已练 ${s.covered}/${s.total} ${unit}${s.due ? ` · <b>到期 ${s.due} ${unit}</b>` : ''} · 稳定 ${s.stable} ${unit}` : `${s.total} ${unit} · 还没练`}</small>`;
    };
    const groupRow = (title, href, sub, s, unit, start, label) => `<li class="lx-lesson">
  <div class="lx-l-main">
    <a class="lx-l-title" href="${esc(href)}">${title}</a>${sub ? `<small>${esc(sub)}</small>` : ''}
    ${statHtml(s, unit)}
  </div>
  <a class="lx-btn lx-btn-ghost lx-btn-sm" href="${esc(start)}">${label}</a>
</li>`;

    /** 错题列表里的一行：哪一题、上次怎么错的、什么时候复习 */
    const wrongRow = (id, it, r, t) => {
      const why = TRACK[id].grades[r.e] || '';
      let what = '';
      if (id === 'mx') {
        const l = data.lessons.get(it.l);
        what = `《${esc(l ? l.t : '')}》第 ${it.c[0].n} 题`;
      } else if (id === 'sc') what = `「${esc(wordOf(data, it).w)}」 · ${esc(it.s)}`;
      else {
        const tp = topicOf(data, it);
        what = `${tp ? `${esc(tp.t)} · ` : ''}${esc([...it.q].slice(0, 16).join(''))}……`;
      }
      return `<li>${what}${why ? ` · 上次：${why}` : ''} · ${whenText(t, r.d)}复习</li>`;
    };

    const dashboard = (st, t) => {
      const scope = new Set(st.scope);
      const on = TRACK_IDS.filter((id) => trackOn(data, st, id));
      const queues = Object.fromEntries(on.map((id) => [id, todayOf(data, st, id, t)]));
      const week = C.weekOf(t);
      const studied = week.filter((d) => st.days[d] && st.days[d].n > 0).length;
      const WD = '一二三四五六日';
      const lessons = data.lessonList.filter((l) => scope.has(l.id));
      const backup = st.backupAt ? stampDay(st.backupAt) : '从未';
      const lessonRow = (l) => groupRow(`《${esc(l.t)}》`, `${l.url}#tab-exercises`, `${bookName(data, l.k)} · ${l.u}`, C.summarize(data.idsOf(l.id), st.items, t), '句', `${practice}?lesson=${encodeURIComponent(l.id)}`, '练这一篇');
      const todayRows = on.map((id) => {
        const q = queues[id];
        const T = TRACK[id];
        const count = [q.due && `到期 <b>${q.due}</b> ${T.unit}`, q.fresh && `${T.fresh} <b>${q.fresh}</b> ${T.unit}`].filter(Boolean).join(' · ');
        return `<li class="lx-track">
  <div class="lx-track-main"><span class="lx-track-name">${T.name}</span><small>${q.ids.length ? count : '今天的任务完成了'}${q.due > SIZE ? `（一次练 ${SIZE} ${T.unit}，做完可以再来一组）` : ''}</small></div>
  ${q.ids.length ? `<a class="lx-btn" href="${esc(trackHref(practice, id, 'mode=today'))}">开始（${q.ids.length} ${T.unit}，约 ${Math.max(2, Math.round(q.ids.length * T.min))} 分钟）</a>` : ''}
</li>`;
      });
      const anyLeft = on.some((id) => queues[id].ids.length);

      const mine = on.includes('mx')
        ? `<section class="lx-card" aria-labelledby="lx-mine-title">
  <div class="lx-sec-head"><h2 id="lx-mine-title">我在学 · 默写</h2><button type="button" class="lx-btn lx-btn-ghost lx-btn-sm" data-act="scope">调整范围</button></div>
  <p class="lx-legend"><i class="lx-dot lx-dot-stable"></i>稳定：隔几天还能写对 <i class="lx-dot lx-dot-covered"></i>在记</p>
  <ul class="lx-lessons">${lessons.map(lessonRow).join('')}</ul>
</section>`
        : '';

      let words = '';
      if (on.includes('sc')) {
        const tr = data.tracks.sc;
        const s = C.summarize(tr.items.map((it) => it.id), st.items, t);
        const chip = (w) => {
          const ws = C.summarize(tr.items.filter((it) => it.l === w.id).map((it) => it.id), st.items, t);
          const cls = ws.due ? ' is-due' : ws.covered && ws.stable === ws.total ? ' is-stable' : ws.covered ? ' is-covered' : '';
          return `<a class="lx-chip${cls}" href="${esc(trackHref(practice, 'sc', `word=${encodeURIComponent(w.id)}`))}">${esc(w.w)}<small>${ws.covered}/${ws.total}</small></a>`;
        };
        words = `<section class="lx-card" aria-labelledby="lx-words-title">
  <h2 id="lx-words-title">文言实词</h2>
  <p class="lx-sub">高考常考的 ${data.wordList.length} 个实词，放在短文和高考原句里辨析意思：先想，再看答案，自己判断对不对。</p>
  ${statHtml(s, '题')}
  <details class="lx-more" data-more="sc"><summary>按词练（${data.wordList.length} 个词）</summary>
    <p class="lx-legend"><span><i class="lx-dot lx-dot-due"></i>有到期</span><span><i class="lx-dot lx-dot-covered"></i>练过</span><span><i class="lx-dot lx-dot-stable"></i>都稳定</span><span>数字是已练/总题数</span></p>
    <div class="lx-chips">${data.wordList.map(chip).join('')}</div>
  </details>
</section>`;
      }

      let topics = '';
      if (on.includes('cs')) {
        const tr = data.tracks.cs;
        const s = C.summarize(tr.items.map((it) => it.id), st.items, t);
        const row = (x) => groupRow(esc(x.t), x.url, '', C.summarize(tr.items.filter((it) => it.g.includes(x.id)).map((it) => it.id), st.items, t), '题', trackHref(practice, 'cs', `topic=${encodeURIComponent(x.id)}`), '练这个专题');
        topics = `<section class="lx-card" aria-labelledby="lx-topics-title">
  <h2 id="lx-topics-title">文化常识</h2>
  <p class="lx-sub">古代文化常识的判断题、选择题 ${tr.items.length} 道，选完马上判分，看解析。</p>
  ${statHtml(s, '题')}
  <details class="lx-more" data-more="cs"><summary>按专题练（${data.topicList.length} 个专题）</summary>
    <ul class="lx-lessons">${data.topicList.map(row).join('')}</ul>
  </details>
</section>`;
      }

      const wrongGroups = on
        .map((id) => {
          const tr = data.tracks[id];
          const ids = C.wrongIds(tr.items, st);
          if (!ids.length) return '';
          const T = TRACK[id];
          return `<div class="lx-wrong-group">
  <div class="lx-sec-head"><h3>${T.name} · ${ids.length} ${T.unit}</h3><a class="lx-btn lx-btn-ghost lx-btn-sm" href="${esc(trackHref(practice, id, 'mode=wrong'))}">练错题（${Math.min(ids.length, SIZE)} ${T.unit}）</a></div>
  <ul class="lx-wrong">${ids.slice(0, 3).map((x) => wrongRow(id, tr.byId.get(x), st.items[x], t)).join('')}</ul>${ids.length > 3 ? `<p class="lx-sub">……还有 ${ids.length - 3} ${T.unit}</p>` : ''}
</div>`;
        })
        .filter(Boolean);

      const trackField = TRACK_IDS.filter((id) => data.tracks[id]).length > 1
        ? `<div class="lx-field"><span class="lx-field-label">学习内容</span>
    ${TRACK_IDS.filter((id) => data.tracks[id]).map((id) => `<label><input type="checkbox" name="track" value="${id}"${on.includes(id) ? ' checked' : ''}> ${TRACK[id].name}</label>`).join('')}
  </div>`
        : '';

      return `<section class="lx-card lx-today" aria-labelledby="lx-today-title">
  <div class="lx-today-main">
    <h2 id="lx-today-title">今日复习</h2>
    ${on.length ? `<ul class="lx-tracks">${todayRows.join('')}</ul>${anyLeft ? '' : '<p class="lx-sub">想多练，可以在下面选一篇课文、一个词或一个专题，或者把每天新题调多一些。</p>'}` : '<p class="lx-sub">在下面「设置」里选择要学的内容。</p>'}
  </div>
  <div class="lx-week" role="img" aria-label="本周学了 ${studied} 天">
    <p>本周学了 <b>${studied}</b> 天</p>
    <ol>${week.map((d, i) => `<li class="${st.days[d] && st.days[d].n ? 'on' : ''}${d === t ? ' is-today' : ''}"><span>${WD[i]}</span></li>`).join('')}</ol>
  </div>
</section>
${mine}${words}${topics}
<section class="lx-card" aria-labelledby="lx-wrong-title">
  <h2 id="lx-wrong-title">错题</h2>
  ${wrongGroups.length ? `<p class="lx-sub">最近错过、还没记牢的：</p>${wrongGroups.join('')}` : '<p class="lx-sub">还没有错题。</p>'}
</section>
<section class="lx-card" id="lx-settings" aria-labelledby="lx-set-title">
  <h2 id="lx-set-title">设置</h2>
  ${trackField}
  <div class="lx-field"><span class="lx-field-label">默写作答</span>
    <label><input type="radio" name="mode" value="paper"${st.prefs.mode === 'paper' ? ' checked' : ''}> 纸笔<small>在纸上写，再对答案自评。最接近考试</small></label>
    <label><input type="radio" name="mode" value="input"${st.prefs.mode === 'input' ? ' checked' : ''}> 输入<small>打字作答，自动标出错字。输入法会联想，打对不等于会写</small></label>
  </div>
  <div class="lx-field"><span class="lx-field-label">每天新题</span>
    ${C.GOALS.map((g) => `<label><input type="radio" name="goal" value="${g}"${st.prefs.goal === g ? ' checked' : ''}> ${g} 题</label>`).join('')}
    <small class="lx-field-note">默写、实词、常识分别计</small>
  </div>
</section>
<section class="lx-card" id="lx-backup" aria-labelledby="lx-backup-title">
  <h2 id="lx-backup-title">进度备份</h2>
  <p class="lx-sub">进度只保存在这个浏览器里。换手机、换浏览器、清理浏览器数据之前，先下载备份；在微信里打开和在浏览器里打开，进度也是分开的。上次备份：${esc(backup)}。</p>
  <div class="lx-actions">
    <button type="button" class="lx-btn lx-btn-ghost" data-act="export-file">下载备份文件</button>
    <button type="button" class="lx-btn lx-btn-ghost" data-act="export-text">复制进度文本</button>
    <label class="lx-btn lx-btn-ghost lx-file">从文件恢复<input type="file" accept=".json,application/json" data-import-file></label>
    <button type="button" class="lx-btn lx-btn-ghost" data-act="import-text">粘贴文本恢复</button>
  </div>
  <div class="lx-import" data-import-area>${importBox}</div>
  ${Store.raw(BEFORE) ? '<p class="lx-sub">上次恢复备份前的进度还留着：<button type="button" class="lx-link" data-act="undo-import">换回恢复前的进度</button></p>' : ''}
  <p class="lx-sub">${Store.temp ? '' : '在公共电脑上用？<button type="button" class="lx-link" data-act="temp-on">开启临时模式</button>：关闭标签页后不留下记录。'}</p>
</section>`;
    };

    const reminder = (st, t) => {
      if (Store.temp || !Object.keys(st.items).length) return '';
      const last = stampDay(st.backupAt);
      if (last && C.daysBetween(last, t) < 7) return '';
      if (st.remindAt && C.daysBetween(st.remindAt, t) < 7) return '';
      Store.update((s) => (s.remindAt = t));
      return `<p class="callout">${last ? `已经 ${C.daysBetween(last, t)} 天没有备份进度了。` : '还没有备份过进度。'}清理浏览器数据或换设备会丢失记录。<a href="#lx-backup">现在备份</a></p>`;
    };

    function render() {
      const st = Store.read();
      const t = today();
      const head = `<p class="lx-keep">进度只保存在这个浏览器里 · 上次备份：${esc(st.backupAt ? stampDay(st.backupAt) : '从未')} · <a href="#lx-backup">备份</a></p>`;
      const open = new Set([...app.querySelectorAll('details[data-more][open]')].map((x) => x.dataset.more)); // 重画时保留展开的「按词练」「按专题练」
      app.innerHTML = banners(st, t) + ((trackOn(data, st, 'mx') && !st.scope) || editing ? scopeView(st) : head + reminder(st, t) + dashboard(st, t));
      app.querySelectorAll('details[data-more]').forEach((x) => (x.open = open.has(x.dataset.more)));
    }

    const download = (name, text) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    };
    const markBackup = () => Store.update((s) => (s.backupAt = new Date().toISOString()));

    const preview = (text) => {
      const r = C.parseImport(text);
      if (!r.ok) {
        importBox = `<p class="lx-error">没有恢复：${esc(r.error)}</p>`;
        return render();
      }
      pendingImport = r.state;
      const sm = r.summary;
      importBox = `<div class="lx-confirm"><p>这份进度有 <b>${sm.items}</b> 句记录、学过 ${sm.days} 天，最后学习：${esc(sm.lastDay || '无')}${r.exportedAt ? `，备份于 ${esc(stampDay(r.exportedAt))}` : ''}。</p>
<p class="lx-sub">恢复后会整体替换这个浏览器里现在的进度；现在的进度会另存一份，可以再换回来。</p>
<div class="lx-actions"><button type="button" class="lx-btn" data-act="import-ok">确认恢复</button><button type="button" class="lx-btn lx-btn-ghost" data-act="import-cancel">取消</button></div></div>`;
      render();
    };
    app.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'scope') {
        editing = true;
        render();
        app.querySelector('.lx-scope')?.scrollIntoView({ block: 'start' });
      } else if (act === 'scope-cancel') {
        editing = false;
        render();
      } else if (act === 'scope-save') {
        const ids = [...app.querySelectorAll('input[name="lesson"]:checked')].map((x) => x.value);
        if (!ids.length) {
          app.querySelector('[data-scope-error]').hidden = false;
          return;
        }
        Store.update((s) => (s.scope = ids));
        editing = false;
        render();
        window.scrollTo(0, 0);
      } else if (act === 'export-file') {
        const st = Store.read();
        download(`语文学习进度-${today()}.json`, C.exportText(st, new Date()));
        markBackup();
        render();
      } else if (act === 'export-text') {
        const text = C.exportText(Store.read(), new Date());
        importBox = `<p class="lx-sub">把下面整段文字保存好（发给自己、存到备忘录）。恢复时用「粘贴文本恢复」。</p><textarea class="lx-textarea" readonly rows="4" data-export-text>${esc(text)}</textarea><div class="lx-actions"><button type="button" class="lx-btn lx-btn-ghost lx-btn-sm" data-act="copy">复制</button><span class="lx-sub" data-copied hidden>已复制</span></div>`;
        markBackup();
        render();
      } else if (act === 'copy') {
        const ta = app.querySelector('[data-export-text]');
        const done = () => (app.querySelector('[data-copied]').hidden = false);
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(ta.value).then(done, () => { ta.select(); });
        else {
          ta.select();
          try {
            if (document.execCommand('copy')) done();
          } catch (e) {
            /* 选中后让学生自己复制 */
          }
        }
      } else if (act === 'import-text') {
        importBox = `<label class="lx-sub" for="lx-paste">把备份的进度文本粘贴到这里：</label><textarea class="lx-textarea" id="lx-paste" rows="4" data-paste></textarea><div class="lx-actions"><button type="button" class="lx-btn lx-btn-ghost lx-btn-sm" data-act="paste-check">检查</button></div>`;
        render();
        app.querySelector('[data-paste]')?.focus();
      } else if (act === 'paste-check') {
        preview(app.querySelector('[data-paste]').value);
      } else if (act === 'import-ok' && pendingImport) {
        const cur = Store.raw(KEY);
        try {
          if (cur && box) box.setItem(BEFORE, cur);
        } catch (e) {
          importBox = '<p class="lx-error">没有恢复：浏览器存储空间不够，无法先另存当前进度。</p>';
          return render();
        }
        Store.corrupt = false;
        const ok = Store.write(pendingImport);
        pendingImport = null;
        importBox = ok ? '<p class="lx-ok">已恢复。</p>' : '<p class="lx-error">恢复时没有保存成功。</p>';
        Sess.clear();
        render();
      } else if (act === 'import-cancel') {
        pendingImport = null;
        importBox = '';
        render();
      } else if (act === 'undo-import') {
        const before = Store.raw(BEFORE);
        const r = before ? C.parseImport(JSON.stringify({ app: 'yuwen-learn', v: 1, data: JSON.parse(before) })) : { ok: false };
        if (r.ok && Store.write(r.state)) {
          try {
            box.removeItem(BEFORE);
          } catch (e) {
            /* 忽略 */
          }
          importBox = '<p class="lx-ok">已换回恢复前的进度。</p>';
        } else importBox = '<p class="lx-error">恢复前的进度读不出来。</p>';
        render();
      } else if (act === 'temp-on' || act === 'temp-off') {
        try {
          ss.removeItem(KEY); // 临时进度不带进、也不带出临时模式
          if (act === 'temp-on') ss.setItem(TEMP, '1');
          else ss.removeItem(TEMP);
        } catch (e) {
          /* 忽略 */
        }
        Sess.clear();
        location.reload();
      } else if (act === 'corrupt-dl') {
        download(`损坏的学习进度-${today()}.txt`, Store.raw(CORRUPT) || '');
      }
    });
    app.addEventListener('change', (ev) => {
      const x = ev.target;
      if (x.matches('[data-book]')) app.querySelectorAll(`input[data-in="${x.dataset.book}"]`).forEach((c) => (c.checked = x.checked));
      else if (x.matches('input[name="track"]')) {
        const ids = [...app.querySelectorAll('input[name="track"]:checked')].map((c) => c.value);
        Store.update((s) => (s.prefs.tracks = ids));
        render();
      } else if (x.matches('input[name="mode"]')) {
        Store.update((s) => (s.prefs.mode = x.value));
      } else if (x.matches('input[name="goal"]')) {
        Store.update((s) => (s.prefs.goal = Number(x.value)));
        render();
      } else if (x.matches('[data-import-file]') && x.files[0]) {
        const f = x.files[0];
        if (f.size > 2 * 1024 * 1024) {
          importBox = '<p class="lx-error">没有恢复：文件太大，不像是本站的进度文件。</p>';
          return render();
        }
        f.text().then(preview, () => {
          importBox = '<p class="lx-error">没有恢复：文件读不出来。</p>';
          render();
        });
      }
    });
    // 另一个标签页练了题：首页数字跟着刷新（正在调整范围、粘贴或确认恢复时不刷，免得冲掉输入）
    window.addEventListener('storage', (ev) => {
      if (ev.key === KEY && !editing && !importBox) render();
    });
    render();
  }

  // ───────── 练习页 ─────────
  function practice(root, data) {
    const app = root.querySelector('[data-learn-app]');
    const homeUrl = root.dataset.home;
    const practiceUrl = root.dataset.practice;
    const params = new URLSearchParams(location.search);
    const track = params.get('track') || 'mx';
    const tr = data.tracks[track];
    const T = TRACK[track];
    // 练一组：mx ?lesson=课文，sc ?word=词条，cs ?topic=专题
    const groupParam = { mx: 'lesson', sc: 'word', cs: 'topic' }[track];
    const groupId = groupParam ? params.get(groupParam) : null;
    const mode = groupId ? 'group' : params.get('mode') === 'wrong' ? 'wrong' : 'today';
    const t = today();
    const key = `${track}:${mode}:${groupId || ''}`;
    const msg = (html) => (app.innerHTML = `${banners(Store.read(), t)}<section class="lx-card lx-done">${html}</section>`);
    const backHome = `<p><a class="lx-btn" href="${esc(homeUrl)}">回学习中心</a></p>`;
    if (!tr) return msg(`<h1>没有找到这类练习</h1>${backHome}`);
    const group = !groupId ? null : track === 'mx' ? data.lessons.get(groupId) : track === 'sc' ? data.words.get(groupId) : data.topics.get(groupId);
    const groupName = !group ? '' : track === 'mx' ? `《${group.t}》默写` : track === 'sc' ? `「${group.w}」语境练习` : `${group.t} · 文化常识`;
    const title = mode === 'group' ? groupName : `${T.name} · ${mode === 'wrong' ? '练错题' : '今日复习'}`;
    document.title = `${title} · ${document.title.split(' · ').pop()}`;
    if (mode === 'group' && !group) return msg(`<h1>没有找到这一组练习</h1>${backHome}`);
    const inGroup = track === 'mx' ? (it) => it.l === groupId : track === 'sc' ? (it) => it.l === groupId : (it) => it.g.includes(groupId);

    let sess = Sess.get();
    if (!sess || sess.key !== key || sess.day !== t || !Array.isArray(sess.ids) || sess.i >= sess.ids.length) {
      const st = Store.read();
      if (track === 'mx' && mode === 'today' && !st.scope) return msg(`<h1>先选好学习范围</h1><p>今日复习的默写从你选的课文里出题。</p><p><a class="lx-btn" href="${esc(homeUrl)}">去选课文</a></p>`);
      const ids = mode === 'group' ? C.groupQueue(tr.items, st, inGroup, t) : mode === 'wrong' ? C.wrongIds(tr.items, st).slice(0, SIZE) : todayOf(data, st, track, t).ids;
      if (!ids.length) {
        return msg(mode === 'wrong' ? `<h1>没有错题</h1>${backHome}` : `<h1>今天的${T.name}复习做完了</h1><p>记牢的${T.unit === '句' ? '句子' : '题'}会隔几天再出现。想多练，可以回学习中心选一组来练。</p>${backHome}`);
      }
      sess = { key, day: t, ids, i: 0, res: { right: 0, typo: 0, mix: 0, forgot: 0 } };
      Sess.set(sess);
    }

    // 当前这一题。默写：ask 作答 → judge 对答案/判分 → cause 选错因 → rewrite 重写一遍 → right 答对了
    // 实词：ask 想意思 → judge 看答案自评 → done；常识：ask 选答案 → picked 答对了（问是不是猜的）→ done
    let card = null;
    const newCard = () => {
      while (sess.i < sess.ids.length && !tr.byId.get(sess.ids[sess.i])) sess.i++; // 题库更新后不存在的题跳过
      if (sess.i >= sess.ids.length) return (card = null);
      const item = tr.byId.get(sess.ids[sess.i]);
      const st = Store.read();
      const rec = st.items[item.id];
      card = { item, rec, isNew: !rec, phase: 'ask', hinted: false, result: null, grade: null };
      if (track === 'mx') {
        const cue = C.pickCue(item, rec, st.prefs.mode === 'input');
        Object.assign(card, { cue, inputs: cue.b.map(() => ''), rewriteOk: false });
      }
    };
    const dueText = () => (card.after ? whenText(t, card.after.d) : '');
    const nextBtn = (label) => `<div class="lx-actions"><button type="button" class="lx-btn" data-act="next">${label || (sess.i + 1 < sess.ids.length ? `下一${T.unit}` : '看看这一组')}</button></div>`;

    // ── 默写 ──
    const useInput = () => Store.read().prefs.mode === 'input' && !card.cue.o;
    const slot = (k, n) => {
      const label = n > 1 ? `（${k + 1}）` : '';
      if (card.phase === 'ask' && card.hinted) return `<span class="lx-slot">${label}${esc([...C.norm(card.cue.b[k])][0] || '')}……</span>`;
      return `<span class="lx-slot">${label || '　　　'}</span>`;
    };
    const diffHtml = (d) =>
      d.ops
        .map((o) => (o.t === 'eq' ? esc(o.a) : o.t === 'sub' ? `<del>${esc(o.b)}</del><ins>${esc(o.a)}</ins>` : o.t === 'miss' ? `<ins class="lx-miss">${esc(o.a)}</ins>` : `<del>${esc(o.b)}</del>`))
        .join('');
    const diffNote = (d) => (d.ok ? '全对' : [d.sub && `错 ${d.sub} 字`, d.miss && `漏 ${d.miss} 字`, d.extra && `多 ${d.extra} 字`].filter(Boolean).join('、') || '没有写');
    const inputsHtml = (prefix, values, disabled) => {
      const n = card.cue.b.length;
      return `<div class="lx-inputs">${card.cue.b.map((_, k) => `<label>${n > 1 ? `<span class="lx-k">（${k + 1}）</span>` : '<span class="lx-sr">答案</span>'}<input type="text" lang="zh-CN" autocomplete="off" autocapitalize="off" spellcheck="false" data-${prefix}="${k}" value="${esc(values[k] || '')}"${disabled ? ' disabled' : ''}></label>`).join('')}</div>`;
    };
    const mx = {
      meta() {
        const l = data.lessons.get(card.item.l);
        return `《${esc(l ? l.t : '')}》 · ${card.cue.s === '真题' ? '高考真题' : '情境默写'}`;
      },
      stem() {
        const parts = card.cue.q.split('____');
        const n = parts.length - 1;
        return `<p class="lx-stem">${parts.map((p, k) => esc(p).replace(/\n/g, '<br>') + (k < n ? slot(k, n) : '')).join('')}</p>${card.cue.o ? '<p class="lx-note">这道题写其他符合题意的名句也可以，参考答案只是其中一种。</p>' : ''}`;
      },
      body() {
        const c = card;
        const inp = useInput();
        const lessonInfo = data.lessons.get(c.item.l);
        const back = lessonInfo ? `<a class="lx-link" href="${esc(lessonInfo.url)}#tab-text">回课文看原文</a>` : '';
        if (c.phase === 'ask') {
          return `${inp ? inputsHtml('in', c.inputs, false) : '<p class="lx-tip">先在纸上写出空缺的句子，写完再翻开答案。</p>'}
<div class="lx-actions"><button type="button" class="lx-btn" data-act="${inp ? 'submit' : 'reveal'}">${inp ? '提交' : '翻开答案'}</button><button type="button" class="lx-btn lx-btn-ghost" data-act="hint"${c.hinted ? ' disabled' : ''}>${c.hinted ? '已提示首字' : '首字提示'}</button></div>`;
        }
        const n = c.cue.b.length;
        let html = `<div class="lx-answer"><p class="lx-label">${c.cue.o ? '参考答案' : '答案'}</p><p class="lx-ans">${c.cue.b.map((b, k) => `${n > 1 ? `<span class="lx-k">（${k + 1}）</span>` : ''}${esc(b)}`).join('<br>')}</p></div>`;
        if (c.result) {
          html += `<div class="lx-diff"><p class="lx-label">你写的</p>${c.result.per.map((d, k) => `<p>${n > 1 ? `<span class="lx-k">（${k + 1}）</span>` : ''}<span class="lx-diff-text">${diffHtml(d) || '<span class="muted">（没有写）</span>'}</span><small class="${d.ok ? 'lx-ok' : 'lx-bad'}">${diffNote(d)}</small></p>`).join('')}</div>`;
        }
        if (c.phase === 'judge') {
          return `${html}<p class="lx-q-ask">你写的和答案一样吗？</p>
<div class="lx-grade">
  <button type="button" class="lx-btn" data-grade="right">全对</button>
  <button type="button" class="lx-btn lx-btn-ghost" data-grade="typo">有错别字</button>
  <button type="button" class="lx-btn lx-btn-ghost" data-grade="mix">记混或漏了句子</button>
  <button type="button" class="lx-btn lx-btn-ghost" data-grade="forgot">没想起来</button>
</div>
<p class="lx-sub">${c.hinted ? '看过首字提示，答对也先不算记牢，明天再考一次。 ' : ''}${back}</p>`;
        }
        if (c.phase === 'cause') {
          return `${html}<p class="lx-q-ask">和答案有出入。主要是哪种情况？</p>
<div class="lx-grade">
  <button type="button" class="lx-btn lx-btn-ghost" data-grade="typo">错别字</button>
  <button type="button" class="lx-btn lx-btn-ghost" data-grade="mix">记混或漏了句子</button>
  <button type="button" class="lx-btn lx-btn-ghost" data-grade="forgot">没想起来</button>
</div>
<p class="lx-sub"><button type="button" class="lx-link" data-grade="right" data-flag="1">我认为没错</button>（按答对记，并记下来供以后核对） ${back}</p>`;
        }
        if (c.phase === 'rewrite') {
          const fb = { typo: '记下了：错别字。', mix: '记下了：记混或漏了句子。', forgot: '记下了：没想起来。' }[c.grade];
          return `${html}<p class="lx-feedback">${fb}这句${dueText()}再复习。</p>
${inp
  ? `<p class="lx-tip">对照答案，再完整写一遍：</p>${inputsHtml('re', c.rewrite || [], c.rewriteOk)}<p class="lx-sub" data-re-msg>${c.rewriteOk ? '<span class="lx-ok">写对了。</span>' : ''}</p>
<div class="lx-actions">${c.rewriteOk ? '<button type="button" class="lx-btn" data-act="next">下一句</button>' : '<button type="button" class="lx-btn" data-act="re-check">核对</button><button type="button" class="lx-link" data-act="next">跳过</button>'}</div>`
  : `<p class="lx-tip">对照答案，在纸上再完整写一遍。</p><div class="lx-actions"><button type="button" class="lx-btn" data-act="next">写好了，下一句</button></div>`}
<p class="lx-sub">${back}</p>`;
        }
        // right
        return `${html}<p class="lx-feedback lx-ok">${c.hinted ? '写对了（看过提示）。' : '答对了。'}这句${dueText()}再复习。</p>
${nextBtn()}<p class="lx-sub">${back}</p>`;
      },
      after(grade) {
        card.phase = grade === 'right' ? 'right' : 'rewrite';
        if (card.phase === 'rewrite') card.rewrite = card.cue.b.map(() => '');
      },
    };

    // ── 文言实词：短文里的一个空，或一句高考原句 ──
    const sc = {
      meta() {
        return `文言实词「${esc(wordOf(data, card.item).w)}」 · ${esc(card.item.s)}`;
      },
      stem() {
        const it = card.item;
        const w = wordOf(data, it).w;
        const ctx = tr.ctx[it.x];
        const shown = card.phase !== 'ask';
        const mark = `<span class="lx-slot lx-slot-word">${shown ? esc(it.a.split('（')[0]) : '？'}</span>`;
        if (it.k < 0) {
          // 高考原句：词只出现一次时标出来，出现几次就不标（不知道问的是哪一个）
          const s = ctx.q[0];
          const parts = s.split(w);
          return `<p class="lx-stem">${parts.length === 2 ? `${esc(parts[0])}<b class="lx-target">${esc(w)}</b>${esc(parts[1])}` : esc(s)}</p>`;
        }
        const segs = ctx.q;
        const html = segs
          .map((p, j) => {
            if (j !== it.k) return esc(p);
            const chars = [...p.replace(/[\s　]+$/, '')];
            const word = chars.splice(chars.length - (it.t || 1)).join(''); // 一般是一个字；问双音词（如「左右」）时两个字一起标
            return `${esc(chars.join(''))}<b class="lx-target">${esc(word)}</b>${mark}`;
          })
          .join('');
        return `<p class="lx-stem">${html}</p>`;
      },
      body() {
        const c = card;
        const w = wordOf(data, c.item);
        const ctx = tr.ctx[c.item.x];
        const back = w.url ? `<a class="lx-link" href="${esc(w.url)}">看「${esc(w.w)}」的词条和例句</a>` : '';
        if (c.phase === 'ask') {
          const target = c.item.t ? [...ctx.q[c.item.k].replace(/[\s　]+$/, '')].slice(-c.item.t).join('') : w.w;
          return `<p class="lx-tip">加粗的「${esc(target)}」在这里是什么意思？先想好（可以写在纸上），再看答案。</p>
<div class="lx-actions"><button type="button" class="lx-btn" data-act="reveal">看答案</button></div>`;
        }
        const html = `<div class="lx-answer"><p class="lx-label">答案</p><p class="lx-ans">${esc(c.item.a)}</p></div>${ctx.t ? `<details class="lx-trans"><summary>看整段译文</summary><p>${esc(ctx.t)}</p></details>` : ''}`;
        if (c.phase === 'judge') {
          return `${html}<p class="lx-q-ask">你想的意思对吗？</p>
<div class="lx-grade">
  <button type="button" class="lx-btn" data-grade="right">答对了</button>
  <button type="button" class="lx-btn lx-btn-ghost" data-grade="typo">大体对，不够准确</button>
  <button type="button" class="lx-btn lx-btn-ghost" data-grade="mix">想错了</button>
  <button type="button" class="lx-btn lx-btn-ghost" data-grade="forgot">没想起来</button>
</div>
<p class="lx-sub">${back}</p>`;
        }
        const fb = c.grade === 'right' ? '<p class="lx-feedback lx-ok">答对了。' : `<p class="lx-feedback">记下了：${T.grades[c.grade]}。`;
        return `${html}${fb}这题${dueText()}再复习。</p>${c.grade === 'right' ? '' : '<p class="lx-tip">把答案放回句子里，再读一遍。</p>'}
${nextBtn()}<p class="lx-sub">${back}</p>`;
      },
      after() {
        card.phase = 'done';
      },
    };

    // ── 文化常识：判断题（√ / ×）、选择题（A—D），选完马上判分 ──
    const cs = {
      meta() {
        const tp = topicOf(data, card.item);
        const tag = csTag(card.item);
        return `文化常识${tp ? ` · ${esc(tp.t)}` : ''}${tag ? ` · ${tag}` : ''}`;
      },
      stem() {
        return `<p class="lx-stem lx-stem-cs">${esc(card.item.q)}</p>${card.item.y === 'j' ? '<p class="lx-tip">这个说法对吗？</p>' : ''}`;
      },
      body() {
        const c = card;
        const it = c.item;
        const picked = c.phase !== 'ask';
        const opts = it.y === 'j' ? [['√', '对'], ['×', '错']] : it.o;
        const cls = (k) => (!picked ? '' : k === it.a ? ' is-right' : k === c.pick ? ' is-wrong' : '');
        const optHtml = `<div class="lx-options${it.y === 'j' ? ' lx-options-judge' : ''}">${opts
          .map(([k, text]) => `<button type="button" class="lx-opt${cls(k)}" data-pick="${esc(k)}"${picked ? ' disabled' : ''}><b>${esc(k)}</b><span>${esc(text)}</span></button>`)
          .join('')}</div>`;
        if (!picked) return optHtml;
        const tp = topicOf(data, it);
        const back = tp ? `<a class="lx-link" href="${esc(tp.url)}">看专题「${esc(tp.t)}」</a>` : '';
        const ok = c.pick === it.a;
        const ansText = it.y === 'j' ? (it.a === '√' ? '对（√）' : '错（×）') : it.a;
        const why = `${it.e ? `<div class="lx-answer"><p class="lx-label">解析</p><p>${esc(it.e)}</p></div>` : ''}<p class="lx-src">出处：${esc(it.src)}</p>`;
        if (c.phase === 'picked') {
          return `${optHtml}<p class="lx-feedback lx-ok">答对了。</p>${why}
<p class="lx-q-ask">是确实知道，还是猜的？</p>
<div class="lx-actions"><button type="button" class="lx-btn" data-grade="right">确实知道，下一题</button><button type="button" class="lx-btn lx-btn-ghost" data-grade="right" data-guess="1">猜对的</button></div>
<p class="lx-sub">猜对的先不算记住，明天再考一次。 ${back}</p>`;
        }
        return `${optHtml}${ok ? `<p class="lx-feedback lx-ok">${c.hinted ? '记下了：猜对的。' : '答对了。'}` : `<p class="lx-feedback lx-bad">答错了，正确答案是 ${esc(ansText)}。`}这题${dueText()}再复习。</p>${why}
${nextBtn()}<p class="lx-sub">${back}</p>`;
      },
      after(grade) {
        card.phase = 'done';
        if (grade === 'right' && !card.hinted) return 'next'; // 「确实知道」直接下一题
      },
    };
    const view = { mx, sc, cs }[track];

    function render() {
      if (!card) return summary();
      const n = sess.ids.length;
      const st = Store.read();
      app.innerHTML = `${banners(st, t)}<div class="lx-player">
  <div class="lx-top">
    <a class="lx-link" href="${esc(homeUrl)}">结束</a>
    <div class="lx-progress" role="progressbar" aria-label="本组进度" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${sess.i}"><span style="width:${Math.round((sess.i / n) * 100)}%"></span></div>
    <span class="lx-count">${sess.i + 1} / ${n}</span>
  </div>
  <h1 class="lx-title">${esc(title)}</h1>
  <article class="lx-card lx-q">
    <p class="lx-meta">${view.meta()}${card.isNew ? ` · <span class="lx-new">${T.fresh}</span>` : ''}</p>
    ${view.stem()}
    ${view.body()}
  </article>
  ${track === 'mx' && card.phase === 'ask' && !card.cue.o ? `<div class="lx-modebar" role="group" aria-label="作答方式"><span>作答方式</span><button type="button" data-mode="paper" aria-pressed="${st.prefs.mode === 'paper'}">纸笔</button><button type="button" data-mode="input" aria-pressed="${st.prefs.mode === 'input'}">输入</button></div>` : ''}
</div>`;
      const focus = app.querySelector('input[data-in]:not([disabled]), input[data-re]:not([disabled])') || app.querySelector('.lx-q .lx-btn, .lx-q .lx-opt:not([disabled])');
      if (focus) focus.focus({ preventScroll: card.phase === 'ask' });
    }

    function summary() {
      const r = sess.res;
      const total = r.right + r.typo + r.mix + r.forgot;
      const more = mode === 'today' ? todayOf(data, Store.read(), track, t).ids.length : 0;
      const back =
        mode !== 'group' ? ''
        : track === 'mx' ? `<a class="lx-btn lx-btn-ghost" href="${esc(group.url)}#tab-text">回课文看原文</a>`
        : track === 'sc' ? `<a class="lx-btn lx-btn-ghost" href="${esc(group.url)}">看「${esc(group.w)}」的词条</a>`
        : `<a class="lx-btn lx-btn-ghost" href="${esc(group.url)}">看专题「${esc(group.t)}」</a>`;
      const parts = ['typo', 'mix', 'forgot'].filter((g) => r[g]).map((g) => ` · ${T.grades[g] || TRACK.mx.grades[g]} ${r[g]}`).join('');
      app.innerHTML = `${banners(Store.read(), t)}<section class="lx-card lx-done">
  <h1>这一组练完了</h1>
  <p class="lx-today-count">共 <b>${total}</b> ${T.unit}：答对 <b>${r.right}</b>${parts}</p>
  ${total - r.right ? `<p class="lx-sub">没答对的${T.unit === '句' ? '句子' : '题'}明天会再出现。</p>` : `<p class="lx-sub">答对的${T.unit === '句' ? '句子' : '题'}会隔几天再考一次，隔得越来越久。</p>`}
  <div class="lx-actions">
    ${more ? `<a class="lx-btn" href="${esc(trackHref(practiceUrl, track, 'mode=today'))}">再来一组（${more} ${T.unit}）</a>` : ''}
    ${back}
    <a class="lx-btn ${more ? 'lx-btn-ghost' : ''}" href="${esc(homeUrl)}">回学习中心</a>
  </div>
</section>`;
      app.querySelector('.lx-btn')?.focus({ preventScroll: true });
    }

    // 记一次作答（每题只记一次；默写重写一遍不改记录）。opts：{ flag 我认为没错, guess 常识猜对的 }
    function commit(grade, opts = {}) {
      const c = card;
      if (opts.guess) c.hinted = true;
      const { state } = Store.update((s) => {
        const old = s.items[c.item.id];
        s.items[c.item.id] = C.apply(old, grade, { today: t, hinted: c.hinted, rev: c.item.r });
        C.logDay(s, t, !old, C.NEW_KEY[track]);
        if (opts.flag) {
          s.flags.push({ id: c.item.id, at: t, input: c.inputs.join('／').slice(0, 400) });
          if (s.flags.length > 500) s.flags.splice(0, s.flags.length - 500);
        }
      });
      c.after = state.items[c.item.id];
      c.grade = grade;
      sess.res[grade]++;
      Sess.set(sess);
      if (view.after(grade) === 'next') return next();
      render();
    }
    function next() {
      sess.i++;
      Sess.set(sess);
      newCard();
      render();
      window.scrollTo(0, 0);
    }
    const readInputs = (prefix) => [...app.querySelectorAll(`input[data-${prefix}]`)].map((x) => x.value);

    app.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act], [data-grade], [data-mode], [data-pick]');
      if (!b || !card) return;
      if (b.dataset.mode) {
        Store.update((s) => (s.prefs.mode = b.dataset.mode));
        card.inputs = card.cue.b.map(() => '');
        return render();
      }
      if (b.dataset.grade) return commit(b.dataset.grade, { flag: !!b.dataset.flag, guess: !!b.dataset.guess });
      if (b.dataset.pick) {
        if (card.phase !== 'ask') return;
        card.pick = b.dataset.pick;
        if (card.pick === card.item.a) {
          card.phase = 'picked'; // 答对了先问是不是猜的，选完再记
          return render();
        }
        return commit('mix');
      }
      const act = b.dataset.act;
      if (act === 'hint') {
        card.inputs = useInput() ? readInputs('in') : card.inputs;
        card.hinted = true;
        render();
      } else if (act === 'reveal') {
        card.phase = 'judge';
        render();
      } else if (act === 'submit') {
        card.inputs = readInputs('in');
        const g = C.gradeInput(card.cue.b, card.inputs);
        card.result = g;
        if (g.ok) commit('right');
        else {
          card.phase = 'cause';
          render();
        }
      } else if (act === 're-check') {
        card.rewrite = readInputs('re');
        card.rewriteOk = C.gradeInput(card.cue.b, card.rewrite).ok;
        if (!card.rewriteOk) {
          const m = app.querySelector('[data-re-msg]');
          if (m) m.innerHTML = '<span class="lx-bad">还有出入，对照答案再看看。</span>';
          return;
        }
        render();
      } else if (act === 'next') next();
    });
    // 回车提交（输入法组字时不算）
    app.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || ev.isComposing || ev.keyCode === 229) return;
      const x = ev.target;
      if (!(x instanceof HTMLInputElement)) return;
      ev.preventDefault();
      const all = [...app.querySelectorAll(`input[data-${x.dataset.in !== undefined ? 'in' : 're'}]`)];
      const k = all.indexOf(x);
      if (k < all.length - 1) return all[k + 1].focus();
      app.querySelector(x.dataset.in !== undefined ? '[data-act="submit"]' : '[data-act="re-check"]')?.click();
    });

    newCard();
    render();
  }

  // ───────── 启动 ─────────
  const root = document.querySelector('[data-learn-home], [data-learn-practice]');
  if (!root) return;
  loadData(root).then(
    (data) => (root.matches('[data-learn-home]') ? home(root, data) : practice(root, data)),
    () => {
      root.querySelector('[data-learn-app]').innerHTML = '<p class="callout warn">题库没有载入，请检查网络后刷新页面。</p>';
    },
  );
})();
