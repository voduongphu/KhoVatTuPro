import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  X,
  FileSpreadsheet,
  UploadCloud,
  Download,
  AlertTriangle,
  CheckCircle2,
  Check,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { useInventory } from '../context/InventoryContext';
import {
  InventoryItem,
  TransactionLineItem,
  TransactionSubtype,
  TransactionType,
} from '../types/inventory';
import {
  formatCurrency,
  formatNumber,
  getSubtypeLabel,
  getTransactionTypeLabel,
} from '../utils/formatters';
import { PaginationBar } from './PaginationBar';

interface ExcelImportModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

interface ParsedGroupedTransaction {
  id: string;
  code?: string;
  type: TransactionType;
  subtype: TransactionSubtype;
  date: string;
  warehouseId: string;
  warehouseName: string;
  partnerName: string;
  departmentOrProject: string;
  notes: string;
  items: TransactionLineItem[];
  totalAmount: number;
  isValid: boolean;
  errors: string[];
}

/**
 * Loại bỏ dấu tiếng Việt để so sánh tiêu đề cột và giá trị chuỗi an toàn
 */
function removeVietnameseTones(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .trim();
}

/**
 * Phân tích ngày giờ đa định dạng từ file Excel (JS Date, Excel Serial, DD/MM/YYYY, YYYY-MM-DD...)
 */
function parseExcelDate(val: any): string {
  if (!val) {
    return new Date().toISOString().substring(0, 16).replace('T', ' ');
  }

  // 1. Đối tượng Date nguyên bản
  if (val instanceof Date) {
    if (!isNaN(val.getTime())) {
      const y = val.getFullYear();
      const m = String(val.getMonth() + 1).padStart(2, '0');
      const d = String(val.getDate()).padStart(2, '0');
      const hh = String(val.getHours()).padStart(2, '0');
      const mm = String(val.getMinutes()).padStart(2, '0');
      return `${y}-${m}-${d} ${hh}:${mm}`;
    }
  }

  // 2. Số nguyên / số thực serial của Excel (VD: 45215.375)
  if (typeof val === 'number') {
    try {
      const parsed = XLSX.SSF.parse_date_code(val);
      if (parsed) {
        const y = parsed.y || new Date().getFullYear();
        const m = String(parsed.m || 1).padStart(2, '0');
        const d = String(parsed.d || 1).padStart(2, '0');
        const hh = String(parsed.H || 8).padStart(2, '0');
        const mm = String(parsed.M || 0).padStart(2, '0');
        return `${y}-${m}-${d} ${hh}:${mm}`;
      }
    } catch {
      // fallback
    }
  }

  const str = String(val).trim();

  // 3. Định dạng DD/MM/YYYY hoặc DD-MM-YYYY (kèm hoặc không kèm giờ)
  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?/);
  if (dmyMatch) {
    const d = dmyMatch[1].padStart(2, '0');
    const m = dmyMatch[2].padStart(2, '0');
    const y = dmyMatch[3];
    const hh = dmyMatch[4] ? dmyMatch[4].padStart(2, '0') : '08';
    const mm = dmyMatch[5] ? dmyMatch[5].padStart(2, '0') : '00';
    return `${y}-${m}-${d} ${hh}:${mm}`;
  }

  // 4. Định dạng YYYY-MM-DD hoặc YYYY/MM/DD
  const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const m = ymdMatch[2].padStart(2, '0');
    const d = ymdMatch[3].padStart(2, '0');
    const hh = ymdMatch[4] ? ymdMatch[4].padStart(2, '0') : '08';
    const mm = ymdMatch[5] ? ymdMatch[5].padStart(2, '0') : '00';
    return `${y}-${m}-${d} ${hh}:${mm}`;
  }

  // 5. Thử new Date(str)
  const parsedDate = new Date(str);
  if (!isNaN(parsedDate.getTime())) {
    return parsedDate.toISOString().substring(0, 16).replace('T', ' ');
  }

  return new Date().toISOString().substring(0, 16).replace('T', ' ');
}

/**
 * Phân tích chuỗi số an toàn (xử lý định dạng dấu phẩy/chấm Việt Nam và quốc tế)
 */
function parseCleanNumber(val: any): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const str = String(val).trim().replace(/\s/g, '');

  // Xử lý định dạng dạng 1.000,50
  if (str.includes('.') && str.includes(',')) {
    if (str.indexOf('.') < str.indexOf(',')) {
      return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
    } else {
      return parseFloat(str.replace(/,/g, '')) || 0;
    }
  }

  // Nếu chỉ chứa dấu phẩy
  if (str.includes(',')) {
    const parts = str.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      return parseFloat(str.replace(',', '.')) || 0;
    }
    return parseFloat(str.replace(/,/g, '')) || 0;
  }

  const cleaned = str.replace(/[^0-9.-]/g, '');
  return parseFloat(cleaned) || 0;
}

/**
 * Xác định loại phiếu (NHAP_KHO hoặc XUAT_KHO) từ text bất kỳ
 */
function resolveTransactionType(raw: any, voucherCode?: string): TransactionType {
  const norm = removeVietnameseTones(String(raw || '')).toUpperCase();
  const codeNorm = String(voucherCode || '').trim().toUpperCase();

  if (
    norm.includes('XUAT') ||
    norm.includes('OUTWARD') ||
    norm.includes('ISSUE') ||
    codeNorm.startsWith('PX')
  ) {
    return 'XUAT_KHO';
  }
  return 'NHAP_KHO';
}

