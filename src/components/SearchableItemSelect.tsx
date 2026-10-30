import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, ChevronDown, Plus, Check, X } from 'lucide-react';
import { InventoryItem } from '../types/inventory';

interface SearchableItemSelectProps {
  items: InventoryItem[];
  itemsById?: Map<string, InventoryItem>;
  value: string;
  onChange: (selectedValue: string) => void;
  warehouseId?: string;
  allowNewItem?: boolean;
  newItemValue?: string;
  newItemLabel?: string;
  placeholder?: string;
  showStockInWarehouse?: boolean;
  className?: string;
}

const MAX_RENDERED_OPTIONS = 60;

export const SearchableItemSelect: React.FC<SearchableItemSelectProps> = ({
  items,
  itemsById,
  value,
  onChange,
  warehouseId,
  allowNewItem = false,
  newItemValue = '__NEW_ITEM__',
  newItemLabel = '+ Nhập vật tư mới (Chưa có mã trong kho)',
  placeholder = '-- Tìm mã SKU hoặc tên vật tư --',
  showStockInWarehouse = true,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; width: number; openUp: boolean }>({
    top: 0,
    left: 0,
    width: 320,
    openUp: false,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedItem = useMemo(() => {
    if (!value || value === newItemValue) return undefined;
    if (itemsById) return itemsById.get(value);
    return items.find((i) => i.id === value);
  }, [value, newItemValue, itemsById, items]);

  const updatePosition = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 290 && rect.top > spaceBelow;
    const width = Math.max(rect.width, 340);
    const left = Math.min(rect.left, Math.max(8, window.innerWidth - width - 8));
    setMenuStyle({
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      left,
      width,
      openUp,
    });
  };

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!menuRef.current || !menuRef.current.contains(target))
      ) {
        setIsOpen(false);
      }
    };
    const handleScrollOrResize = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      updatePosition();
    };
    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [isOpen]);

  const { matchedOptions, totalMatched } = useMemo(() => {
    if (!isOpen) return { matchedOptions: [] as InventoryItem[], totalMatched: items.length };
    const q = query.trim().toLowerCase();
    if (!q) {
      const initial: InventoryItem[] = [];
      if (selectedItem) {
        initial.push(selectedItem);
      }
      for (let i = 0; i < items.length && initial.length < MAX_RENDERED_OPTIONS; i++) {
        if (!selectedItem || items[i].id !== selectedItem.id) {
          initial.push(items[i]);
        }
      }
      return { matchedOptions: initial, totalMatched: items.length };
    }

    const matches: InventoryItem[] = [];
    let count = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const match =
        it.code.toLowerCase().includes(q) ||
        it.name.toLowerCase().includes(q) ||
        (it.serialOrLot && it.serialOrLot.toLowerCase().includes(q));
      if (match) {
        count++;
        if (matches.length < MAX_RENDERED_OPTIONS) {
          matches.push(it);
        }
      }
    }
    return { matchedOptions: matches, totalMatched: count };
  }, [isOpen, query, items, selectedItem]);

  const getAvailableQty = (it: InventoryItem): number => {
    if (warehouseId && it.warehouseStocks && it.warehouseStocks[warehouseId] !== undefined) {
      return Number(it.warehouseStocks[warehouseId]) || 0;
    }
    if (warehouseId && it.warehouseId === warehouseId) {
      return Number(it.currentStock) || 0;
    }
    return warehouseId ? 0 : Number(it.currentStock) || 0;
  };

  const displayLabel = useMemo(() => {
    if (value === newItemValue && allowNewItem) {
      return newItemLabel;
    }
    if (selectedItem) {
      const stockText = showStockInWarehouse
        ? ` (Tồn: ${getAvailableQty(selectedItem).toLocaleString('vi-VN')} ${selectedItem.unit})`
        : '';
      return `[${selectedItem.code}] ${selectedItem.name}${stockText}`;
    }
    return '';
  }, [value, newItemValue, allowNewItem, newItemLabel, selectedItem, showStockInWarehouse, warehouseId]);

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 ${
          value === newItemValue
            ? 'border-emerald-300 bg-emerald-50/70 font-semibold text-emerald-800'
            : selectedItem
            ? 'border-slate-200 bg-white font-medium text-slate-800 hover:border-slate-300'
            : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300'
        }`}
      >
        <span className="truncate">{displayLabel || placeholder}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          style={{
            top: menuStyle.openUp ? undefined : `${menuStyle.top}px`,
            bottom: menuStyle.openUp ? `${window.innerHeight - menuStyle.top}px` : undefined,
            left: `${menuStyle.left}px`,
            width: `${menuStyle.width}px`,
          }}
          className="fixed z-[70] rounded-xl border border-slate-200 bg-white shadow-2xl"
        >
          <div className="flex items-center gap-1.5 border-b border-slate-100 px-2.5 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Gõ mã SKU, tên vật tư, số lô/serial..."
              className="w-full bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {allowNewItem && (
              <button
                type="button"
                onClick={() => {
                  onChange(newItemValue);
                  setIsOpen(false);
                }}
                className="flex w-full items-center gap-2 border-b border-emerald-100 bg-emerald-50/70 px-3 py-2 text-left text-xs font-semibold text-emerald-700 hover:bg-emerald-100/80"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span>{newItemLabel}</span>
              </button>
            )}

            {matchedOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-400">
                Không tìm thấy vật tư phù hợp với "{query}"
              </div>
            ) : (
              matchedOptions.map((it) => {
                const isSelected = it.id === value;
                const avail = getAvailableQty(it);
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => {
                      onChange(it.id);
                      setIsOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                      isSelected
                        ? 'bg-blue-50 font-semibold text-blue-700'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        <span className="font-mono font-semibold text-slate-900">[{it.code}]</span>{' '}
                        <span>{it.name}</span>
                      </div>
                      {showStockInWarehouse && (
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          ĐVT: {it.unit} • Tồn kho:{' '}
                          <span className={avail > 0 ? 'font-semibold text-emerald-600' : 'text-rose-500'}>
                            {avail.toLocaleString('vi-VN')}
                          </span>
                        </div>
                      )}
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-blue-600" />}
                  </button>
                );
              })
            )}
          </div>

          {totalMatched > MAX_RENDERED_OPTIONS && (
            <div className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
              Đang hiển thị {MAX_RENDERED_OPTIONS}/{totalMatched.toLocaleString('vi-VN')} kết quả — gõ thêm từ khóa để thu hẹp nhanh.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
