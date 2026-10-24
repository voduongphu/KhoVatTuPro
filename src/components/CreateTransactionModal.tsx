import React, { useState } from 'react';
import {
  X,
  Plus,
  Trash2,
  AlertTriangle,
  PackagePlus,
  PackageMinus,
  CheckCircle2,
} from 'lucide-react';
import { useInventory } from '../context/InventoryContext';
import {
  InventoryItem,
  IssueSubtype,
  ReceiptSubtype,
  TransactionLineItem,
  TransactionType,
} from '../types/inventory';
import {
  formatCurrency,
  formatNumber,
  getItemTypeLabel,
  getSubtypeLabel,
} from '../utils/formatters';

interface CreateTransactionModalProps {
  initialType: TransactionType;
  initialItem?: InventoryItem;
  onClose: () => void;
  onSuccess: () => void;
}

export const CreateTransactionModal: React.FC<CreateTransactionModalProps> = ({
  initialType,
  initialItem,
  onClose,
  onSuccess,
}) => {
  const { warehouses, items, createTransaction, currentUser } = useInventory();

  const [type, setType] = useState<TransactionType>(initialType);
  const [subtype, setSubtype] = useState<string>(
    initialType === 'NHAP_KHO' ? 'NHAP_MUA_MOI' : 'XUAT_THI_CONG'
  );
  const [warehouseId, setWarehouseId] = useState<string>(
    initialItem?.warehouseId || warehouses[0]?.id || ''
  );
  const [date, setDate] = useState<string>(
    new Date().toISOString().substring(0, 16)
  );
  const [partnerName, setPartnerName] = useState<string>(
    initialItem?.supplierDefault || ''
  );
  const [departmentOrProject, setDepartmentOrProject] = useState<string>('');
  const [creatorName, setCreatorName] = useState<string>(
    () => currentUser?.fullName || currentUser?.username || 'Thủ kho'
  );
  const [approverName, setApproverName] = useState<string>('Chỉ huy trưởng / GĐ');
  const [notes, setNotes] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [rawInputs, setRawInputs] = useState<Record<string, string>>({});

  // Initial line item
  const [lineItems, setLineItems] = useState<TransactionLineItem[]>(() => {
    if (initialItem) {
      return [
        {
          itemId: initialItem.id,
          itemCode: initialItem.code,
          itemName: initialItem.name,
          unit: initialItem.unit,
          quantity: 1,
          unitPrice: initialItem.unitPrice,
          amount: initialItem.unitPrice,
          serialNumber: initialItem.serialOrLot || '',
          note: '',
          isNewItem: false,
        },
      ];
    }
    const shouldStartNew = initialType === 'NHAP_KHO' && items.length === 0;
    return [
      {
        itemId: shouldStartNew ? `TEMP-NEW-${Date.now()}-0` : '',
        itemCode: '',
        itemName: '',
        unit: 'Cái',
        quantity: 1,
        unitPrice: 0,
        amount: 0,
        serialNumber: '',
        note: '',
        isNewItem: shouldStartNew,
        type: 'VAT_TU',
        category: 'Cơ điện & Vật tư công trình',
        location: 'Khu vực tiếp nhận',
        minStock: 5,
        maxStock: 200,
      },
    ];
  });

  const handleTypeChange = (newType: TransactionType) => {
    setType(newType);
    if (newType === 'NHAP_KHO') {
      setSubtype('NHAP_MUA_MOI');
      if (items.length === 0) {
        setLineItems(prev =>
          prev.map((l, i) => ({
            ...l,
            isNewItem: true,
            itemId: l.itemId || `TEMP-NEW-${Date.now()}-${i}`,
            unit: l.unit || 'Cái',
          }))
        );
      }
    } else {
      setSubtype('XUAT_THI_CONG');
      setLineItems(prev =>
        prev.map(l => (l.isNewItem ? { ...l, isNewItem: false, itemId: '', itemCode: '', itemName: '' } : l))
      );
    }
    setErrorMessage('');
  };

  const handleSelectItem = (index: number, selectedItemId: string) => {
    setRawInputs(prev => {
      const next = { ...prev };
      delete next[`${index}-quantity`];
      delete next[`${index}-unitPrice`];
      return next;
    });

    if (selectedItemId === '__NEW_ITEM__') {
      setLineItems(prev => {
        const updated = [...prev];
        const qty = updated[index].quantity > 0 ? updated[index].quantity : 1;
        updated[index] = {
          ...updated[index],
          itemId: `TEMP-NEW-${Date.now()}-${index}`,
          itemCode: '',
          itemName: '',
          unit: 'Cái',
          quantity: qty,
          unitPrice: updated[index].unitPrice || 0,
          amount: qty * (updated[index].unitPrice || 0),
          serialNumber: '',
          isNewItem: true,
          type: 'VAT_TU',
          category: 'Cơ điện & Vật tư công trình',
          location: 'Kệ A1-01',
          minStock: 5,
          maxStock: 200,
        };
        return updated;
      });
      setErrorMessage('');
      return;
    }

    const item = items.find(i => i.id === selectedItemId);
    if (!item) return;

    setLineItems(prev => {
      const updated = [...prev];
      const qty = updated[index].quantity > 0 ? updated[index].quantity : 1;
      updated[index] = {
        ...updated[index],
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        unit: item.unit,
        quantity: qty,
        unitPrice: item.unitPrice,
        amount: qty * item.unitPrice,
        serialNumber: item.serialOrLot || '',
        isNewItem: false,
      };
      return updated;
    });
    setErrorMessage('');
  };

  const handleQuantityChange = (index: number, qty: number) => {
    const validQty = Math.max(0, qty);
    setLineItems(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        quantity: validQty,
        amount: validQty * updated[index].unitPrice,
      };
      return updated;
    });
  };

  const handlePriceChange = (index: number, price: number) => {
    const validPrice = Math.max(0, price);
    setLineItems(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        unitPrice: validPrice,
        amount: updated[index].quantity * validPrice,
      };
      return updated;
    });
  };

  const handleNumericInputChange = (
    index: number,
    field: 'quantity' | 'unitPrice',
    rawValue: string
  ) => {
    const key = `${index}-${field}`;
    setRawInputs(prev => ({ ...prev, [key]: rawValue }));
    const parsed = rawValue.trim() === '' ? 0 : Number(rawValue);
    if (!Number.isNaN(parsed)) {
      if (field === 'quantity') {
        handleQuantityChange(index, parsed);
      } else {
        handlePriceChange(index, parsed);
      }
    }
  };

  const handleNumericInputBlur = (index: number, field: 'quantity' | 'unitPrice') => {
    const key = `${index}-${field}`;
    setRawInputs(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleFieldChange = (index: number, field: keyof TransactionLineItem, value: string) => {
    setLineItems(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        [field]: value,
      };
      return updated;
    });
  };

  const addLine = (isNew: boolean = false) => {
    setLineItems(prev => [
      ...prev,
      {
        itemId: isNew ? `TEMP-NEW-${Date.now()}` : '',
        itemCode: '',
        itemName: '',
        unit: 'Cái',
        quantity: 1,
        unitPrice: 0,
        amount: 0,
        serialNumber: '',
        note: '',
        isNewItem: isNew,
        type: 'VAT_TU',
        category: 'Cơ điện & Vật tư công trình',
        location: 'Khu vực tiếp nhận',
        minStock: 5,
        maxStock: 200,
      },
    ]);
  };

  const removeLine = (index: number) => {
    if (lineItems.length <= 1) return;
    setLineItems(prev => prev.filter((_, i) => i !== index));
    setRawInputs({});
  };

  const totalQuantity = lineItems.reduce((acc, l) => acc + (Number(l.quantity) || 0), 0);
  const totalAmount = lineItems.reduce((acc, l) => acc + (l.amount || 0), 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!partnerName.trim()) {
      setErrorMessage(
        type === 'NHAP_KHO'
          ? 'Vui lòng nhập tên Nhà cung cấp / Đơn vị giao hàng.'
          : 'Vui lòng nhập tên Người nhận / Đơn vị / Dự án nhận hàng.'
      );
      return;
    }

    if (!departmentOrProject.trim()) {
      setErrorMessage('Vui lòng nhập mục đích hoặc Dự án / Phòng ban sử dụng.');
      return;
    }

    // Validate line items
    for (let i = 0; i < lineItems.length; i++) {
      const line = lineItems[i];
      if (type === 'NHAP_KHO' && !line.itemId && (line.itemCode?.trim() || line.itemName?.trim())) {
        line.isNewItem = true;
        if (!line.itemCode?.trim()) {
          line.itemCode = `VT-${Date.now().toString().slice(-4)}`;
        }
        if (!line.unit?.trim()) {
          line.unit = 'Cái';
        }
      }

      if (line.isNewItem) {
        if (!line.itemCode?.trim()) {
          setErrorMessage(`Dòng ${i + 1}: Vui lòng nhập Mã SKU cho vật tư mới.`);
          return;
        }
        if (!line.itemName?.trim()) {
          setErrorMessage(`Dòng ${i + 1}: Vui lòng nhập Tên vật tư mới.`);
          return;
        }
        if (!line.unit?.trim()) {
          line.unit = 'Cái';
        }
      } else if (!line.itemId && line.quantity > 0) {
        setErrorMessage(`Dòng ${i + 1}: Vui lòng chọn mặt hàng hoặc bấm nhập vật tư mới.`);
        return;
      }

      if (line.quantity <= 0) {
        setErrorMessage(`Dòng ${i + 1}: Số lượng phải lớn hơn 0.`);
        return;
      }
    }

    // Filter valid lines
    const validLines = lineItems.filter(l => (l.itemId || l.isNewItem) && l.quantity > 0);
    if (validLines.length === 0) {
      setErrorMessage('Vui lòng chọn hoặc nhập ít nhất 1 mặt hàng với số lượng lớn hơn 0.');
      return;
    }

    const result = createTransaction({
      type,
      subtype: subtype as any,
      date: date.replace('T', ' '),
      warehouseId,
      partnerName: partnerName.trim(),
      departmentOrProject: departmentOrProject.trim(),
      creatorName: creatorName.trim(),
      approverName: approverName.trim(),
      notes: notes.trim(),
      items: validLines,
      totalAmount,
      status: 'HOAN_THANH',
    });

    if (!result.success) {
      setErrorMessage(result.error || 'Có lỗi xảy ra khi tạo phiếu.');
      return;
    }

    onSuccess();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl max-w-[96vw] 2xl:max-w-[1480px] w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[94vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center text-white ${
                type === 'NHAP_KHO' ? 'bg-emerald-600' : 'bg-amber-600'
              }`}
            >
              {type === 'NHAP_KHO' ? (
                <PackagePlus className="w-5 h-5" />
              ) : (
                <PackageMinus className="w-5 h-5" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {type === 'NHAP_KHO' ? 'Lập Phiếu Nhập Kho Mới' : 'Lập Phiếu Xuất Kho Mới'}
              </h2>
              <p className="text-xs text-slate-500">
                Cập nhật số dư tồn kho và theo dõi chứng từ kế toán
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
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Type Toggle & Subtype */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Loại giao dịch
              </label>
              <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => handleTypeChange('NHAP_KHO')}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded transition-colors ${
                    type === 'NHAP_KHO'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Nhập kho
                </button>
                <button
                  type="button"
                  onClick={() => handleTypeChange('XUAT_KHO')}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded transition-colors ${
                    type === 'XUAT_KHO'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Xuất kho
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Nghiệp vụ chi tiết
              </label>
              <select
                value={subtype}
                onChange={e => setSubtype(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
              >
                {type === 'NHAP_KHO' ? (
                  <>
                    <option value="NHAP_MUA_MOI">Nhập mua mới từ nhà cung cấp</option>
                    <option value="NHAP_THU_HOI_DU_AN">Thu hồi hoàn nhập từ công trình/dự án</option>
                    <option value="NHAP_TRA_SAU_MUON">Hoàn trả thiết bị sau khi mượn</option>
                    <option value="NHAP_CHUYEN_KHO">Nhập điều chuyển từ kho khác</option>
                    <option value="NHAP_DIEU_CHINH">Nhập điều chỉnh tăng kiểm kê</option>
                  </>
                ) : (
                  <>
                    <option value="XUAT_THI_CONG">Xuất phục vụ thi công công trình</option>
                    <option value="XUAT_PHONG_BAN">Cấp phát phòng ban / nội bộ</option>
                    <option value="XUAT_CHO_MUON">Xuất cho mượn máy móc thi công</option>
                    <option value="XUAT_BAO_DUONG">Xuất chuyển gửi sửa chữa / bảo dưỡng</option>
                    <option value="XUAT_CHUYEN_KHO">Xuất điều chuyển sang kho khác</option>
                    <option value="XUAT_THANH_LY">Xuất thanh lý / hủy vật tư hỏng</option>
                  </>
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Kho hàng thực hiện
              </label>
              <select
                value={warehouseId}
                onChange={e => setWarehouseId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none font-medium"
              >
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Header Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Ngày giờ lập phiếu
              </label>
              <input
                type="datetime-local"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:border-indigo-500 outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {type === 'NHAP_KHO' ? 'Nhà cung cấp / Đơn vị giao *' : 'Người nhận / Đơn vị nhận *'}
              </label>
              <input
                type="text"
                value={partnerName}
                onChange={e => setPartnerName(e.target.value)}
                placeholder={type === 'NHAP_KHO' ? 'Tên nhà cung cấp...' : 'Tên người/đơn vị nhận...'}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:border-indigo-500 outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Dự án / Phòng ban *
              </label>
              <input
                type="text"
                value={departmentOrProject}
                onChange={e => setDepartmentOrProject(e.target.value)}
                placeholder="Dự án hoặc bộ phận liên quan..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:border-indigo-500 outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Người lập chứng từ
              </label>
              <input
                type="text"
                value={creatorName}
                onChange={e => setCreatorName(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:border-indigo-500 outline-none"
              />
            </div>
          </div>

          {/* Line Items Table */}
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Danh sách vật tư & thiết bị giao dịch ({lineItems.length} dòng)
              </h3>
              <div className="flex items-center gap-2">
                {type === 'NHAP_KHO' && (
                  <button
                    type="button"
                    onClick={() => addLine(true)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg border border-emerald-200 transition-colors"
                    title="Nhập vật tư mới chưa có trong hệ thống và tự động lưu vào danh mục"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Nhập vật tư mới (Lưu danh mục)</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => addLine(false)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg border border-indigo-200 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Thêm dòng</span>
                </button>
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-x-auto shadow-2xs bg-white">
              <table className="w-full min-w-[1180px] text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/90 border-b border-slate-200 text-slate-700 font-bold text-xs">
                    <th className="py-3 px-3 min-w-[280px]">Chọn hoặc Nhập Vật tư / Thiết bị</th>
                    <th className="py-3 px-2.5 min-w-[84px] w-22 text-center">ĐVT</th>
                    <th className="py-3 px-3 min-w-[120px] w-32 text-right">
                      {type === 'XUAT_KHO' ? 'Tồn khả dụng' : 'Tồn hiện tại'}
                    </th>
                    <th className="py-3 px-3.5 min-w-[175px] w-44 text-right bg-indigo-50/80 text-indigo-950 border-x border-indigo-100">
                      Số lượng *
                    </th>
                    <th className="py-3 px-3.5 min-w-[215px] w-56 text-right bg-amber-50/70 text-amber-950 border-r border-amber-100">
                      Đơn giá (VNĐ)
                    </th>
                    <th className="py-3 px-3.5 min-w-[165px] w-44 text-right">Thành tiền (VNĐ)</th>
                    <th className="py-3 px-3 min-w-[160px] w-44">Serial / Lô / Ghi chú</th>
                    <th className="py-3 px-2 w-12 text-center">Xóa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lineItems.map((line, idx) => {
                    const currentItem = items.find(i => i.id === line.itemId);
                    const isExceedingStock =
                      type === 'XUAT_KHO' && currentItem && line.quantity > currentItem.currentStock;

                    return (
                      <tr
                        key={idx}
                        className={`align-top ${
                          line.isNewItem
                            ? 'bg-emerald-50/40 hover:bg-emerald-50/60'
                            : isExceedingStock
                            ? 'bg-rose-50/50'
                            : 'hover:bg-slate-50/50'
                        }`}
                      >
                        {/* Item selection or New item inputs */}
                        <td className="py-2.5 px-3">
                          {line.isNewItem ? (
                            <div className="space-y-1.5 py-0.5">
                              <div className="flex items-center justify-between">
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md">
                                  Vật tư mới - Tự động cập nhật danh mục
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setLineItems(prev => {
                                      const updated = [...prev];
                                      updated[idx] = {
                                        ...updated[idx],
                                        isNewItem: false,
                                        itemId: '',
                                        itemCode: '',
                                        itemName: '',
                                      };
                                      return updated;
                                    });
                                  }}
                                  className="text-[10px] text-slate-500 hover:text-indigo-600 underline"
                                >
                                  Chọn hàng có sẵn
                                </button>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                <input
                                  type="text"
                                  placeholder="Mã SKU (*) VD: VT-CD-901"
                                  value={line.itemCode}
                                  onChange={e =>
                                    handleFieldChange(idx, 'itemCode', e.target.value.toUpperCase())
                                  }
                                  className="w-full px-2.5 py-1.5 text-xs font-mono font-bold border border-emerald-300 rounded-lg focus:border-emerald-600 outline-none bg-white"
                                  required
                                />
                                <input
                                  type="text"
                                  placeholder="Tên vật tư / thiết bị (*)"
                                  value={line.itemName}
                                  onChange={e =>
                                    handleFieldChange(idx, 'itemName', e.target.value)
                                  }
                                  className="w-full px-2.5 py-1.5 text-xs border border-emerald-300 rounded-lg focus:border-emerald-600 outline-none bg-white"
                                  required
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-1.5">
                                <input
                                  type="text"
                                  placeholder="Nhóm ngành (Cáp điện, Cơ khí...)"
                                  value={line.category || ''}
                                  onChange={e =>
                                    handleFieldChange(idx, 'category', e.target.value)
                                  }
                                  className="w-full px-2.5 py-1.5 text-[11px] border border-slate-200 rounded-lg outline-none bg-white"
                                />
                                <input
                                  type="text"
                                  placeholder="Vị trí kệ (Kệ A1-02)"
                                  value={line.location || ''}
                                  onChange={e =>
                                    handleFieldChange(idx, 'location', e.target.value)
                                  }
                                  className="w-full px-2.5 py-1.5 text-[11px] border border-slate-200 rounded-lg outline-none bg-white"
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <select
                                value={line.itemId}
                                onChange={e => handleSelectItem(idx, e.target.value)}
                                className="w-full px-2.5 py-2 text-xs border border-slate-200 rounded-lg focus:border-indigo-500 outline-none bg-white font-medium"
                                required
                              >
                                <option value="">-- Chọn mặt hàng có sẵn --</option>
                                {type === 'NHAP_KHO' && (
                                  <option value="__NEW_ITEM__">
                                    + Nhập vật tư mới (Tự động cập nhật danh mục)
                                  </option>
                                )}
                                {items.map(it => (
                                  <option key={it.id} value={it.id}>
                                    [{it.code}] {it.name} (Tồn: {it.currentStock} {it.unit})
                                  </option>
                                ))}
                              </select>
                              {type === 'NHAP_KHO' && (
                                <button
                                  type="button"
                                  onClick={() => handleSelectItem(idx, '__NEW_ITEM__')}
                                  className="text-[10px] text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1 font-medium"
                                >
                                  <span>+ Không có trong kho? Nhập vật tư mới tại đây</span>
                                </button>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Unit */}
                        <td className="py-2.5 px-2.5 text-center text-slate-600">
                          {line.isNewItem ? (
                            <input
                              type="text"
                              value={line.unit}
                              onChange={e => handleFieldChange(idx, 'unit', e.target.value)}
                              placeholder="ĐVT"
                              className="w-full px-2 py-2 text-xs border border-emerald-300 rounded-lg text-center outline-none bg-white font-medium"
                              required
                            />
                          ) : (
                            <span className="inline-block py-1.5 font-medium">{line.unit || '-'}</span>
                          )}
                        </td>

                        {/* Available Stock */}
                        <td className="py-3.5 px-3 text-right tabular-nums text-slate-600 whitespace-nowrap">
                          {line.isNewItem ? (
                            <span className="text-[11px] text-emerald-600 font-semibold">Mới (0)</span>
                          ) : currentItem ? (
                            `${formatNumber(currentItem.currentStock)} ${currentItem.unit}`
                          ) : (
                            '-'
                          )}
                        </td>

                        {/* Quantity */}
                        <td className="py-2.5 px-3.5 text-right bg-indigo-50/35 border-x border-indigo-100/70 min-w-[175px] w-44">
                          <input
                            type="number"
                            min="0.001"
                            step="any"
                            value={rawInputs[`${idx}-quantity`] ?? line.quantity}
                            onChange={e => handleNumericInputChange(idx, 'quantity', e.target.value)}
                            onBlur={() => handleNumericInputBlur(idx, 'quantity')}
                            placeholder="0"
                            className={`w-full min-w-[145px] px-3 py-2 text-sm border-2 rounded-lg text-right tabular-nums outline-none font-bold bg-white ${
                              isExceedingStock
                                ? 'border-rose-400 bg-rose-50 text-rose-700'
                                : 'border-indigo-300 text-indigo-950 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/15'
                            }`}
                            required
                          />
                          {isExceedingStock && (
                            <span className="mt-1 text-[10px] text-rose-600 font-bold block">
                              Vượt tồn khả dụng!
                            </span>
                          )}
                        </td>

                        {/* Unit Price */}
                        <td className="py-2.5 px-3.5 text-right bg-amber-50/25 border-r border-amber-100/70 min-w-[215px] w-56">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={rawInputs[`${idx}-unitPrice`] ?? line.unitPrice}
                            onChange={e => handleNumericInputChange(idx, 'unitPrice', e.target.value)}
                            onBlur={() => handleNumericInputBlur(idx, 'unitPrice')}
                            placeholder="0"
                            className="w-full min-w-[185px] px-3 py-2 text-sm font-bold text-slate-900 bg-white border-2 border-amber-300/90 rounded-lg text-right tabular-nums outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                          />
                          {line.unitPrice > 0 && (
                            <div className="mt-1 text-[10px] font-medium text-slate-500 text-right tabular-nums">
                              {formatCurrency(line.unitPrice)}
                            </div>
                          )}
                        </td>

                        {/* Amount */}
                        <td className="py-3.5 px-3.5 text-right tabular-nums text-sm font-bold text-slate-900 whitespace-nowrap">
                          {formatCurrency(line.amount)}
                        </td>

                        {/* Serial & Note */}
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            value={line.note || line.serialNumber || ''}
                            onChange={e => handleFieldChange(idx, 'note', e.target.value)}
                            placeholder="Số serial, lô hoặc ghi chú..."
                            className="w-full px-2.5 py-2 text-xs border border-slate-200 rounded-lg outline-none focus:border-indigo-500 bg-white"
                          />
                        </td>

                        {/* Delete line */}
                        <td className="py-3 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeLine(idx)}
                            disabled={lineItems.length <= 1}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t border-slate-200 font-bold text-xs text-slate-900">
                    <td colSpan={3} className="py-3.5 px-3 text-right uppercase">
                      Tổng cộng phiếu:
                    </td>
                    <td className="py-3.5 px-3.5 text-right tabular-nums text-indigo-700 text-sm bg-indigo-50/60 border-x border-indigo-100">
                      {formatNumber(totalQuantity)}
                    </td>
                    <td className="py-3.5 px-3.5 text-right text-slate-400 border-r border-amber-100/60">-</td>
                    <td className="py-3.5 px-3.5 text-right tabular-nums text-indigo-900 text-sm whitespace-nowrap">
                      {formatCurrency(totalAmount)}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Ghi chú thêm về phiếu giao dịch
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Căn cứ hợp đồng, biên bản giao nhận, điều kiện vận chuyển, v.v."
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:border-indigo-500 outline-none"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              * Tồn kho của các mặt hàng sẽ tự động cập nhật ngay khi bấm lưu.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                className={`px-5 py-2 text-xs font-semibold text-white rounded-lg transition-colors shadow-xs ${
                  type === 'NHAP_KHO'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {type === 'NHAP_KHO' ? 'Lưu Phiếu Nhập Kho' : 'Lưu Phiếu Xuất Kho'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
