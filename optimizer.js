// ============================================================
// 1. DATA — daftar truk + katalog barang (mirror dari dataset.py)
// ============================================================
const FLEET = {
  "Blind Van":  { length:240, width:160, height:130, max_weight:800 },
  "CDE Engkel": { length:300, width:160, height:170, max_weight:2000 },
  "CDD Colt":   { length:425, width:185, height:190, max_weight:4000 },
};

const CATALOG = [
  ["Lemari Kecil",   120, 80, 60, 35],
  ["Kotak Perkakas",  60, 40, 35, 15],
  ["Dus Dapur",       50, 50, 50, 12],
  ["Kursi Lipat",     90, 60, 20, 14],
  ["Rak Besi",       110, 40, 30, 25],
  ["Dus Elektronik",  45, 35, 30,  6],
  ["Cat 5L",          40, 40, 35, 24],
  ["Pipa Panjang",   150, 20, 20,  8],
  ["Dus Kecil",       25, 20, 20,  3],
  ["Meja Knockdown", 130, 70, 15, 22],
];

const BIAYA_PER_TRIP = 350000;

// STEP B: kalau ada upload CSV, manifest pakai ini (kalau null pakai data acak)
let manifestUpload = null;

// random dengan seed biar hasil konsisten tiap demo
function seededRandom(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function buatManifest(jumlah, seed = 42) {
  const rnd = seededRandom(seed);
  const manifest = [];
  for (let i = 0; i < jumlah; i++) {
    const c = CATALOG[Math.floor(rnd() * CATALOG.length)];
    manifest.push({
      id: `ITM-${String(i+1).padStart(3,'0')}`,
      name: c[0], length: c[1], width: c[2], height: c[3], weight: c[4],
    });
  }
  return manifest;
}

// ============================================================
// 2. ENGINE — algoritma 3D Bin Packing (versi JS, dioptimasi)
// ============================================================
function packItems(manifest, fleet) {
  // urutkan barang dari volume terbesar dulu
  const items = manifest
    .map(it => ({ ...it, vol: it.length * it.width * it.height }))
    .sort((a, b) => b.vol - a.vol);

  const W = fleet.width, H = fleet.height, D = fleet.length;
  const placed = [], unfitted = [];
  let points = [{ x:0, y:0, z:0 }]; // titik kandidat posisi

  function overlap(a, b) {
    return !(a.x+a.w<=b.x || b.x+b.w<=a.x ||
             a.y+a.h<=b.y || b.y+b.h<=a.y ||
             a.z+a.d<=b.z || b.z+b.d<=a.z);
  }
  function fits(box) {
    if (box.x+box.w>W || box.y+box.h>H || box.z+box.d>D) return false;
    for (const p of placed) if (overlap(box, p)) return false;
    if (box.y === 0) return true; // di lantai = aman
    // harus ada penopang di bawah
    for (const p of placed) {
      if (Math.abs(p.y+p.h-box.y) < 0.01 &&
          box.x < p.x+p.w && p.x < box.x+box.w &&
          box.z < p.z+p.d && p.z < box.z+box.d) return true;
    }
    return false;
  }

  for (const it of items) {
    const orientasi = [
      { w:it.width, h:it.height, d:it.length },
      { w:it.length, h:it.height, d:it.width },
    ];
    let best = null, bestScore = Infinity;
    for (const p of points) {
      for (const o of orientasi) {
        const box = { x:p.x, y:p.y, z:p.z, w:o.w, h:o.h, d:o.d, id:it.id, name:it.name };
        if (fits(box)) {
          const score = box.y*10000 + box.z*100 + box.x; // pilih posisi terendah & rapat
          if (score < bestScore) { bestScore = score; best = box; }
        }
      }
    }
    if (best) {
      placed.push(best);
      points.push({ x:best.x+best.w, y:best.y, z:best.z });
      points.push({ x:best.x, y:best.y+best.h, z:best.z });
      points.push({ x:best.x, y:best.y, z:best.z+best.d });
      points = points.filter(p => !(p.x===best.x && p.y===best.y && p.z===best.z));
    } else {
      unfitted.push(it.id);
    }
  }

  const binVol = W * H * D;
  const usedVol = placed.reduce((s, b) => s + b.w*b.h*b.d, 0);
  const beratTotal = manifest
    .filter(m => !unfitted.includes(m.id))
    .reduce((s, m) => s + m.weight, 0);

  // deteksi barang yang memang terlalu besar untuk truk ini (bukan karena penuh)
  const terlaluBesar = manifest.filter(m => {
    const l=m.length, w=m.width, h=m.height;
    // cek semua 2 orientasi, kalau semua nggak muat dimensi truk = kebesaran
    const o1 = w<=W && h<=H && l<=D;
    const o2 = l<=W && h<=H && w<=D;
    return !o1 && !o2;
  }).map(m => m.id);

  return {
    fill: +(usedVol/binVol*100).toFixed(1),
    placed, unfitted,
    muat: placed.length,
    tidakMuat: unfitted.length,
    berat: +beratTotal.toFixed(1),
    kapasitasBerat: fleet.max_weight,
    dim: { W, H, D },
    terlaluBesar, // barang yang dimensinya melebihi truk
  };
}

// STEP D: Simulasi packing MANUAL. Perbedaan kunci vs AI:
// AI mengurutkan barang besar dulu + cari posisi paling rapat.
// Manusia ambil barang seadanya (urutan acak) + taruh di tempat pertama yang muat.
// Hasilnya: ruang lebih banyak terbuang = baseline realistis.
function packManual(manifest, fleet) {
  // acak urutan barang (meniru pengambilan tanpa strategi)
  const items = manifest.map(it => ({ ...it }));
  let s = 12345;
  for (let i = items.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }

  const W = fleet.width, H = fleet.height, D = fleet.length;
  const placed = [], unfitted = [];
  let points = [{ x:0, y:0, z:0 }];

  function overlap(a,b){return !(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y||a.z+a.d<=b.z||b.z+b.d<=a.z);}
  function fits(box){
    if(box.x+box.w>W||box.y+box.h>H||box.z+box.d>D)return false;
    for(const p of placed)if(overlap(box,p))return false;
    if(box.y===0)return true;
    for(const p of placed){if(Math.abs(p.y+p.h-box.y)<0.01&&box.x<p.x+p.w&&p.x<box.x+box.w&&box.z<p.z+p.d&&p.z<box.z+box.d)return true;}
    return false;
  }

  for (const it of items) {
    // 1 orientasi saja, ambil titik PERTAMA yang muat (tidak cari paling rapat)
    let taruh = null;
    for (const p of points) {
      const box = { x:p.x, y:p.y, z:p.z, w:it.width, h:it.height, d:it.length };
      if (fits(box)) { taruh = box; break; }
    }
    if (taruh) {
      placed.push(taruh);
      points.push({ x:taruh.x+taruh.w, y:taruh.y, z:taruh.z });
      points.push({ x:taruh.x, y:taruh.y+taruh.h, z:taruh.z });
      points.push({ x:taruh.x, y:taruh.y, z:taruh.z+taruh.d });
    } else {
      unfitted.push(it.id);
    }
  }

  const binVol = W*H*D;
  const usedVol = placed.reduce((s,b)=>s+b.w*b.h*b.d,0);
  return { fill: +(usedVol/binVol*100).toFixed(1), muat: placed.length };
}

// ============================================================
// 3. PILIH TRUK terbaik otomatis (versi JS)
// ============================================================
function pilihTrukTerbaik(manifest) {
  let best = null, bestNama = null, semua = {};
  for (const [nama, spek] of Object.entries(FLEET)) {
    const r = packItems(manifest, spek);
    semua[nama] = r;
    if (r.tidakMuat === 0) {
      if (!best || best.tidakMuat > 0 || r.fill > best.fill) {
        best = r; bestNama = nama;
      }
    }
  }
  if (!best) { // tidak ada yang muat semua → ambil yang paling banyak muat
    for (const [nama, r] of Object.entries(semua)) {
      if (!best || r.muat > best.muat) { best = r; bestNama = nama; }
    }
  }
  return { bestNama, best, semua };
}

// STEP D: penghematan pakai hasil manual NYATA (bukan asumsi)
function hitungPenghematan(res, manifest, fleet) {
  const fillAi = res.fill;
  const manual = packManual(manifest, fleet); // hitung manual sungguhan
  const fillManual = manual.fill;
  const rasio = fillManual > 0 ? fillAi / fillManual : 1;
  const tripAi = 100;
  const tripManual = Math.round(tripAi * rasio);
  const tripHemat = tripManual - tripAi;
  return {
    fillManual, fillAi,
    tripManual, tripAi, tripHemat,
    rupiah: tripHemat * BIAYA_PER_TRIP,
  };
}

// ============================================================
// 4. VISUALISASI 3D pakai Three.js
// ============================================================
let scene, camera, renderer, group;
let dragging = false, prevX = 0, prevY = 0;
let rotY = 0.6, rotX = 0.4, dist = 900;
let animToken = 0; // STEP C: untuk membatalkan animasi lama saat run baru

function initThree() {
  const canvas = document.getElementById('canvas');
  const w = canvas.clientWidth, h = canvas.clientHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1418);
  camera = new THREE.PerspectiveCamera(50, w/h, 1, 8000);
  renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(window.devicePixelRatio);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(1, 2, 1);
  scene.add(dir);

  group = new THREE.Group();
  scene.add(group);

  // kontrol mouse
  canvas.addEventListener('mousedown', e => { dragging=true; prevX=e.clientX; prevY=e.clientY; });
  window.addEventListener('mouseup', () => dragging=false);
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    rotY += (e.clientX-prevX)*0.008;
    rotX += (e.clientY-prevY)*0.008;
    rotX = Math.max(-1.4, Math.min(1.4, rotX));
    prevX = e.clientX; prevY = e.clientY;
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    dist *= (1 + e.deltaY*0.001);
    dist = Math.max(300, Math.min(4000, dist));
  }, { passive:false });

  window.addEventListener('resize', onResize);
  animate();
}

