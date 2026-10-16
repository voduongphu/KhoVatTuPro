import React from 'react';
import { X, Printer } from 'lucide-react';
import { useInventory } from '../context/InventoryContext';
import { Transaction } from '../types/inventory';
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  getSubtypeLabel,
  getTransactionTypeLabel,
} from '../utils/formatters';

interface TransactionPrintModalProps {
  transaction: Transaction | null;
  onClose: () => void;
}

export const TransactionPrintModal: React.FC<TransactionPrintModalProps> = ({
  transaction,
  onClose,
}) => {
  const { warehouses } = useInventory();

  if (!transaction) return null;

  const wh = warehouses.find(w => w.id === transaction.warehouseId);
  const isReceipt = transaction.type === 'NHAP_KHO';

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 print:p-0 print:bg-white">
      <div className="bg-white rounded-2xl max-w-3xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] print:max-h-none print:shadow-none print:border-none print:rounded-none">
        {/* Modal Controls (Hidden during print) */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 print:hidden">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-200 text-slate-800">
              {transaction.code}
            </span>
            <span className="text-xs text-slate-500">Xem trước mẫu chứng từ kho</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors shadow-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>In Phiếu (Ctrl + P)</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Document Sheet */}
        <div className="flex-1 overflow-y-auto p-8 font-serif text-slate-900 print:overflow-visible print:p-4">
          {/* Company & Standard Form Header */}
          <div className="flex justify-between items-start pb-4 border-b border-slate-300 text-xs">
            <div>
              <p className="font-bold uppercase tracking-wider text-slate-900">
                TẬP ĐOÀN ĐẦU TƯ XÂY DỰNG & KỸ THUẬT CÔNG NGHIỆP
              </p>
              <p className="text-slate-600">Ban Điều Hành Quản Lý Kho & Cung Ứng Vật Tư</p>
              <p className="text-slate-500 italic">Địa điểm: {wh?.address}</p>
            </div>
            <div className="text-right">
              <p className="font-bold">Mẫu số: 01-VT</p>
              <p className="text-[11px] text-slate-500">(Ban hành theo Thông tư 200/2014/TT-BTC)</p>
              <p className="font-mono font-bold mt-1 text-slate-900">Số: {transaction.code}</p>
            </div>
          </div>

          {/* Title */}
          <div className="text-center my-6">
            <h1 className="text-2xl font-bold uppercase tracking-wide">
              {isReceipt ? 'PHIẾU NHẬP KHO' : 'PHIẾU XUẤT KHO'}
            </h1>
            <p className="text-xs italic text-slate-500 mt-1">
              Ngày lập: {formatDateTime(transaction.date)}
            </p>
            <p className="text-xs font-sans font-semibold text-indigo-700 mt-0.5">
              Nghiệp vụ: {getSubtypeLabel(transaction.subtype)}
            </p>
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-y-2 text-xs mb-6 font-sans">
            <div>
              <span className="text-slate-500">
                {isReceipt ? 'Họ tên người giao / Nhà cung cấp:' : 'Họ tên người nhận / Đơn vị nhận:'}
              </span>{' '}
              <strong className="text-slate-900">{transaction.partnerName}</strong>
            </div>
            <div>
              <span className="text-slate-500">Kho thực hiện:</span>{' '}
              <strong className="text-slate-900">{wh?.name}</strong>
            </div>
            <div>
              <span className="text-slate-500">Theo hợp đồng / Dự án:</span>{' '}
              <strong className="text-slate-900">{transaction.departmentOrProject}</strong>
            </div>
            <div>
              <span className="text-slate-500">Địa chỉ kho:</span>{' '}
              <span className="text-slate-700">{wh?.address}</span>
            </div>
            {transaction.notes && (
              <div className="col-span-2">
                <span className="text-slate-500">Lý do / Diễn giải:</span>{' '}
                <span className="italic text-slate-800">{transaction.notes}</span>
              </div>
            )}
          </div>

          {/* Items Table */}
          <div className="mb-6">
            <table className="w-full text-left border-collapse border border-slate-300 text-xs font-sans">
              <thead>
                <tr className="bg-slate-100 text-slate-800 font-bold border-b border-slate-300 text-center">
                  <th className="border border-slate-300 py-2 px-2 w-10">STT</th>
                  <th className="border border-slate-300 py-2 px-3">Tên, quy cách vật tư, thiết bị</th>
                  <th className="border border-slate-300 py-2 px-2 w-20">Mã SKU</th>
                  <th className="border border-slate-300 py-2 px-2 w-14">ĐVT</th>
                  <th className="border border-slate-300 py-2 px-2 w-20 text-right">Số lượng</th>
                  <th className="border border-slate-300 py-2 px-3 w-28 text-right">Đơn giá (VNĐ)</th>
                  <th className="border border-slate-300 py-2 px-3 w-32 text-right">Thành tiền (VNĐ)</th>
                </tr>
              </thead>
              <tbody>
                {transaction.items.map((item, idx) => (
                  <tr key={idx} className="border-b border-slate-200">
                    <td className="border border-slate-300 py-2 px-2 text-center tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="border border-slate-300 py-2 px-3">
                      <div className="font-semibold text-slate-900">{item.itemName}</div>
                      {item.note && (
                        <div className="text-[11px] text-slate-500 italic mt-0.5">{item.note}</div>
                      )}
                    </td>
                    <td className="border border-slate-300 py-2 px-2 font-mono text-center">
                      {item.itemCode}
                    </td>
                    <td className="border border-slate-300 py-2 px-2 text-center text-slate-700">
                      {item.unit}
                    </td>
                    <td className="border border-slate-300 py-2 px-2 text-right tabular-nums font-bold">
                      {formatNumber(item.quantity)}
                    </td>
                    <td className="border border-slate-300 py-2 px-3 text-right tabular-nums">
                      {formatCurrency(item.unitPrice)}
                    </td>
                    <td className="border border-slate-300 py-2 px-3 text-right tabular-nums font-bold text-slate-900">
                      {formatCurrency(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold bg-slate-50 border-t-2 border-slate-300">
                  <td colSpan={4} className="border border-slate-300 py-2.5 px-3 uppercase text-right">
                    Tổng cộng giá trị chứng từ:
                  </td>
                  <td className="border border-slate-300 py-2.5 px-2 text-right tabular-nums">
                    {formatNumber(transaction.items.reduce((a, b) => a + b.quantity, 0))}
                  </td>
                  <td className="border border-slate-300"></td>
                  <td className="border border-slate-300 py-2.5 px-3 text-right tabular-nums text-slate-900">
                    {formatCurrency(transaction.totalAmount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Amount in words approximation */}
          <div className="text-xs italic text-slate-600 mb-8 font-sans">
            Tổng số tiền (viết bằng chữ): Chẵn <strong>{formatCurrency(transaction.totalAmount)}</strong> đồng.
          </div>

          {/* Signatures block */}
          <div className="grid grid-cols-4 gap-4 text-center text-xs font-sans mt-8 pt-4">
            <div>
              <p className="font-bold text-slate-900">Người lập phiếu</p>
              <p className="text-[11px] text-slate-400 italic mb-16">(Ký, họ tên)</p>
              <p className="font-semibold text-slate-800">{transaction.creatorName}</p>
            </div>
            <div>
              <p className="font-bold text-slate-900">
                {isReceipt ? 'Người giao hàng' : 'Người nhận hàng'}
              </p>
              <p className="text-[11px] text-slate-400 italic mb-16">(Ký, họ tên)</p>
              <p className="font-semibold text-slate-800">{transaction.partnerName}</p>
            </div>
            <div>
              <p className="font-bold text-slate-900">Thủ kho</p>
              <p className="text-[11px] text-slate-400 italic mb-16">(Ký, họ tên)</p>
              <p className="font-semibold text-slate-800">{wh?.manager.split('-')[0].trim() || 'Thủ kho'}</p>
            </div>
            <div>
              <p className="font-bold text-slate-900">Kế toán / Giám đốc</p>
              <p className="text-[11px] text-slate-400 italic mb-16">(Ký, đóng dấu)</p>
              <p className="font-semibold text-slate-800">{transaction.approverName || 'Ban Giám Đốc'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
