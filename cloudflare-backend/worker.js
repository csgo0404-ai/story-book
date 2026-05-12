const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

const ok = (data) => json({ ok: true, ...(data !== undefined ? { data } : {}) });
const okRaw = (extra) => json({ ok: true, ...extra });
const fail = (error, status = 200) => json({ ok: false, error }, status);

const WORK_FIELDS = [
  'id','studentNum','studentName','status','characterName','personality',
  'storyPlace','storyTime','goal','obstacle','helper','process','lesson','ending','structure','story',
  'coverUrl','storyTitle','message','createdAt','updatedAt'
];

let _workExtraColumnsReady = false;
async function ensureWorkExtraColumns(env) {
  if (_workExtraColumnsReady) return;
  for (const col of ['storyPlace','storyTime','lesson','storyTitle']) {
    try { await env.DB.prepare(`ALTER TABLE works ADD COLUMN ${col} TEXT`).run(); } catch (e) {}
  }
  _workExtraColumnsReady = true;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    let action, params;

    if (request.method === 'GET') {
      action = url.searchParams.get('action');
      params = Object.fromEntries(url.searchParams);
    } else if (request.method === 'POST') {
      try {
        const body = await request.text();
        params = body ? JSON.parse(body) : {};
        action = params.action;
      } catch {
        return fail('잘못된 요청 형식');
      }
    } else {
      return fail('지원하지 않는 메서드');
    }

    try {
      switch (action) {
        case 'getWorks':       return await getWorks(env);
        case 'getSubmittedDigest': return await getSubmittedDigest(env);
        case 'getStudentUnreadDigest': return await getStudentUnreadDigest(env, params);
        case 'saveWork':       return await saveWork(env, params);
        case 'deleteWork':     return await deleteWork(env, params);
        case 'setWorkStatus':  return await setWorkStatus(env, params);
        case 'clearAllWorks':  return await clearAllWorks(env, params);
        case 'getStudents':    return await getStudents(env);
        case 'addStudents':    return await addStudents(env, params);
        case 'deleteStudent':  return await deleteStudent(env, params);
        case 'loginStudent':   return await loginStudent(env, params);
        case 'getCovers':      return await getCovers(env, params);
        case 'addCover':       return await addCover(env, params);
        case 'deleteCover':    return await deleteCover(env, params);
        case 'destroyCloudinary': return await destroyCloudinary(env, params);
        case 'setCoverStatus': return await setCoverStatus(env, params);
        case 'setCoverRole':   return await setCoverRole(env, params);
        case 'markCoverRead':  return await markCoverRead(env, params);
        case 'getOptions':     return await getOptions(env);
        case 'setOptions':     return await setOptions(env, params);
        case 'clearAllCovers': return await clearAllCovers(env, params);
        case 'aiFeedback':     return await aiFeedback(env, params);
        case 'getAIUsage':     return await getAIUsage(env, params);
        case 'markRead':       return await markRead(env, params);
        case 'getWorkAIInfo':  return await getWorkAIInfo(env, params);
        case 'getExamplesAll': return await getExamplesAll(env);
        case 'addExample':     return await addExample(env, params);
        case 'deleteExampleD1':return await deleteExampleD1(env, params);
        case 'updateExample':  return await updateExample(env, params);
        case 'reorderExamples':return await reorderExamples(env, params);
        case 'aiCustom':       return await aiCustom(env, params);
        case 'getStudentAIUsage': return await getStudentAIUsage(env, params);
        case 'resetStudentAI': return await resetStudentAI(env, params);
        default:               return fail('알 수 없는 action: ' + action);
      }
    } catch (e) {
      return fail('서버 오류: ' + (e.message || String(e)));
    }
  }
};

function checkPw(env, pw) {
  return pw && pw === env.TEACHER_PW;
}

async function getWorks(env) {
  await ensureWorkExtraColumns(env);
  const { results } = await env.DB.prepare(
    'SELECT * FROM works ORDER BY updatedAt DESC'
  ).all();
  return ok(results || []);
}

// 폴링용 가벼운 digest — 제출/반려/승인/완료 상태 작품의 개수와 최신 updatedAt만 반환
async function getSubmittedDigest(env) {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt, MAX(updatedAt) AS latest FROM works WHERE status IN ('제출됨','반려됨','승인됨','완료')"
  ).first();
  return okRaw({ cnt: (r && r.cnt) || 0, latest: (r && r.latest) || '' });
}

