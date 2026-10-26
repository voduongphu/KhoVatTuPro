import React, { useState } from 'react';
import { X, Plus, Edit2, AlertCircle } from 'lucide-react';
import { useInventory } from '../context/InventoryContext';
import {
  EquipmentCondition,
  InventoryItem,
  ItemType,
} from '../types/inventory';
import { getItemTypeLabel } from '../utils/formatters';

interface CreateItemModalProps {
  itemToEdit?: InventoryItem | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const CreateItemModal: React.FC<CreateItemModalProps> = ({
  itemToEdit,
  onClose,
  onSuccess,
}) => {
  const { warehouses, materialCategories, addMaterialCategory, addItem, updateItem } = useInventory();

  const isEdit = Boolean(itemToEdit);

  // Resolve initial categoryId from itemToEdit or first available MaterialCategory
  const initialMatchedCategory = (() => {
    if (itemToEdit) {
      if (itemToEdit.categoryId) {
        const byId = materialCategories.find(c => c.id === itemToEdit.categoryId);
        if (byId) return byId.id;
      }
      if (itemToEdit.categoryCode) {
        const byCode = materialCategories.find(
          c => c.code.trim().toUpperCase() === itemToEdit.categoryCode!.trim().toUpperCase()
        );
        if (byCode) return byCode.id;
      }
      if (itemToEdit.category && itemToEdit.category !== 'Chưa phân loại') {
        const byName = materialCategories.find(
          c => c.name.trim().toLowerCase() === itemToEdit.category.trim().toLowerCase()
        );
        if (byName) return byName.id;
      }
      if (itemToEdit.category === 'Chưa phân loại') {
        return '__UNCATEGORIZED__';
      }
    }
    return materialCategories[0]?.id || '__UNCATEGORIZED__';
  })();

  const [code, setCode] = useState(itemToEdit?.code || '');
  const [name, setName] = useState(itemToEdit?.name || '');
  const [type, setType] = useState<ItemType>(itemToEdit?.type || 'VAT_TU');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(initialMatchedCategory);
  const [isCreatingNewCat, setIsCreatingNewCat] = useState(false);
  const [newCatCode, setNewCatCode] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [unit, setUnit] = useState(itemToEdit?.unit || 'Cái');
  const [warehouseId, setWarehouseId] = useState(
    itemToEdit?.warehouseId || warehouses[0]?.id || ''
  );
  const [location, setLocation] = useState(itemToEdit?.location || '');
  const [currentStock, setCurrentStock] = useState(itemToEdit?.currentStock ?? 0);
  const [minStock, setMinStock] = useState(itemToEdit?.minStock ?? 10);
  const [maxStock, setMaxStock] = useState(itemToEdit?.maxStock ?? 100);
  const [unitPrice, setUnitPrice] = useState(itemToEdit?.unitPrice ?? 0);
  const [serialOrLot, setSerialOrLot] = useState(itemToEdit?.serialOrLot || '');
  const [condition, setCondition] = useState<EquipmentCondition>(
    itemToEdit?.condition || 'SAN_SANG'
  );
  const [inspectionDueDate, setInspectionDueDate] = useState(
    itemToEdit?.inspectionDueDate || ''
  );
  const [supplierDefault, setSupplierDefault] = useState(
    itemToEdit?.supplierDefault || ''
  );
  const [spec, setSpec] = useState(itemToEdit?.spec || '');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!code.trim()) {
      setError('Vui lòng nhập mã SKU vật tư / thiết bị.');
      return;
    }
    if (!name.trim()) {
      setError('Vui lòng nhập tên vật tư / thiết bị.');
      return;
    }
    if (!unit.trim()) {
      setError('Vui lòng nhập đơn vị tính (ĐVT).');
      return;
    }

    let resolvedCategoryId: string | undefined;
    let resolvedCategoryCode: string | undefined;
    let resolvedCategoryName = 'Chưa phân loại';

