// ============================================================
// FLEET SPACE OPTIMIZER — Tim Ambatublow
// Fitur: CSV manifest, armada custom tersimpan, mode komparasi
// ============================================================

// ------------------------------------------------------------
// 1. WARNA — palet 16 warna yang benar-benar berbeda
// ------------------------------------------------------------
const PALETTE = [
  '#e6194b', // merah
  '#3cb44b', // hijau
  '#ffe119', // kuning
  '#4363d8', // biru
  '#f58231', // oranye
  '#911eb4', // ungu
  '#46f0f0', // cyan
  '#f032e6', // magenta
  '#bcf60c', // lime
  '#fabed4', // pink muda
  '#008080', // teal gelap
  '#dcbeff', // lavender
  '#9a6324', // coklat
  '#fffac8', // krem
  '#800000', // maroon
  '#aaffc3', // mint
];
const warnaMap = {}; // nama barang -> index palet
let warnaCounter = 0;
function warnaUntuk(nama) {
  if (!(nama in warnaMap)) {
    warnaMap[nama] = warnaCounter % PALETTE.length;
    warnaCounter++;
  }
  return PALETTE[warnaMap[nama]];
}

const BIAYA_PER_RUTE = 350000;

// ------------------------------------------------------------
// 2. ARMADA — disimpan permanen di localStorage
// ------------------------------------------------------------
const FLEET_KEY = 'fleet_db_v2';

function loadFleets() {
  try {
    const raw = localStorage.getItem(FLEET_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      // migrasi: pastikan semua armada punya field 'tersedia'
      arr.forEach(f => { if (f.tersedia === undefined) f.tersedia = true; });
      return arr;
    }
  } catch (e) {}
  // default awal (bisa dihapus user)
  return [
    { nama: 'Blind Van',  length: 240, width: 160, height: 130, max_weight: 800,  biaya: 200000, tersedia: true },
    { nama: 'CDE Engkel', length: 300, width: 160, height: 170, max_weight: 2000, biaya: 350000, tersedia: true },
    { nama: 'CDD Colt',   length: 425, width: 185, height: 190, max_weight: 4000, biaya: 550000, tersedia: true },
  ];
}
function saveFleets(fleets) {
  localStorage.setItem(FLEET_KEY, JSON.stringify(fleets));
}
let FLEETS = loadFleets();
saveFleets(FLEETS); // pastikan default tersimpan

// ------------------------------------------------------------
// 3. MANIFEST — hanya dari CSV upload user
// ------------------------------------------------------------
let manifest = null; // null = belum ada data

// ------------------------------------------------------------
// 4. ENGINE — 3D Bin Packing
// packSekaliJalan = satu kali jalan dengan urutan tertentu (Level 1:
//   support ratio + snug bonus). packItems = wrapper multi-start (Level 2):
//   coba beberapa strategi urutan, ambil hasil terbaik.
// ------------------------------------------------------------
function packSekaliJalan(mf, fleet, sorter, opsi = {}) {
  const items = mf.map(it => ({ ...it, vol: it.length*it.width*it.height }))
                  .sort(sorter);
  const W = fleet.width, H = fleet.height, D = fleet.length;
  const placed = [], unfitted = [];
  let points = [{x:0,y:0,z:0}];
  const EPS = 0.01;
  const tanpaSnug = !!opsi.tanpaSnug; // mode cepat: skip perhitungan snug
  const kapasitasBerat = fleet.max_weight || Infinity;
  let beratTerpakai = 0;

  function overlap(a,b){return !(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y||a.z+a.d<=b.z||b.z+b.d<=a.z);}

  // LEVEL 1a: support ratio — barang di atas harus tertopang >= 70% luas alasnya.
  // Mencegah penempatan "melayang" yang tidak realistis.
  function rasioTopang(box) {
    if (box.y === 0) return 1; // di lantai = tertopang penuh
    let area = 0;
    for (const p of placed) {
      if (Math.abs(p.y + p.h - box.y) < EPS) {
        const ox = Math.max(0, Math.min(box.x+box.w, p.x+p.w) - Math.max(box.x, p.x));
        const oz = Math.max(0, Math.min(box.z+box.d, p.z+p.d) - Math.max(box.z, p.z));
        area += ox * oz;
      }
    }
    return area / (box.w * box.d);
  }

  function fits(box){
    if(box.x+box.w>W+EPS||box.y+box.h>H+EPS||box.z+box.d>D+EPS)return false;
    for(const p of placed)if(overlap(box,p))return false;
    return rasioTopang(box) >= 0.7;
  }

  // LEVEL 1b: snug bonus — hitung berapa sisi box yang menempel
  // (dinding atau box lain). Makin nempel makin baik -> mengurangi celah.
  function hitungSnug(box) {
    let s = 0;
    if (box.x < EPS) s++;                    // nempel dinding kiri
    if (Math.abs(box.x+box.w - W) < EPS) s++; // dinding kanan
    if (box.z < EPS) s++;                    // dinding depan (tertutup)
    for (const p of placed) {
      // nempel sisi kiri/kanan box lain
      if ((Math.abs(p.x+p.w - box.x) < EPS || Math.abs(box.x+box.w - p.x) < EPS) &&
          box.z < p.z+p.d && p.z < box.z+box.d &&
          box.y < p.y+p.h && p.y < box.y+box.h) { s++; break; }
    }
    for (const p of placed) {
      // nempel depan/belakang box lain
      if ((Math.abs(p.z+p.d - box.z) < EPS || Math.abs(box.z+box.d - p.z) < EPS) &&
          box.x < p.x+p.w && p.x < box.x+box.w &&
          box.y < p.y+p.h && p.y < box.y+box.h) { s++; break; }
    }
    return s; // 0..5
  }

  for (const it of items) {
    const [a, c, e] = [it.length, it.width, it.height];
    const orients = [
      {w:c, h:e, d:a}, {w:a, h:e, d:c},
      {w:c, h:a, d:e}, {w:e, h:a, d:c},
      {w:a, h:c, d:e}, {w:e, h:c, d:a},
    ];
    // ENFORCEMENT BERAT: kalau menambah barang ini melebihi kapasitas truk, skip
    if (beratTerpakai + it.weight > kapasitasBerat) {
      unfitted.push(it.id);
      continue;
    }
    // snug mahal untuk manifest besar — skip saat mode cepat atau sudah banyak barang
    const pakaiSnug = !tanpaSnug && placed.length <= 100;
    // urutkan titik (y,z,x) menaik -> early-exit karena skor didominasi y lalu z
    points.sort((p,q) => p.y-q.y || p.z-q.z || p.x-q.x);
    let best=null, bestScore=Infinity;
    for (const p of points) {
      // batas bawah skor dari titik ini (konservatif); titik selanjutnya pasti >= ini
      if (p.y*100000 + p.z*1000 - 450 > bestScore) break;
      for (const o of orients) {
        const box = {x:p.x,y:p.y,z:p.z,w:o.w,h:o.h,d:o.d,id:it.id,name:it.name};
        if (fits(box)) {
          const snug = pakaiSnug ? hitungSnug(box) : 0;
          const score = box.y*100000 + box.z*1000 + box.h*100 + box.x - snug*40;
          if (score < bestScore) { bestScore=score; best=box; }
        }
      }
    }
    if (best) {
      placed.push(best);
      beratTerpakai += it.weight;
      points.push({x:best.x+best.w,y:best.y,z:best.z});
      points.push({x:best.x,y:best.y+best.h,z:best.z});
      points.push({x:best.x,y:best.y,z:best.z+best.d});
      // pangkas: buang titik yang kini tertutup box baru (tidak mungkin jadi posisi)
      const b = best;
      points = points.filter(p =>
        !(p.x >= b.x-EPS && p.x < b.x+b.w-EPS &&
          p.y >= b.y-EPS && p.y < b.y+b.h-EPS &&
          p.z >= b.z-EPS && p.z < b.z+b.d-EPS));
      // dedup titik
      const seen = new Set();
      points = points.filter(p => {
        const k = p.x+'|'+p.y+'|'+p.z;
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });
    } else unfitted.push(it.id);
  }

  const binVol = W*H*D;
  const usedVol = placed.reduce((s,b)=>s+b.w*b.h*b.d,0);
  const berat = mf.filter(m=>!unfitted.includes(m.id)).reduce((s,m)=>s+m.weight,0);
  const terlaluBesar = mf.filter(m=>{
    const [a,c,e] = [m.length, m.width, m.height];
    const orients = [[c,e,a],[a,e,c],[c,a,e],[e,a,c],[a,c,e],[e,c,a]];
    const adaYangMuat = orients.some(([w,h,d]) => w<=W && h<=H && d<=D);
    return !adaYangMuat;
  }).map(m=>m.id);

  return {
    fill:+(usedVol/binVol*100).toFixed(1), placed, unfitted,
    muat:placed.length, tidakMuat:unfitted.length,
    berat:+berat.toFixed(1), kapasitasBerat:fleet.max_weight,
    dim:{W,H,D}, terlaluBesar, usedVol, binVol,
  };
}

