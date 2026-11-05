/* VPD 운영 업무 보조 — 판정 엔진
 *
 * 화면(app.js)은 판정하지 않는다. 지연·임박·완료·미착수 판정, 대상자 추출, 메일 초안 치환,
 * EIM 요약은 전부 여기서 계산하고 test/logic.test.js 로 고정한다. 브라우저와 node 양쪽에서 읽힌다.
 *
 * 입력: 검증항목 관리 엑셀 한 시트 — 한 줄이 검증항목 하나
 *   기종 · 검증항목 · 담당부서 · 담당자 · 이메일 · 계획일 · 완료일 · 산출물 링크 · 상태 · 비고
 *
 * 판정(기준일 ref, 임박 기준 soonDays 일)
 *   done       완료 — 완료일이 기준일 이전이거나, 상태 열이 「완료」류
 *   hold       보류 — 상태 열이 「보류」류 (날짜 판정을 하지 않는다)
 *   nodate     기한 없음 — 계획일을 읽지 못함
 *   late       지연 — 계획일 < 기준일, 미완료
 *   soon       임박 — 0 ≤ 남은 날 ≤ soonDays, 미완료
 *   progress   진행 — 기한 여유, 상태 열이 「진행」류
 *   notstarted 미착수 — 기한 여유, 시작 표시 없음
 * 「문서에 적힌 값」(상태·완료일)으로 정한 판정과 「계산한 값」(기한 대비)으로 정한 판정을 basis 로 구분한다.
 */
