import React, { useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  AlertTriangle,
  Download,
  Warehouse as WarehouseIcon,
  PieChart,
  Layers,
  TableProperties,
  BarChart3,
  Search,
  X,
  Filter,
} from 'lucide-react';
import { useInventory } from '../context/InventoryContext';
import { MaterialCategory } from '../types/inventory';
import * as XLSX from 'xlsx';
import {
  formatCurrency,
  formatNumber,
  getFastItemWarehouseStocks,
  getItemTypeLabel,
  getStockStatus,
  getStockStatusLabel,
} from '../utils/formatters';
import { PaginationBar } from './PaginationBar';

interface DashboardViewProps {
  onSelectStockCard: (itemId: string) => void;
  onOpenCreateTransaction: (type: 'NHAP_KHO' | 'XUAT_KHO') => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onSelectStockCard,
}) => {
  const { items, materialCategories, transactions, warehouses } = useInventory();
  const [selectedReportWarehouse, setSelectedReportWarehouse] = useState<string>('ALL');
  const [reportViewMode, setReportViewMode] = useState<'matrix' | 'nxt'>('matrix');
  const [reportPage, setReportPage] = useState<number>(1);
  const [reportPageSize, setReportPageSize] = useState<number>(50);
  const [reportSearchQuery, setReportSearchQuery] = useState<string>('');
  const [reportQuickFilter, setReportQuickFilter] = useState<'ALL' | 'LOW_STOCK' | 'IN_STOCK' | 'ACTIVE_MOVEMENTS'>('ALL');

  useEffect(() => {
    setReportPage(1);
  }, [selectedReportWarehouse, reportViewMode, reportSearchQuery, reportQuickFilter]);

  // Single-pass KPI Calculations in O(N + T)
  const kpiStats = useMemo(() => {
    let totalInventoryValue = 0;
    let lowStockCount = 0;
    let equipmentOnLoanCount = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      totalInventoryValue += it.currentStock * it.unitPrice;
      const st = getStockStatus(it);
      if (st === 'CANH_BAO_THAP' || st === 'HET_HANG') lowStockCount++;
      if ((it.type === 'THIET_BI' || it.type === 'CONG_CU') && it.condition === 'DANG_MUON') {
        equipmentOnLoanCount++;
      }
    }

    let receiptsCount = 0;
    let issuesCount = 0;
    let totalReceiptValue = 0;
    let totalIssueValue = 0;

    for (let t = 0; t < transactions.length; t++) {
      const trx = transactions[t];
      if (trx.type === 'NHAP_KHO') {
        receiptsCount++;
        totalReceiptValue += Number(trx.totalAmount) || 0;
      } else if (trx.type === 'XUAT_KHO') {
        issuesCount++;
        totalIssueValue += Number(trx.totalAmount) || 0;
      }
    }

    return {
      totalItemsCount: items.length,
      totalInventoryValue,
      lowStockCount,
      equipmentOnLoanCount,
      receiptsCount,
      issuesCount,
      totalReceiptValue,
      totalIssueValue,
    };
  }, [items, transactions]);

  const { totalInventoryValue } = kpiStats;

  // Category breakdown linked with MaterialCategory in O(N + C)
  const categoryBreakdown = useMemo(() => {
    const catById = new Map<string, MaterialCategory>();
    const catByCode = new Map<string, MaterialCategory>();
    const catByName = new Map<string, MaterialCategory>();
    for (let i = 0; i < materialCategories.length; i++) {
      const c = materialCategories[i];
      catById.set(c.id, c);
      if (c.code) catByCode.set(c.code.trim().toUpperCase(), c);
      if (c.name) catByName.set(c.name.trim().toLowerCase(), c);
    }

    const map = new Map<string, { code?: string; name: string; count: number; value: number }>();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const matchedCat =
        (item.categoryId ? catById.get(item.categoryId) : undefined) ||
        (item.categoryCode ? catByCode.get(item.categoryCode.trim().toUpperCase()) : undefined) ||
        (item.category ? catByName.get(item.category.trim().toLowerCase()) : undefined);
      const key = matchedCat ? matchedCat.id : `RAW:${item.category || 'Chưa phân loại'}`;
      const existing = map.get(key);
      const itemVal = item.currentStock * item.unitPrice;
      if (existing) {
        existing.count += 1;
        existing.value += itemVal;
      } else {
        map.set(key, {
          code: matchedCat?.code || item.categoryCode,
          name: matchedCat?.name || item.category || 'Chưa phân loại',
          count: 1,
          value: itemVal,
        });
      }
    }

    return Array.from(map.values())
      .map(val => ({
        category: val.name,
        categoryCode: val.code,
        count: val.count,
        value: val.value,
        percentage: totalInventoryValue > 0 ? (val.value / totalInventoryValue) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [items, materialCategories, totalInventoryValue]);

  // Warehouse breakdown in O(N * W) using pre-computed item.warehouseStocks
  const warehouseBreakdown = useMemo(() => {
    const accum = new Map<string, { totalStock: number; totalValue: number; itemCount: number }>();
    for (let w = 0; w < warehouses.length; w++) {
      accum.set(warehouses[w].id, { totalStock: 0, totalValue: 0, itemCount: 0 });
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const stocks = getFastItemWarehouseStocks(item, warehouses);
      for (let w = 0; w < warehouses.length; w++) {
        const whId = warehouses[w].id;
        const qty = stocks[whId] || 0;
        if (qty > 0) {
          const entry = accum.get(whId)!;
          entry.totalStock += qty;
          entry.totalValue += qty * item.unitPrice;
          entry.itemCount += 1;
        }
      }
    }

    return warehouses.map(wh => {
      const entry = accum.get(wh.id) || { totalStock: 0, totalValue: 0, itemCount: 0 };
      return {
        id: wh.id,
        name: wh.name,
        code: wh.code,
        itemCount: entry.itemCount,
        totalStock: entry.totalStock,
        totalValue: entry.totalValue,
        percentage: totalInventoryValue > 0 ? (entry.totalValue / totalInventoryValue) * 100 : 0,
      };
    });
  }, [warehouses, items, totalInventoryValue]);

  // 1. Multi-Warehouse Stock Matrix in O(N * W)
  const warehouseMatrixRows = useMemo(() => {
    const rows = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const stocks = getFastItemWarehouseStocks(item, warehouses);
      if (selectedReportWarehouse !== 'ALL' && (stocks[selectedReportWarehouse] || 0) <= 0) {
        continue;
      }
      let totalStock = 0;
      const vals = Object.values(stocks);
      for (let v = 0; v < vals.length; v++) totalStock += Number(vals[v]) || 0;

      const totalValue = totalStock * item.unitPrice;
      const status = getStockStatus({
        currentStock: totalStock,
        minStock: item.minStock,
        maxStock: item.maxStock,
      });

      rows.push({
        id: item.id,
        code: item.code,
        name: item.name,
        type: item.type,
        category: item.category,
        unit: item.unit,
        location: item.location || 'Chưa xếp kệ',
        stocks,
        totalStock,
        unitPrice: item.unitPrice,
        totalValue,
        status,
      });
    }
    return rows;
  }, [items, warehouses, selectedReportWarehouse]);

  const matrixTotals = useMemo(() => {
    const byWh: Record<string, number> = {};
    for (let w = 0; w < warehouses.length; w++) byWh[warehouses[w].id] = 0;
    let grandTotalStock = 0;
    let grandTotalValue = 0;
    for (let i = 0; i < warehouseMatrixRows.length; i++) {
      const r = warehouseMatrixRows[i];
      grandTotalStock += r.totalStock;
      grandTotalValue += r.totalValue;
      for (let w = 0; w < warehouses.length; w++) {
        const whId = warehouses[w].id;
        byWh[whId] += r.stocks[whId] || 0;
      }
    }
    return { byWh, grandTotalStock, grandTotalValue };
  }, [warehouseMatrixRows, warehouses]);

  // 2. Comprehensive In-Out-Stock (NXT) Report Data in O(N * W + T_lines) instead of O(W * N * T)
  const nxtReportRows = useMemo(() => {
    const n = items.length;
    if (n === 0 || warehouses.length === 0) return [];

    const idToIdx = new Map<string, number>();
    const codeToIdx = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      if (items[i].id) idToIdx.set(items[i].id, i);
      const normCode = (items[i].code || '').trim().toUpperCase();
      if (normCode && !codeToIdx.has(normCode)) codeToIdx.set(normCode, i);
    }

    const inByItemWh = new Array<Record<string, number>>(n);
    const outByItemWh = new Array<Record<string, number>>(n);
    for (let i = 0; i < n; i++) {
      inByItemWh[i] = {};
      outByItemWh[i] = {};
    }

    for (let t = 0; t < transactions.length; t++) {
      const trx = transactions[t];
      if (!trx || trx.status === 'DA_HUY') continue;
      const whId = trx.warehouseId;
      if (!whId) continue;
      if (selectedReportWarehouse !== 'ALL' && whId !== selectedReportWarehouse) continue;

      const isReceipt = trx.type === 'NHAP_KHO';
      const isIssue = trx.type === 'XUAT_KHO';
      if (!isReceipt && !isIssue) continue;

      const lines = trx.items || [];
      for (let l = 0; l < lines.length; l++) {
        const line = lines[l];
        if (!line) continue;
        let idx = line.itemId ? idToIdx.get(line.itemId) : undefined;
        if (idx === undefined && line.itemCode) {
          idx = codeToIdx.get(line.itemCode.trim().toUpperCase());
        }
        if (idx === undefined) continue;

        const qty = Number(line.quantity) || 0;
        if (isReceipt) {
          inByItemWh[idx][whId] = (inByItemWh[idx][whId] || 0) + qty;
        } else {
          outByItemWh[idx][whId] = (outByItemWh[idx][whId] || 0) + qty;
        }
      }
    }

    const targetWarehouses =
      selectedReportWarehouse === 'ALL'
        ? warehouses
        : warehouses.filter(w => w.id === selectedReportWarehouse);

    const rows: Array<{
      id: string;
      itemId: string;
      code: string;
      name: string;
      type: string;
      unit: string;
      location: string;
      warehouseId: string;
      warehouseName: string;
      openingStock: number;
      totalIn: number;
      totalOut: number;
      closingStock: number;
      unitPrice: number;
      closingValue: number;
      status: ReturnType<typeof getStockStatus>;
    }> = [];

    for (let w = 0; w < targetWarehouses.length; w++) {
      const wh = targetWarehouses[w];
      for (let i = 0; i < n; i++) {
        const item = items[i];
        const stocks = getFastItemWarehouseStocks(item, warehouses);
        const closingStock = stocks[wh.id] || 0;
        const totalIn = inByItemWh[i][wh.id] || 0;
        const totalOut = outByItemWh[i][wh.id] || 0;

        if (closingStock > 0 || totalIn > 0 || totalOut > 0) {
          const openingStock = Math.max(0, closingStock - totalIn + totalOut);
          const closingValue = closingStock * item.unitPrice;
          rows.push({
            id: `${item.id}-${wh.id}`,
            itemId: item.id,
            code: item.code,
            name: item.name,
            type: item.type,
            unit: item.unit,
            location: item.location || 'Chưa xếp kệ',
            warehouseId: wh.id,
            warehouseName: wh.name,
            openingStock,
            totalIn,
            totalOut,
            closingStock,
            unitPrice: item.unitPrice,
            closingValue,
            status: getStockStatus({
              currentStock: closingStock,
              minStock: item.minStock,
              maxStock: item.maxStock,
            }),
          });
        }
      }
    }

    return rows;
  }, [items, transactions, selectedReportWarehouse, warehouses]);

  const nxtTotals = useMemo(() => {
    let openingStock = 0;
    let totalIn = 0;
    let totalOut = 0;
    let closingStock = 0;
    let closingValue = 0;
    for (let i = 0; i < nxtReportRows.length; i++) {
      const r = nxtReportRows[i];
      openingStock += r.openingStock;
      totalIn += r.totalIn;
      totalOut += r.totalOut;
      closingStock += r.closingStock;
      closingValue += r.closingValue;
    }
    return { openingStock, totalIn, totalOut, closingStock, closingValue };
  }, [nxtReportRows]);

  // Chuẩn hóa chuỗi tìm kiếm không dấu, chữ thường
  const normalizeForSearch = (str: string) => {
    return (str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .trim();
  };

  // 3. Lọc danh sách ma trận tồn kho theo tìm kiếm thông minh & bộ lọc nhanh
  const filteredWarehouseMatrixRows = useMemo(() => {
    const q = normalizeForSearch(reportSearchQuery);
    return warehouseMatrixRows.filter(row => {
      // Bộ lọc nhanh trạng thái
      if (reportQuickFilter === 'LOW_STOCK') {
        if (row.status !== 'CANH_BAO_THAP' && row.status !== 'HET_HANG') return false;
      } else if (reportQuickFilter === 'IN_STOCK') {
        if (row.totalStock <= 0) return false;
      }

      // Từ khóa tìm kiếm thông minh
      if (!q) return true;
      const matchCode = normalizeForSearch(row.code).includes(q);
      const matchName = normalizeForSearch(row.name).includes(q);
      const matchCategory = normalizeForSearch(row.category).includes(q);
      const matchLocation = normalizeForSearch(row.location).includes(q);
      const matchUnit = normalizeForSearch(row.unit).includes(q);
      return matchCode || matchName || matchCategory || matchLocation || matchUnit;
    });
  }, [warehouseMatrixRows, reportSearchQuery, reportQuickFilter]);

  // 4. Lọc danh sách chi tiết NXT theo tìm kiếm thông minh & bộ lọc nhanh
  const filteredNxtReportRows = useMemo(() => {
    const q = normalizeForSearch(reportSearchQuery);
    return nxtReportRows.filter(row => {
      // Bộ lọc nhanh trạng thái
      if (reportQuickFilter === 'LOW_STOCK') {
        if (row.status !== 'CANH_BAO_THAP' && row.status !== 'HET_HANG') return false;
      } else if (reportQuickFilter === 'IN_STOCK') {
        if (row.closingStock <= 0) return false;
      } else if (reportQuickFilter === 'ACTIVE_MOVEMENTS') {
        if (row.totalIn <= 0 && row.totalOut <= 0) return false;
      }

      // Từ khóa tìm kiếm thông minh
      if (!q) return true;
      const matchCode = normalizeForSearch(row.code).includes(q);
      const matchName = normalizeForSearch(row.name).includes(q);
      const matchWarehouse = normalizeForSearch(row.warehouseName).includes(q);
      const matchLocation = normalizeForSearch(row.location).includes(q);
      const matchUnit = normalizeForSearch(row.unit).includes(q);
      return matchCode || matchName || matchWarehouse || matchLocation || matchUnit;
    });
  }, [nxtReportRows, reportSearchQuery, reportQuickFilter]);

  const activeTotalRowsCount =
    reportViewMode === 'matrix' ? filteredWarehouseMatrixRows.length : filteredNxtReportRows.length;
  const totalReportPages = Math.max(1, Math.ceil(activeTotalRowsCount / reportPageSize));
  const safeReportPage = Math.min(Math.max(1, reportPage), totalReportPages);
  const pageOffset = (safeReportPage - 1) * reportPageSize;

  const paginatedMatrixRows = useMemo(
    () => filteredWarehouseMatrixRows.slice(pageOffset, pageOffset + reportPageSize),
    [filteredWarehouseMatrixRows, pageOffset, reportPageSize]
  );

  const paginatedNxtRows = useMemo(
    () => filteredNxtReportRows.slice(pageOffset, pageOffset + reportPageSize),
    [filteredNxtReportRows, pageOffset, reportPageSize]
  );

  const visibleWarehouses = useMemo(
    () =>
      warehouses.filter(w => selectedReportWarehouse === 'ALL' || w.id === selectedReportWarehouse),
    [warehouses, selectedReportWarehouse]
  );

  // Export report to genuine Excel (.xlsx) file with full multi-warehouse stock breakdown
  const handleExportExcel = () => {
    const selectedWhName =
      selectedReportWarehouse === 'ALL'
        ? 'Tat_Ca_Cac_Kho'
        : warehouses.find(w => w.id === selectedReportWarehouse)?.name?.replace(/\s+/g, '_') ||
          selectedReportWarehouse;

    const workbook = XLSX.utils.book_new();

    // Sheet 1: Bảng tổng hợp số lượng tồn chia theo từng kho (dùng danh sách đã lọc thông minh)
    const exportMatrixRows = filteredWarehouseMatrixRows.length > 0 ? filteredWarehouseMatrixRows : warehouseMatrixRows;
    const matrixSheetData = exportMatrixRows.map((row, idx) => {
      const rowObj: Record<string, any> = {
        STT: idx + 1,
        'Mã SKU': row.code,
        'Tên Vật Tư Thiết Bị': row.name,
        'Phân Loại': getItemTypeLabel(row.type as any),
        'Nhóm Ngành': row.category,
        'ĐVT': row.unit,
        'Vị Trí Kệ / Ngăn': row.location,
      };

      warehouses.forEach(wh => {
        rowObj[`Tồn tại: ${wh.name}`] = row.stocks[wh.id] || 0;
      });

      rowObj['Tổng Tồn Kho (Các Kho)'] = row.totalStock;
      rowObj['Đơn Giá Vốn (VNĐ)'] = row.unitPrice;
      rowObj['Tổng Thành Tiền (VNĐ)'] = row.totalValue;
      rowObj['Tình Trạng Tồn'] = getStockStatusLabel(row.status);

      return rowObj;
    });

    const summaryMatrixRow: Record<string, any> = {
      STT: 'TỔNG CỘNG',
      'Mã SKU': '',
      'Tên Vật Tư Thiết Bị': `Tổng ${exportMatrixRows.length} mặt hàng`,
      'Phân Loại': '',
      'Nhóm Ngành': '',
      'ĐVT': '',
      'Vị Trí Kệ / Ngăn': '',
    };
    warehouses.forEach(wh => {
      summaryMatrixRow[`Tồn tại: ${wh.name}`] = matrixTotals.byWh[wh.id] || 0;
    });
    summaryMatrixRow['Tổng Tồn Kho (Các Kho)'] = matrixTotals.grandTotalStock;
    summaryMatrixRow['Đơn Giá Vốn (VNĐ)'] = '';
    summaryMatrixRow['Tổng Thành Tiền (VNĐ)'] = matrixTotals.grandTotalValue;
    summaryMatrixRow['Tình Trạng Tồn'] = '';
    matrixSheetData.push(summaryMatrixRow);

    const matrixWorksheet = XLSX.utils.json_to_sheet(matrixSheetData);
    XLSX.utils.book_append_sheet(workbook, matrixWorksheet, 'Ton_Kho_Tung_Kho');

    // Sheet 2: Sổ NXT chi tiết (dùng danh sách đã lọc thông minh)
    const exportNxtRows = filteredNxtReportRows.length > 0 ? filteredNxtReportRows : nxtReportRows;
    const nxtSheetData = exportNxtRows.map((row, idx) => ({
      STT: idx + 1,
      'Mã SKU': row.code,
      'Tên Vật Tư Thiết Bị': row.name,
      'Phân Loại': getItemTypeLabel(row.type as any),
      'ĐVT': row.unit,
      'Kho Lưu Trữ': row.warehouseName,
      'Vị Trí Kệ / Ngăn': row.location,
      'Tồn Đầu Kỳ': row.openingStock,
      'Nhập Trong Kỳ': row.totalIn,
      'Xuất Trong Kỳ': row.totalOut,
      'Tồn Cuối Kỳ': row.closingStock,
      'Đơn Giá Vốn (VNĐ)': row.unitPrice,
      'Thành Tiền Tồn (VNĐ)': row.closingValue,
      'Tình Trạng': getStockStatusLabel(row.status),
    }));

    if (nxtSheetData.length > 0) {
      nxtSheetData.push({
        STT: 'TỔNG CỘNG' as any,
        'Mã SKU': '',
        'Tên Vật Tư Thiết Bị': `Tổng ${nxtReportRows.length} dòng dữ liệu`,
        'Phân Loại': '',
        'ĐVT': '',
        'Kho Lưu Trữ': '',
        'Vị Trí Kệ / Ngăn': '',
        'Tồn Đầu Kỳ': nxtTotals.openingStock,
        'Nhập Trong Kỳ': nxtTotals.totalIn,
        'Xuất Trong Kỳ': nxtTotals.totalOut,
        'Tồn Cuối Kỳ': nxtTotals.closingStock,
        'Đơn Giá Vốn (VNĐ)': '' as any,
        'Thành Tiền Tồn (VNĐ)': nxtTotals.closingValue,
        'Tình Trạng': '',
      });
      const nxtWorksheet = XLSX.utils.json_to_sheet(nxtSheetData);
      XLSX.utils.book_append_sheet(workbook, nxtWorksheet, 'Chi_Tiet_NXT');
    }

    XLSX.writeFile(
      workbook,
      `Bao_Cao_Ton_Kho_Phan_Bo_${selectedWhName}_${new Date().toISOString().substring(0, 10)}.xlsx`
    );
  };

  return (
    <div className="space-y-6">
      {/* KPI Cards Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Tổng giá trị tồn kho</span>
            <Boxes className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">
            {formatCurrency(kpiStats.totalInventoryValue)}
          </div>
          <div className="mt-2 text-xs text-slate-500 flex items-center gap-1.5">
            <span className="font-semibold text-slate-700 tabular-nums">
              {formatNumber(kpiStats.totalItemsCount)}
            </span>
            <span>danh mục vật tư thiết bị</span>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Cảnh báo thiếu hụt</span>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-bold text-rose-600 tabular-nums">
            {formatNumber(kpiStats.lowStockCount)}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            <span>Dưới định mức min hoặc hết tồn kho</span>
          </div>
        </div>

        {/* Metric 3 */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Thiết bị đang thi công/mượn</span>
            <Layers className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">
            {formatNumber(kpiStats.equipmentOnLoanCount)}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            <span>Máy móc, công cụ tại các công trường</span>
          </div>
        </div>

        {/* Metric 4 */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Lưu chuyển trong kỳ</span>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="w-2 h-2 rounded-full bg-amber-500" />
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <div>
              <span className="text-xs text-emerald-700 block">
                Nhập ({formatNumber(kpiStats.receiptsCount)})
              </span>
              <span className="text-sm font-bold text-slate-800 tabular-nums">
                {formatCurrency(kpiStats.totalReceiptValue)}
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs text-amber-700 block">
                Xuất ({formatNumber(kpiStats.issuesCount)})
              </span>
              <span className="text-sm font-bold text-slate-800 tabular-nums">
                {formatCurrency(kpiStats.totalIssueValue)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Distribution Section: Categories & Warehouses */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Category Breakdown (2 columns) */}
        <div className="lg:col-span-2 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Phân bổ giá trị theo danh mục vật tư
              </h3>
              <p className="text-xs text-slate-500">Tỷ trọng vốn lưu động tại các kho</p>
            </div>
            <PieChart className="w-4 h-4 text-slate-400" />
          </div>

          <div className="space-y-3.5 max-h-[380px] overflow-y-auto pr-1">
            {categoryBreakdown.map(cat => (
              <div key={`${cat.categoryCode || ''}-${cat.category}`} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 truncate pr-2">
                    {cat.categoryCode && (
                      <span className="font-mono font-semibold text-indigo-700 mr-1.5">
                        [{cat.categoryCode}]
                      </span>
                    )}
                    {cat.category}
                  </span>
                  <div className="flex items-center gap-3 shrink-0 tabular-nums">
                    <span className="text-slate-500">{formatNumber(cat.count)} mặt hàng</span>
                    <span className="font-semibold text-slate-900">
                      {formatCurrency(cat.value)}
                    </span>
                    <span className="w-12 text-right text-slate-400">
                      {cat.percentage.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(cat.percentage, 2)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Warehouse Breakdown (1 column) */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Số lượng tồn theo Kho &amp; Dự án
              </h3>
              <p className="text-xs text-slate-500">Chi tiết số lượng và giá trị từng địa điểm</p>
            </div>
            <WarehouseIcon className="w-4 h-4 text-slate-400" />
          </div>

          <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
            {warehouseBreakdown.map(wh => (
              <div
                key={wh.id}
                className="p-3.5 bg-slate-50/80 hover:bg-slate-50 rounded-lg border border-slate-200/80 transition-all space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-slate-900 truncate block" title={wh.name}>
                      {wh.name}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      Mã kho: {wh.code}
                    </span>
                  </div>
                  <span className="text-xs font-bold text-indigo-700 tabular-nums bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                    {wh.percentage.toFixed(0)}% vốn
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200/60 text-xs">
                  <div>
                    <span className="text-[11px] text-slate-500 block">Số lượng tồn:</span>
                    <span className="font-bold text-slate-900 text-sm tabular-nums">
                      {formatNumber(wh.totalStock)}
                    </span>
                    <span className="text-[10px] text-slate-400 ml-1">đơn vị</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-slate-500 block">Giá trị tồn kho:</span>
                    <span className="font-bold text-indigo-700 tabular-nums">
                      {formatCurrency(wh.totalValue)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
                  <span>{formatNumber(wh.itemCount)} danh mục lưu trữ</span>
                </div>

                <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(wh.percentage, 2)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Stock Report Section: Multi-Warehouse Stock Matrix & Detailed NXT */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Table Header Controls */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-50/50">
          <div>
            <div className="flex items-center gap-2">
              <TableProperties className="w-5 h-5 text-indigo-600" />
              <h3 className="text-base font-bold text-slate-900">
                Báo Cáo Phân Bổ Tồn Kho &amp; Nhập - Xuất - Tồn
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {reportViewMode === 'matrix'
                ? 'Bảng ma trận chia chi tiết số lượng tồn của từng mặt hàng theo từng kho lưu trữ'
                : 'Báo cáo chi tiết số dư đầu kỳ, phát sinh nhập/xuất và tồn cuối kỳ theo kho'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-white shadow-2xs">
              <button
                type="button"
                onClick={() => setReportViewMode('matrix')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  reportViewMode === 'matrix'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <TableProperties className="w-3.5 h-3.5" />
                <span>Chia tồn theo các kho</span>
              </button>

              <button
                type="button"
                onClick={() => setReportViewMode('nxt')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  reportViewMode === 'nxt'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Báo cáo NXT chi tiết</span>
              </button>
            </div>

            <select
              value={selectedReportWarehouse}
              onChange={e => setSelectedReportWarehouse(e.target.value)}
              className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 bg-white hover:border-indigo-500 outline-none text-slate-800 font-semibold shadow-2xs"
            >
              <option value="ALL">Tất cả kho lưu trữ ({warehouses.length} kho)</option>
              {warehouses.map(w => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>

            <button
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-2xs whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Xuất Excel (.xlsx)</span>
            </button>
          </div>
        </div>

        {/* SMART SEARCH BAR FOR PHÂN BỔ NHẬP - XUẤT - TỒN */}
        <div className="px-4 py-3 bg-slate-50/90 border-b border-slate-200 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search Input Box */}
          <div className="relative flex-1 min-w-[280px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={reportSearchQuery}
              onChange={e => setReportSearchQuery(e.target.value)}
              placeholder="Tìm kiếm thông minh: mã SKU, tên vật tư, danh mục, vị trí kệ/ngăn..."
              className="w-full pl-9 pr-9 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 shadow-2xs text-slate-900 placeholder-slate-400 transition-all font-medium"
            />
            {reportSearchQuery && (
              <button
                type="button"
                onClick={() => setReportSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-md transition-colors"
                title="Xóa tìm kiếm"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Filter Status Badges */}
          <div className="flex flex-wrap items-center gap-1.5 shrink-0 text-xs">
            <span className="text-slate-400 text-[11px] font-semibold flex items-center gap-1 mr-1">
              <Filter className="w-3 h-3" />
              Lọc nhanh:
            </span>

            <button
              type="button"
              onClick={() => setReportQuickFilter('ALL')}
              className={`px-2.5 py-1 rounded-md font-semibold text-xs transition-all ${
                reportQuickFilter === 'ALL'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              Tất cả
            </button>

            <button
              type="button"
              onClick={() => setReportQuickFilter('LOW_STOCK')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold text-xs transition-all ${
                reportQuickFilter === 'LOW_STOCK'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'bg-white text-rose-700 hover:bg-rose-50 border border-rose-200'
              }`}
            >
              <AlertTriangle className="w-3 h-3" />
              <span>Cảnh báo tồn</span>
            </button>

            <button
              type="button"
              onClick={() => setReportQuickFilter('IN_STOCK')}
              className={`px-2.5 py-1 rounded-md font-semibold text-xs transition-all ${
                reportQuickFilter === 'IN_STOCK'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-white text-emerald-700 hover:bg-emerald-50 border border-emerald-200'
              }`}
            >
              Còn hàng
            </button>

            {reportViewMode === 'nxt' && (
              <button
                type="button"
                onClick={() => setReportQuickFilter('ACTIVE_MOVEMENTS')}
                className={`px-2.5 py-1 rounded-md font-semibold text-xs transition-all ${
                  reportQuickFilter === 'ACTIVE_MOVEMENTS'
                    ? 'bg-indigo-600 text-white shadow-2xs'
                    : 'bg-white text-indigo-700 hover:bg-indigo-50 border border-indigo-200'
                }`}
              >
                Có phát sinh Nhập/Xuất
              </button>
            )}

            {/* Matching Result Count Badge */}
            <div className="pl-2 border-l border-slate-200 text-[11px] text-slate-500 font-semibold whitespace-nowrap">
              Hiển thị: <strong className="text-slate-900 font-bold">{activeTotalRowsCount}</strong>{' '}
              {reportViewMode === 'matrix' ? 'mặt hàng' : 'dòng chi tiết'}
              {(reportSearchQuery || reportQuickFilter !== 'ALL') && (
                <button
                  type="button"
                  onClick={() => {
                    setReportSearchQuery('');
                    setReportQuickFilter('ALL');
                  }}
                  className="ml-2 text-indigo-600 hover:text-indigo-800 underline font-semibold"
                >
                  Xóa lọc
                </button>
              )}
            </div>
          </div>
        </div>

        {/* VIEW MODE 1: MATRIX TABLE */}
        {reportViewMode === 'matrix' && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/90 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-3 w-10 text-center">STT</th>
                    <th className="py-3 px-3 whitespace-nowrap">Mã SKU</th>
                    <th className="py-3 px-4 min-w-[220px]">Tên vật tư / thiết bị</th>
                    <th className="py-3 px-2 text-center whitespace-nowrap">ĐVT</th>
                    <th className="py-3 px-3 min-w-[120px] whitespace-nowrap">Vị trí kệ/ngăn</th>

                    {visibleWarehouses.map(w => (
                      <th
                        key={w.id}
                        className="py-3 px-3 text-right min-w-[130px] bg-indigo-50/50 text-indigo-950 font-bold border-x border-slate-200"
                        title={w.name}
                      >
                        <div className="truncate">{w.name}</div>
                        <div className="text-[10px] text-indigo-600 font-normal mt-0.5">SL Tồn</div>
                      </th>
                    ))}

                    <th className="py-3 px-3 text-right min-w-[110px] bg-slate-200/80 font-bold text-slate-900 whitespace-nowrap">
                      Tổng tồn kho
                    </th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Đơn giá vốn</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Tổng thành tiền</th>
                    <th className="py-3 px-3 text-center whitespace-nowrap">Tình trạng</th>
                    <th className="py-3 px-3 text-center whitespace-nowrap">Thẻ kho</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedMatrixRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9 + visibleWarehouses.length}
                        className="py-12 text-center text-slate-500 text-xs"
                      >
                        <div className="flex flex-col items-center justify-center gap-1.5 max-w-sm mx-auto">
                          <Search className="w-8 h-8 text-slate-300" />
                          <span className="font-semibold text-slate-700 text-sm">
                            {reportSearchQuery
                              ? `Không tìm thấy mặt hàng nào khớp với "${reportSearchQuery}"`
                              : 'Không có dữ liệu mặt hàng nào tại kho đã chọn.'}
                          </span>
                          {(reportSearchQuery || reportQuickFilter !== 'ALL') && (
                            <button
                              type="button"
                              onClick={() => {
                                setReportSearchQuery('');
                                setReportQuickFilter('ALL');
                              }}
                              className="text-xs text-indigo-600 hover:text-indigo-800 underline font-semibold mt-1"
                            >
                              Xóa bộ lọc tìm kiếm
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedMatrixRows.map((row, idx) => {
                      const isLow = row.status === 'CANH_BAO_THAP' || row.status === 'HET_HANG';

                      return (
                        <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-3 text-center font-mono text-slate-400 text-[11px]">
                            {pageOffset + idx + 1}
                          </td>
                          <td className="py-3 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                            {row.code}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900 line-clamp-1" title={row.name}>
                              {row.name}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                              <span>{getItemTypeLabel(row.type as any)}</span>
                              <span>&bull;</span>
                              <span className="text-slate-400">{row.category}</span>
                            </div>
                          </td>
                          <td className="py-3 px-2 text-center text-slate-600 whitespace-nowrap font-medium">
                            {row.unit}
                          </td>
                          <td className="py-3 px-3 text-slate-700 whitespace-nowrap font-medium">
                            <span className="inline-block bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px] border border-slate-200">
                              {row.location}
                            </span>
                          </td>

                          {visibleWarehouses.map(w => {
                            const whStock = row.stocks[w.id] || 0;
                            return (
                              <td
                                key={w.id}
                                className="py-3 px-3 text-right tabular-nums border-x border-slate-100 whitespace-nowrap"
                              >
                                {whStock > 0 ? (
                                  <span className="font-bold text-indigo-900 bg-indigo-50/80 px-2 py-0.5 rounded border border-indigo-100/80">
                                    {formatNumber(whStock)}
                                  </span>
                                ) : (
                                  <span className="text-slate-300 font-mono">-</span>
                                )}
                              </td>
                            );
                          })}

                          <td className="py-3 px-3 text-right tabular-nums font-bold text-slate-900 bg-slate-50/60 whitespace-nowrap">
                            <span
                              className={
                                row.totalStock === 0
                                  ? 'text-rose-600'
                                  : isLow
                                  ? 'text-amber-600'
                                  : 'text-slate-900'
                              }
                            >
                              {formatNumber(row.totalStock)}
                            </span>
                          </td>

                          <td className="py-3 px-3 text-right tabular-nums text-slate-600 whitespace-nowrap">
                            {formatCurrency(row.unitPrice)}
                          </td>

                          <td className="py-3 px-4 text-right tabular-nums font-bold text-indigo-700 whitespace-nowrap">
                            {formatCurrency(row.totalValue)}
                          </td>

                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                row.status === 'HET_HANG'
                                  ? 'bg-rose-100 text-rose-700'
                                  : row.status === 'CANH_BAO_THAP'
                                  ? 'bg-amber-100 text-amber-700'
                                  : row.status === 'VUOT_DINH_MUC'
                                  ? 'bg-purple-100 text-purple-700'
                                  : 'bg-emerald-100 text-emerald-700'
                              }`}
                            >
                              {getStockStatusLabel(row.status)}
                            </span>
                          </td>

                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            <button
                              onClick={() => onSelectStockCard(row.id)}
                              className="text-indigo-600 hover:text-indigo-800 font-semibold underline underline-offset-2 hover:bg-indigo-50 px-2 py-1 rounded text-xs"
                            >
                              Xem thẻ kho
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100/90 border-t-2 border-slate-300 font-bold text-slate-900 text-xs">
                    <td colSpan={5} className="py-3.5 px-4 uppercase tracking-wider">
                      Tổng cộng tồn kho ({formatNumber(warehouseMatrixRows.length)} mặt hàng)
                    </td>

                    {visibleWarehouses.map(w => (
                      <td
                        key={w.id}
                        className="py-3.5 px-3 text-right tabular-nums text-indigo-950 font-bold bg-indigo-100/50 border-x border-slate-200 whitespace-nowrap"
                      >
                        {formatNumber(matrixTotals.byWh[w.id] || 0)}
                      </td>
                    ))}

                    <td className="py-3.5 px-3 text-right tabular-nums font-bold text-slate-900 bg-slate-200/60 whitespace-nowrap">
                      {formatNumber(matrixTotals.grandTotalStock)}
                    </td>
                    <td className="py-3.5 px-3 text-right text-slate-400">-</td>
                    <td className="py-3.5 px-4 text-right tabular-nums font-bold text-indigo-700 whitespace-nowrap">
                      {formatCurrency(matrixTotals.grandTotalValue)}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <PaginationBar
              currentPage={safeReportPage}
              totalItems={warehouseMatrixRows.length}
              pageSize={reportPageSize}
              onPageChange={setReportPage}
              onPageSizeChange={setReportPageSize}
              itemLabel="mặt hàng"
            />
          </>
        )}

        {/* VIEW MODE 2: SỔ NHẬP - XUẤT - TỒN CHI TIẾT (NXT LEDGER) */}
        {reportViewMode === 'nxt' && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/90 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-3 w-10 text-center">STT</th>
                    <th className="py-3 px-3 whitespace-nowrap">Mã SKU</th>
                    <th className="py-3 px-4 min-w-[200px]">Tên vật tư / thiết bị</th>
                    <th className="py-3 px-2 text-center whitespace-nowrap">ĐVT</th>
                    <th className="py-3 px-3 whitespace-nowrap">Kho lưu trữ</th>
                    <th className="py-3 px-3 whitespace-nowrap">Vị trí kệ/ngăn</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Tồn đầu kỳ</th>
                    <th className="py-3 px-3 text-right text-emerald-700 whitespace-nowrap">Nhập kỳ</th>
                    <th className="py-3 px-3 text-right text-amber-700 whitespace-nowrap">Xuất kỳ</th>
                    <th className="py-3 px-3 text-right font-bold text-slate-900 whitespace-nowrap">Tồn cuối</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Đơn giá vốn</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Thành tiền tồn</th>
                    <th className="py-3 px-3 text-center whitespace-nowrap">Thẻ kho</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedNxtRows.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="py-12 text-center text-slate-500 text-xs">
                        <div className="flex flex-col items-center justify-center gap-1.5 max-w-sm mx-auto">
                          <Search className="w-8 h-8 text-slate-300" />
                          <span className="font-semibold text-slate-700 text-sm">
                            {reportSearchQuery
                              ? `Không tìm thấy dòng phát sinh NXT nào khớp với "${reportSearchQuery}"`
                              : 'Không có phát sinh giao dịch hoặc số dư tại kho này.'}
                          </span>
                          {(reportSearchQuery || reportQuickFilter !== 'ALL') && (
                            <button
                              type="button"
                              onClick={() => {
                                setReportSearchQuery('');
                                setReportQuickFilter('ALL');
                              }}
                              className="text-xs text-indigo-600 hover:text-indigo-800 underline font-semibold mt-1"
                            >
                              Xóa bộ lọc tìm kiếm
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedNxtRows.map((row, idx) => (
                      <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-3 text-center font-mono text-slate-400 text-[11px]">
                          {pageOffset + idx + 1}
                        </td>
                        <td className="py-3 px-3 font-mono font-medium text-slate-900 whitespace-nowrap">
                          {row.code}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-900 min-w-[200px]">
                          <div className="line-clamp-1">{row.name}</div>
                          <div className="text-[11px] text-slate-400 font-normal">
                            {getItemTypeLabel(row.type as any)}
                          </div>
                        </td>
                        <td className="py-3 px-2 text-center text-slate-600 whitespace-nowrap">{row.unit}</td>
                        <td className="py-3 px-3 text-slate-700 whitespace-nowrap font-medium max-w-[150px] truncate" title={row.warehouseName}>
                          <span className="inline-block bg-indigo-50 text-indigo-900 px-2 py-0.5 rounded text-[11px] border border-indigo-100 font-semibold">
                            {row.warehouseName}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-slate-600 whitespace-nowrap">
                          {row.location}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums text-slate-600">
                          {formatNumber(row.openingStock)}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums font-medium text-emerald-700 bg-emerald-50/30">
                          {row.totalIn > 0 ? `+${formatNumber(row.totalIn)}` : '-'}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums font-medium text-amber-700 bg-amber-50/30">
                          {row.totalOut > 0 ? `-${formatNumber(row.totalOut)}` : '-'}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums font-bold text-slate-900 bg-slate-50/50">
                          {formatNumber(row.closingStock)}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums text-slate-600 whitespace-nowrap">
                          {formatCurrency(row.unitPrice)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                          {formatCurrency(row.closingValue)}
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <button
                            onClick={() => onSelectStockCard(row.itemId)}
                            className="text-indigo-600 hover:text-indigo-800 font-semibold underline underline-offset-2 hover:bg-indigo-50 px-2 py-1 rounded"
                          >
                            Xem thẻ kho
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100/90 border-t-2 border-slate-300 font-bold text-slate-900 text-xs">
                    <td colSpan={6} className="py-3.5 px-4 uppercase tracking-wider">
                      Tổng cộng báo cáo ({formatNumber(nxtReportRows.length)} dòng dữ liệu)
                    </td>
                    <td className="py-3.5 px-3 text-right tabular-nums">
                      {formatNumber(nxtTotals.openingStock)}
                    </td>
                    <td className="py-3.5 px-3 text-right tabular-nums text-emerald-800">
                      +{formatNumber(nxtTotals.totalIn)}
                    </td>
                    <td className="py-3.5 px-3 text-right tabular-nums text-amber-800">
                      -{formatNumber(nxtTotals.totalOut)}
                    </td>
                    <td className="py-3.5 px-3 text-right tabular-nums font-bold">
                      {formatNumber(nxtTotals.closingStock)}
                    </td>
                    <td className="py-3.5 px-3 text-right text-slate-400">-</td>
                    <td className="py-3.5 px-4 text-right tabular-nums font-bold text-indigo-700">
                      {formatCurrency(nxtTotals.closingValue)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <PaginationBar
              currentPage={safeReportPage}
              totalItems={nxtReportRows.length}
              pageSize={reportPageSize}
              onPageChange={setReportPage}
              onPageSizeChange={setReportPageSize}
              itemLabel="dòng báo cáo"
            />
          </>
        )}
      </div>
    </div>
  );
};

