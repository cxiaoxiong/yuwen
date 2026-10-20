// 学习中心核心逻辑（无 DOM、无存储）：判分比对、Leitner 调度、复习状态、出题队列、进度校验。三类题（默写、文言实词、文化常识）共用一套调度。
// 浏览器里挂到 window.LearnCore，给 learn.js 用；test/learn/selftest.mjs 在 Node 的 vm 里加载它做测试。
(function (root) {
  'use strict';

  // ───────── 日期（本地日历日，YYYY-MM-DD 字符串可直接比大小） ─────────
  const pad = (n) => String(n).padStart(2, '0');
  const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const addDays = (s, n) => {
    const [y, m, d] = s.split('-').map(Number);
    return dayStr(new Date(y, m - 1, d + n));
  };
  const daysBetween = (a, b) => {
    const [y1, m1, d1] = a.split('-').map(Number);
    const [y2, m2, d2] = b.split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
  };
  /** 本周（周一到周日）的七个日期 */
  const weekOf = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    const dow = (new Date(y, m - 1, d).getDay() + 6) % 7;
    return Array.from({ length: 7 }, (_, i) => addDays(s, i - dow));
  };

  // ───────── 判分 ─────────
  /** 与构建端 scripts/lib/learn.mjs 的 norm 一致：全角 ASCII 转半角，去掉标点、符号和空白；不做繁简、异体转换 */
  function norm(s) {
    return String(s || '')
      .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[\p{P}\p{S}\s]/gu, '');
  }

  /**
   * 逐字比对（LCS 对齐）：answer 是标准答案，input 是学生写的。
   * ops：eq 相同、sub 错字（写成了 b，应为 a）、miss 漏字、extra 多字。
   * 一个漏字之后的文字不会被连带判错。
   */
  function diff(answer, input) {
    const a = [...norm(answer)];
    const b = [...norm(input)];
    const n = a.length;
    const m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const raw = [];
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) {
        raw.push({ t: 'eq', a: a[i] });
        i++;
        j++;
      } else if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) raw.push({ t: 'miss', a: a[i++] });
      else raw.push({ t: 'extra', b: b[j++] });
    }
    // 相邻的一段漏字、多字两两配成错字
    const ops = [];
    for (let k = 0; k < raw.length; ) {
      if (raw[k].t === 'eq') {
        ops.push(raw[k++]);
        continue;
      }
      const miss = [];
      const extra = [];
      while (k < raw.length && raw[k].t !== 'eq') (raw[k].t === 'miss' ? miss : extra).push(raw[k++]);
      const p = Math.min(miss.length, extra.length);
      for (let q = 0; q < p; q++) ops.push({ t: 'sub', a: miss[q].a, b: extra[q].b });
      ops.push(...miss.slice(p), ...extra.slice(p));
    }
    const count = (t) => ops.filter((o) => o.t === t).length;
    const r = { ops, eq: count('eq'), sub: count('sub'), miss: count('miss'), extra: count('extra'), len: n };
    r.ok = n > 0 && r.sub + r.miss + r.extra === 0;
    return r;
  }

  /** 分空判分：每个空单独比对，空与空之间不串位。返回 { ok, per, empty, ratio }（ratio：答对的字占答案总字数） */
  function gradeInput(blanks, inputs) {
    const per = blanks.map((ans, k) => diff(ans, inputs[k] || ''));
    const len = per.reduce((s, d) => s + d.len, 0);
    const eq = per.reduce((s, d) => s + d.eq, 0);
    return { ok: per.every((d) => d.ok), per, empty: inputs.every((x) => !norm(x)), ratio: len ? eq / len : 0 };
  }

  // ───────── Leitner 调度 ─────────
  // 五个盒子的复习间隔（天）。盒号 1–5；没有记录 = 新句。
  const BOXES = [1, 2, 4, 8, 16];
  // 评价：right 对、typo 有错别字、mix 记混或漏了句子、forgot 没想起来
  const GRADES = ['right', 'typo', 'mix', 'forgot'];

  /**
   * 记一次作答，返回新记录（不修改 rec）。opts：{ today, hinted, rev }。
   * 规则（test/learn/selftest.mjs 逐条测试）：
   *   新句：无提示答对 → 2 号盒；看了提示答对、有错字 → 1 号盒；记混、没想起 → 1 号盒
   *   旧句：没想起、记混 → 回 1 号盒；有错字 → 降一盒（最低 1）
   *         答对 → 升一盒（最高 5）；但看了提示、同一天已作答过、还没到期（提前复习）时不升盒，到期日不变
   *   间隔按作答后的盒号算；k 是「无提示答对」的不同天数，用来判断稳定
   */
  function apply(rec, grade, opts) {
    const { today, hinted = false, rev } = opts;
    if (!GRADES.includes(grade)) throw new Error(`未知的评价：${grade}`);
    const isNew = !rec;
    const r = isNew ? { b: 0, d: today, l: '', k: 0, ko: '', x: 0, f: today } : { ...rec };
    const sameDay = r.l === today;
    const early = !isNew && r.d > today;
    if (grade === 'forgot' || grade === 'mix') {
      r.b = 1;
      r.x++;
      r.d = addDays(today, BOXES[0]);
    } else if (grade === 'typo') {
      r.b = isNew ? 1 : Math.max(1, r.b - 1);
      r.x++;
      r.d = addDays(today, BOXES[r.b - 1]);
    } else {
      if (isNew) {
        r.b = hinted ? 1 : 2;
        r.d = addDays(today, BOXES[r.b - 1]);
      } else if (!hinted && !sameDay && !early) {
        r.b = Math.min(5, r.b + 1);
        r.d = addDays(today, BOXES[r.b - 1]);
      }
      if (!hinted && r.ko !== today) {
        r.k++;
        r.ko = today;
      }
    }
    if (grade !== 'right') r.e = grade;
    r.l = today;
    if (rev) r.r = rev;
    return r;
  }

  /** 一句（一题）的复习状态：new 没练过、due 到期该复习、learning 在记、stable 稳定（4 号盒以上、没到期、至少两天无提示答对） */
  function status(rec, today) {
    if (!rec) return 'new';
    if (rec.d <= today) return 'due';
    if (rec.b >= 4 && rec.k >= 2) return 'stable';
    return 'learning';
  }

  /** 一篇（或一组句子）的汇总：total 总句数、covered 练过、due 到期、stable 稳定 */
  function summarize(ids, items, today) {
    const s = { total: ids.length, covered: 0, due: 0, stable: 0, learning: 0 };
    for (const id of ids) {
      const st = status(items[id], today);
      if (st !== 'new') s.covered++;
      if (st === 'due') s.due++;
      if (st === 'stable') s.stable++;
      if (st === 'learning') s.learning++;
    }
    return s;
  }

  // ───────── 出题 ─────────
  const byDue = (items) => (x, y) => items[x].d.localeCompare(items[y].d) || items[x].b - items[y].b;

  // 三类题（同一类内部混排，不同类不混在一组里）：mx 默写、sc 文言实词语境、cs 文化常识。
  // 每类当天的新题分开计数，记在 days[日期] 的 w / s / c 上（w 是第一期就有的默写新句数）。
  const TRACKS = ['mx', 'sc', 'cs'];
  const NEW_KEY = { mx: 'w', sc: 's', cs: 'c' };

  /**
   * 今日复习：范围内到期的句子优先（最多 size 句），再补新句（受当天新句上限约束）。
   * bank：一类题的 items 数组（按出题顺序）；state：进度；scope：课文 id 集合（null = 全部）；newKey：当天新题数记在哪个字段。
   * 返回 { ids, due, fresh }。
   */
  function todayQueue(bank, state, scope, today, size = 10, newKey = 'w') {
    const inScope = bank.filter((it) => !scope || scope.has(it.l));
    const due = inScope.filter((it) => state.items[it.id] && state.items[it.id].d <= today).map((it) => it.id).sort(byDue(state.items));
    const newLeft = Math.max(0, (state.prefs.goal || 10) - ((state.days[today] && state.days[today][newKey]) || 0));
    const pickDue = due.slice(0, size);
    const fresh = inScope.filter((it) => !state.items[it.id]).slice(0, Math.min(newLeft, size - pickDue.length)).map((it) => it.id);
    return { ids: [...pickDue, ...fresh], due: due.length, fresh: fresh.length, newLeft };
  }

  /** 练一组（一篇课文、一个实词、一个常识专题）：到期的、新的、其余（按到期日）依次排列，全部都练。inGroup(item) 判断是否属于这一组 */
  function groupQueue(bank, state, inGroup, today) {
    const ids = bank.filter(inGroup).map((it) => it.id);
    const rec = (id) => state.items[id];
    const due = ids.filter((id) => rec(id) && rec(id).d <= today).sort(byDue(state.items));
    const fresh = ids.filter((id) => !rec(id));
    const rest = ids.filter((id) => rec(id) && rec(id).d > today).sort(byDue(state.items));
    return [...due, ...fresh, ...rest];
  }
  const lessonQueue = (bank, state, lessonId, today) => groupQueue(bank, state, (it) => it.l === lessonId, today);

  /** 错题：错过、还在 1–2 号盒的句子（不限范围），按到期日 */
  function wrongIds(bank, state) {
    return bank.filter((it) => { const r = state.items[it.id]; return r && r.x > 0 && r.b <= 2; }).map((it) => it.id).sort(byDue(state.items));
  }

  /** 选题面：同一句有几道题时轮流出；要输入作答时优先选能自动判分的题面（不是开放题） */
  function pickCue(item, rec, wantInput) {
    const n = item.c.length;
    const start = rec ? (rec.k + rec.x) % n : 0;
    for (let t = 0; t < n; t++) {
      const c = item.c[(start + t) % n];
      if (!wantInput || !c.o) return c;
    }
    return item.c[start];
  }

  // ───────── 进度数据 ─────────
  const APP = 'yuwen-learn';
  const GOALS = [5, 10, 15];
  const MODES = ['paper', 'input'];
  const emptyState = () => ({ v: 1, items: {}, days: {}, prefs: { goal: 10, mode: 'paper' }, scope: null, backupAt: null, remindAt: null, flags: [] });

  /** 记一次作答到当天的统计：n 作答题数（三类合计），w / s / c 当天第一次练的默写新句、实词新题、常识新题数 */
  function logDay(state, today, isNew, newKey = 'w') {
    const d = state.days[today] || (state.days[today] = { n: 0, w: 0 });
    d.n++;
    if (isNew) d[newKey] = (d[newKey] || 0) + 1;
    const keys = Object.keys(state.days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete state.days[k];
  }

  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
  const isDay = (x) => typeof x === 'string' && DATE.test(x);
  const isDayOrEmpty = (x) => x === '' || isDay(x);
  const isStamp = (x) => x === null || (typeof x === 'string' && x.length <= 40 && !Number.isNaN(Date.parse(x)));

  /**
   * 校验进度数据（本机读出的、导入的都走这里）。不认识的句子 id 保留（可能是别的题库版本）。
   * 返回 { ok: true, state, summary } 或 { ok: false, error }。
   */
  function validateState(s) {
    const bad = (error) => ({ ok: false, error });
    if (!isObj(s) || s.v !== 1) return bad('进度数据的版本不对');
    if (!isObj(s.items) || !isObj(s.days) || !isObj(s.prefs)) return bad('进度数据缺少必要的部分');
    const ids = Object.keys(s.items);
    if (ids.length > 20000) return bad('进度数据里的句子太多');
    for (const id of ids) {
      const r = s.items[id];
      if (id.length > 80 || !isObj(r)) return bad(`句子记录格式不对：${id.slice(0, 40)}`);
      if (!isInt(r.b, 1, 5) || !isDay(r.d) || !isDayOrEmpty(r.l) || !isInt(r.k, 0, 100000) || !isDayOrEmpty(r.ko) || !isInt(r.x, 0, 100000) || !isDay(r.f)) return bad(`句子记录的数值不对：${id.slice(0, 40)}`);
      if (r.r !== undefined && (typeof r.r !== 'string' || r.r.length > 16)) return bad(`句子记录的版本号不对：${id.slice(0, 40)}`);
      if (r.e !== undefined && !GRADES.includes(r.e)) return bad(`句子记录的错因不对：${id.slice(0, 40)}`);
    }
    const days = Object.keys(s.days);
    if (days.length > 4000) return bad('每日记录太多');
    const optInt = (x) => x === undefined || isInt(x, 0, 100000);
    for (const k of days) if (!isDay(k) || !isObj(s.days[k]) || !isInt(s.days[k].n, 0, 100000) || !isInt(s.days[k].w, 0, 100000) || !optInt(s.days[k].s) || !optInt(s.days[k].c)) return bad(`每日记录不对：${k.slice(0, 20)}`);
    if (!GOALS.includes(s.prefs.goal) || !MODES.includes(s.prefs.mode)) return bad('设置不对');
    if (s.prefs.tracks !== undefined && (!Array.isArray(s.prefs.tracks) || s.prefs.tracks.length > TRACKS.length || s.prefs.tracks.some((t) => !TRACKS.includes(t)))) return bad('设置里的学习内容不对');
    if (s.scope !== null && (!Array.isArray(s.scope) || s.scope.length > 1000 || s.scope.some((x) => typeof x !== 'string' || x.length > 60))) return bad('学习范围不对');
    if (!isStamp(s.backupAt) || !(s.remindAt === null || isDay(s.remindAt))) return bad('备份时间不对');
    if (!Array.isArray(s.flags) || s.flags.length > 500 || s.flags.some((f) => !isObj(f) || typeof f.id !== 'string' || f.id.length > 80 || !isDay(f.at) || typeof f.input !== 'string' || f.input.length > 400)) return bad('复核记录不对');
    const last = ids.reduce((m, id) => (s.items[id].l > m ? s.items[id].l : m), '');
    return { ok: true, state: s, summary: { items: ids.length, lastDay: last || null, days: days.filter((k) => s.days[k].n > 0).length } };
  }

  /** 导出文件的内容（JSON 文本，UTF-8） */
  function exportText(state, now) {
    return JSON.stringify({ app: APP, v: 1, exportedAt: now.toISOString(), data: state });
  }

  /** 解析导入的文本：大小、格式、字段范围都检查；通过才返回状态，调用方负责先备份当前进度再整体替换 */
  function parseImport(text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: '内容是空的' };
    if (text.length > 2 * 1024 * 1024) return { ok: false, error: '内容太大，不像是本站的进度文件' };
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: '不是有效的进度文件（无法解析）' };
    }
    if (!isObj(obj) || obj.app !== APP) return { ok: false, error: '不是本站导出的学习进度' };
    if (obj.v !== 1) return { ok: false, error: '进度文件的版本不对' };
    const r = validateState(obj.data);
    if (!r.ok) return r;
    return { ...r, exportedAt: isStamp(obj.exportedAt) ? obj.exportedAt : null };
  }

  root.LearnCore = { dayStr, addDays, daysBetween, weekOf, norm, diff, gradeInput, BOXES, GRADES, apply, status, summarize, todayQueue, groupQueue, lessonQueue, wrongIds, TRACKS, NEW_KEY, pickCue, emptyState, logDay, validateState, exportText, parseImport, GOALS, MODES };
})(typeof window !== 'undefined' ? window : globalThis);
