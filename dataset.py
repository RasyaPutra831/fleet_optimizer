"""
dataset.py
Membuat data uji: daftar barang + dimensi truk.
Satuan: cm untuk ukuran, kg untuk berat.
"""

import random

# --- Bagian 1: Daftar truk (ukuran ruang kargo: panjang x lebar x tinggi) ---
FLEET_TYPES = {
    "Blind Van":   {"length": 240, "width": 160, "height": 130, "max_weight": 800},
    "CDE Engkel":  {"length": 300, "width": 160, "height": 170, "max_weight": 2000},
    "CDD Colt":    {"length": 425, "width": 185, "height": 190, "max_weight": 4000},
}

# --- Bagian 2: Katalog jenis barang (nama, panjang, lebar, tinggi, berat) ---
# Ukuran sengaja bervariasi (besar/kecil/panjang) supaya optimasi AI
# terlihat jelas lebih unggul dibanding susunan manual.
PRODUCT_CATALOG = [
    ("Lemari Kecil",   120, 80, 60, 35),
    ("Kotak Perkakas",  60, 40, 35, 15),
    ("Dus Dapur",       50, 50, 50, 12),
    ("Kursi Lipat",     90, 60, 20, 14),
    ("Rak Besi",       110, 40, 30, 25),
    ("Dus Elektronik",  45, 35, 30,  6),
    ("Cat 5L",          40, 40, 35, 24),
    ("Pipa Panjang",   150, 20, 20,  8),
    ("Dus Kecil",       25, 20, 20,  3),
    ("Meja Knockdown", 130, 70, 15, 22),
]

# --- Bagian 3: Fungsi bikin daftar barang acak ---
def generate_manifest(num_items=20, seed=42):
    random.seed(seed)  # seed = biar hasilnya sama tiap dijalankan
    manifest = []
    for i in range(num_items):
        name, l, w, h, wt = random.choice(PRODUCT_CATALOG)
        manifest.append({
            "id": f"ITM-{i+1:03d}",
            "name": name,
            "length": l,
            "width": w,
            "height": h,
            "weight": wt,
        })
    return manifest


# --- Tes: jalankan file ini untuk cek hasilnya ---
if __name__ == "__main__":
    barang = generate_manifest(20)
    print(f"Total barang dibuat: {len(barang)}")
    print("Contoh 3 barang pertama:")
    for b in barang[:3]:
        print(" ", b)
    print(f"Truk tersedia: {list(FLEET_TYPES.keys())}")