// 학생 폴링용 — 본인 unread 알림 개수만 가벼운 응답 (작품 + 표지)
async function getStudentUnreadDigest(env, { studentNum, studentName }) {
  if (!studentNum || !studentName) return fail('학생 정보 누락');
  const w = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM works WHERE studentNum = ? AND studentName = ? AND unreadByStudent = 1 AND status IN ('반려됨','승인됨')"
  ).bind(studentNum, studentName).first();
  const c = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM covers WHERE studentNum = ? AND studentName = ? AND unreadByStudent = 1 AND status IN ('반려됨','승인됨')"
  ).bind(studentNum, studentName).first();
  return okRaw({ cnt: ((w && w.cnt) || 0) + ((c && c.cnt) || 0) });
}

async function saveWork(env, { work }) {
  if (!work || !work.id) return fail('work.id 누락');
  await ensureWorkExtraColumns(env);
  const cols = WORK_FIELDS.join(',');
  const placeholders = WORK_FIELDS.map(() => '?').join(',');
  const updates = WORK_FIELDS.filter(f => f !== 'id').map(f => `${f}=excluded.${f}`).join(',');
  const values = WORK_FIELDS.map(f => work[f] ?? '');
  await env.DB.prepare(
    `INSERT INTO works (${cols}) VALUES (${placeholders})
     ON CONFLICT(id) DO UPDATE SET ${updates}`
  ).bind(...values).run();
  return ok();
}

async function deleteWork(env, { id }) {
  if (!id) return fail('id 누락');
  await env.DB.prepare('DELETE FROM works WHERE id = ?').bind(id).run();
  return ok();
}

async function setWorkStatus(env, { id, status, message, teacherPw }) {
  if (!checkPw(env, teacherPw)) return fail('교사 비밀번호가 올바르지 않습니다.');
  if (!id || !status) return fail('id/status 누락');
  const now = new Date().toLocaleDateString('ko-KR');
  const unread = (status === '반려됨' || status === '승인됨' || message) ? 1 : 0;
  await env.DB.prepare(
    'UPDATE works SET status = ?, message = ?, updatedAt = ?, unreadByStudent = ? WHERE id = ?'
  ).bind(status, message || '', now, unread, id).run();
  return ok();
}

async function clearAllWorks(env, { teacherPw }) {
  if (!checkPw(env, teacherPw)) return fail('교사 비밀번호가 올바르지 않습니다.');
  await env.DB.prepare('DELETE FROM works').run();
  return ok();
}

async function getStudents(env) {
  const { results } = await env.DB.prepare(
    'SELECT num, name, code FROM students ORDER BY num'
  ).all();
  return ok(results || []);
}

async function addStudents(env, { students, teacherPw }) {
  if (!checkPw(env, teacherPw)) return fail('교사 비밀번호가 올바르지 않습니다.');
  if (!Array.isArray(students) || !students.length) return fail('학생 목록 없음');

  const existing = await env.DB.prepare('SELECT code FROM students').all();
  const existingCodes = new Set((existing.results || []).map(r => r.code));

  let added = 0, skipped = 0;
  const stmts = [];
  for (const s of students) {
    if (!s.code) { skipped++; continue; }
    if (existingCodes.has(s.code)) { skipped++; continue; }
    existingCodes.add(s.code);
    stmts.push(
      env.DB.prepare('INSERT INTO students (code, num, name) VALUES (?, ?, ?)')
        .bind(s.code, s.num || '', s.name || '')
    );
    added++;
  }
  if (stmts.length) await env.DB.batch(stmts);
  return okRaw({ added, skipped });
}

async function deleteStudent(env, { code, teacherPw }) {
  if (!checkPw(env, teacherPw)) return fail('교사 비밀번호가 올바르지 않습니다.');
  if (!code) return fail('code 누락');
  await env.DB.prepare('DELETE FROM students WHERE code = ?').bind(code).run();
  return ok();
}

let _coverRoleColumnReady = false;
async function ensureCoverRoleColumn(env) {
  if (_coverRoleColumnReady) return;
  try {
    await env.DB.prepare('ALTER TABLE covers ADD COLUMN coverRole TEXT').run();
  } catch (e) { /* already exists */ }
  _coverRoleColumnReady = true;
}

