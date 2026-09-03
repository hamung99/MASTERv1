// ====================================================================
//  excelParser.js — Parsing workbook Excel (via lib global `XLSX`) menjadi
//  array baris siap pakai. Tidak menyentuh DOM atau state aplikasi.
// ====================================================================
import { formatDate, detectMonth, str, num } from './utils.js';

/**
 * Parse workbook "Uang Masuk" (piutang tempo / cash dropping) menjadi array
 * baris ternormalisasi.
 * @param {import('xlsx').WorkBook} wb Workbook hasil XLSX.read().
 * @returns {Array<object>} Baris uang masuk siap ditampilkan/disimpan.
 */
export function parseWorkbook(wb) {
    const rows = [];
    for (const sheetName of wb.SheetNames) {
        if (/^sheet\d*$/i.test(sheetName) && sheetName.toLowerCase() === 'sheet2') continue;
        const ws = wb.Sheets[sheetName];
        if (!ws) continue;
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
        if (!aoa || aoa.length < 5) continue;
        let dateLabel = sheetName;
        for (let r = 0; r < Math.min(6, aoa.length); r++) {
            for (let c = 0; c < (aoa[r] || []).length; c++) {
                const v = aoa[r][c];
                if (v && typeof v === 'string' && /\d{1,2}\/\d{1,2}\/\d{4}/.test(v)) { dateLabel = v.trim(); break; }
                if (v instanceof Date) { dateLabel = formatDate(v); break; }
            }
        }
        const sheetMonth = detectMonth(sheetName, dateLabel);
        let section = 'PIUTANG TEMPO';
        let currentSales = '';
        for (let r = 0; r < aoa.length; r++) {
            const row = aoa[r] || [];
            const rowStr = row.map(x => (x == null ? '' : String(x))).join(' ').toUpperCase();
            if (rowStr.includes('CASH DROPPING')) { section = 'CASH DROPPING';
                currentSales = ''; continue; }
            if (rowStr.includes('PIUTANG TEMPO')) { section = 'PIUTANG TEMPO';
                currentSales = ''; continue; }
            if (/UANG MASUK DARI PIUTANG|UANG MASUK CASH|TOTAL UANG MASUK|MENGETAHUI|TOTAL CASH|TOTAL TRANSFER/
                .test(rowStr)) continue;
            const colC = row[2] != null ? String(row[2]).trim() : '';
            if (colC && /^(RAJU|JOSSY|HAFID|ZEIN|ALIM)/i.test(colC)) currentSales = colC;
            let fakturIdx = -1,
                faktur = null;
            for (let c = 2; c <= 5; c++) {
                const v = row[c];
                if (v == null) continue;
                const s = String(v).trim();
                if (/^\d{10,}$/.test(s) || /^0\d{10,}$/.test(s)) { faktur = s;
                    fakturIdx = c; break; }
            }
            if (!faktur) continue;
            if (/NO FAKTUR|NOMINAL|TAGIHAN/i.test(rowStr) && !/TOKO|WARUNG|MART|CELL|SWALAYAN|BUMDES/i.test(rowStr))
                continue;
            const namaToko = str(row[fakturIdx + 1]);
            const alamat = str(row[fakturIdx + 2]);
            let tagihan = num(row[fakturIdx + 5]);
            let minyakCash = num(row[9]);
            let minyakTf = num(row[10]);
            let rupaCash = num(row[11]);
            let rupaTf = num(row[12]);
            let ket = str(row[13]) || str(row[14]) || '';
            if (!tagihan) tagihan = num(row[8]) || num(row[fakturIdx + 5]);
            let status = '—';
            const ketUp = ket.toUpperCase();
            if (ketUp.includes('LUNAS')) status = 'LUNAS';
            else if (ketUp.includes('TITIP')) status = 'TITIP';
            else if (ketUp.includes('TF') || ketUp.includes('TRANSFER')) status = 'TF';
            else if (ketUp.includes('RETUR')) status = 'RETUR';
            else if (ket) status = ket;
            let sales = currentSales;
            if (section === 'CASH DROPPING' && colC) sales = colC;
            else if (!sales && colC && !/^\d+$/.test(colC)) sales = colC;
            if (/^TOTAL/i.test(str(row[1])) || /^TOTAL/i.test(namaToko)) continue;
            rows.push({
                sheet: sheetName,
                date: dateLabel,
                month: sheetMonth || 'Lainnya',
                section,
                sales: sales || '—',
                faktur,
                toko: namaToko || '—',
                alamat: alamat || '—',
                tagihan,
                minyakCash,
                minyakTf,
                rupaCash,
                rupaTf,
                ket: ket || '—',
                status,
                _q: (faktur + ' ' + (namaToko || '') + ' ' + (alamat || '') + ' ' + (sales || '') + ' ' + sheetName +
                    ' ' + dateLabel + ' ' + (sheetMonth || '')).toLowerCase()
            });
        }
    }
    return rows;
}