// LEVEL 2: multi-start — jalankan beberapa strategi urutan barang,
// pilih hasil terbaik: barang termuat terbanyak > fill tertinggi > tumpukan terata.
function stdTumpukan(placed) {
  if (placed.length === 0) return 0;
  const h = {};
  placed.forEach(b => {
    const k = Math.round(b.x/20)+'_'+Math.round(b.z/20);
    h[k] = Math.max(h[k]||0, b.y+b.h);
  });
  const v = Object.values(h);
  const avg = v.reduce((a,b)=>a+b,0)/v.length;
  return Math.sqrt(v.reduce((a,b)=>a+(b-avg)**2,0)/v.length);
}

function packItems(mf, fleet) {
  // strategi urutan (deterministik semua — hasil demo selalu konsisten)
  const strategi = [
    (a,b) => b.vol - a.vol,                                          // volume terbesar
    (a,b) => Math.max(b.length,b.width,b.height) - Math.max(a.length,a.width,a.height), // dimensi terpanjang
    (a,b) => (b.length*b.width) - (a.length*a.width),                // tapak terluas
    (a,b) => b.height - a.height,                                    // tertinggi dulu
  ];
  // batasi jumlah strategi untuk manifest besar agar tetap responsif
  const n = mf.length;
  const dipakai = n > 150 ? strategi.slice(0,1) : n > 80 ? strategi.slice(0,2) : strategi;

  let best = null, bestStd = Infinity;
  for (const s of dipakai) {
    const r = packSekaliJalan(mf, fleet, s);
    const rStd = stdTumpukan(r.placed);
    if (!best ||
        r.muat > best.muat ||
        (r.muat === best.muat && r.fill > best.fill) ||
        (r.muat === best.muat && r.fill === best.fill && rStd < bestStd)) {
      best = r; bestStd = rStd;
    }
  }
  return best;
}

// Versi CEPAT (single-pass, tanpa snug) — dipakai untuk EKSPLORASI kombinasi truk.
// Hasil kombinasi terpilih nanti di-pack ulang dengan packItems penuh untuk visual.
function packItemsCepat(mf, fleet) {
  return packSekaliJalan(mf, fleet, (a,b) => b.vol - a.vol, { tanpaSnug: true });
}

// ------------------------------------------------------------
// 4b. PENCARI KOMBINASI TRUK OPTIMAL (multi-bin + minimasi biaya)
// ------------------------------------------------------------
// Muat barang ke SATU truk, kembalikan barang yang muat + yang tersisa.
// cepat=true memakai engine eksplorasi (untuk pencarian kombinasi).
function packSatuTruk(mf, fleet, cepat = false) {
  const res = cepat ? packItemsCepat(mf, fleet) : packItems(mf, fleet);
  const idMuat = new Set(res.placed.map(b => b.id));
  const muat = mf.filter(m => idMuat.has(m.id));
  const sisa = mf.filter(m => !idMuat.has(m.id));
  return { res, muat, sisa };
}

// Strategi greedy: pakai truk `fleet` berkali-kali sampai semua barang habis.
// Kembalikan daftar "trip" (tiap trip = 1 truk + isinya) atau null kalau ada
// barang yang tak muat di truk jenis ini sama sekali (kebesaran).
function packBerulang(mf, fleet, maxTruk = 60) {
  const trips = [];
  let sisa = mf.slice();
  let guard = 0;
  while (sisa.length > 0 && guard < maxTruk) {
    const { res, muat, sisa: sisaBaru } = packSatuTruk(sisa, fleet, true);
    if (muat.length === 0) return null; // ada barang yang tak mungkin muat
    trips.push({ fleet, res, jumlahBarang: muat.length, barang: muat });
    sisa = sisaBaru;
    guard++;
  }
  if (sisa.length > 0) return null; // masih ada sisa setelah maxTruk
  return trips;
}