function onResize() {
  const canvas = document.getElementById('canvas');
  const w = canvas.clientWidth, h = canvas.clientHeight;
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function animate() {
  requestAnimationFrame(animate);
  camera.position.set(
    Math.sin(rotY)*Math.cos(rotX)*dist,
    Math.sin(rotX)*dist,
    Math.cos(rotY)*Math.cos(rotX)*dist
  );
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
}

function warnaUntuk(nama) {
  let h = 0;
  for (let i = 0; i < nama.length; i++) h = nama.charCodeAt(i) + ((h<<5)-h);
  return new THREE.Color(`hsl(${(h%360+360)%360}, 55%, 55%)`);
}

// STEP C: gambar 3D dengan animasi box muncul satu per satu
function gambar3D(res) {
  while (group.children.length) group.remove(group.children[0]);
  const { W, H, D } = res.dim;
  const ox = -W/2, oy = -H/2, oz = -D/2;

  // wireframe truk
  const binGeo = new THREE.BoxGeometry(W, H, D);
  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(binGeo),
    new THREE.LineBasicMaterial({ color:0x3ad9c5 })
  );
  group.add(wire);

  dist = Math.max(W, H, D) * 2.2;

  // batalkan animasi sebelumnya kalau ada (mencegah tumpang tindih saat run cepat)
  const token = ++animToken;

  let i = 0;
  function tampilSatu() {
    if (token !== animToken) return; // run baru sudah dimulai, hentikan yang lama
    if (i >= res.placed.length) return;
    const b = res.placed[i];
    const geo = new THREE.BoxGeometry(b.w*0.97, b.h*0.97, b.d*0.97);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color:warnaUntuk(b.name) }));
    mesh.position.set(ox+b.x+b.w/2, oy+b.y+b.h/2, oz+b.z+b.d/2);
    mesh.scale.set(0.01, 0.01, 0.01); // mulai kecil
    group.add(mesh);

    // animasi membesar (efek "pop")
    let s = 0.01;
    function tumbuh() {
      if (token !== animToken) return;
      s += 0.08;
      if (s >= 1) { mesh.scale.set(1,1,1); }
      else { mesh.scale.set(s,s,s); requestAnimationFrame(tumbuh); }
    }
    tumbuh();

    i++;
    setTimeout(tampilSatu, 50); // jeda antar box (kecil = cepat, besar = dramatis)
  }
  tampilSatu();
}