async function getCovers(env, { workId }) {
  await ensureCoverRoleColumn(env);
  let q;
  if (workId) {
    q = env.DB.prepare('SELECT * FROM covers WHERE workId = ? ORDER BY createdAt DESC').bind(workId);
  } else {
    q = env.DB.prepare('SELECT * FROM covers ORDER BY createdAt DESC');
  }
  const { results } = await q.all();
  return ok(results || []);
}

async function addCover(env, { workId, imageUrl, studentNum, studentName, coverRole }) {
  if (!workId || !imageUrl) return fail('workId/imageUrl 누락');
  await ensureCoverRoleColumn(env);
  const role = (coverRole === 'front' || coverRole === 'back') ? coverRole : null;
  // 같은 학생이 같은 작품의 같은 역할(앞/뒤)로 이미 제출한 게 있다면 그것만 교체.
  // 역할이 미지정(null)이면 기존 미지정 표지를 교체. 다른 역할의 표지는 보존.
  if (role === null) {
    await env.DB.prepare(
      'DELETE FROM covers WHERE workId = ? AND studentNum = ? AND studentName = ? AND coverRole IS NULL'
    ).bind(workId, studentNum || '', studentName || '').run();
  } else {
    await env.DB.prepare(
      'DELETE FROM covers WHERE workId = ? AND studentNum = ? AND studentName = ? AND coverRole = ?'
    ).bind(workId, studentNum || '', studentName || '', role).run();
  }
  const id = 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
  const now = new Date().toLocaleDateString('ko-KR');
  await env.DB.prepare(
    "INSERT INTO covers (id, workId, studentNum, studentName, imageUrl, createdAt, status, message, unreadByStudent, coverRole) VALUES (?, ?, ?, ?, ?, ?, '제출됨', '', 0, ?)"
  ).bind(id, workId, studentNum || '', studentName || '', imageUrl, now, role).run();
  return okRaw({ id });
}

async function setCoverRole(env, { id, coverRole, teacherPw }) {
  if (!checkPw(env, teacherPw)) return fail('교사 비밀번호가 올바르지 않습니다.');
  if (!id) return fail('id 누락');
  await ensureCoverRoleColumn(env);
  const role = (coverRole === 'front' || coverRole === 'back') ? coverRole : null;
  // 대상 표지의 workId 찾기
  const row = await env.DB.prepare('SELECT workId FROM covers WHERE id = ?').bind(id).first();
  if (!row) return fail('표지를 찾을 수 없습니다.');
  // 같은 작품에서 같은 역할을 가진 다른 표지의 role을 해제 (앞/뒤 각 1개씩만 허용)
  if (role !== null) {
    await env.DB.prepare(
      'UPDATE covers SET coverRole = NULL WHERE workId = ? AND id <> ? AND coverRole = ?'
    ).bind(row.workId, id, role).run();
  }
  await env.DB.prepare('UPDATE covers SET coverRole = ? WHERE id = ?').bind(role, id).run();
  return ok();
}

async function setCoverStatus(env, { id, status, message, teacherPw }) {
  if (!checkPw(env, teacherPw)) return fail('교사 비밀번호가 올바르지 않습니다.');
  if (!id || !status) return fail('id/status 누락');
  // 승인됨/반려됨이면 학생에게 알림
  const unread = (status === '승인됨' || status === '반려됨') ? 1 : 0;
  await env.DB.prepare(
    'UPDATE covers SET status = ?, message = ?, unreadByStudent = ? WHERE id = ?'
  ).bind(status, message || '', unread, id).run();
  return ok();
}

async function markCoverRead(env, { id }) {
  if (!id) return fail('id 누락');
  await env.DB.prepare('UPDATE covers SET unreadByStudent = 0 WHERE id = ?').bind(id).run();
  return ok();
}

async function deleteCover(env, { id }) {
  if (!id) return fail('id 누락');
  // 삭제 전 imageUrl을 가져와서 Cloudinary 원본도 함께 제거 (고아 파일 방지)
  try {
    const row = await env.DB.prepare('SELECT imageUrl FROM covers WHERE id = ?').bind(id).first();
    if (row && row.imageUrl) await destroyCloudinaryByUrl(env, row.imageUrl);
  } catch (e) {}
  await env.DB.prepare('DELETE FROM covers WHERE id = ?').bind(id).run();
  return ok();
}