// Cari kombinasi truk paling murah yang memuat SEMUA barang.
// Mengevaluasi beberapa strategi dan memilih total biaya terendah.
function cariKombinasiOptimal(mf, fleets) {
  const kandidat = []; // { label, trips, totalBiaya, totalTruk, fillRata }

  // Strategi A: satu jenis truk dipakai berulang (untuk tiap jenis truk)
  for (const f of fleets) {
    const trips = packBerulang(mf, f);
    if (trips) {
      kandidat.push(bungkusKandidat(`${trips.length}× ${f.nama}`, trips));
    }
  }

  // Strategi B: greedy campur — pakai truk termurah-per-volume dulu,
  // isi semaksimal mungkin, sisanya cari truk paling pas (biaya terkecil
  // yang muat sisa dalam 1 truk). Ini menangkap kasus "2 kecil < 1 sedang".
  const byEff = [...fleets].sort((a,b) => {
    const volA = a.length*a.width*a.height, volB = b.length*b.width*b.height;
    return (a.biaya/volA) - (b.biaya/volB); // biaya per cm³ termurah dulu
  });
  for (const trukAwal of fleets) {
    const trips = [];
    let sisa = mf.slice();
    let guard = 0;
    while (sisa.length > 0 && guard < 60) {
      // pilih truk: kalau sisa sedikit, cari truk termurah yang muat semua sisa;
      // kalau tidak, pakai truk awal (kapasitas besar) untuk borong.
      let pilih = null;
      // cari truk termurah yang bisa muat SEMUA sisa dalam 1 truk
      const volSisa = sisa.reduce((s,m)=>s+m.length*m.width*m.height,0);
      const beratSisa = sisa.reduce((s,m)=>s+m.weight,0);
      const muatSemua = fleets
        .filter(f => f.length*f.width*f.height*0.95 >= volSisa &&
                     (f.max_weight||Infinity) >= beratSisa) // gating: skip yg mustahil
        .map(f => ({ f, r: packSatuTruk(sisa, f, true) }))
        .filter(x => x.r.sisa.length === 0)
        .sort((a,b) => a.f.biaya - b.f.biaya);
      if (muatSemua.length > 0) {
        pilih = muatSemua[0].f;
        trips.push({ fleet: pilih, res: muatSemua[0].r.res, jumlahBarang: muatSemua[0].r.muat.length, barang: muatSemua[0].r.muat });
        sisa = [];
      } else {
        // belum ada yang muat semua sisa; borong pakai truk awal
        const { res, muat, sisa: sisaBaru } = packSatuTruk(sisa, trukAwal, true);
        if (muat.length === 0) { trips.length = 0; break; }
        trips.push({ fleet: trukAwal, res, jumlahBarang: muat.length, barang: muat });
        sisa = sisaBaru;
      }
      guard++;
    }
    if (trips.length > 0 && sisa.length === 0) {
      kandidat.push(bungkusKandidat('Kombinasi campur', trips));
    }
  }

  if (kandidat.length === 0) return null;

  // pilih total biaya termurah; kalau seri, fill rata-rata tertinggi
  kandidat.sort((a,b) =>
    a.totalBiaya - b.totalBiaya || b.fillRata - a.fillRata);

  // buang duplikat (label + biaya sama)
  const unik = [];
  const seen = new Set();
  for (const k of kandidat) {
    const key = k.totalBiaya + '|' + k.trips.map(t=>t.fleet.nama).sort().join(',');
    if (!seen.has(key)) { seen.add(key); unik.push(k); }
  }
  return unik;
}

function bungkusKandidat(label, trips) {
  const totalBiaya = trips.reduce((s,t) => s + (t.fleet.biaya||0), 0);
  const fillRata = trips.reduce((s,t) => s + t.res.fill, 0) / trips.length;
  return {
    label, trips, totalBiaya, totalTruk: trips.length,
    fillRata: +fillRata.toFixed(1),
  };
}

// ------------------------------------------------------------
// 5. VISUALISASI 3D — mendukung banyak canvas sekaligus
// ------------------------------------------------------------
let vizList = []; // { renderer, scene, camera, rot, canvas }

function hancurkanSemuaViz() {
  vizList.forEach(v => { try { v.renderer.dispose(); } catch(e){} });
  vizList = [];
  document.getElementById('vizArea').innerHTML = '';
}

// Gambar wireframe truk + penanda sisi PINTU (belakang, z = D) via warna.
// Sisi z=0 = depan (dinding tertutup). Barang dimuat dari depan ke pintu.
function gambarKontainer(scene, W, H, D) {
  const ox=-W/2, oy=-H/2, oz=-D/2;

  // wireframe utuh (cyan)
  scene.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(W,H,D)),
    new THREE.LineBasicMaterial({color:0x3ad9c5})
  ));

  // ---- SISI PINTU (belakang, z = D): bidang oranye + bingkai oranye tebal ----
  const doorZ = oz + D;
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({ color:0xffb338, transparent:true, opacity:0.18, side:THREE.DoubleSide }));
  door.position.set(0, 0, doorZ);
  scene.add(door);
  const df = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(W, H)),
    new THREE.LineBasicMaterial({color:0xffb338}));
  df.position.set(0, 0, doorZ);
  scene.add(df);

  // ---- SISI DEPAN (tertutup, z = 0): bidang gelap solid (dinding) ----
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({ color:0x1d2832, transparent:true, opacity:0.6, side:THREE.DoubleSide }));
  back.position.set(0, 0, oz);
  scene.add(back);

  // ---- LANTAI (biar barang terlihat "duduk") ----
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshBasicMaterial({color:0x10191f, transparent:true, opacity:0.5, side:THREE.DoubleSide}));
  floor.rotation.x = -Math.PI/2;
  floor.position.set(0, oy, 0);
  scene.add(floor);
}

