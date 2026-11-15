# Balap Keong v1.2 — TV Touchscreen Experience

Jalankan lokal: `npm install` lalu `npm start` → buka http://localhost:3000 di TV/laptop.
Untuk tes dengan HP di Wi-Fi yang sama: `PUBLIC_URL=http://IP-LAPTOP:3000 npm start`
(supaya QR berisi alamat yang bisa dijangkau HP, bukan "localhost").

## Deploy (butuh WebSocket persisten)
Pakai layanan Node.js biasa: Render (Web Service), Railway, Fly.io, atau VPS. Vercel gratis TIDAK cocok.
Build: `npm install` — Start: `npm start`. QR otomatis memakai domain publik (atau set env `PUBLIC_URL`).
Catatan: jalankan 1 instance saja (room disimpan di memori server).

## Atur
- Bank soal: `questions.json` — format `{"q":"...","o":["A","B","C","D"],"a":indexJawabanBenar}`
- Jumlah jawaban benar untuk menang: env `TARGET` (default 10)