async function getOptions(env) {
  const { results } = await env.DB.prepare(
    'SELECT category, ord, value, label FROM options ORDER BY category, ord'
  ).all();
  const grouped = {};
  for (const r of results || []) {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push({ value: r.value, label: r.label });
  }
  return ok(grouped);
}

async function setOptions(env, { category, items, teacherPw }) {
  if (!checkPw(env, teacherPw)) return fail('교사 비밀번호가 올바르지 않습니다.');
  if (!category) return fail('category 누락');
  if (!Array.isArray(items)) return fail('items 누락');
  const stmts = [env.DB.prepare('DELETE FROM options WHERE category = ?').bind(category)];
  items.forEach((it, i) => {
    if (it && it.value && it.label) {
      stmts.push(env.DB.prepare(
        'INSERT INTO options (category, ord, value, label) VALUES (?, ?, ?, ?)'
      ).bind(category, i, it.value, it.label));
    }
  });
  await env.DB.batch(stmts);
  return ok();
}

// 한국 시간(KST = UTC+9) 기준 오늘 날짜 문자열 (YYYY-MM-DD)
function todayKST() {
  const d = new Date();
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
// Gemini free-tier quota는 PT(태평양시간) 자정에 리셋됨
function todayPT() {
  const d = new Date();
  const pt = new Date(d.getTime() - 8 * 60 * 60 * 1000);
  return pt.toISOString().slice(0, 10);
}

async function sha1Hex(s) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function extractPublicId(url) {
  const m = String(url || '').match(/\/upload\/(?:v\d+\/)?(.+?)\.(?:png|jpg|jpeg|webp|gif)(?:\?|$)/i);
  return m ? m[1] : null;
}

async function destroyCloudinaryByUrl(env, url) {
  const cloud = env.CLOUDINARY_CLOUD;
  const key = env.CLOUDINARY_API_KEY;
  const secret = env.CLOUDINARY_API_SECRET;
  if (!cloud || !key || !secret) return { ok: false, error: 'cloudinary env 미설정' };
  const pid = extractPublicId(url);
  if (!pid) return { ok: false, error: 'public_id 추출 실패' };
  const ts = Math.floor(Date.now() / 1000);
  const sig = await sha1Hex(`public_id=${pid}&timestamp=${ts}${secret}`);
  const body = new URLSearchParams({ public_id: pid, timestamp: String(ts), api_key: key, signature: sig });
  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/destroy`, { method: 'POST', body });
    const j = await res.json().catch(() => ({}));
    return { ok: j.result === 'ok' || j.result === 'not found', result: j.result };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function destroyCloudinary(env, { imageUrl }) {
  if (!imageUrl) return fail('imageUrl 누락');
  const r = await destroyCloudinaryByUrl(env, imageUrl);
  return r.ok ? ok() : fail(r.error || '실패');
}

async function clearAllCovers(env, { teacherPw }) {
  if (!checkPw(env, teacherPw)) return fail('교사 비밀번호가 올바르지 않습니다.');
  const cloud = env.CLOUDINARY_CLOUD;
  const key = env.CLOUDINARY_API_KEY;
  const secret = env.CLOUDINARY_API_SECRET;
  if (!cloud || !key || !secret) return fail('Cloudinary 환경변수가 설정되지 않았습니다.');

  const { results } = await env.DB.prepare('SELECT id, imageUrl FROM covers').all();
  const list = results || [];
  let okCount = 0, failCount = 0;
  const failedIds = [];

  for (const row of list) {
    const pid = extractPublicId(row.imageUrl);
    if (!pid) { failCount++; failedIds.push(row.id); continue; }
    try {
      const ts = Math.floor(Date.now() / 1000);
      const sig = await sha1Hex(`public_id=${pid}&timestamp=${ts}${secret}`);
      const body = new URLSearchParams({
        public_id: pid, timestamp: String(ts), api_key: key, signature: sig
      });
      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/destroy`, {
        method: 'POST', body
      });
      const j = await res.json().catch(() => ({}));
      if (j.result === 'ok' || j.result === 'not found') {
        okCount++;
      } else {
        failCount++; failedIds.push(row.id);
      }
    } catch (e) {
      failCount++; failedIds.push(row.id);
    }
  }

  if (okCount > 0) {
    if (failedIds.length > 0) {
      const placeholders = failedIds.map(() => '?').join(',');
      await env.DB.prepare(`DELETE FROM covers WHERE id NOT IN (${placeholders})`).bind(...failedIds).run();
    } else {
      await env.DB.prepare('DELETE FROM covers').run();
    }
  }
  return okRaw({ deleted: okCount, failed: failCount });
}