function buatVizCard(fleetNama, res, opts) {
  // opts: { recommended, index, mode }
  const area = document.getElementById('vizArea');

  const card = document.createElement('div');
  card.className = 'viz-card' + (opts.mode==='compare' ? ' clickable' : '');
  card.innerHTML = `
    <div class="viz-head">
      <div class="viz-title">
        ${fleetNama}
        ${opts.recommended ? '<span class="badge-rec">★ REKOMENDASI</span>' : ''}
      </div>
      <div class="viz-fill ${res.fill>=70?'good':res.fill>=50?'warn':'bad'}">${res.fill}% terisi</div>
    </div>
    <div class="viz-sub">${res.muat}/${res.muat+res.tidakMuat} barang muat · ${res.berat}/${res.kapasitasBerat} kg</div>
  `;
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'viz-canvas-wrap';
  const canvas = document.createElement('canvas');
  canvas.className = 'viz-canvas';
  canvasWrap.appendChild(canvas);
  // tooltip hover
  const tip = document.createElement('div');
  tip.className = 'viz-tooltip';
  tip.style.display = 'none';
  canvasWrap.appendChild(tip);
  card.appendChild(canvasWrap);

  if (opts.mode==='compare') {
    const hint = document.createElement('div');
    hint.className = 'viz-click-hint';
    hint.textContent = 'Klik untuk lihat insight →';
    card.appendChild(hint);
    card.addEventListener('click', () => pilihReferensi(opts.index));
  }
  area.appendChild(card);

  // setup three.js
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1418);
  const camera = new THREE.PerspectiveCamera(50, w/h, 1, 8000);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(window.devicePixelRatio);
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const dir = new THREE.DirectionalLight(0xffffff, 0.55);
  dir.position.set(1,2,1); scene.add(dir);

  const {W,H,D} = res.dim;
  gambarKontainer(scene, W, H, D);
  const ox=-W/2, oy=-H/2, oz=-D/2;

  // buat SEMUA mesh barang sekarang (tapi bisa disembunyikan untuk animasi)
  const boxMeshes = []; // { mesh, edge, name, id }
  res.placed.forEach(b => {
    const geo = new THREE.BoxGeometry(b.w*0.96, b.h*0.96, b.d*0.96);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({color:warnaUntuk(b.name)}));
    mesh.position.set(ox+b.x+b.w/2, oy+b.y+b.h/2, oz+b.z+b.d/2);
    mesh.userData = { name: b.name, id: b.id };
    scene.add(mesh);
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({color:0x0e1418})
    );
    edge.position.copy(mesh.position);
    scene.add(edge);
    boxMeshes.push({ mesh, edge, name:b.name, id:b.id });
  });

  const viz = {
    renderer, scene, camera, canvas, boxMeshes,
    rot: { y:0.6, x:0.4, dist: Math.max(W,H,D)*2.3 },
    dragging:false, px:0, py:0,
    raycaster: new THREE.Raycaster(),
    mouse: new THREE.Vector2(),
    tip,
    // status animasi: -1 = tampil semua (mode normal). >=0 = jumlah barang tampak.
    animStep: -1,
  };

  // ---- fungsi kontrol tampilan (dipakai animasi) ----
  viz.updateVisibility = () => {
    if (viz.animStep < 0) {
      boxMeshes.forEach(bm => { bm.mesh.visible = true; bm.edge.visible = true; });
    } else {
      boxMeshes.forEach((bm,i) => {
        const show = i < viz.animStep;
        bm.mesh.visible = show; bm.edge.visible = show;
      });
    }
  };

  // ---- animasi masuk bertahap saat pertama render (mode normal) ----
  if (opts.mode === 'compare') {
    // di komparasi: langsung tampil semua, animasi cepat
    let n = 0;
    boxMeshes.forEach(bm => { bm.mesh.visible=false; bm.edge.visible=false; });
    const token = Symbol(); card._token = token;
    (function pop(){
      if (card._token!==token) return;
      if (n >= boxMeshes.length) return;
      boxMeshes[n].mesh.visible=true; boxMeshes[n].edge.visible=true;
      n++; setTimeout(pop, 25);
    })();
  }
  // di mode single: default tampil semua (kontrol animasi manual via panel kanan)

  // ---- interaksi mouse: drag rotate, wheel zoom, hover tooltip ----
  canvas.addEventListener('mousedown', e => {
    viz.dragging=true; viz.px=e.clientX; viz.py=e.clientY;
    viz.startX=e.clientX; viz.startY=e.clientY; e.stopPropagation();
  });
  window.addEventListener('mouseup', () => viz.dragging=false);
  canvas.addEventListener('mousemove', e => {
    // update posisi mouse untuk raycaster (koordinat -1..1)
    const rect = canvas.getBoundingClientRect();
    viz.mouse.x = ((e.clientX-rect.left)/rect.width)*2 - 1;
    viz.mouse.y = -((e.clientY-rect.top)/rect.height)*2 + 1;
    viz.tipX = e.clientX - rect.left;
    viz.tipY = e.clientY - rect.top;
  });
  window.addEventListener('mousemove', e => {
    if (!viz.dragging) return;
    viz.rot.y += (e.clientX-viz.px)*0.008;
    viz.rot.x += (e.clientY-viz.py)*0.008;
    viz.rot.x = Math.max(-1.4, Math.min(1.4, viz.rot.x));
    viz.px=e.clientX; viz.py=e.clientY;
  });
  canvas.addEventListener('mouseleave', () => { viz.tip.style.display='none'; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault(); e.stopPropagation();
    viz.rot.dist *= (1+e.deltaY*0.001);
    viz.rot.dist = Math.max(200, Math.min(5000, viz.rot.dist));
  }, {passive:false});
  canvas.addEventListener('click', e => {
    const jarak = Math.abs(e.clientX-(viz.startX||0)) + Math.abs(e.clientY-(viz.startY||0));
    if (jarak > 6) e.stopPropagation();
  });

  vizList.push(viz);
  return viz;
}

