const express = require('express'), http = require('http'), { Server } = require('socket.io'), path = require('path'), crypto = require('crypto');
const app = express(), server = http.createServer(app), io = new Server(server);
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

const rooms = new Map(), classes = new Map();
const LIMIT = 8, LAST = 28, AVATARS = 8;

/* ───────── 기본 문제 은행 ───────── */
const words = [
  ['We should ______  ____ the light.', 'turn off'], ['Don’t forget to ________ the paper.', 'reuse'], ['Don’t forget to use a cup. We should save ________.', 'water'], ['Don’t forget to _________ cans and bottles.', 'recycle'], ['Don’t use __________ bags.', 'plastic'], ['The Earth is our _______.', 'home'], ['We should ______ water and energy.', 'save'], ['We should _______ _____ the water.', 'turn off'], ['elevator → _______', 'stairs'], ['What can you recycle?', 'cans|bottles|paper|papers|plastic|plastics|glass'], ['We _______ save energy.', 'should'], ['Don’t ________ to recycle.', 'forget'], ['We should ______ a bike.', 'ride'], ['We should turn off ______. (Write two: water, light, TV)', 'water light|water tv|light tv'], ['We should take _______.', 'a bus|a subway|bus|subway'], ['해적이 가장 좋아하는 알파벳은?', 'c'], ['USA 옆에 있는 나라는?', 'usb'], ['귀(ear)가 없는 곰(bear)은?', 'b'], ['turn on → _______', 'turn off'], ['The ________ is too hot.', 'earth'], ['World Car ______ Day', 'free']];
const sentencePairs = [
  ['We should turn off the music.', 'We should turn off the light.', 1], ['The Earth is hot.', 'The Earth is cold.', 0], ['We should eat more vegetables.', 'We should eat more meat.', 0], ['We should use plastic bags.', 'We should use eco bags.', 1], ['How about using the stairs?', 'How about using the elevator?', 0], ['Let’s wash slowly.', 'Let’s wash quickly.', 1], ['Earth Day is on May 22.', 'Earth Day is on April 22.', 1], ['Earth Hour is on the last Saturday in March.', 'Earth Hour is on the first Saturday in March.', 0], ['People turn off lights during Earth Hour.', 'People turn on lights during Earth Hour.', 0], ['We should save the forest.', 'We should save the zoo.', 0], ['We should ride more bikes.', 'We should ride more cars.', 0], ['The Earth is not our home.', 'The Earth is our home.', 1], ['How about reusing paper?', 'How about using paper?', 0], ['How about using a cup?', 'How about using a paper cup?', 0], ['We should buy from online.', 'We should buy from the market.', 1], ['Let’s recycle cans and bottles.', 'Let’s throw away cans and bottles.', 0], ['Let’s plant trees.', 'Let’s cut trees.', 0], ['We should ride more.', 'We should walk more.', 1], ['We should waste the energy.', 'We should save the energy.', 1], ['We can’t change the world.', 'We can change the world.', 1], ['Don’t forget to save the Earth.', 'Don’t forget to save the money.', 0]];
const gems = ['We should plant trees to clean the air.', 'Don’t forget to protect plants and animals.', 'We should use reusable water bottles.', 'We should turn off electronics when not in use.', 'Don’t forget to unplug electronic devices.', 'How about picking up litter in the streets?', 'Let’s recycle.', 'Let’s buy secondhand.', 'Let’s save water.', 'Let’s turn off the water while brushing our teeth.', 'How about taking a short shower?', 'Let’s reduce, reuse and recycle!', 'We should reduce our waste.', 'Let’s read many books about the Earth.', 'How about trying vegetarian or vegan food?', 'We should walk or bike.', 'Let’s buy less.', 'Don’t waste paper.', 'Let’s save energy.', 'We should care for our wildlife animals.', 'Don’t forget to turn off the light when you leave.'];
// 그림 보드판 28칸. 칸에는 번호만 있고, 문제는 28문제 중에서 무작위(한 판 안에서는 겹치지 않게)로 나옵니다.
const board = Array.from({ length: LAST + 1 }, (_, i) => i === 0 ? 'start' : 'R');