// ===== AI 응답 캐시 (D1) =====
async function ensureAICacheTable(env) {
  try {
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS ai_cache (hash TEXT PRIMARY KEY, action TEXT, response TEXT, createdAt TEXT)'
    ).run();
  } catch (e) {}
}
async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function normalizeCacheInput(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}
async function getCachedAI(env, action, input) {
  await ensureAICacheTable(env);
  const hash = await sha256Hex(action + '||' + normalizeCacheInput(input));
  try {
    const row = await env.DB.prepare('SELECT response FROM ai_cache WHERE hash = ?').bind(hash).first();
    if (row && row.response) return JSON.parse(row.response);
  } catch (e) {}
  return null;
}
async function setCachedAI(env, action, input, response) {
  const hash = await sha256Hex(action + '||' + normalizeCacheInput(input));
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      'INSERT INTO ai_cache (hash, action, response, createdAt) VALUES (?, ?, ?, ?) ON CONFLICT(hash) DO UPDATE SET response = excluded.response, createdAt = excluded.createdAt'
    ).bind(hash, action, JSON.stringify(response), now).run();
  } catch (e) {}
}

async function callGeminiWithKey(env, prompt, key, maxTokens) {
  const base = env.AI_GATEWAY_URL
    ? env.AI_GATEWAY_URL.replace(/\/$/, '')
    : 'https://generativelanguage.googleapis.com';
  const url = `${base}/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`;
  const headers = { 'Content-Type': 'application/json' };
  if (env.AI_GATEWAY_TOKEN) headers['cf-aig-authorization'] = 'Bearer ' + env.AI_GATEWAY_TOKEN;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 22000);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: maxTokens || 4096
        }
      }),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      const err = new Error('Gemini 응답 시간 초과 (22초). 잠시 후 다시 시도해 주세요.');
      err.status = 504;
      throw err;
    }
    throw e;
  }
  clearTimeout(timeoutId);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const err = new Error(`Gemini ${res.status}: ${t.slice(0, 200)}`);
    err.status = res.status;
    err.body = t;
    throw err;
  }
  const j = await res.json();
  const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  if (!text) throw new Error('Gemini 빈 응답');
  return text.trim();
}

// 일일 한도가 다 된 키는 자정까지 스킵 (Gateway 요청 중복 카운트 방지)
async function ensureKeyStatusTable(env) {
  try {
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS gemini_key_status (keyId TEXT NOT NULL, date TEXT NOT NULL, exhausted INTEGER DEFAULT 1, PRIMARY KEY (keyId, date))'
    ).run();
  } catch (e) {}
}
async function isKeyExhausted(env, keyId) {
  await ensureKeyStatusTable(env);
  try {
    const row = await env.DB.prepare(
      'SELECT exhausted FROM gemini_key_status WHERE keyId = ? AND date = ?'
    ).bind(keyId, todayPT()).first();
    return !!(row && row.exhausted);
  } catch (e) { return false; }
}
async function markKeyExhausted(env, keyId) {
  try {
    await env.DB.prepare(
      'INSERT INTO gemini_key_status (keyId, date, exhausted) VALUES (?, ?, 1) ON CONFLICT(keyId, date) DO UPDATE SET exhausted = 1'
    ).bind(keyId, todayPT()).run();
  } catch (e) {}
}

async function callGemini(env, prompt, maxTokens) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 미설정');
  // 오늘 이미 한도 초과로 마크된 키는 스킵 → Gateway 요청 0회
  if (await isKeyExhausted(env, 'k1')) {
    const err = new Error('Gemini 429: 오늘 한도를 모두 사용했어요. 내일 다시 시도해 주세요.');
    err.status = 429;
    throw err;
  }
  try {
    return await callGeminiWithKey(env, prompt, key, maxTokens);
  } catch (e) {
    const body = e.body || e.message || '';
    // 진짜 "일일 한도" 키워드가 명시된 경우만 자정까지 마킹.
    // RPM(분당) 초과는 RESOURCE_EXHAUSTED로도 오므로 단순 매칭은 위험 → 명시적 daily 표현만 인정.
    const isDailyQuota =
      /per day|RequestsPerDay|daily.?limit|free.?tier/i.test(body) ||
      /exceeded your current quota[\s\S]{0,200}(day|일)/i.test(body);
    if (isDailyQuota) await markKeyExhausted(env, 'k1');
    throw e;
  }
}

