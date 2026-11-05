/* VPD math & load 데이터 관리 — 엔진 (v2.0)
 *
 * 화면(app2.js)은 판정하지 않는다. 양식 읽기(어느 열이 무엇인지)·프로젝트 만들기·값 넣기·자동 계산·입력 현황·
 * 팀별 배포 파일·되돌려 받은 파일 병합·엑셀 표는 전부 여기서 만들고 test/logic.test.js 로 고정한다.
 * 브라우저(window.Vpdm)와 node(require) 양쪽에서 읽힌다.
 *
 * 지키는 것
 *   - 양식(기획자의 math & load 엑셀)은 저장소에 넣지 않는다. 화면에서 올려 읽고 이 브라우저에만 둔다. 예제 양식은 가상이다.
 *   - 값을 지어내지 않는다. 자동 계산은 양식에 적힌 수식만 따라가고, 참조 값이 비면 비워 둔다.
 *   - 병합할 때 값을 조용히 덮어쓰지 않는다. 비어 있던 칸은 채우고, 둘 다 값이 있으면 나중 것을 쓰되 보고서에 남긴다.
 *   - 바뀐 값은 누가 언제 무엇을 바꿨는지 이력으로 남는다.
 */
(function (root) {
  'use strict';

  function clean(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function norm(s) { return clean(s).replace(/[\s()·_\-/.:#]/g, '').toLowerCase(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(d) { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

  /* ---------- 양식 열 역할 — 머리글 낱말로 알아본다. 늘릴 때는 코드가 아니라 이 표를 늘린다. ---------- */
  var ROLE = {
    cat1: ['구분1', '구분'], cat2: ['구분2'], team: ['팀', '담당팀'], part: ['파트'], owner: ['담당자'],
    data: ['data', '필요data', 'data1', 'part', '항목', '항목명'], data2: ['data2', '세부'], unit: ['단위', 'unit'],
    note: ['비고', '설명', '참고'], required: ['필수값', '필수']
  };
  var ROLE_KEYS = Object.keys(ROLE);
  function roleOf(header) {
    var h = norm(header); if (!h) return null;
    for (var i = 0; i < ROLE_KEYS.length; i++) if (ROLE[ROLE_KEYS[i]].some(function (a) { return norm(a) === h; })) return ROLE_KEYS[i];
    return null;
  }
  var FIELD_LABELS = ['기종 타입', 'Grade(톤수)', '기종명', '기종코드'];
  var STOP_RE = /^(추가\s*\/\s*삭제|추가삭제)$/;

  /* ---------- 양식 읽기 ---------- */
  // sheets: [{ name, aoa }] (aoa 의 수식 셀은 '=…' 문자열). → template
  // template = { name, fields:[{label,hint}], roster:[{team,part,hint}], sheets:[{ name, blocks:[{ notes, cols:[{key,label,by}], roles:{role:colIndex}, items:[…], reference }] }], issues }
  function parseTemplate(sheets, name) {
    var T = { name: name || '양식', fields: [], roster: [], sheets: [], issues: [] };
    (sheets || []).forEach(function (sh) {
      var aoa = sh.aoa || [];
      if (isProjectSheet(aoa)) { parseProjectSheet(aoa, T); return; }
      var S = { name: sh.name, blocks: [] }, notes = [], cur = null;
      aoa.forEach(function (row, ri) {
        row = row || [];
        var cells = row.map(clean), nonEmpty = cells.filter(Boolean);
        if (!nonEmpty.length) { if (cur) { cur = null; } return; }
        if (STOP_RE.test(nonEmpty[0])) { cur = null; return; }
        var hdr = headerInfo(cells);
        if (hdr) {
          cur = { notes: notes.join('\n'), cols: [], roles: hdr.roles, items: [], headerRow: ri + 1, reference: false };
          notes = [];
          var above = aoa[ri - 1] || [];
          hdr.valueIdx.forEach(function (ci) { cur.cols.push({ key: colKey(cells[ci]), label: cells[ci], idx: ci, letter: colLetter(ci), by: inputBy(above[ci]) }); });
          cur.reference = !cur.cols.length;
          S.blocks.push(cur);
          return;
        }
        if (!cur) { notes.push(nonEmpty.join(' ')); return; }
        var item = itemFromRow(row, cells, cur, ri + 1);
        if (item) cur.items.push(item);
      });
      if (S.blocks.length) T.sheets.push(S);
      else T.issues.push('「' + sh.name + '」 시트에서 항목 표(머리글)를 찾지 못해 건너뜁니다.');
    });
    if (!T.sheets.length) T.issues.push('읽을 수 있는 항목 표가 없습니다. 구분·팀·DATA·단위 머리글이 있는 시트가 필요합니다.');
    T.counts = countTemplate(T);
    return T;
  }
  function isProjectSheet(aoa) {
    return (aoa || []).some(function (r) { return (r || []).some(function (c) { var n = norm(c); return n === norm('프로젝트 생성') || n === norm('기종코드'); }); }) &&
      !(aoa || []).some(function (r) { return headerInfo((r || []).map(clean)); });
  }
  function parseProjectSheet(aoa, T) {
    var roster = false;
    aoa.forEach(function (row) {
      var c = (row || []).map(clean), ne = c.filter(Boolean); if (!ne.length) { return; }
      var first = ne[0];
      if (/담당자\s*입력/.test(first)) { roster = true; return; }
      if (roster && c.indexOf('팀') >= 0 && c.indexOf('파트') >= 0) { roster = 'rows'; return; }
      if (roster === 'rows') { var fi = c.findIndex(Boolean); if (fi >= 0) T.roster.push({ team: c[fi], part: c[fi + 1] || '', hint: hint(c[fi + 3] || c[fi + 2]) }); return; }
      var li = c.findIndex(function (x) { return FIELD_LABELS.some(function (f) { return norm(f) === norm(x); }); });
      if (li >= 0 && !roster) T.fields.push({ label: c[li], hint: hint(c.slice(li + 1).filter(Boolean)[0]) });
    });
    if (!T.fields.length) T.fields = FIELD_LABELS.map(function (l) { return { label: l, hint: '' }; });
  }
  // 머리글 줄인가 — 「단위」와 DATA 역할이 있거나, 「구분1」과 「팀」이 있으면.
  function headerInfo(cells) {
    var roles = {}, valueIdx = [];
    cells.forEach(function (c, i) { if (!c) return; var r = roleOf(c); if (r && roles[r] == null) roles[r] = i; else if (!r) valueIdx.push(i); });
    var ok = (roles.unit != null && roles.data != null) || (roles.cat1 != null && roles.team != null && roles.cat2 != null);
    return ok ? { roles: roles, valueIdx: valueIdx } : null;
  }
  function colKey(label) { return norm(label) || 'v'; }
  function colLetter(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function colIndex(letter) { var n = 0; for (var i = 0; i < letter.length; i++) n = n * 26 + (letter.charCodeAt(i) - 64); return n - 1; }
  function inputBy(v) { var s = clean(v); if (!/입력/.test(s)) return ''; return s.replace(/입력/, '').trim() || '담당자'; }
  function hint(v) { var s = clean(v); return s.replace(/^#+\s*/, ''); }
  function itemFromRow(row, cells, blk, excelRow) {
    var r = blk.roles, get = function (role) { return r[role] != null ? cells[r[role]] : ''; };
    var data = get('data') || get('cat2');
    if (!data && !blk.cols.some(function (c) { return cells[c.idx]; })) return null;
    if (!data) return null;
    var it = { row: excelRow, cat1: get('cat1'), cat2: get('cat2'), team: get('team'), part: get('part'), ownerHint: hint(get('owner')), data: data, data2: get('data2'), unit: get('unit'), note: get('note'),
      required: /^o|필수|y/i.test(get('required')), hints: {}, formulas: {} };
    if (it.data2) it.data = it.data + ' · ' + it.data2;
    blk.cols.forEach(function (c) {
      var v = row[c.idx], s = clean(v);
      if (s.charAt(0) === '=') it.formulas[c.key] = s;
      else if (s) it.hints[c.key] = hint(s);
    });
    // 「자동입력」 글자는 값이 아니라 안내다
    Object.keys(it.hints).forEach(function (k) { if (/^자동입력$/.test(it.hints[k])) { it.hints[k] = '자동입력'; } });
    return it;
  }
  function countTemplate(T) {
    var items = 0, auto = 0, blocks = 0;
    T.sheets.forEach(function (s) { s.blocks.forEach(function (b) { blocks++; if (b.reference) return; b.items.forEach(function (it) { if (Object.keys(it.formulas).length) auto++; else items++; }); }); });
    return { sheets: T.sheets.length, blocks: blocks, items: items, auto: auto, roster: T.roster.length };
  }
  // SheetJS 시트 → aoa (수식 셀은 '=수식'). XLSX 를 넘겨받는다(엔진은 라이브러리를 들이지 않는다).
  function aoaFromSheet(ws, XLSX) {
    if (!ws || !ws['!ref']) return [];
    var rg = XLSX.utils.decode_range(ws['!ref']), out = [];
    for (var R = rg.s.r; R <= rg.e.r; R++) {
      var row = [];
      for (var C = rg.s.c; C <= rg.e.c; C++) {
        var cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        row.push(!cell ? '' : cell.f ? '=' + cell.f : cell.v == null ? '' : cell.v);
      }
      out.push(row);
    }
    return out;
  }

  /* ---------- 프로젝트 ---------- */
  // project = { id, code, name, type, grade, createdAt, confirmedAt, owners:{'팀/파트': 이름}, template:{name, sheets:[{name, blocks:[{notes, cols, reference}]}]}, items:[…], history:[…] }
  // item = { id, sheet, block, row, cat1, cat2, team, part, owner, data, unit, note, required, cols:[key], hints, formulas, values:{key: 값}, auto:{key:true}, updatedAt, updatedBy }
  function validateHeader(h, list) {
    var e = [];
    if (!clean(h.code)) e.push('기종코드를 적어 주세요.');
    else if ((list || []).some(function (p) { return norm(p.code) === norm(h.code); })) e.push('이미 있는 기종코드입니다: ' + clean(h.code));
    if (!clean(h.name)) e.push('기종명을 적어 주세요.');
    return e;
  }
  function createProject(T, h, owners, now, list) {
    var errors = validateHeader(h, list);
    if (errors.length) return { errors: errors, project: null };
    var P = { id: 'P' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), code: clean(h.code), name: clean(h.name), type: clean(h.type), grade: clean(h.grade),
      createdAt: now || stamp(), confirmedAt: '', owners: owners || {}, template: { name: T.name, sheets: [], roster: T.roster.slice() }, items: [], history: [] };
    T.sheets.forEach(function (s, si) {
      var ts = { name: s.name, blocks: [] };
      s.blocks.forEach(function (b, bi) {
        ts.blocks.push({ notes: b.notes, cols: b.cols.map(function (c) { return { key: c.key, label: c.label, letter: c.letter, by: c.by }; }), reference: b.reference });
        if (b.reference) return;
        b.items.forEach(function (it, ii) {
          var item = { id: 'S' + (si + 1) + 'B' + (bi + 1) + 'R' + (ii + 1), sheet: s.name, block: bi, row: it.row, cat1: it.cat1, cat2: it.cat2, team: it.team, part: it.part,
            owner: ownerFor(P.owners, it.team, it.part) || '', data: it.data, unit: it.unit, note: it.note, required: it.required,
            cols: b.cols.map(function (c) { return c.key; }), hints: it.hints, formulas: it.formulas, values: {}, updatedAt: '', updatedBy: '' };
          b.cols.forEach(function (c) { item.values[c.key] = ''; });
          P.items.push(item);
        });
      });
      P.template.sheets.push(ts);
    });
    return { errors: [], project: evalFormulas(P) };
  }
  function ownerFor(owners, team, part) { return owners[team + '/' + part] || owners[team + '/'] || owners[team] || ''; }
  function isAuto(item, key) { return !!(item.formulas && item.formulas[key]); }
  function inputCols(item) { return item.cols.filter(function (k) { return !isAuto(item, k); }); }
  function status(item) {
    var cols = inputCols(item); if (!cols.length) return 'auto';
    var n = cols.filter(function (k) { return clean(item.values[k]) !== ''; }).length;
    return n === 0 ? 'empty' : n === cols.length ? 'done' : 'partial';
  }
  var STATUS_LABEL = { empty: '미입력', partial: '일부', done: '입력 완료', auto: '자동 계산' };
  function clone(P) { return JSON.parse(JSON.stringify(P)); }
  // 값 넣기 — 새 프로젝트를 돌려준다(원본은 그대로). 같은 값이면 아무것도 바꾸지 않는다.
  function setValue(P, itemId, key, value, by, now) {
    var Q = clone(P), it = Q.items.filter(function (x) { return x.id === itemId; })[0];
    if (!it) return { project: P, error: '모르는 항목: ' + itemId };
    if (it.cols.indexOf(key) < 0) return { project: P, error: '모르는 칸: ' + key };
    if (isAuto(it, key)) return { project: P, error: '자동 계산 칸은 직접 넣지 않습니다.' };
    var v = clean(value), old = clean(it.values[key]);
    if (v === old) return { project: P, changed: false };
    var warn = '';
    if (v && it.unit && !/^(name|type)/i.test(it.data) && isNaN(parseNum(v))) warn = '「' + it.data + '」 ' + key + ' 칸은 단위(' + it.unit + ')가 있는 수치 칸인데 숫자가 아닙니다: ' + v;
    it.values[key] = v; it.updatedAt = now || stamp(); it.updatedBy = clean(by);
    Q.history.unshift({ at: it.updatedAt, by: it.updatedBy, item: it.id, data: it.data, sheet: it.sheet, col: key, from: old, to: v, afterConfirm: !!Q.confirmedAt });
    if (Q.history.length > 500) Q.history.length = 500;
    return { project: evalFormulas(Q), changed: true, warn: warn };
  }
  function parseNum(v) { var s = clean(v).replace(/,/g, ''); if (!s) return NaN; return /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s) ? Number(s) : NaN; }
  function confirm(P, now) { var Q = clone(P); Q.confirmedAt = now || stamp(); Q.history.unshift({ at: Q.confirmedAt, by: '', item: '', data: '(최종 확정)', sheet: '', col: '', from: '', to: '', afterConfirm: false }); return Q; }
  function setOwners(P, owners) { var Q = clone(P); Q.owners = owners || {}; Q.items.forEach(function (it) { it.owner = ownerFor(Q.owners, it.team, it.part) || it.owner; }); return Q; }

  /* ---------- 자동 계산 — 양식에 적힌 수식만 따라간다 ---------- */
  // 허용: 숫자 · 셀 참조(I4) · + - * / ( ) , · IF(a=b, x, y) · "글자". 그 밖은 「수식 미지원」.
  var TOKEN_RE = /^(?:\s|\d+(?:\.\d+)?|[A-Z]{1,2}\d{1,4}|[-+*\/(),]|IF\(|"[^"]*"|=|<>|<=|>=|<|>)+$/;
  function evalFormula(expr, lookup) {
    var f = String(expr || '').replace(/^=/, '').trim();
    if (!TOKEN_RE.test(f)) return { value: null, error: '수식 미지원' };
    var missing = false, refs = [];
    var js = f.replace(/"([^"]*)"/g, function (m, s) { return JSON.stringify(s); })
      .replace(/\bIF\(/g, '_IF(')
      .replace(/([A-Z]{1,2})(\d{1,4})/g, function (m, col, row) {
        var v = lookup(col, +row); refs.push(col + row);
        if (v === undefined) { missing = true; return 'null'; }
        return typeof v === 'number' ? '(' + v + ')' : JSON.stringify(v);
      })
      .replace(/<>/g, '!=').replace(/(^|[^<>!=])=([^=])/g, '$1==$2');
    if (missing) return { value: null, error: '', waiting: true, refs: refs };
    try {
      var out = new Function('_IF', 'return (' + js + ');')(function (c, a, b) { return c ? a : b; });
      if (typeof out === 'number' && isFinite(out)) return { value: Math.round(out * 1e6) / 1e6, refs: refs };
      if (typeof out === 'number') return { value: null, error: '0 으로 나눔', refs: refs };
      return { value: out, refs: refs };
    } catch (e) { return { value: null, error: '수식 오류' }; }
  }
  function evalFormulas(P) {
    var bySheet = {};
    P.items.forEach(function (it) { (bySheet[it.sheet] = bySheet[it.sheet] || []).push(it); });
    P.items.forEach(function (it) { it.auto = {}; it.autoNote = {}; });
    // 참조는 같은 시트 안, 열 글자 → 그 블록의 값 칸, 줄 번호 → 항목의 엑셀 줄
    for (var pass = 0; pass < 4; pass++) {
      P.items.forEach(function (it) {
        Object.keys(it.formulas || {}).forEach(function (key) {
          var r = evalFormula(it.formulas[key], function (col, row) {
            var tgt = bySheet[it.sheet].filter(function (x) { return x.row === row; })[0]; if (!tgt) return undefined;
            var blk = P.template.sheets.filter(function (s) { return s.name === it.sheet; })[0].blocks[tgt.block];
            var c = blk.cols.filter(function (x) { return x.letter === col; })[0]; if (!c) return undefined;
            var v = tgt.values[c.key]; if (clean(v) === '') return undefined;
            var n = parseNum(v); return isNaN(n) ? clean(v) : n;
          });
          it.values[key] = r.value == null ? '' : String(r.value);
          it.auto[key] = true; it.autoNote[key] = r.error || (r.waiting ? '참조 값 대기' : '');
        });
      });
    }
    return P;
  }

  /* ---------- 현황 ---------- */
  var BY = { team: '팀', sheet: '시트', part: '파트', owner: '담당자' };
  function progress(P, by) {
    by = BY[by] ? by : 'team';
    var g = {}, tot = { key: '전체', total: 0, done: 0, partial: 0, empty: 0, auto: 0, required: 0, requiredDone: 0 };
    P.items.forEach(function (it) {
      var st = status(it), k = it[by] || '(미지정)', o = g[k] || (g[k] = { key: k, total: 0, done: 0, partial: 0, empty: 0, auto: 0, required: 0, requiredDone: 0 });
      [o, tot].forEach(function (x) {
        if (st === 'auto') { x.auto++; return; }
        x.total++; x[st]++;
        if (it.required) { x.required++; if (st === 'done') x.requiredDone++; }
      });
    });
    var rows = Object.keys(g).map(function (k) { var o = g[k]; o.pct = o.total ? o.done / o.total : null; return o; }).sort(function (a, b) { return (a.pct || 0) - (b.pct || 0) || a.key.localeCompare(b.key, 'ko'); });
    tot.pct = tot.total ? tot.done / tot.total : null;
    return { by: by, byLabel: BY[by], rows: rows, total: tot };
  }
  function missing(P, team) {
    return P.items.filter(function (it) { var st = status(it); return st !== 'done' && st !== 'auto' && (!team || it.team === team); })
      .map(function (it) { return { id: it.id, sheet: it.sheet, team: it.team, part: it.part, owner: it.owner, data: it.data, unit: it.unit, status: status(it), required: it.required, emptyCols: inputCols(it).filter(function (k) { return clean(it.values[k]) === ''; }) }; });
  }
  // 독촉용 글 — 팀마다 한 묶음
  function missingText(P) {
    var m = missing(P), byTeam = {};
    m.forEach(function (x) { (byTeam[x.team || '(미지정)'] = byTeam[x.team || '(미지정)'] || []).push(x); });
    var lines = ['[' + P.code + ' ' + P.name + '] 미입력 항목 ' + m.length + '건 (' + stamp().slice(0, 10) + ')'];
    Object.keys(byTeam).sort(function (a, b) { return a.localeCompare(b, 'ko'); }).forEach(function (t) {
      lines.push('');
      lines.push('■ ' + t + (byTeam[t][0].owner ? ' (' + byTeam[t][0].owner + ')' : '') + ' — ' + byTeam[t].length + '건');
      byTeam[t].forEach(function (x) { lines.push('  - [' + x.sheet + '] ' + x.data + (x.unit ? ' (' + x.unit + ')' : '') + (x.status === 'partial' ? ' · 일부 입력' : '') + (x.required ? ' · 필수' : '')); });
    });
    return lines.join('\n');
  }
  function filterItems(P, f) {
    f = f || {};
    return P.items.filter(function (it) {
      if (f.sheet && it.sheet !== f.sheet) return false;
      if (f.team && it.team !== f.team) return false;
      if (f.part && it.part !== f.part) return false;
      if (f.status && status(it) !== f.status) return false;
      if (f.q) { var q = norm(f.q); if (norm(it.data + it.cat2 + it.note).indexOf(q) < 0) return false; }
      return true;
    });
  }
  function valuesOf(P, key) { var s = {}; P.items.forEach(function (it) { if (it[key]) s[it[key]] = 1; }); return Object.keys(s).sort(function (a, b) { return a.localeCompare(b, 'ko'); }); }

  /* ---------- 배포(팀별)·병합 ---------- */
  var PACK_KIND = 'vpd-team-pack';
  function teamPack(P, team, now) {
    var items = P.items.filter(function (it) { return (!team || it.team === team) && status(it) !== 'auto'; });
    return { kind: PACK_KIND, project: { id: P.id, code: P.code, name: P.name }, team: team || '', exportedAt: now || stamp(),
      items: items.map(function (it) { return { id: it.id, sheet: it.sheet, data: it.data, unit: it.unit, cols: inputCols(it), values: pick(it.values, inputCols(it)), updatedAt: it.updatedAt, updatedBy: it.updatedBy }; }) };
  }
  function pick(o, keys) { var r = {}; keys.forEach(function (k) { r[k] = o[k]; }); return r; }
  // 팀 배포 엑셀 — 항목ID 열이 있어 되돌려 받을 때 짝을 맞춘다
  function teamRows(P, team) {
    var pk = teamPack(P, team), colKeys = {}, order = [];
    pk.items.forEach(function (it) { it.cols.forEach(function (k) { if (!colKeys[k]) { colKeys[k] = labelOf(P, it, k); order.push(k); } }); });
    var head = ['항목ID', '시트', '구분2', '팀', '파트', '담당자', 'DATA', '단위'].concat(order.map(function (k) { return colKeys[k]; }), ['비고', '수정시각', '수정자']);
    return [head].concat(pk.items.map(function (it) {
      var src = P.items.filter(function (x) { return x.id === it.id; })[0];
      return [it.id, it.sheet, src.cat2, src.team, src.part, src.owner, it.data, it.unit].concat(order.map(function (k) { return it.cols.indexOf(k) >= 0 ? it.values[k] : ''; }), [src.note, it.updatedAt, it.updatedBy]);
    }));
  }
  function labelOf(P, it, key) {
    var sh = P.template.sheets.filter(function (s) { return s.name === it.sheet; })[0]; if (!sh) return key;
    var src = P.items.filter(function (x) { return x.id === it.id; })[0], blk = sh.blocks[src ? src.block : 0];
    var c = blk && blk.cols.filter(function (x) { return x.key === key; })[0]; return c ? c.label : key;
  }
  // 되돌려 받은 엑셀 줄(sheet_to_json) → pack. 항목ID 로 짝을 맞춘다. 열 이름은 라벨(또는 key)로 받는다.
  function packFromRows(rows, P) {
    var items = [], unknown = 0;
    (rows || []).forEach(function (r) {
      var id = clean(r['항목ID'] || r.id); if (!id) return;
      var src = P.items.filter(function (x) { return x.id === id; })[0]; if (!src) { unknown++; return; }
      var vals = {}; inputCols(src).forEach(function (k) { var lab = labelOf(P, src, k); var v = r[lab] != null ? r[lab] : r[k]; if (v != null && clean(v) !== '') vals[k] = clean(v); });
      items.push({ id: id, values: vals, updatedAt: clean(r['수정시각'] || r.updatedAt), updatedBy: clean(r['수정자'] || r.updatedBy) });
    });
    return { kind: PACK_KIND, project: { code: P.code }, items: items, unknown: unknown };
  }
  // 병합 — 비어 있던 칸은 채운다 · 같으면 넘긴다 · 다르면 나중에 고친 쪽을 쓰되 보고서에 남긴다(받은 쪽 시각이 없으면 내 값을 지킨다)
  function mergePack(P, pack, by, now) {
    var rep = { applied: [], same: 0, older: [], unknown: 0, wrongProject: false };
    if (!pack || pack.kind !== PACK_KIND) return { project: P, report: rep, error: '팀 배포 파일이 아닙니다.' };
    if (pack.project && pack.project.code && norm(pack.project.code) !== norm(P.code)) { rep.wrongProject = true; return { project: P, report: rep, error: '다른 프로젝트의 파일입니다: ' + pack.project.code }; }
    var Q = clone(P); now = now || stamp();
    (pack.items || []).forEach(function (pi) {
      var it = Q.items.filter(function (x) { return x.id === pi.id; })[0]; if (!it) { rep.unknown++; return; }
      Object.keys(pi.values || {}).forEach(function (k) {
        if (it.cols.indexOf(k) < 0 || isAuto(it, k)) return;
        var v = clean(pi.values[k]), old = clean(it.values[k]);
        if (!v) return;
        if (v === old) { rep.same++; return; }
        var theirs = pi.updatedAt || '', ours = it.updatedAt || '';
        if (old && theirs && ours && theirs <= ours) { rep.older.push({ id: it.id, data: it.data, col: k, ours: old, theirs: v, oursAt: ours, theirsAt: theirs }); return; }
        if (old && !theirs) { rep.older.push({ id: it.id, data: it.data, col: k, ours: old, theirs: v, oursAt: ours, theirsAt: '' }); return; }
        it.values[k] = v; it.updatedAt = theirs || now; it.updatedBy = pi.updatedBy || by || '';
        Q.history.unshift({ at: now, by: by || '', item: it.id, data: it.data, sheet: it.sheet, col: k, from: old, to: v, merged: true, mergedFrom: pi.updatedBy || pack.team || '', afterConfirm: !!Q.confirmedAt });
        rep.applied.push({ id: it.id, data: it.data, col: k, from: old, to: v });
      });
    });
    rep.unknown += pack.unknown || 0;
    return { project: evalFormulas(Q), report: rep };
  }

  /* ---------- 엑셀 표(취합본) ---------- */
  function exportBook(P) {
    var out = [];
    var head = [['프로젝트'], ['기종코드', P.code], ['기종명', P.name], ['기종 타입', P.type], ['Grade(톤수)', P.grade], ['생성일', P.createdAt], ['최종확정일', P.confirmedAt || '(미확정)'], ['양식', P.template.name], [], ['팀', '파트', '담당자']];
    Object.keys(P.owners).forEach(function (k) { var sp = k.split('/'); head.push([sp[0], sp[1] || '', P.owners[k]]); });
    var pr = progress(P, 'team');
    head.push([], ['입력 현황', '전체 ' + pr.total.total + '건 · 완료 ' + pr.total.done + ' · 일부 ' + pr.total.partial + ' · 미입력 ' + pr.total.empty + ' · 자동 계산 ' + pr.total.auto]);
    out.push({ name: '프로젝트', aoa: head });
    P.template.sheets.forEach(function (s) {
      var aoa = [];
      s.blocks.forEach(function (b, bi) {
        if (b.notes) b.notes.split('\n').forEach(function (n) { aoa.push([n]); });
        if (b.reference) { aoa.push(['(참고 표 — 값 칸 없음)']); aoa.push([]); return; }
        aoa.push(['구분1', '구분2', '팀', '파트', '담당자', 'DATA', '단위'].concat(b.cols.map(function (c) { return c.label; }), ['비고', '상태', '항목ID']));
        P.items.filter(function (it) { return it.sheet === s.name && it.block === bi; }).forEach(function (it) {
          aoa.push([it.cat1, it.cat2, it.team, it.part, it.owner, it.data, it.unit].concat(b.cols.map(function (c) { var v = it.values[c.key]; var n = parseNum(v); return isNaN(n) ? v : n; }), [it.note, STATUS_LABEL[status(it)], it.id]));
        });
        aoa.push([]);
      });
      out.push({ name: sheetName(s.name), aoa: aoa });
    });
    out.push({ name: '현황', aoa: [['팀', '전체', '입력 완료', '일부', '미입력', '입력률(%)', '필수', '필수 완료']].concat(pr.rows.map(function (r) { return [r.key, r.total, r.done, r.partial, r.empty, r.pct == null ? '' : Math.round(r.pct * 1000) / 10, r.required, r.requiredDone]; }), [['전체', pr.total.total, pr.total.done, pr.total.partial, pr.total.empty, pr.total.pct == null ? '' : Math.round(pr.total.pct * 1000) / 10, pr.total.required, pr.total.requiredDone]]) });
    out.push({ name: '이력', aoa: [['시각', '작업자', '시트', '항목', '칸', '이전', '이후', '병합', '확정 후']].concat(P.history.map(function (h) { return [h.at, h.by, h.sheet, h.data, h.col, h.from, h.to, h.merged ? '병합(' + (h.mergedFrom || '') + ')' : '', h.afterConfirm ? '확정 후 변경' : '']; })) });
    return out;
  }
  function sheetName(n) { return clean(n).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31) || '시트'; }

  /* ---------- 예제 양식(가상 — 실제 사내 양식이 아닙니다) ---------- */
  function sampleSheets() {
    var proj = [
      ['', '1 프로젝트 생성', '입력값', '', '', '', '(생성일, 최종확정일)'],
      ['', '기종 타입', '', '#굴착기, 휠로더'], ['', 'Grade(톤수)', '', '#5t, 10t'], ['', '기종명', '', '## 가상 기종명'], ['', '기종코드', '', '## 가상코드'],
      [], ['', '2 담당자 입력'], ['', '팀', '파트', '입력값', '설명'],
      ['', 'VPD기획팀', 'VPM', '', '#홍길동'], ['', '기획', 'PM'], ['', 'PTI', '동력'], ['', 'PTI', '냉각공조'], ['', '유압', ''], ['', '구조', '프레임'], ['', '구조', '작업장치'], ['', '의장', '캐빈'], ['', '의장', '익스테리어'], ['', '전장', '']
    ];
    var ex = [
      ['', '', 'VPM입력', '', '', 'VPM입력', 'VPM입력', 'VPM입력', 'VPM입력', 'VPM입력', '담당자 입력'],
      ['', '구분1', '구분2', '팀', '파트', '담당자', '구분3', 'Bucket', 'Arm', 'Boom', 'CWT', 'Excalc2D No.'],
      ['', 'Excalc2D', 'Front', '자동입력', '자동입력', '홍길동', '2PC', '6.5', '2.4', '3.2', '6200', '#4201'],
      ['', 'Excalc2D', 'Main Frame'], ['', 'Excalc2D', 'Track frame'], ['', '추가/삭제']
    ];
    var inp = [
      ['', '', '', '', '', '', '', '', '담당자 입력'],
      ['', '구분1', '구분2', '팀', '파트', '담당자', 'DATA', '단위', '입력', '비고'],
      ['', 'SnD', 'Front', '유압', '', '', '이론 스윙토크', 'kN.m', '', '이론치 100%'],
      ['', 'SnD', 'Track Frame', '유압', '', '', '견인력', 'N', '', '이론치 100%'],
      ['', 'SnD', 'Track Frame', '구조', '작업장치', '', 'Max.Reach Tipping Load', 'N', '', 'Excalc2D 값으로 등록'],
      ['', 'SnD', 'Main Frame', '구조', '프레임', '', 'Front Acceleration', 'G', '', '측정치 없으면 표준 참고치'],
      ['', '추가/삭제']
    ];
    var cyl = [
      ['', '', '', '', '', '', '', '', '담당자 입력', '담당자 입력', '담당자 입력'],
      ['', '구분1', '구분2', '팀', '파트', '담당자', 'DATA', '단위', 'Tube ID', 'Rod OD', 'Stroke', '비고'],
      ['', 'SnD', 'Front', '구조', '프레임', '', 'Boom swing cylinder', 'mm', '', '', '', 'Boom swing 사양인 경우'],
      ['', 'SnD', 'Track Frame', '구조', '프레임', '', 'Dozer cylinder', 'mm', '', '', '', 'Dozer 사양인 경우'],
      ['', '추가/삭제']
    ];
    var nvh = [
      ['', '', '', '', '', '', '', '', '담당자 입력'],
      ['', '구분', '팀', '파트', '담당자', '구분', '필요 Data', '단위', '값'],                 // 2행
      ['', 'NVH', 'PTI', '동력', '', 'E/G', 'Name', '', ''],                              // 3
      ['', 'NVH', 'PTI', '동력', '', 'E/G', 'Low idle', 'rpm', ''],                       // 4
      ['', 'NVH', 'PTI', '동력', '', 'E/G', 'High idle', 'rpm', ''],                      // 5
      ['', 'NVH', 'PTI', '동력', '', 'E/G', 'Cylinder #', '', ''],                        // 6
      ['', 'NVH', 'PTI', '동력', '', 'E/G', 'Low Idle freq. (firing)', 'Hz', '=I4/60*I6/2', '#수식으로 자동 계산'],   // 7
      ['', 'NVH', 'PTI', '동력', '', 'E/G', 'High Idle freq. (firing)', 'Hz', '=I5/60*I6/2', '#수식으로 자동 계산'],  // 8
      ['', 'NVH', 'PTI', '동력', '', 'E/G', 'Upper limit target (1.2)', 'Hz', '=I8*1.2', '#수식으로 자동 계산'],    // 9
      ['', 'NVH', 'PTI', '냉각공조', '', 'Fan', 'Type (Direct/Clutch/Hyd)', '', ''],       // 10
      ['', 'NVH', 'PTI', '냉각공조', '', 'Fan', 'Max rpm', 'rpm', ''],                     // 11
      ['', 'NVH', 'PTI', '냉각공조', '', 'Fan', 'Blade #', '', ''],                        // 12
      ['', 'NVH', 'PTI', '냉각공조', '', 'Fan', '1st order @ max', 'Hz', '=I11/60', '#수식으로 자동 계산'],         // 13
      ['', 'NVH', 'PTI', '냉각공조', '', 'Fan', '1st BPF @ max', 'Hz', '=I13*I12*IF(I10="D",1,0.9)', '#수식으로 자동 계산'] // 14
    ];
    var mass = [
      ['', '참고 사항'], ['', '1) Main Frame 해석에 쓸 장착 부품 질량과 무게중심(COG)을 적습니다.'], ['', '2) 모델 중심 좌표 기준.'],
      ['', '', '', '', '', '', '', '', '', 'COG (mm)'],
      ['', '구분1', '구분2', '팀', '파트', '담당자', 'DATA', '단위', 'Mass', 'X', 'Y', 'Z', '설명'],
      ['', '', 'Main Frame', '의장', '캐빈', '', 'Cabin Total', 'kg', '', '', '', '', 'Cabin 에 장착된 모든 부품'],
      ['', '', 'Main Frame', 'PTI', '동력', '', 'Engine Total', 'kg', '', '', '', '', 'Engine 에 장착된 모든 부품'],
      ['', '', 'Main Frame', '유압', '', '', 'MCV Assy', 'kg'],
      ['', '', 'Main Frame', '구조', '프레임', '', 'Counterweight', 'kg'],
      ['', '추가/삭제'], [],
      ['', '참고 사항'], ['', '1) Support 해석에 쓸 장착 부품.'],
      ['', '구분1', '구분2', '팀', '파트', '담당자', 'DATA', '단위', 'Mass', 'X', 'Y', 'Z', '설명'],
      ['', '', 'Support', 'PTI', '동력', '', 'Air Cleaner Assy', 'kg'],
      ['', '', 'Support', 'PTI', '냉각공조', '', 'Surge Tank Assy (Wet)', 'kg'],
      ['', '추가/삭제']
    ];
    var add = [
      ['', '구분1', '구분2', '팀', '파트', '담당자', 'DATA1', 'DATA2', '단위', '입력 값', '설명'],
      ['', 'Oil', 'Main Frame', '의장', '익스테리어', '', 'Fuel', 'Mass', 'kg', '', 'Fuel Tank 만충 기준'],
      ['', 'Oil', 'Main Frame', '의장', '익스테리어', '', 'Fuel', '유체높이', 'mm', '', 'Fuel Tank 만충 기준'],
      ['', '추가/삭제'],
      ['', '구분1', '구분2', '팀', '파트', '담당자', 'DATA1', 'DATA2', '단위', '입력값', '설명'],
      ['', 'MOI', 'Main Frame', '구조', '프레임', '', 'CWT MOI', 'Ixx', 'kg·m2', ''],
      ['', 'MOI', 'Main Frame', '구조', '프레임', '', 'CWT MOI', 'Iyy', 'kg·m2', ''],
      ['', '추가/삭제']
    ];
    var ref = [
      ['', '구분', '팀', '파트', '담당자', '필수 값', 'Data', '단위', '설명'],
      ['', 'Main Frame', '의장', '캐빈', '', 'O', 'Cabin Total', 'kg', '프레임 기준으로 Cabin 에 장착된 모든 부품'],
      ['', 'Main Frame', 'PTI', '동력', '', 'O', 'Engine Total', 'kg', '']
    ];
    return [{ name: '프로젝트 생성', aoa: proj }, { name: 'Excalc2D', aoa: ex }, { name: 'Input_필요 데이터', aoa: inp }, { name: 'Input_실린더 정보', aoa: cyl }, { name: 'Input(NVH)', aoa: nvh }, { name: 'Mass', aoa: mass }, { name: 'Mass(추가 데이터)', aoa: add }, { name: 'Mass(Back up)', aoa: ref }];
  }
  function sampleTemplate() { return parseTemplate(sampleSheets(), '예제 양식(가상)'); }
  function sampleProject(now) {
    now = now || '2026-11-04 09:00';
    var T = sampleTemplate();
    var P = createProject(T, { code: 'GS-EX120(가상)', name: '가상 12톤 굴착기', type: '굴착기', grade: '12t' }, { 'VPD기획팀/VPM': '가상 VPM', 'PTI/동력': '가상 동력담당', '유압/': '가상 유압담당', '구조/프레임': '가상 프레임담당' }, now, []).project;
    var fill = [['Input(NVH)', 'Low idle', '값', '900', '가상 동력담당'], ['Input(NVH)', 'High idle', '값', '2200', '가상 동력담당'], ['Input(NVH)', 'Cylinder #', '값', '4', '가상 동력담당'], ['Input(NVH)', 'Name', '값', 'D34-가상', '가상 동력담당'],
      ['Input(NVH)', 'Max rpm', '값', '1800', '가상 냉각담당'], ['Input(NVH)', 'Blade #', '값', '9', '가상 냉각담당'], ['Input(NVH)', 'Type (Direct/Clutch/Hyd)', '값', 'D', '가상 냉각담당'],
      ['Input_필요 데이터', '이론 스윙토크', '입력', '38.5', '가상 유압담당'], ['Mass', 'Engine Total', 'Mass', '620', '가상 동력담당'], ['Mass', 'Engine Total', 'X', '1250', '가상 동력담당'], ['Mass', 'Engine Total', 'Y', '-310', '가상 동력담당'],
      ['Excalc2D', 'Front', '구분3', '2PC', '가상 VPM'], ['Excalc2D', 'Front', 'Bucket', '0.5', '가상 VPM']];
    fill.forEach(function (f, i) {
      var it = P.items.filter(function (x) { return x.sheet === f[0] && x.data === f[1]; })[0];
      var key = it.cols.filter(function (k) { return norm(labelOf(P, it, k)) === norm(f[2]); })[0];
      P = setValue(P, it.id, key, f[3], f[4], '2026-11-04 ' + pad2(9 + Math.floor(i / 4)) + ':' + pad2((i * 7) % 60)).project;
    });
    return P;
  }

  var api = {
    ROLE: ROLE, FIELD_LABELS: FIELD_LABELS, STATUS_LABEL: STATUS_LABEL, BY: BY, PACK_KIND: PACK_KIND,
    clean: clean, norm: norm, stamp: stamp, roleOf: roleOf, headerInfo: headerInfo, colLetter: colLetter, colIndex: colIndex, parseNum: parseNum,
    parseTemplate: parseTemplate, aoaFromSheet: aoaFromSheet, countTemplate: countTemplate,
    validateHeader: validateHeader, createProject: createProject, setValue: setValue, confirm: confirm, setOwners: setOwners, status: status, inputCols: inputCols, isAuto: isAuto,
    evalFormula: evalFormula, evalFormulas: evalFormulas,
    progress: progress, missing: missing, missingText: missingText, filterItems: filterItems, valuesOf: valuesOf, labelOf: labelOf,
    teamPack: teamPack, teamRows: teamRows, packFromRows: packFromRows, mergePack: mergePack, exportBook: exportBook,
    sampleSheets: sampleSheets, sampleTemplate: sampleTemplate, sampleProject: sampleProject
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Vpdm = api;
})(this);