    if (isCreatingNewCat) {
      if (!newCatCode.trim() || !newCatName.trim()) {
        setError('Vui lòng nhập đầy đủ Mã danh mục và Tên danh mục mới (hoặc hủy tạo nhanh).');
        return;
      }
      const catRes = addMaterialCategory({
        code: newCatCode.trim().toUpperCase(),
        name: newCatName.trim(),
      });
      if (!catRes.success || !catRes.category) {
        setError(catRes.error || 'Không thể tạo danh mục mới.');
        return;
      }
      resolvedCategoryId = catRes.category.id;
      resolvedCategoryCode = catRes.category.code;
      resolvedCategoryName = catRes.category.name;
    } else if (selectedCategoryId && selectedCategoryId !== '__UNCATEGORIZED__') {
      const foundCat = materialCategories.find(c => c.id === selectedCategoryId);
      if (foundCat) {
        resolvedCategoryId = foundCat.id;
        resolvedCategoryCode = foundCat.code;
        resolvedCategoryName = foundCat.name;
      }
    } else {
      resolvedCategoryId = '__UNCATEGORIZED__';
      resolvedCategoryCode = undefined;
      resolvedCategoryName = 'Chưa phân loại';
    }

    if (isEdit && itemToEdit) {
      updateItem(itemToEdit.id, {
        code: code.trim(),
        name: name.trim(),
        type,
        categoryId: resolvedCategoryId,
        categoryCode: resolvedCategoryCode,
        category: resolvedCategoryName,
        unit: unit.trim(),
        warehouseId,
        location: location.trim(),
        currentStock,
        minStock,
        maxStock,
        unitPrice,
        serialOrLot: serialOrLot.trim() || undefined,
        condition: type === 'THIET_BI' || type === 'CONG_CU' ? condition : undefined,
        inspectionDueDate: inspectionDueDate || undefined,
        supplierDefault: supplierDefault.trim() || undefined,
        spec: spec.trim() || undefined,
      });
    } else {
      addItem({
        code: code.trim(),
        name: name.trim(),
        type,
        categoryId: resolvedCategoryId === '__UNCATEGORIZED__' ? undefined : resolvedCategoryId,
        categoryCode: resolvedCategoryCode,
        category: resolvedCategoryName,
        unit: unit.trim(),
        warehouseId,
        location: location.trim(),
        currentStock,
        minStock,
        maxStock,
        unitPrice,
        serialOrLot: serialOrLot.trim() || undefined,
        condition: type === 'THIET_BI' || type === 'CONG_CU' ? condition : undefined,
        inspectionDueDate: inspectionDueDate || undefined,
        supplierDefault: supplierDefault.trim() || undefined,
        spec: spec.trim() || undefined,
      });
    }