(function (root) {
  'use strict';
  var DAY = 86400000;

  /* ---------- 날짜 ---------- */
  // 엑셀 일련번호 · '2026-03-02' · '2026.03.02' · '2026/3/2' · '2026년 3월 2일' · Date. 전부 UTC 자정.
  function toDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
    if (typeof v === 'number' && isFinite(v)) {
      if (v < 20000 || v > 80000) return null;
      return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * DAY);
    }
    var m = String(v).trim().match(/^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1 ? d : null;
  }
  function fmt(d) { return d ? d.toISOString().slice(0, 10) : ''; }
  function addDays(d, n) { return new Date(d.getTime() + n * DAY); }
  function diffDays(a, b) { return Math.round((a.getTime() - b.getTime()) / DAY); }   // a - b
  function today() { return toDate(new Date()); }

  /* ---------- 입력 정리 ---------- */
  // 열 이름이 조금 달라도 읽는다. 늘릴 때는 코드가 아니라 이 표를 늘린다.
  var ALIASES = {
    model: ['기종', '모델', '프로젝트', 'model', 'project'],
    item: ['검증항목', '항목', '검증 항목', '가상검증항목', 'item', '액티비티'],
    dept: ['담당부서', '부서', '담당 부서', '팀', 'dept'],
    owner: ['담당자', '담당', 'owner', '책임자'],
    email: ['이메일', '메일', 'email', 'e-mail', '담당자메일'],
    plan: ['계획일', '기한', '목표일', '완료예정일', '계획완료일', 'due', 'plan'],
    done: ['완료일', '실적일', '실제완료일', 'done', 'finished'],
    link: ['산출물링크', '산출물', '산출물 링크', '링크', 'link', '보고서링크'],
    status: ['상태', '진행상태', 'status'],
    note: ['비고', '메모', '이슈', 'note']
  };
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }
  function pick(row, key) {
    var names = ALIASES[key].map(norm);
    for (var k in row) if (names.indexOf(norm(k)) >= 0) return row[k];
    return undefined;
  }
  function str(v) { return String(v == null ? '' : v).trim(); }

  // 상태 열 낱말 — 늘릴 때는 이 표를 늘린다.
  var STATUS_WORDS = {
    done: ['완료', '종결', '완', '승인', 'done', 'closed', 'complete', 'completed'],
    hold: ['보류', '중단', '취소', 'hold', 'onhold'],
    progress: ['진행', '진행중', '착수', '수행중', '검토중', '해석중', '용역요청', 'inprogress', 'wip']
  };
  function statusKind(s) {
    var n = norm(s);
    if (!n) return '';
    for (var k in STATUS_WORDS) if (STATUS_WORDS[k].indexOf(n) >= 0) return k;
    return 'other';
  }

  // 틀린 줄은 버리지 않고 issues 에 남긴다 — 조용히 빠지면 지연 건수가 적게 나와도 아무도 모른다.
  function normalize(rows) {
    var items = [], issues = [];
    (rows || []).forEach(function (r, i) {
      var row = i + 2;
      var o = {
        row: row, model: str(pick(r, 'model')), item: str(pick(r, 'item')), dept: str(pick(r, 'dept')),
        owner: str(pick(r, 'owner')), email: str(pick(r, 'email')), planRaw: pick(r, 'plan'), doneRaw: pick(r, 'done'),
        link: str(pick(r, 'link')), status: str(pick(r, 'status')), note: str(pick(r, 'note'))
      };
      if (!o.model && !o.item) return;                         // 빈 줄
      var tag = (o.model || '?') + ' ' + (o.item || '?');
      if (!o.model || !o.item) issues.push(row + '행(' + tag + '): 기종이나 검증항목이 비어 있습니다');
      o.plan = toDate(o.planRaw); o.done = toDate(o.doneRaw);
      if (!o.plan) issues.push(row + '행(' + tag + '): 계획일을 읽지 못해 「기한 없음」으로 둡니다');
      if (str(o.doneRaw) && !o.done) issues.push(row + '행(' + tag + '): 완료일을 날짜로 읽지 못했습니다');
      if (!o.owner) { issues.push(row + '행(' + tag + '): 담당자가 비어 있어 (미지정)으로 둡니다'); o.owner = '(미지정)'; }
      if (o.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) issues.push(row + '행(' + tag + '): 이메일 형식이 아닙니다 — ' + o.email);
      if (o.status && statusKind(o.status) === 'other') issues.push(row + '행(' + tag + '): 상태 「' + o.status + '」를 알 수 없어 날짜로만 판정합니다');
      delete o.planRaw; delete o.doneRaw;
      items.push(o);
    });
    // 같은 기종·항목이 두 줄 — 집계가 두 번 된다
    var seen = {};
    items.forEach(function (o) {
      var k = o.model + '|' + o.item;
      if (seen[k]) issues.push(o.row + '행: 「' + o.model + ' ' + o.item + '」가 ' + seen[k] + '행과 겹칩니다');
      else seen[k] = o.row;
    });
    return { items: items, issues: issues };
  }

  /* ---------- 판정 ---------- */
  var STATES = ['late', 'soon', 'progress', 'notstarted', 'done', 'hold', 'nodate'];
  var LABEL = { late: '지연', soon: '임박', progress: '진행', notstarted: '미착수', done: '완료', hold: '보류', nodate: '기한 없음' };

  function judge(o, ref, soonDays) {
    ref = toDate(ref) || today();
    soonDays = soonDays == null ? 7 : +soonDays;
    var sk = statusKind(o.status);
    var r = { state: '', basis: 'calc', daysLeft: null, lateDays: 0, lateDone: false, noLink: false, why: '' };
    if (o.plan) r.daysLeft = diffDays(o.plan, ref);
    var doneByDate = o.done && o.done <= ref;
    if (doneByDate || (sk === 'done' && !o.done)) {
      r.state = 'done'; r.basis = 'doc';
      r.why = doneByDate ? '완료일 ' + fmt(o.done) : '상태 열 「' + o.status + '」';
      if (o.done && o.plan && o.done > o.plan) { r.lateDone = true; r.lateDays = diffDays(o.done, o.plan); }
    } else if (sk === 'hold') {
      r.state = 'hold'; r.basis = 'doc'; r.why = '상태 열 「' + o.status + '」';
    } else if (!o.plan) {
      r.state = 'nodate'; r.basis = 'doc'; r.why = '계획일 없음';
    } else if (r.daysLeft < 0) {
      r.state = 'late'; r.lateDays = -r.daysLeft; r.why = '계획일 ' + fmt(o.plan) + ' 경과 ' + r.lateDays + '일';
    } else if (r.daysLeft <= soonDays) {
      r.state = 'soon'; r.why = '계획일까지 ' + r.daysLeft + '일 (D-' + r.daysLeft + ')';
    } else if (sk === 'progress') {
      r.state = 'progress'; r.why = '상태 열 「' + o.status + '」, 기한 여유 ' + r.daysLeft + '일';
    } else {
      r.state = 'notstarted'; r.why = '시작 표시 없음, 기한 여유 ' + r.daysLeft + '일';
    }
    // 완료됐거나 기한이 지났는데 산출물 링크가 없다 = 「산출물 미등록」
    r.noLink = !o.link && (r.state === 'done' || r.state === 'late');
    return r;
  }
  function judgeAll(items, ref, soonDays) {
    return items.map(function (o) { return Object.assign({}, o, judge(o, ref, soonDays)); });
  }
  function dday(j) {
    if (j.daysLeft == null) return '';
    return j.daysLeft === 0 ? 'D-day' : j.daysLeft > 0 ? 'D-' + j.daysLeft : 'D+' + (-j.daysLeft);
  }

  /* ---------- 집계 ---------- */
  function emptyCount() { var c = { total: 0, noLink: 0 }; STATES.forEach(function (s) { c[s] = 0; }); return c; }
  function rate(c) { var base = c.total - c.hold; return base > 0 ? Math.round(c.done / base * 1000) / 10 : 0; }
  // key: 'model' | 'owner' | 'dept'
  function groupBy(judged, key) {
    var order = [], map = {};
    judged.forEach(function (j) {
      var k = j[key] || '(미지정)';
      if (!map[k]) { map[k] = emptyCount(); map[k].key = k; order.push(k); }
      map[k].total++; map[k][j.state]++; if (j.noLink) map[k].noLink++;
      if (key === 'owner') { map[k].dept = map[k].dept || j.dept; map[k].email = map[k].email || j.email; }
    });
    return order.map(function (k) { var c = map[k]; c.rate = rate(c); return c; });
  }
  function totals(judged) {
    var c = emptyCount();
    judged.forEach(function (j) { c.total++; c[j.state]++; if (j.noLink) c.noLink++; });
    c.rate = rate(c); return c;
  }

  /* ---------- EIM 요약 ---------- */
  // 지연은 지연일이 큰 순, 같으면 기종·항목 순. 임박은 남은 날이 적은 순.
  function eim(judged, ref, opts) {
    opts = opts || {}; var top = opts.top || 10;
    ref = toDate(ref) || today();
    var late = judged.filter(function (j) { return j.state === 'late'; })
      .sort(function (a, b) { return b.lateDays - a.lateDays || a.model.localeCompare(b.model) || a.item.localeCompare(b.item); });
    var soon = judged.filter(function (j) { return j.state === 'soon'; })
      .sort(function (a, b) { return a.daysLeft - b.daysLeft || a.model.localeCompare(b.model); });
    var noLink = judged.filter(function (j) { return j.noLink; });
    var byModel = groupBy(judged, 'model');
    var L = [];
    L.push('[EIM 가상검증 진행 현황] 기준일 ' + fmt(ref));
    var t = totals(judged);
    L.push('전체 ' + t.total + '건 · 완료 ' + t.done + ' (' + t.rate + '%) · 지연 ' + t.late + ' · 임박 ' + t.soon + ' · 산출물 미등록 ' + t.noLink);
    L.push('');
    L.push('■ 기종별');
    byModel.forEach(function (m) {
      L.push('- ' + m.key + ': 완료 ' + m.done + '/' + (m.total - m.hold) + ' (' + m.rate + '%), 지연 ' + m.late + ', 임박 ' + m.soon + (m.noLink ? ', 산출물 미등록 ' + m.noLink : ''));
    });
    L.push('');
    L.push('■ 주요 지연 이슈 (지연일 순 상위 ' + Math.min(top, late.length) + '건' + (late.length > top ? ' / 전체 ' + late.length + '건' : '') + ')');
    if (!late.length) L.push('- 지연 항목 없음');
    late.slice(0, top).forEach(function (j, i) {
      L.push((i + 1) + '. ' + j.model + ' · ' + j.item + ' — ' + j.lateDays + '일 지연 (계획 ' + fmt(j.plan) + ', ' + (j.dept ? j.dept + ' ' : '') + j.owner + ')' + (j.note ? ' / ' + j.note : ''));
    });
    L.push('');
    L.push('■ 임박 항목');
    if (!soon.length) L.push('- 임박 항목 없음');
    soon.slice(0, top).forEach(function (j) { L.push('- ' + j.model + ' · ' + j.item + ' — ' + dday(j) + ' (' + j.owner + ')'); });
    if (noLink.length) {
      L.push('');
      L.push('■ 산출물 미등록 ' + noLink.length + '건 — 링크 등록 요청 예정');
    }
    return { late: late, soon: soon, noLink: noLink, byModel: byModel, total: t, topLate: late.slice(0, top), text: L.join('\n') };
  }

  /* ---------- 대상자 추출 ---------- */
  // mode: 'dn'    기한이 정확히 D-n 인 미완료 항목 (예: D-7 사전 안내)
  //       'within' 0~n 일 남은 미완료 항목
  //       'late'  지연 항목
  //       'nolink' 산출물 미등록 항목
  //       'open'  미완료 전부(보류 제외)
  function targets(judged, mode, n) {
    n = +n || 0;
    return judged.filter(function (j) {
      var open = j.state !== 'done' && j.state !== 'hold';
      if (mode === 'dn') return open && j.daysLeft === n;
      if (mode === 'within') return open && j.daysLeft != null && j.daysLeft >= 0 && j.daysLeft <= n;
      if (mode === 'late') return j.state === 'late';
      if (mode === 'nolink') return j.noLink;
      if (mode === 'open') return open && j.state !== 'nodate';
      return false;
    });
  }
  // 담당자(+이메일) 단위로 묶는다 — 한 사람에게 메일 한 통.
  function byOwner(list) {
    var order = [], map = {};
    list.forEach(function (j) {
      var k = j.owner + '|' + (j.email || '');
      if (!map[k]) { map[k] = { owner: j.owner, email: j.email || '', dept: j.dept, items: [] }; order.push(k); }
      map[k].items.push(j);
    });
    return order.map(function (k) {
      var g = map[k];
      g.items.sort(function (a, b) { return (a.plan ? a.plan.getTime() : Infinity) - (b.plan ? b.plan.getTime() : Infinity); });
      return g;
    });
  }

  /* ---------- 메일 초안 ---------- */
  var VARS = ['담당자', '부서', '기종', '항목', '기한', '남은일', '항목목록', '기준일', '건수'];
  var TEMPLATES = [
    { id: 'pre', name: '기한 사전 안내 (D-7)',
      subject: '[VPD] {기종} {항목} 가상검증 기한 안내 ({기한})',
      body: '{담당자}님 안녕하세요.\n\n{기종} 가상검증 항목의 기한이 다가와 안내드립니다.\n\n{항목목록}\n\n기한 내 진행이 어려우시면 사유와 예상 완료일을 회신 부탁드립니다.\n완료되면 산출물 링크를 관리표에 등록해 주세요.\n\n감사합니다.' },
    { id: 'late', name: '지연 항목 확인 요청',
      subject: '[VPD] {기종} {항목} 진행 확인 요청 (기한 {기한} 경과)',
      body: '{담당자}님 안녕하세요.\n\n아래 가상검증 항목이 계획일을 지났습니다. ({기준일} 기준)\n\n{항목목록}\n\n현재 진행 상황과 예상 완료일을 회신 부탁드립니다.\n이번 주 EIM 회의에 공유될 예정입니다.\n\n감사합니다.' },
    { id: 'link', name: '산출물 등록 요청',
      subject: '[VPD] {기종} {항목} 산출물 등록 요청',
      body: '{담당자}님 안녕하세요.\n\n아래 항목의 산출물 링크가 관리표에 아직 없습니다.\n\n{항목목록}\n\n보고서나 결과 파일 위치를 회신해 주시면 등록하겠습니다.\n\n감사합니다.' }
  ];
  // {변수} 를 바꾼다. 모르는 변수는 그대로 두고 unknown 으로 알린다 — 오타가 메일에 그대로 나가지 않게.
  function fill(tpl, vars) {
    var unknown = [];
    var out = String(tpl || '').replace(/\{([^{}\s]{1,12})\}/g, function (m, k) {
      if (Object.prototype.hasOwnProperty.call(vars, k)) return vars[k];
      if (unknown.indexOf(k) < 0) unknown.push(k);
      return m;
    });
    return { text: out, unknown: unknown };
  }
  function varsFor(group, ref) {
    ref = toDate(ref) || today();
    var it = group.items, first = it[0];
    var models = it.map(function (j) { return j.model; }).filter(function (m, i, a) { return a.indexOf(m) === i; });
    var lines = it.map(function (j) {
      return '- ' + j.model + ' / ' + j.item + ' / 기한 ' + (j.plan ? fmt(j.plan) : '미정') + (j.daysLeft != null ? ' (' + dday(j) + ')' : '') + (j.noLink ? ' / 산출물 미등록' : '');
    });
    return {
      '담당자': group.owner, '부서': group.dept || '', '기종': models.join(', '),
      '항목': first.item + (it.length > 1 ? ' 외 ' + (it.length - 1) + '건' : ''),
      '기한': first.plan ? fmt(first.plan) : '미정',
      '남은일': first.daysLeft == null ? '' : dday(first),
      '항목목록': lines.join('\n'), '기준일': fmt(ref), '건수': String(it.length)
    };
  }
  function drafts(groups, tpl, ref, cc) {
    return groups.map(function (g) {
      var v = varsFor(g, ref), s = fill(tpl.subject, v), b = fill(tpl.body, v);
      var unknown = s.unknown.concat(b.unknown).filter(function (k, i, a) { return a.indexOf(k) === i; });
      return { owner: g.owner, email: g.email, dept: g.dept, count: g.items.length, subject: s.text, body: b.text,
        unknown: unknown, mailto: mailto(g.email, cc, s.text, b.text) };
    });
  }
  // mailto 는 길이 제한이 메일 프로그램마다 다르다(대략 2,000자). 넘으면 long 으로 알리고 복사를 권한다.
  function mailto(to, cc, subject, body) {
    var q = [];
    if (cc) q.push('cc=' + encodeURIComponent(cc));
    q.push('subject=' + encodeURIComponent(subject));
    q.push('body=' + encodeURIComponent(String(body).replace(/\r?\n/g, '\r\n')));
    var href = 'mailto:' + encodeURIComponent(to || '').replace(/%40/g, '@') + '?' + q.join('&');
    return { href: href, long: href.length > 1900 };
  }

  /* ---------- AI(선택) 요청 모양 ---------- */
  // 네트워크는 app.js 가 보낸다. 여기서는 요청 모양과 응답 읽기만 정해 테스트로 고정한다.
  var AI = {
    openai: { model: 'gpt-4o-mini', url: 'https://api.openai.com/v1/chat/completions' },
    anthropic: { model: 'claude-haiku-5-5', url: 'https://api.anthropic.com/v1/messages' }
  };
  function aiRequest(provider, key, system, user) {
    var p = AI[provider]; if (!p) throw new Error('모르는 제공자: ' + provider);
    if (provider === 'openai') return { url: p.url, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: { model: p.model, temperature: 0.3, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] } };
    return { url: p.url, headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true' },
      body: { model: p.model, max_tokens: 1200, system: system, messages: [{ role: 'user', content: user }] } };
  }
  function aiText(provider, json) {
    if (!json) return '';
    if (provider === 'openai') return (((json.choices || [])[0] || {}).message || {}).content || '';
    return (json.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('');
  }

  /* ---------- 내보내기 표 ---------- */
  function exportRows(judged) {
    var head = ['기종', '검증항목', '담당부서', '담당자', '이메일', '계획일', '완료일', '산출물 링크', '상태(문서)', '판정', '판정 근거', 'D-day', '지연일', '산출물 미등록', '비고'];
    return [head].concat(judged.map(function (j) {
      return [j.model, j.item, j.dept, j.owner, j.email, fmt(j.plan), fmt(j.done), j.link, j.status, LABEL[j.state] + (j.lateDone ? '(지연 완료)' : ''),
        (j.basis === 'doc' ? '문서: ' : '계산: ') + j.why, dday(j), j.lateDays || '', j.noLink ? '미등록' : '', j.note];
    }));
  }
  function groupRows(groups, keyName) {
    var head = [keyName].concat(keyName === '담당자' ? ['부서'] : []).concat(['전체', '완료', '지연', '임박', '진행', '미착수', '보류', '기한 없음', '산출물 미등록', '완료율(%)']);
    return [head].concat(groups.map(function (g) {
      return [g.key].concat(keyName === '담당자' ? [g.dept || ''] : []).concat([g.total, g.done, g.late, g.soon, g.progress, g.notstarted, g.hold, g.nodate, g.noLink, g.rate]);
    }));
  }

  /* ---------- 예제 ---------- */
  // 실제 사내 데이터가 아니다. 모양만 비슷하게 만든 가짜 기종 3개 × 검증항목 11~12개.
  // 날짜는 base(기본 오늘)를 기준으로 만든다 — 언제 열어도 지연·임박·D-7 사례가 보이게.
  function sample(base) {
    base = toDate(base) || today();
    var models = ['DX-300 굴착기(가상)', 'WL-150 휠로더(가상)', 'FX-25 전동 지게차(가상)'];
    var items = [
      ['구조 강도 해석', '해석'], ['피로 수명 해석', '해석'], ['냉각 열유동 해석', '해석'],
      ['DMU 간섭 검토', '설계'], ['배관·하네스 라우팅 검토', '설계'], ['정비성 검토', '기획'],
      ['운전석 시야성 검토', '기획'], ['전복 안정성 해석', '검증용역(인도)'], ['소음·진동 해석', '검증용역(인도)'],
      ['조립성 가상검증', '생산기술'], ['시험 연계 상관성 검토', '시험']
    ];
    var people = {
      '해석': [['한지후', 'jihu.han'], ['오세린', 'serin.oh']], '설계': [['김도윤', 'doyun.kim'], ['박서준', 'seojun.park']],
      '기획': [['이하은', 'haeun.lee'], ['이하은', 'haeun.lee']], '검증용역(인도)': [['R. Sharma', 'r.sharma'], ['A. Gupta', 'a.gupta']],
      '생산기술': [['정민재', 'minjae.jung'], ['정민재', 'minjae.jung']], '시험': [['최유나', 'yuna.choi'], ['최유나', 'yuna.choi']]
    };
    // [계획일 오프셋, 상태, 완료일 오프셋, 링크 있음]
    var pat = [
      [-30, '완료', -32, true], [-20, '완료', -15, true], [-14, '완료', -16, false], [-10, '진행중', null, false],
      [-3, '', null, false], [2, '진행중', null, true], [7, '', null, false], [5, '진행중', null, false],
      [14, '진행중', null, false], [30, '', null, false], [45, '보류', null, false]
    ];
    var notes = { 3: '용역 결과 회신 지연', 4: '설계 변경 반영 대기', 10: '시제품 일정 재조정' };
    var rows = [];
    models.forEach(function (m, mi) {
      items.forEach(function (it, ii) {
        var p = pat[(ii + mi * 4) % pat.length];
        var who = people[it[1]][mi % 2];
        var link = p[3] ? 'https://spdm.example.com/vpd/' + (mi + 1) + '-' + (ii + 1) : '';
        rows.push({ 기종: m, 검증항목: it[0], 담당부서: it[1], 담당자: who[0], 이메일: who[1] + '@example.com',
          계획일: fmt(addDays(base, p[0])), 완료일: p[2] == null ? '' : fmt(addDays(base, p[2])), '산출물 링크': link,
          상태: p[1], 비고: notes[(ii + mi * 4) % pat.length] || '' });
      });
    });
    // 기한이 비어 있는 줄 하나 — 「기한 없음」과 경고가 보이게
    rows.push({ 기종: models[2], 검증항목: '배터리팩 냉각 성능 해석', 담당부서: '해석', 담당자: '한지후', 이메일: 'jihu.han@example.com',
      계획일: '', 완료일: '', '산출물 링크': '', 상태: '', 비고: '일정 협의 중' });
    return rows;
  }

  var api = { toDate: toDate, fmt: fmt, addDays: addDays, diffDays: diffDays, today: today, ALIASES: ALIASES, STATUS_WORDS: STATUS_WORDS,
    statusKind: statusKind, normalize: normalize, STATES: STATES, LABEL: LABEL, judge: judge, judgeAll: judgeAll, dday: dday,
    groupBy: groupBy, totals: totals, eim: eim, targets: targets, byOwner: byOwner, VARS: VARS, TEMPLATES: TEMPLATES,
    fill: fill, varsFor: varsFor, drafts: drafts, mailto: mailto, AI: AI, aiRequest: aiRequest, aiText: aiText,
    exportRows: exportRows, groupRows: groupRows, sample: sample };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Vpd = api;
})(this);
