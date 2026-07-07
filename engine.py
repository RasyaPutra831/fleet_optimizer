"""
engine.py
Engine 3D Bin Packing: hitung susunan barang dalam truk.
"""

from py3dbp import Packer, Bin, Item


def optimize_loading(manifest, fleet_spec):
    packer = Packer()

    # Buat "wadah" truk. Catatan: py3dbp pakai urutan (width, height, depth)
    # jadi kita map: width=lebar, height=tinggi, depth=panjang
    truk = Bin(
        name="truk",
        width=fleet_spec["width"],
        height=fleet_spec["height"],
        depth=fleet_spec["length"],
        max_weight=fleet_spec["max_weight"],
    )
    packer.add_bin(truk)

    # Masukin tiap barang ke packer
    for b in manifest:
        packer.add_item(Item(
            name=b["id"],
            width=b["width"],
            height=b["height"],
            depth=b["length"],
            weight=b["weight"],
        ))

    # Jalankan algoritma. bigger_first=True artinya barang besar ditaruh duluan
    packer.pack(bigger_first=True, number_of_decimals=1)

    truk_hasil = packer.bins[0]

    # Hitung volume truk dan volume terpakai
    volume_truk = float(truk_hasil.width) * float(truk_hasil.height) * float(truk_hasil.depth)
    volume_terpakai = 0.0
    for item in truk_hasil.items:
        d = item.get_dimension()
        volume_terpakai += float(d[0]) * float(d[1]) * float(d[2])

    persen_terisi = round(volume_terpakai / volume_truk * 100, 1)

    return {
        "persen_terisi": persen_terisi,
        "muat": len(truk_hasil.items),
        "tidak_muat": len(truk_hasil.unfitted_items),
    }


# --- Tes ---
if __name__ == "__main__":
    from dataset import generate_manifest, FLEET_TYPES

    barang = generate_manifest(20)
    truk = FLEET_TYPES["Blind Van"]

    hasil = optimize_loading(barang, truk)

    print("=== HASIL OPTIMASI ===")
    print(f"Truk         : Blind Van")
    print(f"Persen terisi: {hasil['persen_terisi']}%")
    print(f"Barang muat  : {hasil['muat']}")
    print(f"Tidak muat   : {hasil['tidak_muat']}")