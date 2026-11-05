/* 데이터 관리 화면 — 판정·계산은 vpdm.js 가 한다. 여기서는 읽고, 그리고, 이 브라우저에 기억할 뿐이다. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var V = window.Vpdm;
  var LS = 'b2611-06.vpdm';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var state = load();

  function load() {
    var d = null; try { d = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { d = null; }
    d = d || {};
    return { template: d.template || null, projects: d.projects || [], cur: d.cur || '', by: d.by || '', filter: {} };
  }
  function save() { try { localStorage.setItem(LS, JSON.stringify({ v: 2, template: state.template, projects: state.projects, cur: state.cur, by: state.by })); } catch (e) { msg('t-msg', '데이터가 커서 이 브라우저에 기억하지 못했습니다. 프로젝트 JSON 백업을 내려받아 두세요.', 'warn'); } }
  function cur() { return state.projects.filter(function (p) { return p.id === state.cur; })[0] || null; }
  function replace(P) { state.projects = state.projects.map(function (p) { return p.id === P.id ? P : p; }); save(); }
  function msg(id, html, cls) { $(id).innerHTML = html ? '<div class="' + (cls || 'note') + '">' + html + '</div>' : ''; }
  function copy(text, btn) {
    var done = function () { if (btn) { var o = btn.textContent; btn.textContent = '복사했습니다'; setTimeout(function () { btn.textContent = o; }, 1200); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done); else done();
  }
  function dl(name, text, type) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }

  /* ---------- 1. 양식 ---------- */
  function readTemplateFile(f) {
    var rd = new FileReader();
    rd.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellFormula: true });
        var sheets = wb.SheetNames.map(function (n) { return { name: n, aoa: V.aoaFromSheet(wb.Sheets[n], XLSX) }; });
        useTemplate(V.parseTemplate(sheets, f.name));
      } catch (err) { msg('t-msg', '양식을 읽지 못했습니다: ' + esc(err.message), 'warn'); }
    };
    rd.readAsArrayBuffer(f);
  }
  function useTemplate(T) {
    state.template = T; save(); renderTemplate(); renderProjectForm();
    msg('t-msg', (T.issues.length ? '<div class="warn"><ul>' + T.issues.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>' : '') +
      '양식 <b>' + esc(T.name) + '</b> — 시트 ' + T.counts.sheets + '개 · 항목 ' + T.counts.items + '개 · 자동 계산 ' + T.counts.auto + '개 · 담당 팀/파트 ' + T.counts.roster + '줄. 이 양식으로 새 프로젝트를 만들 수 있습니다.', T.counts.items ? 'ok' : 'warn');
  }
  function renderTemplate() {
    var T = state.template;
    if (!T) { $('t-summary').innerHTML = '<p class="sub">아직 양식이 없습니다. math &amp; load 데이터 양식 엑셀을 올리거나 예제 양식을 넣어 주세요.</p>'; return; }
    var h = '<div class="stats">' + stat('양식', esc(T.name)) + stat('시트', T.counts.sheets) + stat('입력 항목', T.counts.items) + stat('자동 계산', T.counts.auto) + stat('팀/파트', T.counts.roster) + '</div>';
    h += '<div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>시트</th><th>표</th><th>값 칸</th><th>항목</th><th>자동 계산</th><th>입력 주체</th></tr></thead><tbody>';
    T.sheets.forEach(function (s) { s.blocks.forEach(function (b, i) {
      var auto = b.items.filter(function (it) { return Object.keys(it.formulas).length; }).length;
      h += '<tr><td>' + esc(s.name) + '</td><td>' + (i + 1) + (b.reference ? ' <span class="tag">참고 표</span>' : '') + '</td><td class="wrapcell">' + esc(b.cols.map(function (c) { return c.label; }).join(' · ') || '—') + '</td><td class="num">' + (b.items.length - auto) + '</td><td class="num">' + auto + '</td><td>' + esc(b.cols.map(function (c) { return c.by; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }).join(' · ')) + '</td></tr>';
    }); });
    $('t-summary').innerHTML = h + '</tbody></table></div>';
  }
  function stat(k, v) { return '<div class="stat"><b>' + v + '</b>' + k + '</div>'; }

  /* ---------- 2. 프로젝트 ---------- */
  function renderProjectForm() {
    var T = state.template;
    $('p-form').hidden = !T;
    if (!T) return;
    var hintOf = function (label) { var f = T.fields.filter(function (x) { return V.norm(x.label) === V.norm(label); })[0]; return f ? f.hint : ''; };
    $('p-type').placeholder = hintOf('기종 타입') || '굴착기 / 휠로더'; $('p-grade').placeholder = hintOf('Grade(톤수)') || '예: 12t'; $('p-name').placeholder = hintOf('기종명') || '기종명'; $('p-code').placeholder = hintOf('기종코드') || '기종코드';
    $('p-owners').innerHTML = T.roster.map(function (r, i) { return '<label>' + esc(r.team + (r.part ? ' / ' + r.part : '')) + '<input type="text" data-owner="' + esc(r.team + '/' + r.part) + '" placeholder="' + esc(r.hint || '담당자 이름') + '"></label>'; }).join('');
  }
  function renderProjects() {
    if (!state.projects.length) { $('p-list').innerHTML = '<p class="sub">아직 프로젝트가 없습니다.</p>'; return; }
    var h = '<div class="tablewrap"><table class="projects"><thead><tr><th>기종코드</th><th>기종명</th><th>타입 · 톤수</th><th>생성 · 확정</th><th>입력률</th><th>미입력</th><th></th></tr></thead><tbody>';
    state.projects.forEach(function (p) {
      var pr = V.progress(p, 'team').total;
      h += '<tr class="pick' + (p.id === state.cur ? ' on' : '') + '" data-pick="' + esc(p.id) + '"><td class="mono"><b>' + esc(p.code) + '</b></td><td>' + esc(p.name) + '</td><td>' + esc([p.type, p.grade].filter(Boolean).join(' · ')) + '</td>' +
        '<td><small>' + esc(p.createdAt) + '</small>' + (p.confirmedAt ? '<br><span class="tag ok-t">확정 ' + esc(p.confirmedAt.slice(0, 10)) + '</span>' : '<br><span class="tag">미확정</span>') + '</td>' +
        '<td><span class="bar"><i style="width:' + Math.round((pr.pct || 0) * 100) + '%"></i></span>' + (pr.pct == null ? '—' : Math.round(pr.pct * 100) + '%') + ' <small class="sub">' + pr.done + '/' + pr.total + '</small></td>' +
        '<td class="num">' + (pr.empty + pr.partial) + '</td><td><button class="x" data-del="' + esc(p.id) + '" type="button">지우기</button></td></tr>';
    });
    $('p-list').innerHTML = h + '</tbody></table></div>';
  }
  function createProject() {
    var owners = {}; Array.prototype.forEach.call(document.querySelectorAll('#p-owners input'), function (i) { if (i.value.trim()) owners[i.dataset.owner] = i.value.trim(); });
    var r = V.createProject(state.template, { code: $('p-code').value, name: $('p-name').value, type: $('p-type').value, grade: $('p-grade').value }, owners, V.stamp(), state.projects);
    if (r.errors.length) { msg('p-msg', '<ul>' + r.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>', 'warn'); return; }
    state.projects.push(r.project); state.cur = r.project.id; save();
    ['p-code', 'p-name', 'p-type', 'p-grade'].forEach(function (id) { $(id).value = ''; });
    msg('p-msg', '프로젝트 <b>' + esc(r.project.code) + '</b> 을(를) 만들었습니다 — 항목 ' + r.project.items.length + '개. 아래 3 에서 값을 넣습니다.', 'ok');
    renderAll();
  }

  /* ---------- 3. 입력 ---------- */
  function renderFilter() {
    var P = cur(); if (!P) return;
    var opt = function (v, sel, lab) { return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(lab == null ? v : lab) + '</option>'; };
    $('f-sheet').innerHTML = opt('', state.filter.sheet || '', '전체 시트') + P.template.sheets.map(function (s) { return opt(s.name, state.filter.sheet); }).join('');
    $('f-team').innerHTML = opt('', state.filter.team || '', '전체 팀') + V.valuesOf(P, 'team').map(function (v) { return opt(v, state.filter.team); }).join('');
    $('f-part').innerHTML = opt('', state.filter.part || '', '전체 파트') + V.valuesOf(P, 'part').map(function (v) { return opt(v, state.filter.part); }).join('');
    $('f-status').innerHTML = opt('', state.filter.status || '', '전체 상태') + Object.keys(V.STATUS_LABEL).map(function (k) { return opt(k, state.filter.status, V.STATUS_LABEL[k]); }).join('');
    $('f-by').value = state.by;
  }
  function renderItems() {
    var P = cur();
    $('s-input').hidden = !P; $('s-status').hidden = !P; $('s-share').hidden = !P;
    if (!P) return;
    $('cur-title').textContent = P.code + ' · ' + P.name + (P.confirmedAt ? ' · 확정 ' + P.confirmedAt : '');
    var items = V.filterItems(P, state.filter), bySheet = {};
    items.forEach(function (it) { (bySheet[it.sheet] = bySheet[it.sheet] || []).push(it); });
    var h = '';
    P.template.sheets.forEach(function (s) {
      var list = bySheet[s.name]; if (!list) return;
      s.blocks.forEach(function (b, bi) {
        var rows = list.filter(function (it) { return it.block === bi; }); if (!rows.length) return;
        h += '<h3 class="tb-h">' + esc(s.name) + (s.blocks.length > 1 ? ' · 표 ' + (bi + 1) : '') + (b.notes ? ' <button class="x" data-notes="' + esc(s.name) + '|' + bi + '" type="button">참고 사항</button>' : '') + '</h3>';
        if (b.notes) h += '<div class="note" id="notes-' + esc(V.norm(s.name)) + '-' + bi + '" hidden style="white-space:pre-line">' + esc(b.notes) + '</div>';
        h += '<div class="tablewrap"><table class="items"><thead><tr><th>구분</th><th>팀 · 파트</th><th>담당</th><th>DATA</th><th>단위</th>' + b.cols.map(function (c) { return '<th>' + esc(c.label) + (c.by ? '<br><small class="sub">' + esc(c.by) + '</small>' : '') + '</th>'; }).join('') + '<th>비고</th><th>상태</th></tr></thead><tbody>';
        rows.forEach(function (it) {
          var st = V.status(it);
          h += '<tr class="st-' + st + '" data-item="' + esc(it.id) + '"><td class="wrapcell"><small>' + esc([it.cat1, it.cat2].filter(Boolean).join(' · ')) + '</small></td><td class="wrapcell">' + esc([it.team, it.part].filter(Boolean).join(' / ')) + '</td><td>' + esc(it.owner) + '</td>' +
            '<td class="wrapcell"><b>' + esc(it.data) + '</b>' + (it.required ? ' <small class="req">필수</small>' : '') + '</td><td>' + esc(it.unit) + '</td>' +
            b.cols.map(function (c) {
              if (V.isAuto(it, c.key)) return '<td class="auto" title="' + esc(it.formulas[c.key]) + '"><span class="mono">' + esc(it.values[c.key] || '—') + '</span><br><small class="sub">자동' + (it.autoNote && it.autoNote[c.key] ? ' · ' + esc(it.autoNote[c.key]) : '') + '</small></td>';
              return '<td><input type="text" class="val" data-item="' + esc(it.id) + '" data-col="' + esc(c.key) + '" value="' + esc(it.values[c.key]) + '" placeholder="' + esc(it.hints[c.key] || '') + '"></td>';
            }).join('') +
            '<td class="wrapcell"><small>' + esc(it.note) + '</small></td><td><span class="tag ' + (st === 'done' ? 'ok-t' : st === 'empty' ? 'bad-t' : '') + '">' + esc(V.STATUS_LABEL[st]) + '</span>' + (it.updatedAt ? '<br><small class="sub">' + esc(it.updatedBy || '') + ' ' + esc(it.updatedAt.slice(5)) + '</small>' : '') + '</td></tr>';
        });
        h += '</tbody></table></div>';
      });
    });
    $('items').innerHTML = h || '<p class="sub">조건에 맞는 항목이 없습니다.</p>';
    $('items-count').textContent = items.length + ' / ' + P.items.length + '개';
  }
  function onValueChange(input) {
    var P = cur(); if (!P) return;
    if (!state.by) { msg('i-msg', '위 「작업자 이름」을 먼저 적어 주세요. 누가 넣었는지 이력에 남습니다.', 'warn'); input.value = P.items.filter(function (x) { return x.id === input.dataset.item; })[0].values[input.dataset.col]; input.focus(); return; }
    var r = V.setValue(P, input.dataset.item, input.dataset.col, input.value, state.by, V.stamp());
    if (r.error) { msg('i-msg', esc(r.error), 'warn'); return; }
    if (!r.changed) return;
    replace(r.project);
    msg('i-msg', r.warn ? esc(r.warn) : '', r.warn ? 'warn' : '');
    renderItems(); renderStatus(); renderProjects();
  }

  /* ---------- 4. 현황 ---------- */
  function renderStatus() {
    var P = cur(); if (!P) return;
    var by = $('st-by').value || 'team', pr = V.progress(P, by);
    var h = '<div class="stats">' + stat('입력 항목', pr.total.total) + stat('입력 완료', pr.total.done) + stat('일부', pr.total.partial) + stat('미입력', pr.total.empty) + stat('자동 계산', pr.total.auto) +
      (pr.total.required ? stat('필수 완료', pr.total.requiredDone + '/' + pr.total.required) : '') + '</div>';
    h += '<div class="tablewrap" style="margin-top:10px"><table class="prog"><thead><tr><th>' + esc(pr.byLabel) + '</th><th>입력률</th><th>완료</th><th>일부</th><th>미입력</th><th>자동</th></tr></thead><tbody>' +
      pr.rows.map(function (r) { return '<tr data-key="' + esc(r.key) + '"><td>' + esc(r.key) + '</td><td><span class="bar"><i style="width:' + Math.round((r.pct || 0) * 100) + '%"></i></span>' + (r.pct == null ? '—' : Math.round(r.pct * 100) + '%') + '</td><td class="num">' + r.done + '</td><td class="num">' + r.partial + '</td><td class="num">' + r.empty + '</td><td class="num">' + r.auto + '</td></tr>'; }).join('') +
      '<tr class="sum"><td>전체</td><td>' + (pr.total.pct == null ? '—' : Math.round(pr.total.pct * 100) + '%') + '</td><td class="num">' + pr.total.done + '</td><td class="num">' + pr.total.partial + '</td><td class="num">' + pr.total.empty + '</td><td class="num">' + pr.total.auto + '</td></tr></tbody></table></div>';
    $('st-table').innerHTML = h;
    $('st-missing').value = V.missingText(P);
    $('hist').innerHTML = P.history.length ? '<div class="tablewrap"><table class="hist"><thead><tr><th>시각</th><th>작업자</th><th>시트 · 항목</th><th>칸</th><th>이전 → 이후</th><th></th></tr></thead><tbody>' +
      P.history.slice(0, 60).map(function (x) { return '<tr><td>' + esc(x.at) + '</td><td>' + esc(x.by) + '</td><td class="wrapcell">' + esc(x.sheet) + (x.data ? ' · ' + esc(x.data) : '') + '</td><td>' + esc(x.col) + '</td><td class="wrapcell">' + esc(x.from || '(빈칸)') + ' → ' + esc(x.to) + '</td><td>' + (x.merged ? '<span class="tag">병합 ' + esc(x.mergedFrom) + '</span>' : '') + (x.afterConfirm ? ' <span class="tag bad-t">확정 후 변경</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="sub">아직 바뀐 값이 없습니다.</p>';
  }

  /* ---------- 5. 배포·병합 ---------- */
  function renderShare() {
    var P = cur(); if (!P) return;
    $('sh-team').innerHTML = '<option value="">전체(모든 팀)</option>' + V.valuesOf(P, 'team').map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('');
  }
  function teamXlsx() {
    var P = cur(), team = $('sh-team').value, rows = V.teamRows(P, team);
    if (rows.length < 2) { msg('sh-msg', '내보낼 항목이 없습니다.', 'warn'); return; }
    var wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = rows[0].map(function (h, i) { return { wch: i < 2 ? 12 : 16 }; });
    XLSX.utils.book_append_sheet(wb, ws, '입력');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['안내'], ['회색 머리글 그대로 두고 값 칸만 채워 주세요. 「항목ID」 열은 되돌려 받을 때 짝을 맞추는 열이니 지우지 마세요.'], ['수정시각(예: 2026-11-04 14:30)과 수정자를 적으면 병합할 때 나중 값이 이깁니다.']]), '안내');
    XLSX.writeFile(wb, P.code + '_' + (team || '전체') + '_입력.xlsx');
    msg('sh-msg', (team || '전체') + ' 입력 파일(엑셀)을 내려받았습니다. 받은 쪽이 값을 채워 보내면 아래 「되돌려 받은 파일 병합」에 올립니다.', 'ok');
  }
  function teamJson() { var P = cur(), team = $('sh-team').value; dl(P.code + '_' + (team || '전체') + '_입력.json', JSON.stringify(V.teamPack(P, team, V.stamp()), null, 1)); }
  function mergeFile(f) {
    var P = cur(); if (!P) return;
    var rd = new FileReader();
    rd.onload = function (e) {
      try {
        var pack;
        if (/\.json$/i.test(f.name)) pack = JSON.parse(new TextDecoder().decode(new Uint8Array(e.target.result)));
        else { var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' }); var sh = wb.Sheets[wb.SheetNames.indexOf('입력') >= 0 ? '입력' : wb.SheetNames[0]]; pack = V.packFromRows(XLSX.utils.sheet_to_json(sh, { defval: '', raw: false }), P); }
        var r = V.mergePack(P, pack, state.by || '병합', V.stamp());
        if (r.error) { msg('sh-msg', esc(r.error), 'warn'); return; }
        replace(r.project); renderItems(); renderStatus(); renderProjects();
        var rp = r.report, h = '<b>' + esc(f.name) + '</b> 병합 — 새로 채운 칸 ' + rp.applied.length + ' · 같은 값 ' + rp.same + ' · 내 값을 지킨 칸 ' + rp.older.length + (rp.unknown ? ' · 모르는 항목 ' + rp.unknown : '');
        if (rp.older.length) h += '<p style="margin:6px 0 0"><b>내 값을 지킨 칸</b>(받은 파일이 더 오래됐거나 시각이 없음) — 필요하면 직접 고치세요.</p><ul>' + rp.older.slice(0, 10).map(function (o) { return '<li>' + esc(o.data) + ' · ' + esc(o.col) + ': 내 값 ' + esc(o.ours) + (o.oursAt ? '(' + esc(o.oursAt.slice(5)) + ')' : '') + ' / 받은 값 ' + esc(o.theirs) + (o.theirsAt ? '(' + esc(o.theirsAt.slice(5)) + ')' : '(시각 없음)') + '</li>'; }).join('') + (rp.older.length > 10 ? '<li>외 ' + (rp.older.length - 10) + '건</li>' : '') + '</ul>';
        msg('sh-msg', h, rp.older.length ? 'warn' : 'ok');
      } catch (err) { msg('sh-msg', '파일을 읽지 못했습니다: ' + esc(err.message), 'warn'); }
    };
    rd.readAsArrayBuffer(f);
  }
  function allXlsx() {
    var P = cur(), wb = XLSX.utils.book_new();
    V.exportBook(P).forEach(function (sh) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.aoa), sh.name); });
    XLSX.writeFile(wb, P.code + '_취합본_' + V.stamp().slice(0, 10) + '.xlsx');
  }

  function renderAll() { renderTemplate(); renderProjectForm(); renderProjects(); renderFilter(); renderItems(); renderStatus(); renderShare(); }

  /* ---------- 이벤트 ---------- */
  var drop = $('t-drop');
  ['dragover', 'dragenter'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) readTemplateFile(e.dataTransfer.files[0]); });
  $('t-file').addEventListener('change', function () { if (this.files[0]) readTemplateFile(this.files[0]); this.value = ''; });
  $('btn-t-sample').addEventListener('click', function () { useTemplate(V.sampleTemplate()); });
  $('btn-p-sample').addEventListener('click', function () {
    if (!state.template) useTemplate(V.sampleTemplate());
    var S = V.sampleProject(V.stamp());
    if (state.projects.some(function (p) { return p.code === S.code; })) { state.cur = state.projects.filter(function (p) { return p.code === S.code; })[0].id; }
    else { state.projects.push(S); state.cur = S.id; }
    state.by = state.by || '가상 VPM'; save(); renderAll();
    msg('p-msg', '예제 프로젝트(가상 기종, 값 일부 입력)를 넣었습니다. 예제는 실제 사내 데이터가 아닙니다.', 'ok');
  });
  $('btn-p-create').addEventListener('click', createProject);
  $('p-list').addEventListener('click', function (e) {
    var t = e.target;
    if (t.dataset.del) { state.projects = state.projects.filter(function (p) { return p.id !== t.dataset.del; }); if (state.cur === t.dataset.del) state.cur = state.projects.length ? state.projects[0].id : ''; save(); renderAll(); return; }
    var tr = t.closest('tr[data-pick]'); if (tr) { state.cur = tr.dataset.pick; state.filter = {}; save(); renderAll(); }
  });
  ['f-sheet', 'f-team', 'f-part', 'f-status'].forEach(function (id) { $(id).addEventListener('change', function () { state.filter[id.slice(2)] = this.value; renderItems(); }); });
  $('f-q').addEventListener('input', function () { state.filter.q = this.value; renderItems(); });
  $('f-by').addEventListener('change', function () { state.by = this.value.trim(); save(); });
  $('items').addEventListener('change', function (e) { if (e.target.classList.contains('val')) onValueChange(e.target); });
  $('items').addEventListener('click', function (e) { var n = e.target.dataset.notes; if (!n) return; var sp = n.split('|'); var el = $('notes-' + V.norm(sp[0]) + '-' + sp[1]); if (el) el.hidden = !el.hidden; });
  $('st-by').addEventListener('change', renderStatus);
  $('btn-missing-copy').addEventListener('click', function () { copy($('st-missing').value, this); });
  $('btn-confirm').addEventListener('click', function () { var P = cur(); if (!P) return; replace(V.confirm(P, V.stamp())); renderAll(); msg('st-msg', '최종 확정했습니다. 이후 바뀌는 값은 이력에 「확정 후 변경」으로 표시됩니다.', 'ok'); });
  $('btn-team-xlsx').addEventListener('click', teamXlsx);
  $('btn-team-json').addEventListener('click', teamJson);
  $('sh-file').addEventListener('change', function () { if (this.files[0]) mergeFile(this.files[0]); this.value = ''; });
  $('btn-all-xlsx').addEventListener('click', allXlsx);
  $('btn-backup').addEventListener('click', function () { dl('vpd_math_load_백업_' + V.stamp().slice(0, 10) + '.json', JSON.stringify({ kind: 'vpdm-backup', template: state.template, projects: state.projects }, null, 1)); });
  $('bk-file').addEventListener('change', function () {
    var f = this.files[0]; this.value = ''; if (!f) return;
    var rd = new FileReader();
    rd.onload = function (e) {
      try { var j = JSON.parse(e.target.result); if (j.kind !== 'vpdm-backup') throw new Error('백업 파일이 아닙니다.'); state.template = j.template; state.projects = j.projects || []; state.cur = state.projects.length ? state.projects[0].id : ''; save(); renderAll(); msg('sh-msg', '백업을 불러왔습니다 — 프로젝트 ' + state.projects.length + '개.', 'ok'); }
      catch (err) { msg('sh-msg', esc(err.message), 'warn'); }
    };
    rd.readAsText(f);
  });
  renderAll();
  if (location.hash === '#example' && !state.projects.length) $('btn-p-sample').click();
})();