async function checkAILimit(env, workId) {
  const limit = parseInt(env.AI_LIMIT_PER_WORK || '3', 10);
  if (!workId) return { error: 'workId 누락' };
  const w = await env.DB.prepare(
    'SELECT status, studentNum, studentName FROM works WHERE id = ?'
  ).bind(workId).first();
  if (!w) return { error: '작품을 찾을 수 없어요.' };
  if (w.status === '승인됨' || w.status === '완료') {
    return { error: '이미 승인된 작품은 AI를 다시 사용할 수 없어요.' };
  }
  // 학생당 오늘 사용량 검사 (자정 리셋)
  const today = todayKST();
  const row = await env.DB.prepare(
    'SELECT count FROM student_ai_daily WHERE date = ? AND studentNum = ? AND studentName = ?'
  ).bind(today, w.studentNum || '', w.studentName || '').first();
  const used = (row && row.count) || 0;
  if (used >= limit) {
    return { error: `오늘 AI 사용 기회를 모두 사용했어요. (${used} / ${limit}회) 내일 다시 사용할 수 있어요!` };
  }
  return { used, limit, studentNum: w.studentNum, studentName: w.studentName };
}

async function recordAIUsage(env, workId, kind, studentNum, studentName) {
  const today = todayKST();
  await env.DB.batch([
    env.DB.prepare('UPDATE works SET aiUsedCount = COALESCE(aiUsedCount,0) + 1 WHERE id = ?').bind(workId),
    env.DB.prepare(
      'INSERT INTO ai_usage (date, kind, count) VALUES (?, ?, 1) ON CONFLICT(date, kind) DO UPDATE SET count = count + 1'
    ).bind(today, kind),
    env.DB.prepare(
      'INSERT INTO student_ai_daily (date, studentNum, studentName, count) VALUES (?, ?, ?, 1) ON CONFLICT(date, studentNum, studentName) DO UPDATE SET count = count + 1'
    ).bind(today, studentNum || '', studentName || '')
  ]);
}

async function aiFeedback(env, { story, workId }) {
  if (!story) return fail('story 누락');
  const chk = await checkAILimit(env, workId);
  if (chk.error) return fail(chk.error);
  const cached = await getCachedAI(env, 'feedback', story);
  if (cached) {
    return okRaw({ ...cached, cached: true, used: chk.used, remaining: chk.limit - chk.used, limit: chk.limit });
  }
  const prompt = `당신은 초등학생 글의 교정·평가 도우미입니다. 학생이 직접 쓴 글에 대해 피드백 해 주세요.

[규칙]
- 따뜻하고 격려하는 어조
- praise: 잘한 점 3가지 (한 문장으로)
- points: 개선점 3가지 (구체적·실천 가능)
- spelling: 맞춤법/띄어쓰기 눈에 띄는 부분

다음 JSON 형식으로만 출력하세요(다른 텍스트·코드블록 없이):
{
  "feedback": {
    "praise": "잘한 점 3",
    "points": ["개선점 1", "개선점 2", "개선점 3"],
    "spelling": "맞춤법 코멘트"
  }
}

[학생 글]
${story}`;
  try {
    const text = await callGemini(env, prompt, 1024);
    let feedback = null;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        if (parsed.feedback) feedback = parsed.feedback;
      }
    } catch (_) {}
    const result = { feedback, raw: text };
    await setCachedAI(env, 'feedback', story, result);
    await recordAIUsage(env, workId, 'feedback', chk.studentNum, chk.studentName);
    const used = (chk.used || 0) + 1;
    return okRaw({ ...result, used, remaining: chk.limit - used, limit: chk.limit });
  } catch (e) {
    return fail(friendlyAIError(e));
  }
}

