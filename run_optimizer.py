"""
run_optimizer.py
Pilih truk terbaik otomatis + hitung estimasi penghematan biaya.
"""

from dataset import generate_manifest, FLEET_TYPES
from engine import optimize_loading

BIAYA_PER_TRIP = 350_000  # Rp estimasi per keberangkatan truk


def pilih_truk_terbaik(manifest):
    """Coba semua truk, pilih yang persen terisinya paling tinggi
    dan masih muat semua barang."""
    hasil_semua = {}
    for nama, spek in FLEET_TYPES.items():
        hasil_semua[nama] = optimize_loading(manifest, spek)

    # Prioritas 1: muat semua barang. Prioritas 2: persen terisi tertinggi
    yang_muat_semua = {
        n: h for n, h in hasil_semua.items() if h["tidak_muat"] == 0
    }
    pool = yang_muat_semua if yang_muat_semua else hasil_semua
    terbaik_nama = max(pool, key=lambda n: pool[n]["persen_terisi"])

    return terbaik_nama, pool[terbaik_nama], hasil_semua


def hitung_penghematan(hasil_terbaik):
    """Bandingkan fill rate AI vs manual (asumsi manual 70% lebih boros)."""
    fill_ai = hasil_terbaik["persen_terisi"]
    fill_manual = round(fill_ai * 0.70, 1)

    # Rasio trip: manual butuh lebih banyak keberangkatan untuk volume yang sama
    rasio = fill_ai / fill_manual
    trip_per_minggu_ai = 100  # asumsi skala operasi
    trip_manual = round(trip_per_minggu_ai * rasio)
    trip_hemat = trip_manual - trip_per_minggu_ai

    return {
        "fill_manual": fill_manual,
        "fill_ai": fill_ai,
        "trip_manual": trip_manual,
        "trip_ai": trip_per_minggu_ai,
        "trip_hemat": trip_hemat,
        "rupiah_hemat": trip_hemat * BIAYA_PER_TRIP,
    }


if __name__ == "__main__":
    barang = generate_manifest(40)  # naikkan jadi 40 barang
    nama_terbaik, hasil_terbaik, semua_hasil = pilih_truk_terbaik(barang)
    penghematan = hitung_penghematan(hasil_terbaik)

    print("=== PERBANDINGAN SEMUA TRUK ===")
    for nama, h in semua_hasil.items():
        print(f"  {nama:15s}: {h['persen_terisi']}% terisi "
                f"(muat {h['muat']}, tidak muat {h['tidak_muat']})")

    print(f"\n>>> TRUK TERPILIH: {nama_terbaik}")
    print(f"    Fill rate AI  : {penghematan['fill_ai']}%")
    print(f"    Fill rate manual (estimasi): {penghematan['fill_manual']}%")
    print(f"\n=== ESTIMASI PENGHEMATAN / MINGGU ===")
    print(f"    Manual  : {penghematan['trip_manual']} trip")
    print(f"    AI      : {penghematan['trip_ai']} trip")
    print(f"    Hemat   : {penghematan['trip_hemat']} trip")
    print(f"    = Rp {penghematan['rupiah_hemat']:,} / minggu")