function animateAll() {
  requestAnimationFrame(animateAll);
  for (const v of vizList) {
    if (v._mini) v.rot.y += 0.004; // mini card berputar pelan otomatis
    const {y,x,dist} = v.rot;
    v.camera.position.set(
      Math.sin(y)*Math.cos(x)*dist,
      Math.sin(x)*dist,
      Math.cos(y)*Math.cos(x)*dist
    );
    v.camera.lookAt(0,0,0);
    const w = v.canvas.clientWidth, h = v.canvas.clientHeight;
    if (w>0 && v.canvas.width !== Math.floor(w*window.devicePixelRatio)) {
      v.renderer.setSize(w, h, false);
      v.camera.aspect = w/h;
      v.camera.updateProjectionMatrix();
    }

    // hover tooltip: tembak sinar dari kursor, cari box terdekat yang tampak
    if (v.raycaster && v.tip && !v.dragging) {
      v.raycaster.setFromCamera(v.mouse, v.camera);
      const visibleMeshes = v.boxMeshes.filter(bm=>bm.mesh.visible).map(bm=>bm.mesh);
      const hits = v.raycaster.intersectObjects(visibleMeshes, false);
      if (hits.length > 0) {
        const obj = hits[0].object;
        v.tip.textContent = `${obj.userData.id} · ${obj.userData.name}`;
        v.tip.style.display = 'block';
        v.tip.style.left = (v.tipX + 12) + 'px';
        v.tip.style.top = (v.tipY + 12) + 'px';
      } else {
        v.tip.style.display = 'none';
      }
    }

    v.renderer.render(v.scene, v.camera);
  }
}
animateAll();

// ------------------------------------------------------------
// 6. UI ARMADA — form input + daftar tersimpan
// ------------------------------------------------------------
function renderDaftarArmada() {
  const box = document.getElementById('daftarArmada');
  if (FLEETS.length === 0) {
    box.innerHTML = '<div class="fleet-empty">Belum ada armada tersimpan.<br>Tambahkan lewat form di atas.</div>';
    return;
  }
  box.innerHTML = FLEETS.map((f,i) => `
    <label class="fleet-item ${f.tersedia ? '' : 'unavail'}">
      <input type="checkbox" class="fleet-check" data-i="${i}" ${f.tersedia ? '' : 'disabled'}>
      <span class="fleet-info">
        <b>${f.nama}</b>
        <small>${f.length}×${f.width}×${f.height} cm · max ${f.max_weight} kg · ${rupiah(f.biaya||0)}/trip</small>
      </span>
      <button class="fleet-avail ${f.tersedia ? 'on' : 'off'}" data-i="${i}"
        title="${f.tersedia ? 'Klik untuk tandai TIDAK tersedia' : 'Klik untuk tandai tersedia'}">
        ${f.tersedia ? '● Avail' : '○ N/A'}
      </button>
      <button class="fleet-del" data-i="${i}" title="Hapus armada">✕</button>
    </label>
  `).join('');

  box.querySelectorAll('.fleet-avail').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const i = +btn.dataset.i;
      FLEETS[i].tersedia = !FLEETS[i].tersedia;
      saveFleets(FLEETS);
      renderDaftarArmada();
    });
  });

  box.querySelectorAll('.fleet-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const i = +btn.dataset.i;
      if (confirm(`Hapus armada "${FLEETS[i].nama}"?`)) {
        FLEETS.splice(i,1);
        saveFleets(FLEETS);
        renderDaftarArmada();
      }
    });
  });
}

document.getElementById('btnSimpanArmada').addEventListener('click', () => {
  const nama = document.getElementById('inNama').value.trim();
  const p = +document.getElementById('inP').value;
  const l = +document.getElementById('inL').value;
  const t = +document.getElementById('inT').value;
  const b = +document.getElementById('inB').value || 99999;
  const biaya = +document.getElementById('inBiaya').value;
  if (!nama) { alert('Beri nama armada dulu.'); return; }
  if (!(p>0 && l>0 && t>0)) { alert('Dimensi (P, L, T) harus angka positif dalam cm.'); return; }
  if (!(biaya>0)) { alert('Biaya operasional per trip harus diisi (angka positif).'); return; }
  if (FLEETS.some(f => f.nama.toLowerCase() === nama.toLowerCase())) {
    alert('Nama armada sudah ada. Pakai nama lain.'); return;
  }
  FLEETS.push({ nama, length:p, width:l, height:t, max_weight:b, biaya, tersedia: true });
  saveFleets(FLEETS);
  renderDaftarArmada();
  ['inNama','inP','inL','inT','inB','inBiaya'].forEach(id => document.getElementById(id).value='');
});

// ------------------------------------------------------------
// 7. INSIGHT PANEL (kanan)
// ------------------------------------------------------------
function rupiah(n){ return 'Rp ' + n.toLocaleString('id-ID'); }

let hasilRun = []; // [{fleet, res}] hasil run terakhir
let idxRekomendasi = -1;