// ============================================================
// 5. TAMPILAN — tombol, gauge, daftar hasil
// ============================================================
function rupiah(n) { return 'Rp ' + n.toLocaleString('id-ID'); }

function tampilkanHasil(nama, res) {
  const keliling = 2 * Math.PI * 56;
  const isi = keliling * (res.fill / 100);
  const beratClass = res.berat > res.kapasitasBerat ? 'bad' : 'good';

  // Insight otomatis berdasarkan kondisi hasil
  let statusFill;
  if (res.fill >= 80) {
    statusFill = `<span class="good">● Sangat efisien</span> — ruang kargo dimanfaatkan dengan optimal.`;
  } else if (res.fill >= 60) {
    statusFill = `<span class="warn">● Cukup efisien</span> — masih ada ruang tersisa. Coba tambah barang atau pilih kendaraan lebih kecil.`;
  } else {
    statusFill = `<span class="bad">● Kurang efisien</span> — banyak ruang terbuang. Pertimbangkan kendaraan yang lebih kecil.`;
  }

  // Insight: status barang tidak muat
  let saranTambahan = '';
  if (res.tidakMuat > 0) {
    const jmlBesar = res.terlaluBesar ? res.terlaluBesar.length : 0;
    const jmlPenuh = res.tidakMuat - jmlBesar;
    let pesanTidakMuat = '';
    if (jmlBesar > 0) {
      pesanTidakMuat += `<div class="insight-row warn-row">
        ⚠ <b>${jmlBesar} barang terlalu besar</b> untuk semua jenis kendaraan
        (${res.terlaluBesar.join(', ')}).
        Barang ini perlu dibongkar/dikemas ulang sebelum dikirim.
      </div>`;
    }
    if (jmlPenuh > 0) {
      pesanTidakMuat += `<div class="insight-row warn-row">
        ⚠ <b>${jmlPenuh} barang tidak muat</b> karena kapasitas truk penuh.
        Gunakan kendaraan tambahan atau pecah menjadi 2 pengiriman.
      </div>`;
    }
    saranTambahan = pesanTidakMuat;
  } else {
    saranTambahan = `<div class="insight-row good-row">✓ Semua barang berhasil dimuat dalam satu kendaraan.</div>`;
  }

  // ESTIMASI BIAYA OPERASIONAL PER RUTE — hasil dari optimasi
  // Berdasarkan fill rate hasil engine, hitung berapa rute dibutuhkan
  // untuk mengirim seluruh volume barang, dan berapa biaya totalnya.
  const fillDenganOptimasi = res.fill;
  const volBarang = res.placed.reduce((s,b) => s + b.w*b.h*b.d, 0); // cm3
  const volTruk = res.dim.W * res.dim.H * res.dim.D;                 // cm3
  // jumlah rute = volume barang / volume yang bisa diisi per rute (pakai fill rate)
  const ruteOptimasi = Math.ceil(volBarang / (volTruk * fillDenganOptimasi / 100));
  const biayaPerRute = 350000;
  const totalBiaya = ruteOptimasi * biayaPerRute;
  // efisiensi: berapa persen biaya yang "produktif" (terisi barang)
  const efisiensi = fillDenganOptimasi.toFixed(1);

  const estimasiHtml = `
    <div class="saving">
      <div class="cap">Estimasi biaya operasional per rute (dengan optimasi)</div>
      <div class="big">${rupiah(totalBiaya)}</div>
      <div class="sub">
        Dengan fill rate <b style="color:#46d17e">${efisiensi}%</b>,
        volume barang ini membutuhkan <b style="color:#46d17e">${ruteOptimasi} rute</b>
        × Rp 350.000/rute.<br>
        Setiap rute membawa muatan <b style="color:#46d17e">${efisiensi}%</b> kapasitas kendaraan
        — meminimalkan biaya per unit barang yang dikirim.
      </div>
    </div>`;

  document.getElementById('hasilArea').innerHTML = `
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

    <div class="stat"><span class="k">Kendaraan terpilih</span><span class="v">${nama}</span></div>
    <div class="stat"><span class="k">Barang termuat</span><span class="v ${res.tidakMuat?'warn':'good'}">${res.muat} dari ${res.muat+res.tidakMuat} barang</span></div>
    <div class="stat"><span class="k">Berat muatan</span><span class="v ${beratClass}">${res.berat} / ${res.kapasitasBerat} kg</span></div>
    <div class="stat"><span class="k">Ruang tidak terpakai</span><span class="v warn">${(100-res.fill).toFixed(1)}%</span></div>

    <div class="insight-box">
      <div class="insight-title">💡 Insight Optimasi</div>
      <div class="insight-row">${statusFill}</div>
      ${saranTambahan}
      <div class="insight-row">📦 Urutan muat sudah dioptimalkan: barang terbesar dimuat lebih dulu untuk memaksimalkan kepadatan.</div>
    </div>

    ${estimasiHtml}

    <div class="label" style="margin-top:18px;">Urutan Muat</div>
    <div class="loadlist">
      ${res.placed.slice(0,25).map((b,i) => {
        let hh=0; for(let k=0;k<b.name.length;k++) hh=b.name.charCodeAt(k)+((hh<<5)-hh);
        const hue=(hh%360+360)%360;
        return `<div class="load-item">
          <span class="load-num">${i+1}</span>
          <span class="load-dot" style="background:hsl(${hue},55%,55%)"></span>
          <span>${b.id} · ${b.name}</span>
        </div>`;
      }).join('')}
      ${res.placed.length>25 ? `<div class="load-item" style="color:#5a6e7a">…dan ${res.placed.length-25} lainnya</div>` : ''}
    </div>
  `;
}

