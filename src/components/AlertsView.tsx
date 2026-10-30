import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  PackagePlus,
  CheckCircle2,
} from 'lucide-react';
import { useInventory } from '../context/InventoryContext';
import { InventoryItem, Warehouse } from '../types/inventory';
import {
  formatCurrency,
  formatDate,
  formatNumber,
  getItemTypeLabel,
  getStockStatus,
} from '../utils/formatters';
import { PaginationBar } from './PaginationBar';

interface AlertsViewProps {
  onQuickReorder: (item: InventoryItem, suggestedQty: number) => void;
  onEditItem: (item: InventoryItem) => void;
}

export const AlertsView: React.FC<AlertsViewProps> = ({ onQuickReorder, onEditItem }) => {
  const { items, warehouses } = useInventory();

  const [deficitPage, setDeficitPage] = useState(1);
  const [deficitPageSize, setDeficitPageSize] = useState(50);
  const [inspPage, setInspPage] = useState(1);
  const [inspPageSize, setInspPageSize] = useState(50);
  const [overPage, setOverPage] = useState(1);
  const [overPageSize, setOverPageSize] = useState(50);

  const warehouseById = useMemo(() => {
    const map = new Map<string, Warehouse>();
    for (let i = 0; i < warehouses.length; i++) map.set(warehouses[i].id, warehouses[i]);
    return map;
  }, [warehouses]);

  const { deficitItems, totalReplenishBudget, inspectionAlerts, overstockedItems, nowMs } = useMemo(() => {
    const deficit: InventoryItem[] = [];
    const inspection: InventoryItem[] = [];
    const overstocked: InventoryItem[] = [];
    let replenishBudget = 0;

    const currentMs = Date.now();
    const limitMs = currentMs + 30 * 24 * 60 * 60 * 1000;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const status = getStockStatus(item);
      if (status === 'CANH_BAO_THAP' || status === 'HET_HANG') {
        deficit.push(item);
        const suggestedQty = Math.max(0, item.maxStock - item.currentStock);
        replenishBudget += suggestedQty * item.unitPrice;
      } else if (status === 'VUOT_DINH_MUC') {
        overstocked.push(item);
      }

      if (item.inspectionDueDate) {
        const dueMs = Date.parse(item.inspectionDueDate);
        if (!Number.isNaN(dueMs) && dueMs <= limitMs) {
          inspection.push(item);
        }
      }
    }

    return {
      deficitItems: deficit,
      totalReplenishBudget: replenishBudget,
      inspectionAlerts: inspection,
      overstockedItems: overstocked,
      nowMs: currentMs,
    };
  }, [items]);

  const safeDeficitPage = Math.min(
    Math.max(1, deficitPage),
    Math.max(1, Math.ceil(deficitItems.length / deficitPageSize))
  );
  const paginatedDeficit = useMemo(
    () =>
      deficitItems.slice(
        (safeDeficitPage - 1) * deficitPageSize,
        safeDeficitPage * deficitPageSize
      ),
    [deficitItems, safeDeficitPage, deficitPageSize]
  );

  const safeInspPage = Math.min(
    Math.max(1, inspPage),
    Math.max(1, Math.ceil(inspectionAlerts.length / inspPageSize))
  );
  const paginatedInsp = useMemo(
    () =>
      inspectionAlerts.slice((safeInspPage - 1) * inspPageSize, safeInspPage * inspPageSize),
    [inspectionAlerts, safeInspPage, inspPageSize]
  );

  const safeOverPage = Math.min(
    Math.max(1, overPage),
    Math.max(1, Math.ceil(overstockedItems.length / overPageSize))
  );
  const paginatedOver = useMemo(
    () =>
      overstockedItems.slice((safeOverPage - 1) * overPageSize, safeOverPage * overPageSize),
    [overstockedItems, safeOverPage, overPageSize]
  );

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-500" />
            <span>Trung Tâm Cảnh Báo Định Mức & Đề Xuất Mua Bổ Sung</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Tự động rà soát mức tồn kho an toàn và lịch kiểm định máy móc kỹ thuật
          </p>
        </div>

        <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs flex items-center gap-3">
          <div>
            <span className="text-slate-500 block">Dự toán ngân sách nhập bù kho:</span>
            <span className="text-base font-bold text-rose-700 tabular-nums">
              {formatCurrency(totalReplenishBudget)}
            </span>
          </div>
          <div className="text-right border-l border-rose-200 pl-3">
            <span className="text-slate-500 block">Mặt hàng thiếu hụt:</span>
            <span className="text-base font-bold text-slate-900 tabular-nums">
              {deficitItems.length} danh mục
            </span>
          </div>
        </div>
      </div>

      {/* Section 1: Deficit & Out of Stock */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-rose-50/30">
          <div>
            <h3 className="text-base font-semibold text-rose-950 flex items-center gap-2">
              <span>Mặt hàng dưới định mức tối thiểu & Hết hàng ({deficitItems.length})</span>
            </h3>
            <p className="text-xs text-slate-500">
              Cần ưu tiên lập phiếu nhập kho để đảm bảo tiến độ thi công và sản xuất
            </p>
          </div>
        </div>

        {deficitItems.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            <span className="font-semibold text-slate-700">
              Tuyệt vời! Tất cả vật tư thiết bị đều đang đạt hoặc vượt mức tồn an toàn.
            </span>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px]">
                    <th className="py-3 px-4">Mã SKU</th>
                    <th className="py-3 px-4 min-w-[200px]">Tên vật tư / thiết bị</th>
                    <th className="py-3 px-3">Kho hàng</th>
                    <th className="py-3 px-3 text-right">Tồn hiện tại</th>
                    <th className="py-3 px-3 text-right">Định mức Min</th>
                    <th className="py-3 px-3 text-right">Định mức Max</th>
                    <th className="py-3 px-3 text-right text-rose-700 font-bold">Số lượng đề xuất nhập</th>
                    <th className="py-3 px-4 text-right">Dự toán kinh phí</th>
                    <th className="py-3 px-4 text-center">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedDeficit.map(item => {
                    const wh = item.warehouseId ? warehouseById.get(item.warehouseId) : undefined;
                  const isZero = item.currentStock === 0;
                  const suggestedQty = Math.max(0, item.maxStock - item.currentStock);
                  const estBudget = suggestedQty * item.unitPrice;

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isZero ? 'bg-rose-50/40' : ''
                      }`}
                    >
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                        {item.code}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-900">
                        <div>{item.name}</div>
                        <div className="text-[11px] text-slate-400 font-normal">
                          {getItemTypeLabel(item.type)} &bull; {item.category}
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-slate-700 whitespace-nowrap">
                        {wh?.name}
                      </td>
                      <td className="py-3.5 px-3 text-right whitespace-nowrap">
                        <span
                          className={`font-bold tabular-nums text-sm ${
                            isZero ? 'text-rose-700' : 'text-amber-600'
                          }`}
                        >
                          {formatNumber(item.currentStock)}
                        </span>{' '}
                        <span className="text-slate-500">{item.unit}</span>
                      </td>
                      <td className="py-3.5 px-3 text-right tabular-nums text-slate-600">
                        {formatNumber(item.minStock)} {item.unit}
                      </td>
                      <td className="py-3.5 px-3 text-right tabular-nums text-slate-600">
                        {formatNumber(item.maxStock)} {item.unit}
                      </td>
                      <td className="py-3.5 px-3 text-right tabular-nums font-bold text-rose-700 bg-rose-50/40 whitespace-nowrap">
                        +{formatNumber(suggestedQty)} {item.unit}
                      </td>
                      <td className="py-3.5 px-4 text-right tabular-nums font-bold text-slate-900 whitespace-nowrap">
                        {formatCurrency(estBudget)}
                      </td>
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <button
                          onClick={() => onQuickReorder(item, suggestedQty)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors shadow-xs"
                        >
                          <PackagePlus className="w-3.5 h-3.5" />
                          <span>Lập phiếu nhập</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>
            <PaginationBar
              currentPage={safeDeficitPage}
              totalItems={deficitItems.length}
              pageSize={deficitPageSize}
              onPageChange={setDeficitPage}
              onPageSizeChange={setDeficitPageSize}
              itemLabel="mặt hàng thiếu hụt"
            />
          </>
        )}
      </div>

      {/* Section 2: Equipment Inspection Alerts */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-amber-50/30">
          <div>
            <h3 className="text-base font-semibold text-amber-950 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600" />
              <span>Thiết bị máy móc đến hạn hoặc quá hạn kiểm định ({inspectionAlerts.length})</span>
            </h3>
            <p className="text-xs text-slate-500">
              Kiểm tra định kỳ an toàn kỹ thuật và hiệu chuẩn đo đạc
            </p>
          </div>
        </div>

        {inspectionAlerts.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            Hiện tại không có thiết bị máy móc nào bị quá hạn hoặc sắp đến hạn kiểm định trong 30 ngày.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px]">
                    <th className="py-3 px-4">Mã SKU</th>
                    <th className="py-3 px-4">Tên thiết bị</th>
                    <th className="py-3 px-3">Số Serial / Lô</th>
                    <th className="py-3 px-3">Vị trí lưu kho</th>
                    <th className="py-3 px-3">Hạn kiểm định</th>
                    <th className="py-3 px-3">Tình trạng cảnh báo</th>
                    <th className="py-3 px-4 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedInsp.map(item => {
                    const isExpired = Date.parse(item.inspectionDueDate!) < nowMs;
                    return (
                      <tr key={item.id} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4 font-mono font-bold text-slate-900">
                          {item.code}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          {item.name}
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-700">
                          {item.serialOrLot || '-'}
                        </td>
                        <td className="py-3 px-3 text-slate-600">
                          {item.location || 'Tại kho'}
                        </td>
                        <td className="py-3 px-3 font-bold tabular-nums">
                          <span className={isExpired ? 'text-rose-600' : 'text-amber-700'}>
                            {formatDate(item.inspectionDueDate)}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                              isExpired
                                ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                : 'bg-amber-100 text-amber-800 border border-amber-300'
                            }`}
                          >
                            {isExpired ? 'ĐÃ QUÁ HẠN KIỂM ĐỊNH' : 'SẮP ĐẾN HẠN (< 30 NGÀY)'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => onEditItem(item)}
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold underline underline-offset-2"
                          >
                            Cập nhật gia hạn
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <PaginationBar
              currentPage={safeInspPage}
              totalItems={inspectionAlerts.length}
              pageSize={inspPageSize}
              onPageChange={setInspPage}
              onPageSizeChange={setInspPageSize}
              itemLabel="thiết bị"
            />
          </>
        )}
      </div>

      {/* Section 3: Overstocked Items */}
      {overstockedItems.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-200 bg-purple-50/30">
            <h3 className="text-base font-semibold text-purple-950">
              Vật tư tồn kho vượt mức tối đa ({formatNumber(overstockedItems.length)})
            </h3>
            <p className="text-xs text-slate-500">
              Các mặt hàng có lượng tồn vượt định mức max, cần xem xét điều chuyển hoặc ngưng mua mới
            </p>
          </div>

          <div className="p-4 space-y-2">
            {paginatedOver.map(item => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 bg-slate-50 rounded-lg text-xs"
              >
                <div>
                  <span className="font-mono font-bold text-slate-900 mr-2">[{item.code}]</span>
                  <span className="font-semibold text-slate-800">{item.name}</span>
                </div>
                <div className="flex items-center gap-4 tabular-nums">
                  <span className="text-slate-500">
                    Tồn hiện tại: <strong className="text-purple-700">{formatNumber(item.currentStock)} {item.unit}</strong>
                  </span>
                  <span className="text-slate-500">
                    Định mức Max: <strong>{formatNumber(item.maxStock)} {item.unit}</strong>
                  </span>
                </div>
              </div>
            ))}
          </div>
          <PaginationBar
            currentPage={safeOverPage}
            totalItems={overstockedItems.length}
            pageSize={overPageSize}
            onPageChange={setOverPage}
            onPageSizeChange={setOverPageSize}
            itemLabel="vật tư vượt định mức"
          />
        </div>
      )}
    </div>
  );
};