/**
 * Xác định phân loại nghiệp vụ từ text tiếng Việt hoặc mã enum
 */
function resolveTransactionSubtype(type: TransactionType, rawSubtype: any): TransactionSubtype {
  const norm = removeVietnameseTones(String(rawSubtype || '')).toUpperCase();

  if (type === 'NHAP_KHO') {
    if (norm.includes('THU HOI') || norm.includes('THU_HOI')) return 'NHAP_THU_HOI_DU_AN';
    if (norm.includes('TRA SAU') || norm.includes('TRA_SAU') || norm.includes('HOAN TRA')) return 'NHAP_TRA_SAU_MUON';
    if (norm.includes('CHUYEN KHO') || norm.includes('CHUYEN_KHO')) return 'NHAP_CHUYEN_KHO';
    if (norm.includes('DIEU CHINH') || norm.includes('DIEU_CHINH') || norm.includes('KIEM KE')) return 'NHAP_DIEU_CHINH';
    return 'NHAP_MUA_MOI';
  } else {
    if (norm.includes('PHONG BAN') || norm.includes('PHONG_BAN') || norm.includes('NOI BO')) return 'XUAT_PHONG_BAN';
    if (norm.includes('CHO MUON') || norm.includes('CHO_MUON') || norm.includes('MUON')) return 'XUAT_CHO_MUON';
    if (norm.includes('BAO DUONG') || norm.includes('BAO_DUONG') || norm.includes('SUA CHUA')) return 'XUAT_BAO_DUONG';
    if (norm.includes('CHUYEN KHO') || norm.includes('CHUYEN_KHO')) return 'XUAT_CHUYEN_KHO';
    if (norm.includes('THANH LY') || norm.includes('THANH_LY')) return 'XUAT_THANH_LY';
    return 'XUAT_THI_CONG';
  }
}