function friendlyAIError(e) {
  const msg = String((e && e.message) || '');
  const status = e && e.status;
  if (status === 429 || /429|rate.?limit|too many requests|resource_exhausted/i.test(msg)) {
    if (/per day|RequestsPerDay|daily.?limit|free.?tier|오늘 한도|모든 키가 오늘/i.test(msg)) {
      return '오늘 도우미를 너무 많이 사용했어요. 내일 다시 시도해 주세요. 🙏';
    }
    return '잠시만요! 친구들이 동시에 도우미를 부르고 있어요. 5초 후에 다시 눌러 주세요. 💫';
  }
  if (status === 504 || /시간 초과|timeout|abort/i.test(msg)) {
    return '도우미가 생각하느라 시간이 걸리고 있어요. 잠시 후 다시 시도해 주세요. ⏳';
  }
  return '도우미를 부르는 데 실패했어요. 잠시 후 다시 시도해 주세요.';
}

async function aiCustom(env, { story, workId, request }) {
  if (!request) return fail('요청 내용을 입력해 주세요.');
  if (request.length > 500) return fail('요청은 500자 이내로 적어 주세요.');
  const chk = await checkAILimit(env, workId);
  if (chk.error) return fail(chk.error);
  // story + request 조합으로 캐싱 (둘 다 정규화)
  const cacheKey = normalizeCacheInput(story) + '|||' + normalizeCacheInput(request);
  const cached = await getCachedAI(env, 'custom', cacheKey);
  if (cached) {
    return okRaw({ ...cached, cached: true, used: chk.used, remaining: chk.limit - chk.used, limit: chk.limit });
  }
  const prompt = `당신은 초등학교 동화 교실 도우미입니다. 학생이 적은 요청에 따라 친절하고 따뜻하게 도와주세요.

[규칙]
- 초등학생이 이해하기 쉬운 어조로.
- 답을 정해서 강요하지 말고, 학생이 고를 수 있게 보기를 제시해 주세요.
- 짧게 답하세요(10줄 이내).
- 마크다운(##, **) 쓰지 말고 일반 글로.

[학생 글]
${story || '(아직 본문이 없어요)'}

[학생의 도움 요청]
${request}`;
  try {
    const text = await callGemini(env, prompt, 1024);  // 8줄 이내 응답이라 출력 토큰 cap 작게
    const result = { text };
    await setCachedAI(env, 'custom', cacheKey, result);
    await recordAIUsage(env, workId, 'custom', chk.studentNum, chk.studentName);
    const used = (chk.used || 0) + 1;
    return okRaw({ ...result, used, remaining: chk.limit - used, limit: chk.limit });
  } catch (e) {
    return fail(friendlyAIError(e));
  }
}

async function getStudentAIUsage(env, { teacherPw }) {
  if (!checkPw(env, teacherPw)) return fail('교사 비밀번호가 올바르지 않습니다.');
  const limit = parseInt(env.AI_LIMIT_PER_WORK || '3', 10);
  const today = todayKST();
  const { results } = await env.DB.prepare(
    `SELECT w.studentNum AS studentNum, w.studentName AS studentName,
            COUNT(*) AS workCount,
            COALESCE((SELECT count FROM student_ai_daily d WHERE d.date = ? AND d.studentNum = w.studentNum AND d.studentName = w.studentName), 0) AS totalUsed
     FROM works w
     WHERE w.studentNum != '' AND w.studentName != ''
     GROUP BY w.studentNum, w.studentName
     ORDER BY CAST(w.studentNum AS INTEGER)`
  ).bind(today).all();
  return okRaw({ rows: results || [], limit });
}

async function resetStudentAI(env, { studentNum, studentName, teacherPw }) {
  if (!checkPw(env, teacherPw)) return fail('교사 비밀번호가 올바르지 않습니다.');
  if (!studentNum && !studentName) return fail('학생 정보가 필요해요.');
  const today = todayKST();
  await env.DB.batch([
    env.DB.prepare('UPDATE works SET aiUsedCount = 0 WHERE studentNum = ? AND studentName = ?').bind(studentNum || '', studentName || ''),
    env.DB.prepare('DELETE FROM student_ai_daily WHERE date = ? AND studentNum = ? AND studentName = ?').bind(today, studentNum || '', studentName || '')
  ]);
  // Gemini 키 한도 마킹도 풀어줌 (실제로 한도 남았는데 캐시 때문에 막혀 있던 경우 복구)
  try {
    await env.DB.prepare('DELETE FROM gemini_key_status WHERE date = ?').bind(todayPT()).run();
  } catch (e) {}
  return ok();
}