function renderInsight(idx) {
  const {fleet, res} = hasilRun[idx];
  const keliling = 2*Math.PI*56;
  const isi = keliling*(res.fill/100);
  const beratClass = res.berat > res.kapasitasBerat ? 'bad' : 'good';

  let statusFill;
  if (res.fill >= 80) statusFill = `<span class="good">● Sangat efisien</span> — ruang kargo dimanfaatkan dengan optimal.`;
  else if (res.fill >= 60) statusFill = `<span class="warn">● Cukup efisien</span> — masih ada ruang tersisa.`;
  else statusFill = `<span class="bad">● Kurang efisien</span> — banyak ruang terbuang. Pertimbangkan kendaraan lebih kecil.`;

  let saranTambahan = '';
  if (res.tidakMuat > 0) {
    const jb = res.terlaluBesar.length;
    const jp = res.tidakMuat - jb;
    if (jb>0) saranTambahan += `<div class="insight-row warn-row">⚠ <b>${jb} barang terlalu besar</b> untuk armada ini (${res.terlaluBesar.join(', ')}). Perlu dikemas ulang atau armada lebih besar.</div>`;
    if (jp>0) saranTambahan += `<div class="insight-row warn-row">⚠ <b>${jp} barang tidak muat</b> karena kapasitas penuh. Butuh kendaraan tambahan.</div>`;
  } else {
    saranTambahan = `<div class="insight-row good-row">✓ Semua barang berhasil dimuat dalam satu kendaraan.</div>`;
  }

  // rekomendasi (hanya di mode komparasi)
  let rekomHtml = '';
  if (hasilRun.length > 1 && idxRekomendasi >= 0) {
    const rec = hasilRun[idxRekomendasi];
    if (idx === idxRekomendasi) {
      rekomHtml = `<div class="insight-row good-row">★ Armada ini adalah <b>rekomendasi terbaik</b> — barang termuat terbanyak dengan fill rate tertinggi.</div>`;
    } else {
      rekomHtml = `<div class="insight-row">★ Rekomendasi sistem: <b>${rec.fleet.nama}</b> (${rec.res.fill}% terisi, ${rec.res.muat} barang muat).</div>`;
    }
  }

  // estimasi biaya operasional per rute (hasil optimasi)
  const ruteOptimasi = Math.max(1, Math.ceil(res.usedVol / (res.binVol * res.fill/100)));
  const totalBiaya = ruteOptimasi * BIAYA_PER_RUTE;

  document.getElementById('hasilArea').innerHTML = `
    <div class="ref-label">Armada: <b>${fleet.nama}</b></div>
    <div class="gauge-wrap">
      <div class="gauge">
        <svg width="140" height="140">
          <circle cx="70" cy="70" r="56" fill="none" stroke="#2a3742" stroke-width="11"/>
          <circle cx="70" cy="70" r="56" fill="none" stroke="#ffb338" stroke-width="11"
            stroke-dasharray="${isi} ${keliling}" stroke-linecap="round"/>
        </svg>
        <div class="val"><div class="num">${res.fill}%</div><div class="cap">Terisi</div></div>
      </div>
    </div>
    <div class="stat"><span class="k">Barang termuat</span><span class="v ${res.tidakMuat?'warn':'good'}">${res.muat} dari ${res.muat+res.tidakMuat}</span></div>
    <div class="stat"><span class="k">Berat muatan</span><span class="v ${beratClass}">${res.berat} / ${res.kapasitasBerat} kg</span></div>
    <div class="stat"><span class="k">Ruang tidak terpakai</span><span class="v warn">${(100-res.fill).toFixed(1)}%</span></div>

    <div class="insight-box">
      <div class="insight-title">💡 Insight Optimasi</div>
      <div class="insight-row">${statusFill}</div>
      ${saranTambahan}
      ${rekomHtml}
      <div class="insight-row">📦 Barang terbesar dimuat lebih dulu untuk memaksimalkan kepadatan.</div>
    </div>

    <div class="saving">
      <div class="cap">Estimasi biaya operasional per rute (dengan optimasi)</div>
      <div class="big">${rupiah(totalBiaya)}</div>
      <div class="sub">
        Dengan fill rate <b style="color:#46d17e">${res.fill}%</b>, volume barang ini membutuhkan
        <b style="color:#46d17e">${ruteOptimasi} rute</b> × ${rupiah(BIAYA_PER_RUTE)}/rute.
        Setiap rute membawa muatan ${res.fill}% kapasitas — meminimalkan biaya per unit barang.
      </div>
    </div>

    <div class="label" style="margin-top:18px;">Urutan Muat</div>
    ${hasilRun.length===1 || document.getElementById('vizArea').classList.contains('viz-single') ? `
    <div class="anim-panel">
      <div class="anim-status" id="animStatus">Mode animasi: nonaktif</div>
      <div class="anim-controls" id="animControls">
        <button class="anim-btn start" id="btnAnimStart">▶ Start Animation</button>
      </div>
    </div>` : ''}
    <div class="loadlist" id="loadlist">
      ${res.placed.map((b,i)=>`
        <div class="load-item" data-step="${i}">
          <span class="load-num">${i+1}</span>
          <span class="load-dot" style="background:${warnaUntuk(b.name)}"></span>
          <span>${b.id} · ${b.name}</span>
        </div>`).join('')}
    </div>
  `;

  // pasang kontrol animasi (kalau ada)
  setupAnimasi(res);
}

// ---- KONTROL ANIMASI step-by-step ----
function setupAnimasi(res) {
  const controls = document.getElementById('animControls');
  if (!controls) return; // bukan mode fokus
  const viz = vizList[0];
  if (!viz) return;

  const total = res.placed.length;
  const status = document.getElementById('animStatus');
  const loadlist = document.getElementById('loadlist');

  function highlightBaris(step) {
    [...loadlist.querySelectorAll('.load-item')].forEach((el,i) => {
      el.classList.remove('active','done');
      if (i < step) el.classList.add('done');
      if (i === step-1) { el.classList.add('active');
        el.scrollIntoView({block:'nearest', behavior:'smooth'}); }
    });
  }
  function updateStatus(step) {
    if (step <= 0) status.textContent = `Truk kosong — belum ada barang`;
    else if (step >= total) status.textContent = `Selesai — semua ${total} barang tersusun`;
    else status.textContent = `Barang ${step} dari ${total} · ${res.placed[step-1].name}`;
  }
  function render(step) {
    viz.animStep = step;
    viz.updateVisibility();
    highlightBaris(step);
    updateStatus(step);
  }

  function tampilMode(aktif) {
    if (!aktif) {
      // mode nonaktif: tombol start saja, semua barang tampil
      viz.animStep = -1; viz.updateVisibility();
      [...loadlist.querySelectorAll('.load-item')].forEach(el=>el.classList.remove('active','done'));
      status.textContent = 'Mode animasi: nonaktif';
      controls.innerHTML = `<button class="anim-btn start" id="btnAnimStart">▶ Start Animation</button>`;
      document.getElementById('btnAnimStart').onclick = () => { render(1); tampilMode(true); };
    } else {
      // mode aktif: prev/next/exit
      controls.innerHTML = `
        <button class="anim-btn" id="btnPrev">◀ Previous</button>
        <button class="anim-btn" id="btnNext">Next ▶</button>
        <button class="anim-btn exit" id="btnExit">✕ Exit</button>
      `;
      document.getElementById('btnPrev').onclick = () => render(Math.max(0, viz.animStep-1));
      document.getElementById('btnNext').onclick = () => render(Math.min(total, viz.animStep+1));
      document.getElementById('btnExit').onclick = () => { tampilMode(false); };
    }
  }

  tampilMode(false); // awal: nonaktif
}

function pilihReferensi(idx) {
  // klik card di mode komparasi -> FOKUS ke armada itu (tampilan tunggal)
  fokusArmada(idx);
}