const MAX_PREVIEW_LINES_PER_VOUCHER = 25;

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({ onClose, onSuccess }) => {
  const { warehouses, items, importTransactionsBatch, currentUser } = useInventory();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [parsedTransactions, setParsedTransactions] = useState<ParsedGroupedTransaction[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<'preview' | 'help'>('preview');
  const [parseError, setParseError] = useState('');
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageSize, setPreviewPageSize] = useState(30);
  const [expandedVoucherIds, setExpandedVoucherIds] = useState<Record<string, boolean>>({});
  const [importSummary, setImportSummary] = useState<{
    success: boolean;
    importedCount: number;
    errors: string[];
  } | null>(null);

  // Download Sample Template with multiple sheets
  const handleDownloadTemplate = () => {
    // Sheet 1: Mẫu Nhập Kho
    const nhapData = [
      {
        'Số Phiếu': 'PN-2026-0001',
        'Loại Phiếu': 'NHAP_KHO',
        'Nghiệp Vụ': 'NHAP_MUA_MOI',
        'Ngày Lập': '2026-10-21 08:30',
        'Mã Kho': warehouses[0]?.code || 'KHO-01',
        'Đối Tác / Nhà Cung Cấp': 'Công ty Cổ phần Dây cáp điện Cadivi',
        'Dự Án / Phòng Ban': 'Dự án Cơ điện Nhà máy Nhiệt điện Long Phú 1',
        'Mã SKU Vật Tư': 'VT-CD-101',
        'Tên Vật Tư Thiết Bị': 'Dây cáp điện Cadivi CV 2.5mm2 (Cuộn 100m)',
        'Đơn Vị Tính': 'Cuộn',
        'Số Lượng': 150,
        'Đơn Giá (VNĐ)': 185000,
        'Số Lô / Serial': 'LOT-CAD-2026-01',
        'Ghi Chú': 'Nhập mới phục vụ kéo cáp trục A-B',
      },
      {
        'Số Phiếu': 'PN-2026-0001',
        'Loại Phiếu': 'NHAP_KHO',
        'Nghiệp Vụ': 'NHAP_MUA_MOI',
        'Ngày Lập': '2026-10-21 08:30',
        'Mã Kho': warehouses[0]?.code || 'KHO-01',
        'Đối Tác / Nhà Cung Cấp': 'Công ty Cổ phần Dây cáp điện Cadivi',
        'Dự Án / Phòng Ban': 'Dự án Cơ điện Nhà máy Nhiệt điện Long Phú 1',
        'Mã SKU Vật Tư': 'VT-CD-102',
        'Tên Vật Tư Thiết Bị': 'Aptomat Schneider MCB 3P 63A',
        'Đơn Vị Tính': 'Cái',
        'Số Lượng': 25,
        'Đơn Giá (VNĐ)': 2850000,
        'Số Lô / Serial': 'LOT-SCH-2026-02',
        'Ghi Chú': 'Tủ phân phối hạ thế tầng 1',
      },
      {
        'Số Phiếu': 'PN-2026-0002',
        'Loại Phiếu': 'NHAP_KHO',
        'Nghiệp Vụ': 'NHAP_THU_HOI_DU_AN',
        'Ngày Lập': '2026-10-21 10:15',
        'Mã Kho': warehouses[0]?.code || 'KHO-01',
        'Đối Tác / Nhà Cung Cấp': 'Ban Chỉ huy Công trường Gói 4',
        'Dự Án / Phòng Ban': 'Dự án Cải tạo Trạm Biến Áp',
        'Mã SKU Vật Tư': 'TB-DK-001',
        'Tên Vật Tư Thiết Bị': 'Máy đo điện trở cách điện Kyoritsu 3005A',
        'Đơn Vị Tính': 'Bộ',
        'Số Lượng': 2,
        'Đơn Giá (VNĐ)': 8500000,
        'Số Lô / Serial': 'SN-KYO-88319',
        'Ghi Chú': 'Thu hồi sau khi kết thúc thí nghiệm đóng điện',
      },
    ];

    // Sheet 2: Mẫu Xuất Kho
    const firstItem = items[0];
    const secondItem = items[1] || items[0];

    const xuatData = [
      {
        'Số Phiếu': 'PX-2026-0001',
        'Loại Phiếu': 'XUAT_KHO',
        'Nghiệp Vụ': 'XUAT_THI_CONG',
        'Ngày Lập': '2026-10-21 14:00',
        'Mã Kho': warehouses[0]?.code || 'KHO-01',
        'Đối Tác / Đơn Vị Nhận': 'Đội Thi công Cơ điện 1 (KS. Nguyễn Văn An)',
        'Dự Án / Phòng Ban': 'Dự án Cơ điện Nhà máy Nhiệt điện Long Phú 1',
        'Mã SKU Vật Tư': firstItem ? firstItem.code : 'VT-CD-101',
        'Tên Vật Tư Thiết Bị': firstItem ? firstItem.name : 'Dây cáp điện Cadivi CV 2.5mm2',
        'Đơn Vị Tính': firstItem ? firstItem.unit : 'Cuộn',
        'Số Lượng': 10,
        'Đơn Giá (VNĐ)': firstItem ? firstItem.unitPrice : 185000,
        'Số Lô / Serial': 'LOT-CAD-2026-01',
        'Ghi Chú': 'Xuất cấp cho tổ lắp đặt tủ động lực',
      },
      {
        'Số Phiếu': 'PX-2026-0001',
        'Loại Phiếu': 'XUAT_KHO',
        'Nghiệp Vụ': 'XUAT_THI_CONG',
        'Ngày Lập': '2026-10-21 14:00',
        'Mã Kho': warehouses[0]?.code || 'KHO-01',
        'Đối Tác / Đơn Vị Nhận': 'Đội Thi công Cơ điện 1 (KS. Nguyễn Văn An)',
        'Dự Án / Phòng Ban': 'Dự án Cơ điện Nhà máy Nhiệt điện Long Phú 1',
        'Mã SKU Vật Tư': secondItem ? secondItem.code : 'VT-CD-102',
        'Tên Vật Tư Thiết Bị': secondItem ? secondItem.name : 'Aptomat Schneider MCB 3P 63A',
        'Đơn Vị Tính': secondItem ? secondItem.unit : 'Cái',
        'Số Lượng': 5,
        'Đơn Giá (VNĐ)': secondItem ? secondItem.unitPrice : 2850000,
        'Số Lô / Serial': 'LOT-SCH-2026-02',
        'Ghi Chú': 'Xuất lắp tủ điều khiển số 3',
      },
    ];

    // Sheet 3: Hướng Dẫn Nghiệp Vụ
    const huongDanData = [
      {
        'Tên Cột': 'Số Phiếu',
        'Bắt buộc': 'Không',
        'Mô tả quy tắc & Giá trị mẫu': 'Để trống thì hệ thống tự sinh mã PN/PX theo năm. Các dòng cùng Số Phiếu sẽ được gộp chung vào 1 chứng từ duy nhất.',
      },
      {
        'Tên Cột': 'Loại Phiếu',
        'Bắt buộc': 'Có',
        'Mô tả quy tắc & Giá trị mẫu': 'Điền "NHAP_KHO" (hoặc "Nhập kho") để nhập kho; "XUAT_KHO" (hoặc "Xuất kho") để xuất kho.',
      },
      {
        'Tên Cột': 'Nghiệp Vụ',
        'Bắt buộc': 'Không',
        'Mô tả quy tắc & Giá trị mẫu': 'Nhập kho: NHAP_MUA_MOI, NHAP_THU_HOI_DU_AN, NHAP_TRA_SAU_MUON, NHAP_CHUYEN_KHO, NHAP_DIEU_CHINH.\nXuất kho: XUAT_THI_CONG, XUAT_PHONG_BAN, XUAT_CHO_MUON, XUAT_BAO_DUONG, XUAT_CHUYEN_KHO, XUAT_THANH_LY.',
      },
      {
        'Tên Cột': 'Ngày Lập',
        'Bắt buộc': 'Không',
        'Mô tả quy tắc & Giá trị mẫu': 'Định dạng YYYY-MM-DD HH:mm hoặc DD/MM/YYYY HH:mm (VD: 2026-10-21 09:00 hoặc 21/10/2026 09:00).',
      },
      {
        'Tên Cột': 'Mã Kho / Tên Kho',
        'Bắt buộc': 'Không',
        'Mô tả quy tắc & Giá trị mẫu': `Có thể điền mã kho hoặc tên kho. Danh sách kho hiện tại: ${warehouses.map(w => `${w.code} (${w.name})`).join(', ')}.`,
      },
      {
        'Tên Cột': 'Mã SKU Vật Tư',
        'Bắt buộc': 'Có',
        'Mô tả quy tắc & Giá trị mẫu': 'Mã nhận diện vật tư. Đối với phiếu nhập, nếu mã chưa có thì hệ thống tự động đăng ký mới vào danh mục.',
      },
      {
        'Tên Cột': 'Số Lượng',
        'Bắt buộc': 'Có',
        'Mô tả quy tắc & Giá trị mẫu': 'Số lượng vật tư (lớn hơn 0). Đối với xuất kho, số lượng xuất không được vượt quá tồn kho khả dụng.',
      },
    ];

    const workbook = XLSX.utils.book_new();

    const wsNhap = XLSX.utils.json_to_sheet(nhapData);
    wsNhap['!cols'] = [
      { wch: 16 }, { wch: 14 }, { wch: 22 }, { wch: 18 }, { wch: 14 },
      { wch: 32 }, { wch: 35 }, { wch: 16 }, { wch: 38 }, { wch: 12 },
      { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 30 }
    ];
    XLSX.utils.book_append_sheet(workbook, wsNhap, 'Mau_Phieu_Nhap');

    const wsXuat = XLSX.utils.json_to_sheet(xuatData);
    wsXuat['!cols'] = wsNhap['!cols'];
    XLSX.utils.book_append_sheet(workbook, wsXuat, 'Mau_Phieu_Xuat');

    const wsHuongDan = XLSX.utils.json_to_sheet(huongDanData);
    wsHuongDan['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(workbook, wsHuongDan, 'Huong_Dan');

    XLSX.writeFile(workbook, 'Mau_Import_Phieu_Nhap_Xuat_Kho_PTSC.xlsx');
  };

  // Build once-per-row normalized header lookup instead of calling removeVietnameseTones hundreds of times per row
  const createRowReader = (row: Record<string, any>) => {
    const entries: Array<[string, any]> = [];
    const exactMap = new Map<string, any>();
    for (const key of Object.keys(row)) {
      const val = row[key];
      if (val === undefined || val === null || String(val).trim() === '') continue;
      const keyNorm = removeVietnameseTones(key).toLowerCase().trim();
      entries.push([keyNorm, val]);
      if (!exactMap.has(keyNorm)) {
        exactMap.set(keyNorm, val);
      }
    }
    return (...normCandidates: string[]) => {
      for (let i = 0; i < normCandidates.length; i++) {
        const cand = normCandidates[i];
        if (exactMap.has(cand)) return exactMap.get(cand);
      }
      for (let i = 0; i < normCandidates.length; i++) {
        const cand = normCandidates[i];
        for (let j = 0; j < entries.length; j++) {
          const k = entries[j][0];
          if (k.includes(cand) || cand.includes(k)) {
            return entries[j][1];
          }
        }
      }
      return undefined;
    };
  };

  // Parse Uploaded File in O(M)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setIsProcessing(true);
    setImportSummary(null);
    setParseError('');
    setPreviewPage(1);
    setExpandedVoucherIds({});

    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const buffer = evt.target?.result;
        const wb = XLSX.read(buffer, { type: 'array', cellDates: true });

        let rawData: Record<string, any>[] = [];
        for (const sheetName of wb.SheetNames) {
          if (sheetName.toLowerCase().includes('huong_dan')) continue;
          const sheet = wb.Sheets[sheetName];
          const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet);
          if (rows && rows.length > 0) {
            rawData = rawData.concat(rows);
          }
        }

        if (rawData.length === 0 && wb.SheetNames.length > 0) {
          const firstSheet = wb.Sheets[wb.SheetNames[0]];
          rawData = XLSX.utils.sheet_to_json(firstSheet);
        }

        if (!rawData || rawData.length === 0) {
          setParseError('File Excel không có dữ liệu hợp lệ hoặc các sheet đều trống.');
          setIsProcessing(false);
          return;
        }

        // Pre-index catalog items by uppercase SKU and normalized Name in O(N) once!
        const itemByCodeUpper = new Map<string, InventoryItem>();
        const itemByNormName = new Map<string, InventoryItem>();
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const cUpper = it.code.trim().toUpperCase();
          if (cUpper) itemByCodeUpper.set(cUpper, it);
          const nNorm = removeVietnameseTones(it.name).toLowerCase();
          if (nNorm && !itemByNormName.has(nNorm)) {
            itemByNormName.set(nNorm, it);
          }
        }

        // Pre-index warehouses in O(W) once
        const whExactMap = new Map<string, (typeof warehouses)[number]>();
        const whNormList = warehouses.map(w => {
          const idN = removeVietnameseTones(w.id).toLowerCase();
          const codeN = removeVietnameseTones(w.code).toLowerCase();
          const nameN = removeVietnameseTones(w.name).toLowerCase();
          whExactMap.set(idN, w);
          whExactMap.set(codeN, w);
          whExactMap.set(nameN, w);
          return { wh: w, nameN };
        });

        const CAND_VOUCHER = ['so phieu', 'ma phieu', 'so chung tu', 'so ct', 'ma ct', 'voucher code', 'voucher', 'code'];
        const CAND_TYPE = ['loai phieu (nhap_kho/xuat_kho)', 'loai phieu', 'loai nghiep vu', 'loai chung tu', 'loai', 'type'];
        const CAND_SUBTYPE = ['hinh thuc nghiep vu', 'hinh thuc', 'nghiep vu', 'phan loai', 'ly do', 'subtype'];
        const CAND_DATE = ['ngay lap', 'ngay lap phieu', 'ngay (yyyy-mm-dd)', 'ngay', 'thoi gian', 'date'];
        const CAND_WH = ['ma kho', 'kho hang', 'ten kho', 'kho luu tru', 'kho luu', 'kho', 'warehouse'];
        const CAND_PARTNER = [
          'doi tac / nha cung cap / nguoi nhan',
          'doi tac / nha cung cap',
          'nguoi nhan / don vi nhan',
          'doi tac / don vi nhan',
          'doi tac',
          'nha cung cap',
          'nguoi nhan',
          'don vi nhan',
          'partner',
        ];
        const CAND_PROJECT = ['du an / phong ban', 'du an', 'phong ban', 'cong trinh', 'muc dich', 'project'];
        const CAND_ITEM_CODE = ['ma sku vat tu', 'ma vat tu', 'ma sku', 'ma vt', 'sku', 'ma hang', 'itemcode', 'code'];
        const CAND_ITEM_NAME = ['ten vat tu thiet bi', 'ten vat tu / thiet bi', 'ten vat tu', 'ten hang', 'ten thiet bi', 'ten', 'item name'];
        const CAND_UNIT = ['don vi tinh', 'dvt', 'don vi', 'unit'];
        const CAND_QTY = ['so luong vat tu', 'so luong', 'sl', 'qty'];
        const CAND_PRICE = ['don gia (vnd)', 'don gia', 'gia von', 'gia', 'price'];
        const CAND_SERIAL = ['so serial / lo', 'so lo / serial', 'so serial', 'so lo', 'serial', 'lot'];
        const CAND_NOTE = ['ghi chu', 'luu y', 'dien giai', 'note'];

        const groupedMap = new Map<string, ParsedGroupedTransaction>();
        const cumulativeInQty = new Map<string, number>();
        const cumulativeOutQty = new Map<string, number>();
        const nowSuffix = Date.now().toString().slice(-4);

        for (let idx = 0; idx < rawData.length; idx++) {
          const row = rawData[idx];
          const stt = String(row['STT'] || row['stt'] || '').trim().toUpperCase();
          if (stt.includes('TONG') || stt.includes('CONG') || stt.includes('TOTAL')) {
            continue;
          }

          const getVal = createRowReader(row);
          const rawItemCodeVal = getVal(...CAND_ITEM_CODE);
          const rawItemName = getVal(...CAND_ITEM_NAME);
          const rawQtyVal = getVal(...CAND_QTY);

          if (!rawItemCodeVal && !rawItemName && !rawQtyVal) continue;
          const upperName = String(rawItemName || '').toUpperCase();
          if (upperName.includes('TỔNG CỘNG') || upperName.includes('TOTAL')) {
            continue;
          }

          const rawVoucherCode = String(getVal(...CAND_VOUCHER) || '').trim();
          const rawType = getVal(...CAND_TYPE);
          const type: TransactionType = resolveTransactionType(rawType, rawVoucherCode);
          const subtype: TransactionSubtype = resolveTransactionSubtype(type, getVal(...CAND_SUBTYPE));
          const dateStr = parseExcelDate(getVal(...CAND_DATE));

          const rawWh = String(getVal(...CAND_WH) || '').trim();
          let matchedWh = warehouses[0];
          if (rawWh) {
            const rawWhNorm = removeVietnameseTones(rawWh).toLowerCase();
            let foundWh = whExactMap.get(rawWhNorm);
            if (!foundWh) {
              for (let wIdx = 0; wIdx < whNormList.length; wIdx++) {
                if (whNormList[wIdx].nameN.includes(rawWhNorm)) {
                  foundWh = whNormList[wIdx].wh;
                  break;
                }
              }
            }
            if (foundWh) matchedWh = foundWh;
          }

          const partner = String(
            getVal(...CAND_PARTNER) ||
              (type === 'NHAP_KHO' ? 'Nhà cung cấp vật tư' : 'Đơn vị nhận thi công')
          ).trim();

          const project = String(getVal(...CAND_PROJECT) || 'Dự án công trình').trim();
          const rawItemCode = String(rawItemCodeVal || '').trim();
          const rawUnit = getVal(...CAND_UNIT) || 'Cái';
          const qty = parseCleanNumber(rawQtyVal);
          const unitPrice = parseCleanNumber(getVal(...CAND_PRICE));
          const serial = String(getVal(...CAND_SERIAL) || '').trim();
          const note = String(getVal(...CAND_NOTE) || '').trim();

          // O(1) match item in catalog by SKU or normalized Name
          const itemCodeClean = rawItemCode.toUpperCase();
          let matchedItem = itemCodeClean ? itemByCodeUpper.get(itemCodeClean) : undefined;
          if (!matchedItem && rawItemName) {
            const nameNorm = removeVietnameseTones(String(rawItemName)).toLowerCase();
            matchedItem = itemByNormName.get(nameNorm);
          }

          const isNewItem = !matchedItem && type === 'NHAP_KHO';

          const errors: string[] = [];
          if (!rawItemCode && !rawItemName) {
            errors.push(`Dòng ${idx + 2}: Thiếu cả mã SKU lẫn tên vật tư.`);
          }

          if (qty <= 0) {
            errors.push(`Dòng ${idx + 2}: Số lượng phải lớn hơn 0 (hiện tại: ${qty}).`);
          }

          const itemKey = matchedItem ? matchedItem.code.toUpperCase() : itemCodeClean;
          if (type === 'XUAT_KHO') {
            if (!matchedItem) {
              errors.push(
                `Dòng ${idx + 2}: Vật tư mã "${rawItemCode || rawItemName}" chưa tồn tại trong danh mục để xuất kho.`
              );
            } else {
              const inSoFar = cumulativeInQty.get(itemKey) || 0;
              const outSoFar = cumulativeOutQty.get(itemKey) || 0;
              const currentAvailableStock = matchedItem.currentStock + inSoFar - outSoFar;

              if (qty > currentAvailableStock) {
                errors.push(
                  `Dòng ${idx + 2}: Số lượng xuất (${qty} ${matchedItem.unit}) vượt quá tồn kho khả dụng (${currentAvailableStock} ${matchedItem.unit}) của "${matchedItem.name}".`
                );
              } else {
                cumulativeOutQty.set(itemKey, outSoFar + qty);
              }
            }
          } else if (itemKey) {
            const inSoFar = cumulativeInQty.get(itemKey) || 0;
            cumulativeInQty.set(itemKey, inSoFar + qty);
          }

          const finalUnitPrice =
            unitPrice > 0 ? unitPrice : matchedItem ? matchedItem.unitPrice : 0;

          const lineItem: TransactionLineItem = {
            itemId: matchedItem ? matchedItem.id : '',
            itemCode: matchedItem
              ? matchedItem.code
              : itemCodeClean || `VT-${nowSuffix}-${idx + 1}`,
            itemName: rawItemName
              ? String(rawItemName).trim()
              : matchedItem
              ? matchedItem.name
              : itemCodeClean,
            unit: String(rawUnit).trim() || (matchedItem ? matchedItem.unit : 'Cái'),
            quantity: qty,
            unitPrice: finalUnitPrice,
            amount: qty * finalUnitPrice,
            serialNumber: serial,
            note,
            isNewItem,
          };

          const groupKey = rawVoucherCode
            ? `VOUCHER_${rawVoucherCode.toUpperCase()}`
            : `${dateStr.substring(0, 10)}_${type}_${matchedWh.id}_${partner}_${project}`;

          const existing = groupedMap.get(groupKey);
          if (existing) {
            existing.items.push(lineItem);
            existing.totalAmount += lineItem.amount;
            if (errors.length > 0) {
              existing.errors.push(...errors);
              existing.isValid = false;
            }
          } else {
            groupedMap.set(groupKey, {
              id: `GROUP-${nowSuffix}-${idx}`,
              code: rawVoucherCode || undefined,
              type,
              subtype,
              date: dateStr,
              warehouseId: matchedWh.id,
              warehouseName: matchedWh.name,
              partnerName: partner,
              departmentOrProject: project,
              notes: note || `Import tự động từ file ${file.name}`,
              items: [lineItem],
              totalAmount: lineItem.amount,
              isValid: errors.length === 0,
              errors,
            });
          }
        }

        const groupedList = Array.from(groupedMap.values());
        if (groupedList.length === 0) {
          setParseError('Không tìm thấy dòng chứng từ hợp lệ nào trong file Excel đã chọn.');
        }
        setParsedTransactions(groupedList);
      } catch (err: any) {
        setParseError(
          'Lỗi khi đọc file Excel: ' +
            (err.message || 'Định dạng file không phù hợp. Vui lòng kiểm tra lại cấu trúc bảng.')
        );
      } finally {
        setIsProcessing(false);
      }
    };

    reader.readAsArrayBuffer(file);
  };

  // Confirm Import
  const handleConfirmImport = () => {
    setParseError('');
    const validTransactions = parsedTransactions.filter(t => t.isValid);
    if (validTransactions.length === 0) {
      setParseError('Không có phiếu nào hợp lệ để import. Vui lòng kiểm tra danh sách lỗi bên dưới.');
      return;
    }

    const payload = validTransactions.map(t => ({
      code: t.code,
      type: t.type,
      subtype: t.subtype,
      date: t.date,
      warehouseId: t.warehouseId,
      partnerName: t.partnerName,
      departmentOrProject: t.departmentOrProject,
      creatorName: currentUser ? currentUser.fullName : 'Hệ thống Import Excel',
      approverName: 'Đã duyệt qua Excel',
      notes: t.notes,
      items: t.items,
      totalAmount: t.totalAmount,
      status: 'HOAN_THANH' as const,
    }));

    const result = importTransactionsBatch(payload);
    setImportSummary(result);

    if (result.success && result.errors.length === 0) {
      setTimeout(() => {
        onSuccess();
      }, 1500);
    }
  };

  const { validCount, invalidCount, totalLines } = useMemo(() => {
    let valid = 0;
    let invalid = 0;
    let lines = 0;
    for (let i = 0; i < parsedTransactions.length; i++) {
      const t = parsedTransactions[i];
      if (t.isValid) valid++;
      else invalid++;
      lines += t.items.length;
    }
    return { validCount: valid, invalidCount: invalid, totalLines: lines };
  }, [parsedTransactions]);

  const totalPreviewPages = Math.max(1, Math.ceil(parsedTransactions.length / previewPageSize));
  const safePreviewPage = Math.min(previewPage, totalPreviewPages);
  const paginatedTransactions = useMemo(() => {
    const start = (safePreviewPage - 1) * previewPageSize;
    return parsedTransactions.slice(start, start + previewPageSize);
  }, [parsedTransactions, safePreviewPage, previewPageSize]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-4xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-sm">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Import Phiếu Nhập Kho &amp; Xuất Kho Từ File Excel
              </h2>
              <p className="text-xs text-slate-500">
                Tự động gom nhóm nhiều dòng vào chung một phiếu, tự tạo vật tư mới khi nhập và kiểm soát tồn kho khả dụng khi xuất.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab(prev => (prev === 'preview' ? 'help' : 'preview'))}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                activeTab === 'help'
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>{activeTab === 'help' ? 'Xem dữ liệu' : 'Hướng dẫn quy chuẩn'}</span>
            </button>
            <button
              onClick={handleDownloadTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors"
              title="Tải file mẫu Excel chuẩn bao gồm 2 sheet mẫu Nhập/Xuất và hướng dẫn"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Tải file mẫu (.xlsx)</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {activeTab === 'help' ? (
            /* Guide Tab */
            <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <span>Quy chuẩn các cột dữ liệu trong file Excel:</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="bg-white p-3 rounded-lg border border-slate-200">
                  <div className="font-bold text-emerald-700 mb-1">Phiếu Nhập Kho (NHAP_KHO)</div>
                  <ul className="space-y-1 text-slate-600 list-disc pl-4">
                    <li><strong>Mã / Số phiếu:</strong> Tùy chọn (các dòng cùng mã phiếu sẽ gom vào 1 phiếu).</li>
                    <li><strong>Loại phiếu:</strong> "NHAP_KHO" hoặc "Nhập kho".</li>
                    <li><strong>Mã SKU &amp; Tên:</strong> Nếu chưa tồn tại trong kho, hệ thống tự động đăng ký mới.</li>
                    <li><strong>Số lượng:</strong> Số dương &gt; 0 (lập tức cộng vào tồn kho sau import).</li>
                    <li><strong>Đơn giá:</strong> Giá vốn nhập kho bình quân.</li>
                  </ul>
                </div>
                <div className="bg-white p-3 rounded-lg border border-slate-200">
                  <div className="font-bold text-amber-800 mb-1">Phiếu Xuất Kho (XUAT_KHO)</div>
                  <ul className="space-y-1 text-slate-600 list-disc pl-4">
                    <li><strong>Loại phiếu:</strong> "XUAT_KHO" hoặc "Xuất kho".</li>
                    <li><strong>Kiểm soát tồn kho:</strong> Số lượng xuất không được vượt quá số tồn khả dụng.</li>
                    <li><strong>Vật tư bắt buộc:</strong> Mã SKU phải tồn tại sẵn trong danh mục quản lý kho.</li>
                    <li><strong>Nghiệp vụ:</strong> XUAT_THI_CONG, XUAT_PHONG_BAN, XUAT_CHO_MUON...</li>
                  </ul>
                </div>
              </div>

              <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-900">
                <span className="font-bold">Danh sách kho hiện có trong hệ thống: </span>
                {warehouses.map(w => `${w.code} - ${w.name}`).join(' | ')}
              </div>
            </div>
          ) : (
            /* Main Upload & Preview */
            <>
              {/* File Upload Zone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-xl p-6 text-center cursor-pointer transition-colors bg-slate-50/50 hover:bg-emerald-50/20"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".xlsx, .xls, .csv"
                  className="hidden"
                />
                <UploadCloud className="w-9 h-9 text-emerald-600 mx-auto mb-2" />
                <p className="font-semibold text-slate-800 text-sm">
                  {fileName ? fileName : 'Bấm vào đây để chọn file Excel hoặc kéo thả file'}
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Chấp nhận các file định dạng .xlsx, .xls, .csv theo mẫu quy định (Hỗ trợ file xuất chi tiết từ phần mềm)
                </p>
              </div>

              {/* Inline Parse / Validation Error Banner */}
              {parseError && (
                <div className="p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span className="font-medium">{parseError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setParseError('')}
                    className="text-rose-400 hover:text-rose-700 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Import Result Notification if finished */}
              {importSummary && (
                <div
                  className={`p-4 rounded-xl border ${
                    importSummary.success
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold text-sm mb-1">
                    {importSummary.success ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-rose-600" />
                    )}
                    <span>
                      {importSummary.success
                        ? `Import thành công ${formatNumber(importSummary.importedCount)} phiếu vào kho!`
                        : 'Import có lỗi xảy ra.'}
                    </span>
                  </div>
                  {importSummary.errors.length > 0 && (
                    <div className="mt-2 space-y-1 text-xs max-h-36 overflow-y-auto">
                      {importSummary.errors.slice(0, 50).map((err, i) => (
                        <div key={i} className="text-rose-700">
                          &bull; {err}
                        </div>
                      ))}
                      {importSummary.errors.length > 50 && (
                        <div className="text-rose-600 font-semibold">
                          ... và {formatNumber(importSummary.errors.length - 50)} lỗi khác.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Parsed Preview Table */}
              {parsedTransactions.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm">
                        Xem Trước Dữ Liệu ({formatNumber(parsedTransactions.length)} chứng từ &bull;{' '}
                        {formatNumber(totalLines)} dòng mặt hàng)
                      </h3>
                      <div className="flex items-center gap-3 text-slate-500 mt-0.5">
                        <span className="text-emerald-700 font-semibold flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" />
                          <span>{formatNumber(validCount)} phiếu hợp lệ</span>
                        </span>
                        {invalidCount > 0 && (
                          <span className="text-rose-600 font-semibold flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>{formatNumber(invalidCount)} phiếu có lỗi</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleConfirmImport}
                      disabled={validCount === 0 || isProcessing}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Xác nhận Lưu Sổ ({formatNumber(validCount)} phiếu hợp lệ)</span>
                    </button>
                  </div>

                  {/* Paginated Transactions list */}
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {paginatedTransactions.map(trx => {
                      const isExpanded = Boolean(expandedVoucherIds[trx.id]);
                      const visibleLines = isExpanded
                        ? trx.items.slice(0, 200)
                        : trx.items.slice(0, MAX_PREVIEW_LINES_PER_VOUCHER);
                      const hiddenCount = trx.items.length - visibleLines.length;

                      return (
                        <div
                          key={trx.id}
                          className={`p-3.5 rounded-xl border transition-all ${
                            trx.isValid
                              ? 'bg-white border-slate-200'
                              : 'bg-rose-50/50 border-rose-200'
                          }`}
                        >
                          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`px-2 py-0.5 rounded font-bold text-[11px] ${
                                  trx.type === 'NHAP_KHO'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {getTransactionTypeLabel(trx.type)}
                              </span>
                              <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700">
                                {getSubtypeLabel(trx.subtype)}
                              </span>
                              {trx.code && (
                                <span className="font-mono font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                                  {trx.code}
                                </span>
                              )}
                              <span className="font-semibold text-slate-800">{trx.partnerName}</span>
                              <span className="text-slate-400">&bull;</span>
                              <span className="text-slate-600">{trx.departmentOrProject}</span>
                            </div>

                            <div className="flex items-center gap-3">
                              <span className="text-slate-500 font-medium">
                                Kho: <strong className="text-slate-800">{trx.warehouseName}</strong>
                              </span>
                              <span className="font-bold text-slate-900 tabular-nums">
                                {formatCurrency(trx.totalAmount)}
                              </span>
                            </div>
                          </div>

                          {/* Errors if any */}
                          {trx.errors.length > 0 && (
                            <div className="mb-2 p-2.5 bg-rose-100/70 rounded-lg text-[11px] text-rose-800 space-y-1 max-h-28 overflow-y-auto">
                              {trx.errors.slice(0, 20).map((e, ei) => (
                                <div key={ei} className="flex items-center gap-1.5 font-medium">
                                  <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                  <span>{e}</span>
                                </div>
                              ))}
                              {trx.errors.length > 20 && (
                                <div className="text-rose-700 font-semibold">
                                  ... và {formatNumber(trx.errors.length - 20)} lỗi khác trên phiếu này.
                                </div>
                              )}
                            </div>
                          )}

                          {/* Line items mini table */}
                          <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/50">
                            <table className="w-full text-left border-collapse text-[11px]">
                              <thead>
                                <tr className="border-b border-slate-200 bg-slate-100/80 text-slate-600 font-semibold">
                                  <th className="py-1.5 px-3">Mã SKU</th>
                                  <th className="py-1.5 px-3">Tên vật tư thiết bị</th>
                                  <th className="py-1.5 px-2 text-right">Số lượng</th>
                                  <th className="py-1.5 px-3 text-right">Đơn giá</th>
                                  <th className="py-1.5 px-3 text-right">Thành tiền</th>
                                  <th className="py-1.5 px-3">Số Lô / Serial</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {visibleLines.map((line, li) => (
                                  <tr key={li} className="hover:bg-white/80">
                                    <td className="py-1 px-3 font-mono font-medium text-slate-800">
                                      <span className="flex items-center gap-1.5">
                                        <span>{line.itemCode}</span>
                                        {line.isNewItem && (
                                          <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1 rounded">
                                            Mới
                                          </span>
                                        )}
                                      </span>
                                    </td>
                                    <td className="py-1 px-3 text-slate-700 font-medium">
                                      {line.itemName}
                                    </td>
                                    <td className="py-1 px-2 text-right font-bold tabular-nums text-slate-900">
                                      {formatNumber(line.quantity)} {line.unit}
                                    </td>
                                    <td className="py-1 px-3 text-right tabular-nums text-slate-600">
                                      {formatCurrency(line.unitPrice)}
                                    </td>
                                    <td className="py-1 px-3 text-right tabular-nums font-semibold text-slate-900">
                                      {formatCurrency(line.amount)}
                                    </td>
                                    <td className="py-1 px-3 font-mono text-slate-500">
                                      {line.serialNumber || '-'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {trx.items.length > MAX_PREVIEW_LINES_PER_VOUCHER && (
                              <div className="px-3 py-1.5 bg-slate-100/70 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-600">
                                <span>
                                  Đang hiển thị {formatNumber(visibleLines.length)} /{' '}
                                  {formatNumber(trx.items.length)} dòng vật tư trong phiếu
                                  {hiddenCount > 0 ? ` (còn ${formatNumber(hiddenCount)} dòng)` : ''}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedVoucherIds(prev => ({
                                      ...prev,
                                      [trx.id]: !isExpanded,
                                    }))
                                  }
                                  className="font-semibold text-indigo-700 hover:text-indigo-900"
                                >
                                  {isExpanded ? 'Thu gọn' : 'Xem thêm dòng'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {parsedTransactions.length > previewPageSize && (
                    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                      <PaginationBar
                        currentPage={safePreviewPage}
                        totalItems={parsedTransactions.length}
                        pageSize={previewPageSize}
                        onPageChange={setPreviewPage}
                        onPageSizeChange={size => {
                          setPreviewPageSize(size);
                          setPreviewPage(1);
                        }}
                        pageSizeOptions={[20, 30, 50, 100]}
                        itemLabel="chứng từ"
                        compact
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            * Sau khi xác nhận, toàn bộ phiếu nhập/xuất sẽ được lưu sổ và tự động cập nhật số dư tồn kho tức thời.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-100 font-semibold text-xs transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