    onSuccess();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-3xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
              {isEdit ? <Edit2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {isEdit ? 'Chỉnh Sửa Thông Tin Vật Tư / Thiết Bị' : 'Khai Báo Vật Tư / Thiết Bị Mới'}
              </h2>
              <p className="text-xs text-slate-500">
                Quản lý thuộc tính định mức tồn, danh mục vật tư và thông số thiết bị
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Row 1: Code, Type, Name */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Mã SKU / Mã quản lý *
              </label>
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="VD: VT-CD-105..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono font-semibold focus:border-indigo-500 outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Phân loại mặt hàng *
              </label>
              <select
                value={type}
                onChange={e => setType(e.target.value as ItemType)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none font-medium"
              >
                <option value="VAT_TU">Vật tư tiêu hao</option>
                <option value="THIET_BI">Thiết bị máy móc</option>
                <option value="CONG_CU">Công cụ dụng cụ</option>
                <option value="PHU_TUNG">Phụ tùng thay thế</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Đơn vị tính (ĐVT) *
              </label>
              <input
                type="text"
                value={unit}
                onChange={e => setUnit(e.target.value)}
                placeholder="VD: Cái, Mét, Kg, Bộ, Cuộn..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:border-indigo-500 outline-none"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Tên vật tư / thiết bị *
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="VD: Máy toàn đạc điện tử, Dây cáp điện Cadivi 3x25..."
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:border-indigo-500 outline-none font-medium"
              required
            />
          </div>

          {/* Row 2: Category & Warehouse Shelf */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Danh mục vật tư liên kết *
                </label>
                <button
                  type="button"
                  onClick={() => setIsCreatingNewCat(prev => !prev)}
                  className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  {isCreatingNewCat ? 'Chọn danh mục có sẵn' : '+ Tạo nhanh danh mục mới'}
                </button>
              </div>

              {!isCreatingNewCat ? (
                <>
                  <select
                    value={selectedCategoryId}
                    onChange={e => setSelectedCategoryId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none font-medium"
                  >
                    {materialCategories.map(c => (
                      <option key={c.id} value={c.id}>
                        [{c.code}] {c.name}
                      </option>
                    ))}
                    <option value="__UNCATEGORIZED__">-- Chưa phân loại --</option>
                  </select>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Liên kết vật tư với mã danh mục và tên danh mục tương ứng
                  </p>
                </>
              ) : (
                <div className="p-2.5 bg-indigo-50/50 border border-indigo-200 rounded-lg space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={newCatCode}
                      onChange={e => setNewCatCode(e.target.value.toUpperCase())}
                      placeholder="Mã DM (VD: DM-dien)"
                      className="col-span-1 px-2.5 py-1.5 text-xs font-mono font-bold border border-slate-300 rounded bg-white outline-none focus:border-indigo-500 uppercase"
                    />
                    <input
                      type="text"
                      value={newCatName}
                      onChange={e => setNewCatName(e.target.value)}
                      placeholder="Tên danh mục mới..."
                      className="col-span-2 px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white outline-none focus:border-indigo-500 font-medium"
                    />
                  </div>
                  <p className="text-[10px] text-indigo-700">
                    Danh mục mới sẽ được lưu vào hệ thống và liên kết ngay với vật tư này.
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Vị trí kệ / ngăn lưu trữ
              </label>
              <input
                type="text"
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="VD: Kệ A1-02, Ngăn 3, Tầng 2, Khu B..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:border-indigo-500 outline-none font-medium"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Vị trí sắp đặt kệ/ngăn (Kho thực tế được phân bổ linh hoạt theo phiếu nhập/xuất)
              </p>
            </div>
          </div>

          {/* Row 3: Stock quantities & pricing */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Số lượng tồn {isEdit ? 'hiện tại' : 'ban đầu'}
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={currentStock}
                onChange={e => setCurrentStock(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white tabular-nums font-bold"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Định mức tối thiểu (Min)
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={minStock}
                onChange={e => setMinStock(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white tabular-nums"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Định mức tối đa (Max)
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={maxStock}
                onChange={e => setMaxStock(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white tabular-nums"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Đơn giá vốn (VNĐ)
              </label>
              <input
                type="number"
                min="0"
                step="1000"
                value={unitPrice}
                onChange={e => setUnitPrice(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white tabular-nums font-semibold"
                required
              />
            </div>
          </div>

          {/* Equipment specifics (if applicable) */}
          {(type === 'THIET_BI' || type === 'CONG_CU') && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-3.5 bg-blue-50/50 rounded-xl border border-blue-200">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tình trạng thiết bị
                </label>
                <select
                  value={condition}
                  onChange={e => setCondition(e.target.value as EquipmentCondition)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white outline-none"
                >
                  <option value="SAN_SANG">Sẵn sàng sử dụng</option>
                  <option value="DANG_MUON">Đang cấp mượn / thi công</option>
                  <option value="BAO_DUONG">Đang bảo dưỡng / kiểm định</option>
                  <option value="HONG_CHO_SUA">Hỏng hóc / Chờ sửa</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Số Serial máy / Số Lô
                </label>
                <input
                  type="text"
                  value={serialOrLot}
                  onChange={e => setSerialOrLot(e.target.value)}
                  placeholder="VD: SN-BOSCH-2026..."
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white font-mono outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Hạn kiểm định / Bảo dưỡng kế tiếp
                </label>
                <input
                  type="date"
                  value={inspectionDueDate}
                  onChange={e => setInspectionDueDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white outline-none"
                />
              </div>
            </div>
          )}

          {/* Row 4: Supplier & Specs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Nhà cung cấp / Nhà phân phối chính
              </label>
              <input
                type="text"
                value={supplierDefault}
                onChange={e => setSupplierDefault(e.target.value)}
                placeholder="VD: Schneider Electric, Cadivi, Hòa Phát..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Thông số kỹ thuật / Quy cách
              </label>
              <input
                type="text"
                value={spec}
                onChange={e => setSpec(e.target.value)}
                placeholder="VD: Điện áp 380V, 415VAC, ruột đồng ép tròn..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg outline-none"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-xs"
            >
              {isEdit ? 'Lưu Thay Đổi' : 'Thêm Vào Danh Mục Kho'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