// tampilkan grid komparasi (semua armada hasil run)
function tampilkanKomparasi() {
  hancurkanSemuaViz();
  document.getElementById('vizArea').className = 'viz-grid';
  hasilRun.forEach((h,i) => {
    buatVizCard(h.fleet.nama, h.res, {
      recommended: i===idxRekomendasi,
      index: i, mode: 'compare',
    });
  });
  document.getElementById('hasilArea').innerHTML = `
    <div class="empty">
      Mode komparasi aktif.<br><br>
      <b style="color:var(--amber)">Klik salah satu armada</b> di tengah<br>
      untuk fokus dan melihat insight lengkapnya.<br><br>
      Rekomendasi sistem ditandai <span style="color:var(--amber)">★</span>
    </div>`;
}

// fokus ke satu armada: tampilan tunggal penuh + tombol kembali
function fokusArmada(idx) {
  hancurkanSemuaViz();
  const area = document.getElementById('vizArea');
  area.className = 'viz-single';

  // tombol kembali ke komparasi (hanya kalau memang ada >1 hasil)
  if (hasilRun.length > 1) {
    const back = document.createElement('button');
    back.className = 'btn-back';
    back.innerHTML = '← Kembali ke komparasi';
    back.addEventListener('click', e => {
      e.stopPropagation();
      tampilkanKomparasi();
    });
    area.appendChild(back);
  }

  const h = hasilRun[idx];
  buatVizCard(h.fleet.nama, h.res, {
    recommended: hasilRun.length > 1 && idx===idxRekomendasi,
    index: idx, mode: 'single',
  });
  renderInsight(idx);
}

// ------------------------------------------------------------
// 8. RUN — mode tunggal vs komparasi
// ------------------------------------------------------------
function jalankan() {
  if (!manifest || manifest.length === 0) {
    alert('Upload file CSV barang dulu.');
    return;
  }
  // ambil armada yang DICENTANG dan TERSEDIA (tanpa batas jumlah)
  const dipilih = [...document.querySelectorAll('.fleet-check:checked')]
    .map(c => FLEETS[+c.dataset.i])
    .filter(f => f && f.tersedia);
  if (dipilih.length === 0) {
    alert('Centang minimal 1 armada yang tersedia.');
    return;
  }
  if (dipilih.some(f => !f.biaya || f.biaya <= 0)) {
    alert('Semua armada terpilih harus punya biaya operasional (Rp/trip).');
    return;
  }

  // SISTEM TERPADU: cari rencana truk paling optimal dari armada terpilih.
  // Bisa 1 truk, bisa berulang armada sama (mis. 5× Blind Van), bisa campur
  // (mis. 2× besar + 1× kecil untuk sisa) — dipilih yang total biayanya termurah.
  const kandidat = cariKombinasiOptimal(manifest, dipilih);
  if (!kandidat || kandidat.length === 0) {
    alert('Tidak ada rencana yang bisa memuat semua barang dengan armada terpilih.\nKemungkinan ada barang yang terlalu besar — coba centang armada yang lebih besar.');
    return;
  }

  const rekom = kandidat[0]; // termurah
  // FINALISASI: pack ulang tiap truk rencana terpilih dengan engine penuh
  // (multi-start + snug) supaya visual & susunan berkualitas maksimal.
  rekom.trips.forEach(t => {
    if (t.barang && t.barang.length) {
      const resFinal = packItems(t.barang, t.fleet);
      if (resFinal.muat >= t.res.muat) {
        t.res = resFinal;
        t.jumlahBarang = resFinal.muat;
      }
    }
  });
  rekom.fillRata = +(rekom.trips.reduce((s,t)=>s+t.res.fill,0)/rekom.trips.length).toFixed(1);
  komboAktif = rekom;
  komboKandidat = kandidat;

  if (rekom.totalTruk === 1) {
    fokusKomboTruk(0); // 1 truk -> langsung tampilan tunggal + insight
  } else {
    tampilkanKomboCard(); // >1 truk -> card ringkasan berisi mini-grid
  }

  const totVol = (manifest.reduce((s,m)=>s+m.length*m.width*m.height,0)/1e6).toFixed(2);
  document.getElementById('infoBox').innerHTML =
    `Manifest: <b>${manifest.length} barang</b><br>Total volume: <b>${totVol} m³</b><br>Rencana: <b>${rekom.totalTruk} truk (${rupiah(rekom.totalBiaya)})</b>`;
}

// ---- MODE: cari kombinasi truk paling optimal (biaya termurah) ----
let komboAktif = null; // simpan hasil kombinasi terpilih untuk fokus per-truk
let komboKandidat = []; // semua kandidat (untuk alternatif)

// canvas mini read-only untuk grid di dalam kombo-card (tanpa interaksi berat)
function buatVizMini(canvas, res) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1418);
  const w = canvas.clientWidth||200, h = canvas.clientHeight||150;
  const camera = new THREE.PerspectiveCamera(50, w/h, 1, 8000);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(window.devicePixelRatio);
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dir = new THREE.DirectionalLight(0xffffff, 0.5);
  dir.position.set(1,2,1); scene.add(dir);

  const {W,H,D} = res.dim;
  gambarKontainer(scene, W, H, D);
  const ox=-W/2, oy=-H/2, oz=-D/2;
  res.placed.forEach(b => {
    const geo = new THREE.BoxGeometry(b.w*0.96, b.h*0.96, b.d*0.96);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({color:warnaUntuk(b.name)}));
    mesh.position.set(ox+b.x+b.w/2, oy+b.y+b.h/2, oz+b.z+b.d/2);
    scene.add(mesh);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({color:0x0e1418}));
    edge.position.copy(mesh.position); scene.add(edge);
  });

  const viz = { renderer, scene, camera, canvas,
    rot:{ y:0.6, x:0.4, dist: Math.max(W,H,D)*2.4 },
    boxMeshes:[], _mini:true };
  vizList.push(viz);
}