function jalankan() {
  const jumlah = +document.getElementById('selJumlah').value;
  const pilihan = document.getElementById('selTruk').value;
  // STEP B: pakai data upload kalau ada, kalau tidak pakai data acak
  const manifest = manifestUpload ? manifestUpload : buatManifest(jumlah);

  let nama, res;
  if (pilihan === 'auto') {
    const hasil = pilihTrukTerbaik(manifest);
    nama = hasil.bestNama; res = hasil.best;
  } else {
    nama = pilihan; res = packItems(manifest, FLEET[pilihan]);
  }

  // STEP D dihapus — tidak pakai perbandingan manual vs AI
  const totVol = (manifest.reduce((s,m)=>s+m.length*m.width*m.height,0)/1e6).toFixed(2);
  const sumberData = manifestUpload ? 'CSV upload' : 'data acak';

  document.getElementById('infoBox').innerHTML =
    `Manifest: <b>${manifest.length} barang</b> (${sumberData})<br>Total volume: <b>${totVol} m³</b><br>Engine: <b>3D Bin Packing</b>`;
  document.getElementById('vpLabel').textContent = `Simulator · ${nama} · ${res.fill}% terisi`;

  tampilkanHasil(nama, res);
  gambar3D(res);
}

// ============================================================
// MULAI
// ============================================================
initThree();
document.getElementById('btnRun').addEventListener('click', jalankan);