/**
 * Parse workbook "Penjualan" menjadi array baris ternormalisasi, mendeteksi
 * kolom secara otomatis dari baris header (FAKTUR + PRODUK).
 * @param {import('xlsx').WorkBook} wb Workbook hasil XLSX.read().
 * @returns {Array<object>} Baris penjualan siap ditampilkan/disimpan.
 */
export function parseSalesWorkbook(wb) {
    const rows = [];
    for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        if (!ws) continue;
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
        if (!aoa || aoa.length < 2) continue;
        let headerRowIdx = -1;
        const colMap = {};
        for (let r = 0; r < Math.min(5, aoa.length); r++) {
            const row = aoa[r] || [];
            const upRow = row.map(x => (x == null ? '' : String(x).trim().toUpperCase()));
            if (upRow.some(v => v.includes('FAKTUR')) && upRow.some(v => v.includes('PRODUK'))) {
                headerRowIdx = r;
                row.forEach((v, c) => {
                    const label = v == null ? '' : String(v).trim().toUpperCase();
                    if (!label) return;
                    if (label.includes('TANGGAL')) colMap.tanggal = c;
                    else if (label.includes('FAKTUR')) colMap.noFaktur = c;
                    else if (label.includes('PRODUK')) colMap.produk = c;
                    else if (label.includes('JUMLAH')) colMap.jumlah = c;
                    else if (label.includes('SATUAN')) colMap.satuan = c;
                    else if (label.includes('HARGA JUAL')) colMap.hargaJual = c;
                    else if (label.includes('DISC')) colMap.disc = c;
                    else if (label.includes('HARGA BELI')) colMap.hargaBeli = c;
                    else if (label === 'TOTAL' || label.includes('TOTAL')) colMap.total = c;
                    else if (label.includes('SALES')) colMap.sales = c;
                    // 'Kd Customer' (kode pelanggan) HARUS dicek lebih dulu &
                    // dipisah, karena namanya juga mengandung kata CUSTOMER —
                    // kalau tidak, kolom ini akan menimpa colMap.customer dan
                    // membuat nama customer/toko terbaca sebagai kode.
                    else if (label.includes('KD CUSTOMER') || label.includes('KODE CUSTOMER') || label.includes('KD PELANGGAN')) colMap.kdCustomer = c;
                    else if (label.includes('CUSTOMER')) colMap.customer = c;
                    else if (label.includes('ALAMAT')) colMap.alamat = c;
                    else if (label.includes('PEMBAYARAN') || label.includes('BAYAR')) colMap.pembayaran = c;
                    else if (label.includes('PROFIT')) colMap.profit = c;
                });
                break;
            }
        }
        if (headerRowIdx === -1) continue;
        for (let r = headerRowIdx + 1; r < aoa.length; r++) {
            const row = aoa[r] || [];
            const rawFaktur = colMap.noFaktur != null ? row[colMap.noFaktur] : null;
            if (rawFaktur == null || String(rawFaktur).trim() === '') continue;
            if (/^TOTAL/i.test(String(rawFaktur).trim())) continue;
            const get = key => (colMap[key] != null ? row[colMap[key]] : null);
            let tgl = get('tanggal');
            if (tgl instanceof Date) tgl = formatDate(tgl);
            else tgl = tgl == null ? '' : String(tgl).trim();
            const monthVal = detectMonth(sheetName, tgl);
            const noFakturVal = String(rawFaktur).trim();
            const produkVal = str(get('produk'));
            const salesVal = str(get('sales'));
            const customerVal = str(get('customer'));
            const kdCustomerVal = str(get('kdCustomer'));
            const alamatVal = str(get('alamat'));
            rows.push({
                sheet: sheetName,
                tanggal: tgl,
                month: monthVal || 'Lainnya',
                noFaktur: noFakturVal,
                produk: produkVal,
                jumlah: num(get('jumlah')),
                satuan: str(get('satuan')),
                hargaJual: num(get('hargaJual')),
                disc: num(get('disc')),
                total: num(get('total')),
                sales: salesVal,
                customer: customerVal,
                kdCustomer: kdCustomerVal,
                alamat: alamatVal,
                pembayaran: str(get('pembayaran')),
                hargaBeli: num(get('hargaBeli')),
                profit: num(get('profit')),
                _q: (noFakturVal + ' ' + produkVal + ' ' + customerVal + ' ' + kdCustomerVal + ' ' + salesVal + ' ' + alamatVal)
                    .toLowerCase()
            });
        }
    }
    return rows;
}