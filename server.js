const express = require('express'), http = require('http'), path = require('path');
const { Server } = require('socket.io'), QRCode = require('qrcode');
const QS = require('./questions.json');

const TARGET = +process.env.TARGET || 10;  // jumlah jawaban benar untuk menang
const MAX = 4;
const SKINS = ['Coral', 'Mint', 'Sunny', 'Berry', 'Ocean', 'Lime', 'Peach', 'Bubble'];

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();

const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const newOrder = () => shuffle(QS.map((_, i) => i));
const pub = r => ({ code: r.code, state: r.state, winner: r.winner, target: TARGET,
  players: [...r.players.values()].map(p => ({ id: p.id, name: p.name, skin: p.skin, pos: p.pos, correct: p.correct })) });
const push = r => io.to(r.code).emit('room:update', pub(r));
const takenSkins = r => [...r.players.values()].map(p => p.skin);

function genCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c; do { c = Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join(''); } while (rooms.has(c));
  return c;
}

// Kirim soal berikutnya ke satu pemain. Kunci jawaban TIDAK ikut dikirim.
function nextQ(p) {
  if (p.ptr >= p.order.length) { p.order = newOrder(); p.ptr = 0; }   // bank habis -> acak ulang
  p.cur = p.order[p.ptr++];
  const q = QS[p.cur];
  io.to(p.id).emit('q:next', { id: p.cur, q: q.q, o: q.o, pos: p.pos, correct: p.correct, target: TARGET });
}

io.on('connection', socket => {
  const myRoom = () => rooms.get(socket.data.room);

  // ---- TV ----
  async function makeRoom(ack) {
    const code = genCode();
    const r = { code, host: socket.id, state: 'lobby', winner: null, players: new Map() };
    rooms.set(code, r); socket.join(code); socket.data.room = code; socket.data.role = 'tv';
    const h = socket.handshake.headers;
    const proto = (h['x-forwarded-proto'] || 'http').split(',')[0];
    const base = process.env.PUBLIC_URL || `${proto}://${h.host}`;
    const url = `${base}/play.html?room=${code}`;
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 320 });
    ack({ code, url, qr }); push(r);
  }
  socket.on('tv:create', (_, ack) => makeRoom(ack));

  // NEXT GAME: tutup room lama, buat room baru dengan kode & QR baru
  socket.on('tv:new', (_, ack) => {
    const old = myRoom();
    if (old && old.host === socket.id) {
      io.to(old.code).except(socket.id).emit('room:closed');
      io.in(old.code).socketsLeave(old.code);
      rooms.delete(old.code);
    }
    makeRoom(ack);
  });

  socket.on('tv:start', () => {
    const r = myRoom();
    if (!r || r.host !== socket.id || r.state !== 'lobby' || r.players.size < 1) return;
    r.state = 'racing'; r.winner = null;
    r.players.forEach(p => { p.pos = 0; p.correct = 0; p.order = newOrder(); p.ptr = 0; });
    push(r); r.players.forEach(nextQ);
  });

  socket.on('tv:reset', () => {
    const r = myRoom();
    if (!r || r.host !== socket.id) return;
    r.state = 'lobby'; r.winner = null;
    r.players.forEach(p => { p.pos = 0; p.correct = 0; p.cur = null; });
    io.to(r.code).emit('p:reset'); push(r);
  });

  // ---- HP siswa ----
  socket.on('p:peek', (code, ack) => {
    const r = rooms.get(String(code || '').toUpperCase());
    if (!r) return ack({ ok: false, err: 'Kode room tidak ditemukan.' });
    ack({ ok: true, taken: takenSkins(r), state: r.state, full: r.players.size >= MAX });
  });

  socket.on('p:join', ({ code, name, skin } = {}, ack) => {
    const r = rooms.get(String(code || '').toUpperCase());
    name = String(name || '').trim().slice(0, 12);
    if (!r) return ack({ ok: false, err: 'Kode room tidak ditemukan.' });
    if (r.state !== 'lobby') return ack({ ok: false, err: 'Balapan sudah dimulai.' });
    if (r.players.size >= MAX) return ack({ ok: false, err: 'Room sudah penuh (4 pemain).' });
    if (!name) return ack({ ok: false, err: 'Isi nickname dulu.' });
    if (!SKINS.includes(skin)) return ack({ ok: false, err: 'Pilih skin dulu.' });
    if (takenSkins(r).includes(skin)) return ack({ ok: false, err: 'Skin itu sudah dipakai.', taken: takenSkins(r) });
    r.players.set(socket.id, { id: socket.id, name, skin, pos: 0, correct: 0, order: [], ptr: 0, cur: null });
    socket.join(r.code); socket.data.room = r.code; socket.data.role = 'player';
    ack({ ok: true }); push(r);
  });

  socket.on('p:answer', ({ id, choice } = {}, ack) => {
    const r = myRoom(); const p = r && r.players.get(socket.id);
    if (!p || r.state !== 'racing' || p.cur === null || p.cur !== id) return;   // cegah jawab ganda
    const correctIndex = QS[id].a;
    p.cur = null;
    const correct = choice === correctIndex;              // verifikasi di server
    if (correct) { p.correct++; p.pos = p.correct / TARGET * 100; }
    ack({ correct, correctIndex, pos: p.pos, total: p.correct, target: TARGET });
    push(r);
    if (p.correct >= TARGET) {   // yang pertama mencapai target = pemenang
      r.state = 'done'; r.winner = p.name;
      r.players.forEach(q => io.to(q.id).emit('p:end', { won: q.id === p.id, winner: p.name }));
      push(r); return;
    }
    setTimeout(() => { if (rooms.get(r.code) === r && r.state === 'racing' && r.players.has(p.id)) nextQ(p); }, 1300);
  });

  socket.on('disconnect', () => {
    const r = myRoom(); if (!r) return;
    if (socket.data.role === 'tv') { io.to(r.code).emit('room:closed'); rooms.delete(r.code); return; }
    if (r.state === 'lobby') { r.players.delete(socket.id); push(r); }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Balap Keong jalan di http://localhost:${PORT}`));
