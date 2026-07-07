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
const FLEET_KEY = 'fleet_db_v1';

function loadFleets() {
  try {
    const raw = localStorage.getItem(FLEET_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  // default awal (bisa dihapus user)
  return [
    { nama: 'Blind Van',  length: 240, width: 160, height: 130, max_weight: 800 },
    { nama: 'CDE Engkel', length: 300, width: 160, height: 170, max_weight: 2000 },
    { nama: 'CDD Colt',   length: 425, width: 185, height: 190, max_weight: 4000 },
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
// 4. ENGINE — 3D Bin Packing (heuristik best-fit decreasing)
// ------------------------------------------------------------
function packItems(mf, fleet) {
  const items = mf.map(it => ({ ...it, vol: it.length*it.width*it.height }))
                  .sort((a,b) => b.vol - a.vol);
  const W = fleet.width, H = fleet.height, D = fleet.length;
  const placed = [], unfitted = [];
  let points = [{x:0,y:0,z:0}];

  function overlap(a,b){return !(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y||a.z+a.d<=b.z||b.z+b.d<=a.z);}
  function fits(box){
    if(box.x+box.w>W||box.y+box.h>H||box.z+box.d>D)return false;
    for(const p of placed)if(overlap(box,p))return false;
    if(box.y===0)return true;
    for(const p of placed){if(Math.abs(p.y+p.h-box.y)<0.01&&box.x<p.x+p.w&&p.x<box.x+box.w&&box.z<p.z+p.d&&p.z<box.z+box.d)return true;}
    return false;
  }

  for (const it of items) {
    // 6 orientasi: semua kombinasi sisi mana yang jadi tinggi (h) & bagaimana
    // sisi lainnya diputar. Ini memungkinkan barang "ditidurkan" agar hemat tinggi.
    const [a, c, e] = [it.length, it.width, it.height];
    const orients = [
      {w:c, h:e, d:a}, // berdiri normal (tinggi = height asli)
      {w:a, h:e, d:c}, // berdiri, diputar 90°
      {w:c, h:a, d:e}, // rebah — panjang jadi tinggi
      {w:e, h:a, d:c}, // rebah, diputar
      {w:a, h:c, d:e}, // rebah — lebar jadi tinggi
      {w:e, h:c, d:a}, // rebah, diputar
    ];
    let best=null, bestScore=Infinity;
    for (const p of points) {
      for (const o of orients) {
        const box = {x:p.x,y:p.y,z:p.z,w:o.w,h:o.h,d:o.d,id:it.id,name:it.name};
        if (fits(box)) {
          // Skor: utamakan posisi rendah (y), lalu tinggi box yang kecil
          // (dorong barang "tiduran" agar tidak boros tinggi), lalu rapat ke dalam.
          const score = box.y*100000 + box.h*1000 + box.z*10 + box.x;
          if (score < bestScore) { bestScore=score; best=box; }
        }
      }
    }
    if (best) {
      placed.push(best);
      points.push({x:best.x+best.w,y:best.y,z:best.z});
      points.push({x:best.x,y:best.y+best.h,z:best.z});
      points.push({x:best.x,y:best.y,z:best.z+best.d});
      points = points.filter(p=>!(p.x===best.x&&p.y===best.y&&p.z===best.z));
    } else unfitted.push(it.id);
  }

  const binVol = W*H*D;
  const usedVol = placed.reduce((s,b)=>s+b.w*b.h*b.d,0);
  const berat = mf.filter(m=>!unfitted.includes(m.id)).reduce((s,m)=>s+m.weight,0);
  const terlaluBesar = mf.filter(m=>{
    const [a,c,e] = [m.length, m.width, m.height];
    // barang muat kalau ADA SATU orientasi (dari 6) yang pas di dalam truk
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

// ------------------------------------------------------------
// 5. VISUALISASI 3D — mendukung banyak canvas sekaligus
// ------------------------------------------------------------
let vizList = []; // { renderer, scene, camera, rot, canvas }

function hancurkanSemuaViz() {
  vizList.forEach(v => { try { v.renderer.dispose(); } catch(e){} });
  vizList = [];
  document.getElementById('vizArea').innerHTML = '';
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
  const canvas = document.createElement('canvas');
  canvas.className = 'viz-canvas';
  card.appendChild(canvas);
  if (opts.mode==='compare') {
    const hint = document.createElement('div');
    hint.className = 'viz-click-hint';
    hint.textContent = 'Klik untuk lihat insight →';
    card.appendChild(hint);
    card.addEventListener('click', () => pilihReferensi(opts.index));
  }
  area.appendChild(card);

  // setup three.js untuk canvas ini
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
  // wireframe truk
  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(W,H,D)),
    new THREE.LineBasicMaterial({color:0x3ad9c5})
  );
  scene.add(wire);
  const ox=-W/2, oy=-H/2, oz=-D/2;

  // box barang dengan animasi muncul bertahap
  let i = 0;
  const token = Symbol();
  card._token = token;
  function tampilSatu() {
    if (card._token !== token) return;
    if (i >= res.placed.length) return;
    const b = res.placed[i];
    const geo = new THREE.BoxGeometry(b.w*0.96, b.h*0.96, b.d*0.96);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({color:warnaUntuk(b.name)}));
    mesh.position.set(ox+b.x+b.w/2, oy+b.y+b.h/2, oz+b.z+b.d/2);
    scene.add(mesh);
    // garis tepi gelap tipis biar antar box makin jelas terpisah
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({color:0x0e1418})
    );
    edge.position.copy(mesh.position);
    scene.add(edge);
    i++;
    setTimeout(tampilSatu, opts.mode==='compare' ? 25 : 45);
  }
  tampilSatu();

  const viz = {
    renderer, scene, camera, canvas,
    rot: { y:0.6, x:0.4, dist: Math.max(W,H,D)*2.3 },
    dragging:false, px:0, py:0,
  };

  canvas.addEventListener('mousedown', e => {
    viz.dragging=true; viz.px=e.clientX; viz.py=e.clientY;
    viz.startX=e.clientX; viz.startY=e.clientY; e.stopPropagation();
  });
  window.addEventListener('mouseup', () => viz.dragging=false);
  window.addEventListener('mousemove', e => {
    if (!viz.dragging) return;
    viz.rot.y += (e.clientX-viz.px)*0.008;
    viz.rot.x += (e.clientY-viz.py)*0.008;
    viz.rot.x = Math.max(-1.4, Math.min(1.4, viz.rot.x));
    viz.px=e.clientX; viz.py=e.clientY;
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault(); e.stopPropagation();
    viz.rot.dist *= (1+e.deltaY*0.001);
    viz.rot.dist = Math.max(200, Math.min(5000, viz.rot.dist));
  }, {passive:false});
  // klik canvas: kalau mouse TIDAK digeser (bukan drag), anggap klik -> pilih card.
  // Kalau digeser jauh (drag untuk memutar), jangan pindah referensi.
  canvas.addEventListener('click', e => {
    const jarak = Math.abs(e.clientX-(viz.startX||0)) + Math.abs(e.clientY-(viz.startY||0));
    if (jarak > 6) e.stopPropagation(); // drag -> blokir
    // klik biasa -> biarkan bubble ke card (pilih referensi)
  });

  vizList.push(viz);
}

function animateAll() {
  requestAnimationFrame(animateAll);
  for (const v of vizList) {
    const {y,x,dist} = v.rot;
    v.camera.position.set(
      Math.sin(y)*Math.cos(x)*dist,
      Math.sin(x)*dist,
      Math.cos(y)*Math.cos(x)*dist
    );
    v.camera.lookAt(0,0,0);
    // resize kalau ukuran canvas berubah
    const w = v.canvas.clientWidth, h = v.canvas.clientHeight;
    if (w>0 && v.canvas.width !== Math.floor(w*window.devicePixelRatio)) {
      v.renderer.setSize(w, h, false);
      v.camera.aspect = w/h;
      v.camera.updateProjectionMatrix();
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
    <label class="fleet-item">
      <input type="checkbox" class="fleet-check" data-i="${i}">
      <span class="fleet-info">
        <b>${f.nama}</b>
        <small>${f.length}×${f.width}×${f.height} cm · max ${f.max_weight} kg</small>
      </span>
      <button class="fleet-del" data-i="${i}" title="Hapus armada">✕</button>
    </label>
  `).join('');

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
  if (!nama) { alert('Beri nama armada dulu.'); return; }
  if (!(p>0 && l>0 && t>0)) { alert('Dimensi (P, L, T) harus angka positif dalam cm.'); return; }
  if (FLEETS.some(f => f.nama.toLowerCase() === nama.toLowerCase())) {
    alert('Nama armada sudah ada. Pakai nama lain.'); return;
  }
  FLEETS.push({ nama, length:p, width:l, height:t, max_weight:b });
  saveFleets(FLEETS);
  renderDaftarArmada();
  ['inNama','inP','inL','inT','inB'].forEach(id => document.getElementById(id).value='');
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
    <div class="loadlist">
      ${res.placed.slice(0,25).map((b,i)=>`
        <div class="load-item">
          <span class="load-num">${i+1}</span>
          <span class="load-dot" style="background:${warnaUntuk(b.name)}"></span>
          <span>${b.id} · ${b.name}</span>
        </div>`).join('')}
      ${res.placed.length>25?`<div class="load-item" style="color:#5a6e7a">…dan ${res.placed.length-25} lainnya</div>`:''}
    </div>
  `;
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
  const dipilih = [...document.querySelectorAll('.fleet-check:checked')].map(c=>+c.dataset.i);
  if (dipilih.length === 0) {
    alert('Centang minimal 1 armada dari daftar.');
    return;
  }
  if (dipilih.length > 3) {
    alert('Maksimal 3 armada untuk komparasi (biar visual tetap jelas).');
    return;
  }

  hancurkanSemuaViz();
  hasilRun = dipilih.map(i => ({ fleet: FLEETS[i], res: packItems(manifest, FLEETS[i]) }));

  // tentukan rekomendasi: prioritas barang muat terbanyak, lalu fill tertinggi
  idxRekomendasi = 0;
  let best = hasilRun[0];
  hasilRun.forEach((h,i) => {
    if (i===0) return;
    if (h.res.muat > best.res.muat ||
        (h.res.muat === best.res.muat && h.res.fill > best.res.fill)) {
      best = h; idxRekomendasi = i;
    }
  });

  const mode = hasilRun.length > 1 ? 'compare' : 'single';

  if (mode === 'single') {
    fokusArmada(0); // langsung tampilan tunggal + insight
  } else {
    tampilkanKomparasi();
  }

  const totVol = (manifest.reduce((s,m)=>s+m.length*m.width*m.height,0)/1e6).toFixed(2);
  document.getElementById('infoBox').innerHTML =
    `Manifest: <b>${manifest.length} barang</b><br>Total volume: <b>${totVol} m³</b><br>Mode: <b>${mode==='compare'?'Komparasi '+hasilRun.length+' armada':'Armada tunggal'}</b>`;
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