// tampilkan SATU card berisi semua truk rekomendasi (mini-grid di dalamnya)
function tampilkanKomboCard() {
  const rekom = komboAktif;
  hancurkanSemuaViz();
  const area = document.getElementById('vizArea');
  area.className = 'viz-single';
  area.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'viz-card kombo-card clickable';
  card.innerHTML = `
    <div class="viz-head">
      <div class="viz-title">🏆 Kombinasi Termurah — ${rekom.totalTruk} Truk</div>
      <div class="viz-fill good">${rupiah(rekom.totalBiaya)}</div>
    </div>
    <div class="viz-sub">${rekom.trips.map(t=>t.fleet.nama).join(' + ')} · fill rata ${rekom.fillRata}% · semua ${manifest.length} barang termuat</div>
  `;
  // grid mini: 1 canvas kecil per truk
  const grid = document.createElement('div');
  grid.className = 'kombo-mini-grid';
  card.appendChild(grid);
  area.appendChild(card);

  hasilRun = rekom.trips.map(tr => ({ fleet: tr.fleet, res: tr.res }));

  rekom.trips.forEach((t,i) => {
    const cell = document.createElement('div');
    cell.className = 'kombo-mini-cell';
    cell.innerHTML = `<div class="mini-label">Truk ${i+1}: ${t.fleet.nama} · ${t.res.fill}%</div>`;
    const canvas = document.createElement('canvas');
    canvas.className = 'mini-canvas';
    cell.appendChild(canvas);
    grid.appendChild(cell);
    buatVizMini(canvas, t.res);
  });

  // klik card -> fokus truk pertama dengan navigasi panah
  card.addEventListener('click', () => fokusKomboTruk(0));

  // panel kanan: ringkasan biaya + alternatif
  renderKomboInsight();
}

function renderKomboInsight() {
  const rekom = komboAktif;
  const alt = komboKandidat.slice(1, 4);
  document.getElementById('hasilArea').innerHTML = `
    <div class="ref-label">🏆 Kombinasi Termurah</div>
    <div class="saving" style="margin-top:8px;">
      <div class="cap">Total biaya operasional</div>
      <div class="big">${rupiah(rekom.totalBiaya)}</div>
      <div class="sub">
        <b style="color:#46d17e">${rekom.totalTruk} truk</b> (${rekom.trips.map(t=>t.fleet.nama).join(' + ')}),
        fill rata-rata <b style="color:#46d17e">${rekom.fillRata}%</b>.
        Semua ${manifest.length} barang termuat.
      </div>
    </div>

    <div class="insight-box">
      <div class="insight-title">💡 Kenapa kombinasi ini?</div>
      <div class="insight-row good-row">✓ Ini opsi dengan <b>total biaya operasional terendah</b> yang memuat semua barang.</div>
      ${rekom.trips.map((t,i)=>`<div class="insight-row">🚚 Truk ${i+1} — <b>${t.fleet.nama}</b>: ${t.jumlahBarang} barang, ${t.res.fill}% terisi, ${rupiah(t.fleet.biaya)}.</div>`).join('')}
    </div>

    ${alt.length ? `
    <div class="label" style="margin-top:18px;">Alternatif (lebih mahal)</div>
    <div class="alt-list">
      ${alt.map(a=>`
        <div class="alt-item">
          <div class="alt-head">
            <span>${a.label} · ${a.totalTruk} truk</span>
            <span class="alt-cost">${rupiah(a.totalBiaya)}</span>
          </div>
          <div class="alt-sub">fill rata ${a.fillRata}% · selisih +${rupiah(a.totalBiaya-rekom.totalBiaya)}</div>
        </div>`).join('')}
    </div>` : ''}

    <div class="insight-row" style="margin-top:14px; color:#5a6e7a; font-size:11px;">
      💡 Klik card di tengah untuk melihat detail muatan tiap truk.
    </div>
  `;
}

// fokus 1 truk dari rencana, dengan panah navigasi antar truk (jika >1 truk)
function fokusKomboTruk(idx) {
  const rekom = komboAktif;
  idx = (idx + rekom.totalTruk) % rekom.totalTruk; // wrap
  hancurkanSemuaViz();
  const area = document.getElementById('vizArea');
  area.className = 'viz-single';
  area.innerHTML = '';

  // baris navigasi hanya kalau rencana >1 truk
  if (rekom.totalTruk > 1) {
    const nav = document.createElement('div');
    nav.className = 'kombo-nav';
    nav.innerHTML = `
      <button class="btn-back" id="komboBack">← Kembali ke ringkasan</button>
      <div class="kombo-nav-arrows">
        <button class="nav-arrow" id="komboPrev" title="Truk sebelumnya">◀</button>
        <span class="nav-indicator">Truk ${idx+1} / ${rekom.totalTruk}</span>
        <button class="nav-arrow" id="komboNext" title="Truk berikutnya">▶</button>
      </div>
    `;
    area.appendChild(nav);
  }

  const t = rekom.trips[idx];
  hasilRun = rekom.trips.map(tr => ({ fleet: tr.fleet, res: tr.res }));
  buatVizCard(rekom.totalTruk > 1 ? `Truk ${idx+1}: ${t.fleet.nama}` : t.fleet.nama, t.res, {
    recommended: false, index: idx, mode: 'single',
  });
  renderInsight(idx);

  if (rekom.totalTruk > 1) {
    document.getElementById('komboBack').onclick = () => tampilkanKomboCard();
    document.getElementById('komboPrev').onclick = () => fokusKomboTruk(idx-1);
    document.getElementById('komboNext').onclick = () => fokusKomboTruk(idx+1);
  }
}

// ------------------------------------------------------------
// 9. CSV UPLOAD + DATA CONTOH
// ------------------------------------------------------------
document.getElementById('fileCsv').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    const baris = ev.target.result.split('\n').filter(b=>b.trim());
    const data = [];
    for (let i=1; i<baris.length; i++) {
      const k = baris[i].split(',');
      if (k.length < 5) continue;
      data.push({
        id:(k[0]||'').trim()||`ITM-${String(i).padStart(3,'0')}`,
        name:(k[1]||'Barang').trim(),
        length:+k[2], width:+k[3], height:+k[4],
        weight:+(k[5]||10),
      });
    }
    if (data.length === 0) {
      alert('CSV kosong atau format salah.\nKolom: id,name,length,width,height,weight');
      return;
    }
    manifest = data;
    const fn = document.getElementById('uploadFilename');
    fn.textContent = `✓ ${file.name} (${data.length} barang)`;
    fn.style.display = 'block';
    document.getElementById('btnResetCsv').style.display = 'block';
  };
  reader.readAsText(file);
});

document.getElementById('btnResetCsv').addEventListener('click', function() {
  manifest = null;
  document.getElementById('fileCsv').value = '';
  document.getElementById('uploadFilename').style.display = 'none';
  this.style.display = 'none';
});

// ------------------------------------------------------------
// MULAI
// ------------------------------------------------------------
document.getElementById('btnRun').addEventListener('click', jalankan);
renderDaftarArmada();