async function getAIUsage(env, { teacherPw }) {
  if (!checkPw(env, teacherPw)) return fail('교사 비밀번호가 올바르지 않습니다.');
  const today = todayKST();
  const since = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    'SELECT date, kind, count FROM ai_usage WHERE date >= ? ORDER BY date'
  ).bind(since).all();
  const todayRows = (results || []).filter(r => r.date === today);
  const todayCustom = todayRows.find(r => r.kind === 'custom')?.count || 0;
  const todayFeedback = todayRows.find(r => r.kind === 'feedback')?.count || 0;
  return okRaw({
    today: { custom: todayCustom, feedback: todayFeedback, total: todayCustom + todayFeedback },
    last7: results || []
  });
}

async function markRead(env, { id }) {
  if (!id) return fail('id 누락');
  await env.DB.prepare('UPDATE works SET unreadByStudent = 0 WHERE id = ?').bind(id).run();
  return ok();
}

async function getWorkAIInfo(env, { id }) {
  if (!id) return fail('id 누락');
  const w = await env.DB.prepare('SELECT studentNum, studentName, status FROM works WHERE id = ?').bind(id).first();
  const limit = parseInt(env.AI_LIMIT_PER_WORK || '3', 10);
  let used = 0;
  if (w) {
    const today = todayKST();
    const row = await env.DB.prepare(
      'SELECT count FROM student_ai_daily WHERE date = ? AND studentNum = ? AND studentName = ?'
    ).bind(today, w.studentNum || '', w.studentName || '').first();
    used = (row && row.count) || 0;
  }
  return okRaw({ used, remaining: Math.max(0, limit - used), limit, status: (w && w.status) || null });
}

async function getExamplesAll(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, title, story, coverUrl, coverBackUrl, COALESCE(chapter, '모험') AS chapter, ord, createdAt FROM examples ORDER BY ord ASC, createdAt DESC"
  ).all();
  return ok(results || []);
}

async function reorderExamples(env, { ids, teacherPw }) {
  if (!checkPw(env, teacherPw)) return fail('교사 비밀번호가 올바르지 않습니다.');
  if (!Array.isArray(ids)) return fail('ids 누락');
  const stmts = ids.map((id, i) => env.DB.prepare('UPDATE examples SET ord = ? WHERE id = ?').bind(i, id));
  if (stmts.length) await env.DB.batch(stmts);
  return ok();
}

async function addExample(env, { title, story, coverUrl, coverBackUrl, chapter, teacherPw }) {
  if (!checkPw(env, teacherPw)) return fail('교사 비밀번호가 올바르지 않습니다.');
  if (!title || !story) return fail('제목·본문이 필요해요.');
  const id = 'ex-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const now = new Date().toLocaleDateString('ko-KR');
  const maxRow = await env.DB.prepare('SELECT COALESCE(MAX(ord), -1) AS m FROM examples').first();
  const ord = ((maxRow && maxRow.m) || 0) + 1;
  await env.DB.prepare(
    'INSERT INTO examples (id, title, story, coverUrl, coverBackUrl, chapter, ord, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, title, story, coverUrl || '', coverBackUrl || '', chapter || '모험', ord, now).run();
  return okRaw({ id });
}

async function updateExample(env, { id, title, story, coverUrl, coverBackUrl, chapter, teacherPw }) {
  if (!checkPw(env, teacherPw)) return fail('교사 비밀번호가 올바르지 않습니다.');
  if (!id || !title || !story) return fail('id·제목·본문이 필요해요.');
  await env.DB.prepare(
    'UPDATE examples SET title = ?, story = ?, coverUrl = ?, coverBackUrl = ?, chapter = ? WHERE id = ?'
  ).bind(title, story, coverUrl || '', coverBackUrl || '', chapter || '모험', id).run();
  return ok();
}

async function deleteExampleD1(env, { id, teacherPw }) {
  if (!checkPw(env, teacherPw)) return fail('교사 비밀번호가 올바르지 않습니다.');
  if (!id) return fail('id 누락');
  await env.DB.prepare('DELETE FROM examples WHERE id = ?').bind(id).run();
  return ok();
}

async function loginStudent(env, { code }) {
  if (!code) return fail('code 누락');
  const row = await env.DB.prepare(
    'SELECT num, name, code FROM students WHERE code = ?'
  ).bind(code).first();
  if (!row) return fail('등록되지 않은 코드입니다.');
  return okRaw({ student: row });
}