// 기본 28문제: 단어 쓰기 10 · 문장 고르기 10 · 보석 읽기 8
const DEF_W = [0, 1, 2, 3, 4, 5, 6, 8, 11, 12], DEF_S = [3, 4, 6, 8, 11, 13, 15, 16, 18, 19], DEF_G = [0, 1, 2, 5, 8, 9, 11, 20];
function defaultBank() {
  return {
    W: DEF_W.map(i => ({ q: words[i][0], a: words[i][1], on: true })),
    S: DEF_S.map(i => ({ a: sentencePairs[i][0], b: sentencePairs[i][1], ans: sentencePairs[i][2], on: true })),
    G: DEF_G.map(i => ({ t: gems[i], on: true }))
  };
}
const str = (x, n = 200) => String(x ?? '').trim().slice(0, n);
function cleanBank(b) {
  if (!b || typeof b !== 'object') return null;
  const out = {
    W: (Array.isArray(b.W) ? b.W : []).slice(0, 300).map(x => ({ q: str(x?.q), a: str(x?.a), on: x?.on !== false })).filter(x => x.q && x.a),
    S: (Array.isArray(b.S) ? b.S : []).slice(0, 300).map(x => ({ a: str(x?.a), b: str(x?.b), ans: Number(x?.ans) === 1 ? 1 : 0, on: x?.on !== false })).filter(x => x.a && x.b),
    G: (Array.isArray(b.G) ? b.G : []).slice(0, 300).map(x => ({ t: str(x?.t), on: x?.on !== false })).filter(x => x.t)
  };
  return out;
}
function pickQuestion(r) { // 사용 중인 문제 전체에서 무작위, 한 판 안에서는 다 나올 때까지 겹치지 않게
  const c = r.classCode && classes.get(r.classCode);
  const bank = c?.bank || defaultBank();
  let all = [...bank.W.filter(x => x.on).map(x => ['W', x]), ...bank.S.filter(x => x.on).map(x => ['S', x]), ...bank.G.filter(x => x.on).map(x => ['G', x])];
  if (!all.length) { const d = defaultBank(); all = [...d.W.map(x => ['W', x]), ...d.S.map(x => ['S', x]), ...d.G.map(x => ['G', x])]; }
  const key = ([t, x]) => t + '|' + (x.q || x.a || x.t);
  r.used = r.used || new Set();
  let left = all.filter(e => !r.used.has(key(e)));
  if (!left.length) { r.used.clear(); left = all; }
  const e = left[Math.floor(Math.random() * left.length)]; r.used.add(key(e)); return e;
}