// STEP B: baca file CSV yang diupload
document.getElementById('fileCsv').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    const baris = ev.target.result.split('\n').filter(b => b.trim());
    const data = [];
    for (let i = 1; i < baris.length; i++) {
      const kolom = baris[i].split(',');
      if (kolom.length < 5) continue;
      data.push({
        id: (kolom[0] || '').trim() || `ITM-${String(i).padStart(3,'0')}`,
        name: (kolom[1] || 'Barang').trim(),
        length: +kolom[2], width: +kolom[3], height: +kolom[4],
        weight: +(kolom[5] || 10),
      });
    }
    if (data.length === 0) {
      alert('CSV kosong atau format salah.\nPastikan kolom: id,name,length,width,height,weight');
      return;
    }
    manifestUpload = data;
    // tampilkan nama file & tombol reset
    const fn = document.getElementById('uploadFilename');
    fn.textContent = `✓ ${file.name} (${data.length} barang)`;
    fn.style.display = 'block';
    document.getElementById('btnResetCsv').style.display = 'block';
    jalankan();
  };
  reader.readAsText(file);
});

// tombol reset upload (kembali ke data acak)
const btnReset = document.getElementById('btnResetCsv');
if (btnReset) {
  btnReset.addEventListener('click', function() {
    manifestUpload = null;
    document.getElementById('fileCsv').value = '';
    document.getElementById('uploadFilename').style.display = 'none';
    document.getElementById('uploadFilename').textContent = '';
    btnReset.style.display = 'none';
    jalankan();
  });
}

// Set default yang impressive saat web dibuka
document.getElementById('selJumlah').value = '80';   // barang lebih banyak
document.getElementById('selTruk').value = 'auto';   // pilih truk otomatis
setTimeout(jalankan, 300);                            // jalankan sekali