/* ───────── 방 상태 ───────── */
function newRoom(code, extra = {}) { return { code, players: [], turn: 0, question: null, started: false, finished: false, log: [], lastRoll: null, lastResult: null, seq: 0, ...extra }; }
function begin(r) { r.players = r.players.filter(p => p.online); r.players.forEach(p => { p.pos = 0; p.score = 0; p.finished = false; p.correct = 0; p.wrong = 0; p.gems = 0; }); r.turn = 0; r.used = new Set(); r.started = true; r.finished = false; r.question = null; r.lastRoll = null; r.lastResult = null; note(r, '게임 시작!'); }
function code() { let c; do { c = Math.random().toString(36).slice(2, 7).toUpperCase() } while (rooms.has(c) || c.length < 5); return c; }
function publicPlayer(p) { return { id: p.id, name: p.name, avatar: p.avatar, pos: p.pos, score: p.score, finished: p.finished, online: p.online, correct: p.correct, wrong: p.wrong, gems: p.gems }; }
function publicRoom(r) {
  return {
    code: r.code, name: r.name || '', started: r.started, finished: r.finished, players: r.players.map(publicPlayer), turn: r.turn,
    question: r.question ? { type: r.question.type, text: r.question.text, choices: r.question.choices, points: r.question.points, playerId: r.question.playerId } : null,
    board, hostId: r.hostId, log: r.log.slice(-8), lastRoll: r.lastRoll, lastResult: r.lastResult
  };
}
function overview(c) {
  return {
    classCode: c.code, last: LAST, groups: c.groups.map(code => {
      const r = rooms.get(code); const n = r.players.length;
      const sum = r.players.reduce((s, p) => s + p.score, 0);
      return {
        code, name: r.name, started: r.started, finished: r.finished, players: r.players.map(publicPlayer),
        total: sum, average: n ? Math.round(sum / n * 10) / 10 : 0,
        completed: r.players.filter(p => p.finished).length,
        correct: r.players.reduce((s, p) => s + p.correct, 0), gems: r.players.reduce((s, p) => s + p.gems, 0),
        progress: n ? Math.round(r.players.reduce((s, p) => s + p.pos, 0) / n / LAST * 100) : 0,
        turn: r.started && !r.finished ? (r.players[r.turn]?.name || '-') : '-', log: r.log.slice(-4)
      };
    })
  };
}
function classEmit(r) { if (r.classCode) { const c = classes.get(r.classCode); if (c) io.to('class:' + c.code).emit('overview', overview(c)); } }
function emit(r) { io.to(r.code).emit('state', publicRoom(r)); classEmit(r); }
function note(r, s) { r.log.push(s); if (r.log.length > 30) r.log.shift(); }
function current(r) { return r.players[r.turn]; }
function allDone(r) { const on = r.players.filter(p => p.online); return r.players.every(p => p.finished) || (on.length > 0 && on.every(p => p.finished)); }
function advance(r) {
  if (allDone(r)) { r.finished = true; r.question = null; note(r, '🏆 게임 종료!'); return; }
  for (let i = 0; i < r.players.length; i++) { r.turn = (r.turn + 1) % r.players.length; const c = current(r); if (!c.finished && c.online) break; }
}
function fixTurn(r) { // 현재 차례 학생이 없거나 끊긴 경우 정리
  if (!r.started || r.finished) return;
  if (r.turn >= r.players.length) r.turn = 0;
  const c = current(r); if (!c || c.finished || !c.online) { r.turn = (r.turn - 1 + r.players.length) % Math.max(1, r.players.length); advance(r); }
}
function nextQ(r, p) {
  const [type, x] = pickQuestion(r);
  if (type === 'W') r.question = { playerId: p.id, type: 'W', text: x.q, answer: x.a, points: 1 };
  else if (type === 'S') r.question = { playerId: p.id, type: 'S', text: 'Choose the better sentence for our Earth.', choices: [x.a, x.b], answer: String(x.ans), points: 1 };
  else r.question = { playerId: p.id, type: 'G', text: x.t, points: 1 + Math.floor(Math.random() * 3) };
}
function normalize(s) { return String(s || '').toLowerCase().replace(/[’‘`]/g, "'").trim().replace(/[.,!?]/g, '').replace(/\s+/g, ' '); }
function teacherRoom(s, code) { const c = classes.get(s.data?.teacherClass); const r = rooms.get(code); return c && r && c.groups.includes(code) ? { c, r } : null; }

io.on('connection', s => {
  s.data = {};
  /* ── 교사 ── */
  s.on('createClass', ({ groups, bank } = {}, cb) => {
    const count = Math.max(1, Math.min(8, Number(groups) || 5)), classCode = code(), secret = crypto.randomBytes(16).toString('hex');
    const c = { code: classCode, secret, groups: [], bank: cleanBank(bank) || defaultBank() };
    classes.set(classCode, c); s.join('class:' + classCode); s.data.teacherClass = classCode;
    for (let i = 0; i < count; i++) { const rc = code(); rooms.set(rc, newRoom(rc, { classCode, hostId: s.id, name: `${i + 1}모둠` })); c.groups.push(rc); }
    cb?.({ ok: true, classCode, secret, overview: overview(c) });
  });
  s.on('teacherReconnect', ({ classCode, secret } = {}, cb) => {
    const c = classes.get(classCode); if (!c || c.secret !== secret) return cb?.({ error: '교사 접속 정보가 올바르지 않습니다.' });
    s.join('class:' + classCode); s.data.teacherClass = classCode; for (const code of c.groups) rooms.get(code).hostId = s.id;
    cb?.({ ok: true, overview: overview(c) });
  });
  s.on('getDefaultBank', (_, cb) => cb?.(defaultBank()));
  s.on('setBank', ({ bank } = {}, cb) => { const c = classes.get(s.data.teacherClass); const b = cleanBank(bank); if (!b) return cb?.({ error: '문제 형식이 올바르지 않습니다.' }); if (c) c.bank = b; cb?.({ ok: true, live: !!c }); });
  s.on('addGroup', (_, cb) => {
    const c = classes.get(s.data.teacherClass); if (!c) return cb?.({ error: '교사 인증이 필요합니다.' }); if (c.groups.length >= 12) return cb?.({ error: '모둠방은 최대 12개입니다.' });
    const rc = code(); rooms.set(rc, newRoom(rc, { classCode: c.code, hostId: s.id, name: `${c.groups.length + 1}모둠` })); c.groups.push(rc);
    io.to('class:' + c.code).emit('overview', overview(c)); cb?.({ ok: true, code: rc });
  });
  s.on('renameGroup', ({ code, name } = {}, cb) => { const t = teacherRoom(s, code); if (!t) return cb?.({ error: '권한이 없습니다.' }); t.r.name = str(name, 20) || t.r.name; emit(t.r); cb?.({ ok: true }); });
  s.on('removeGroup', ({ code } = {}, cb) => {
    const t = teacherRoom(s, code); if (!t) return cb?.({ error: '권한이 없습니다.' });
    io.to(code).emit('closed', '선생님이 이 모둠방을 닫았어요.'); t.c.groups = t.c.groups.filter(x => x !== code); rooms.delete(code);
    io.to('class:' + t.c.code).emit('overview', overview(t.c)); cb?.({ ok: true });
  });
  s.on('startGroup', ({ code } = {}, cb) => { const t = teacherRoom(s, code); if (!t) return cb?.({ error: '권한이 없습니다.' }); if (!t.r.players.some(p => p.online)) return cb?.({ error: '아직 학생이 없습니다.' }); if (t.r.started && !t.r.finished) return cb?.({ error: '이미 진행 중입니다.' }); begin(t.r); emit(t.r); cb?.({ ok: true }); });
  s.on('endGroup', ({ code } = {}, cb) => { const t = teacherRoom(s, code); if (!t) return cb?.({ error: '권한이 없습니다.' }); if (!t.r.started) return cb?.({ error: '아직 시작하지 않은 방입니다.' }); t.r.finished = true; t.r.question = null; note(t.r, '🏁 선생님이 게임을 마쳤습니다.'); emit(t.r); cb?.({ ok: true }); });
  s.on('resetGroup', ({ code } = {}, cb) => { const t = teacherRoom(s, code); if (!t) return cb?.({ error: '권한이 없습니다.' }); const r = t.r; r.started = false; r.finished = false; r.question = null; r.lastRoll = null; r.lastResult = null; r.players = r.players.filter(p => p.online); r.players.forEach(p => { p.pos = 0; p.score = 0; p.finished = false; p.correct = 0; p.wrong = 0; p.gems = 0; }); note(r, '🔄 새 게임을 준비합니다.'); emit(r); cb?.({ ok: true }); });
  s.on('kickPlayer', ({ code, id } = {}, cb) => {
    const t = teacherRoom(s, code); if (!t) return cb?.({ error: '권한이 없습니다.' }); const r = t.r; const i = r.players.findIndex(p => p.id === id); if (i < 0) return cb?.({ error: '학생을 찾을 수 없습니다.' });
    const [p] = r.players.splice(i, 1); io.to(p.id).emit('closed', '선생님이 모둠에서 내보냈어요. 다시 입장하려면 선생님께 말씀드리세요.'); io.sockets.sockets.get(p.id)?.leave(r.code);
    note(r, p.name + ' 퇴장'); if (r.question?.playerId === p.id) r.question = null;
    if (r.started && !r.finished) { if (i < r.turn) r.turn--; else if (i === r.turn) { r.turn = (i - 1 + Math.max(1, r.players.length)) % Math.max(1, r.players.length); advance(r); } fixTurn(r); }
    emit(r); cb?.({ ok: true });
  });
  s.on('startAll', (_, cb) => { const c = classes.get(s.data.teacherClass); if (!c) return cb?.({ error: '교사 인증이 필요합니다.' }); let count = 0; for (const code of c.groups) { const r = rooms.get(code); if (r.players.some(p => p.online) && !r.started) { begin(r); emit(r); count++; } } cb?.({ ok: true, count }); });

  /* ── 단독 방(이전 방식 호환) ── */
  s.on('create', ({ name } = {}, cb) => { const c = code(); const r = newRoom(c, { hostId: s.id }); rooms.set(c, r); s.join(c); s.data = { code: c, host: true }; note(r, '방이 생성되었습니다.'); emit(r); cb?.({ ok: true, code: c }); });
  s.on('start', (_, cb) => { const r = rooms.get(s.data?.code); if (!r || r.hostId !== s.id) return cb?.({ error: '교사만 시작할 수 있습니다.' }); if (!r.players.some(p => p.online)) return cb?.({ error: '학생이 먼저 입장해야 합니다.' }); begin(r); emit(r); cb?.({ ok: true }); });

  /* ── 학생 ── */
  s.on('join', ({ code: c, name, avatar } = {}, cb) => {
    const r = rooms.get(String(c || '').trim().toUpperCase()); name = str(name, 20);
    if (!r || !name) return cb?.({ error: '모둠 코드와 이름을 확인하세요.' });
    if (r.started) return cb?.({ error: '이미 시작된 게임이에요. 선생님께 말씀드리세요.' });
    if (r.players.length >= LIMIT) return cb?.({ error: '한 모둠은 최대 8명입니다.' });
    if (r.players.some(p => p.name === name)) return cb?.({ error: '같은 이름이 이미 있어요. 다른 이름을 써 주세요.' });
    let av = Number.isInteger(Number(avatar)) ? Math.max(0, Math.min(AVATARS - 1, Number(avatar))) : 0;
    const used = new Set(r.players.map(p => p.avatar)); let changed = false;
    if (used.has(av)) { for (let k = 0; k < AVATARS; k++) if (!used.has(k)) { av = k; changed = true; break; } }
    const p = { id: s.id, token: crypto.randomBytes(12).toString('hex'), name, avatar: av, pos: 0, score: 0, finished: false, online: true, correct: 0, wrong: 0, gems: 0 };
    r.players.push(p); s.join(r.code); s.data = { code: r.code, host: false }; note(r, name + ' 입장'); emit(r);
    cb?.({ ok: true, code: r.code, token: p.token, avatar: av, changed });
  });
  s.on('rejoin', ({ code: c, token } = {}, cb) => {
    const r = rooms.get(String(c || '').trim().toUpperCase()); const p = r && token && r.players.find(x => x.token === token);
    if (!p) return cb?.({ error: '다시 입장할 수 없어요. 선생님께 알려 주세요.' });
    const old = p.id; p.id = s.id; p.online = true; if (r.question && r.question.playerId === old) r.question.playerId = s.id;
    s.join(r.code); s.data = { code: r.code, host: false }; note(r, p.name + ' 다시 연결');
    const cur = current(r); if (r.started && !r.finished && !r.question && (!cur || !cur.online || cur.finished)) { r.turn = r.players.indexOf(p); if (p.finished) advance(r); }
    emit(r); cb?.({ ok: true, code: r.code });
  });
  s.on('roll', (_, cb) => {
    const r = rooms.get(s.data?.code); if (!r || !r.started || r.finished || r.question || current(r)?.id !== s.id) return cb?.({ error: '지금은 주사위를 던질 수 없어요.' });
    const p = current(r), n = 1 + Math.floor(Math.random() * 6), from = p.pos; p.pos = Math.min(LAST, p.pos + n);
    r.lastRoll = { id: p.id, name: p.name, n, from, to: p.pos, seq: ++r.seq }; note(r, `${p.name}: 🎲 ${n} → ${p.pos}번 칸`);
    if (p.pos === LAST) { p.finished = true; note(r, `${p.name} 완주!`); r.lastResult = { id: p.id, name: p.name, kind: 'finish', seq: ++r.seq }; advance(r); } else nextQ(r, p);
    emit(r); cb?.({ ok: true, roll: n });
  });
  s.on('answer', ({ answer } = {}, cb) => {
    const r = rooms.get(s.data?.code); if (!r || !r.question || r.question.playerId !== s.id) return cb?.({ error: '본인의 문제만 풀 수 있어요.' });
    const q = r.question, p = current(r); if (!p || p.id !== s.id) return cb?.({ error: '차례가 아니에요.' }); if (q.type === 'G') return cb?.({ error: '보석 카드는 읽기 완료 버튼을 누르세요.' });
    let correct = q.answer.split('|').some(x => normalize(x) === normalize(answer));
    if (q.type === 'W' && q.answer.includes('water light')) { const vals = normalize(answer).split(/[,/ ]+/).filter(v => v && v !== 'and' && v !== 'the'); correct = vals.length === 2 && new Set(vals).size === 2 && vals.every(v => ['water', 'light', 'tv'].includes(v)); }
    const correctAnswer = q.type === 'S' ? q.choices[Number(q.answer)] : q.answer.split('|')[0];
    if (correct) { p.score += q.points; p.correct++; } else p.wrong++;
    note(r, `${p.name}: ${correct ? '✅ 정답 +' + q.points : '❌ 오답 (정답: ' + correctAnswer + ')'}`);
    r.lastResult = { id: p.id, name: p.name, kind: correct ? 'correct' : 'wrong', points: correct ? q.points : 0, answer: correctAnswer, seq: ++r.seq };
    r.question = null; advance(r); emit(r); cb?.({ ok: true, correct, correctAnswer, points: q.points });
  });
  s.on('gem', (_, cb) => {
    const r = rooms.get(s.data?.code); if (!r || r.question?.type !== 'G' || r.question.playerId !== s.id) return cb?.({ error: '본인 차례가 아니에요.' });
    const p = current(r), pts = r.question.points; p.score += pts; p.gems++; note(r, `${p.name}: 💎 문장 읽기 +${pts}`);
    r.lastResult = { id: p.id, name: p.name, kind: 'gem', points: pts, seq: ++r.seq };
    r.question = null; advance(r); emit(r); cb?.({ ok: true, points: pts });
  });
  s.on('disconnect', () => {
    const r = rooms.get(s.data?.code); if (!r) return;
    if (s.data.host) { note(r, '교사 연결이 끊겼습니다.'); emit(r); return; }
    const i = r.players.findIndex(p => p.id === s.id); if (i < 0) return;
    r.players[i].online = false;
    if (r.started) { note(r, r.players[i].name + ' 연결 끊김'); if (r.question?.playerId === s.id) r.question = null; if (!r.finished && (r.turn === i || allDone(r))) advance(r); }
    emit(r);
  });
});
server.listen(process.env.PORT || 3000, () => console.log('Earth Board Game listening on ' + (process.env.PORT || 3000)));
