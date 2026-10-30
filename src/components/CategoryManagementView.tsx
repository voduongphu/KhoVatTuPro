import React, { useMemo, useState } from 'react';
import {
  FolderTree,
  Plus,
  Edit2,
  Trash2,
  Search,
  Boxes,
  AlertCircle,
  CheckCircle2,
  X,
  ExternalLink,
  Link2,
  Wand2,
  Check,
} from 'lucide-react';
import { useInventory } from '../context/InventoryContext';
import { InventoryItem, MaterialCategory } from '../types/inventory';
import { formatCurrency, formatNumber } from '../utils/formatters';
import { generateCategoryCodeFromName } from '../utils/mergeSyncData';
import { PaginationBar } from './PaginationBar';

interface CategoryManagementViewProps {
  onNavigateToInventoryWithCategory?: (categoryName: string) => void;
  onEditItem?: (item: InventoryItem) => void;
}

export const CategoryManagementView: React.FC<CategoryManagementViewProps> = ({
  onNavigateToInventoryWithCategory,
  onEditItem,
}) => {
  const {
    materialCategories,
    items,
    addMaterialCategory,
    updateMaterialCategory,
    deleteMaterialCategory,
    linkItemsToCategoryBatch,
    resetFilterCriteria,
    updateFilter,
  } = useInventory();

  const [searchQuery, setSearchQuery] = useState('');
  const [notification, setNotification] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);

  // Add / Edit Category Modal State
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<MaterialCategory | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState('');

  // Delete Category Modal State
  const [categoryToDelete, setCategoryToDelete] = useState<MaterialCategory | null>(null);
  const [deleteMode, setDeleteMode] = useState<'UNCATEGORIZED' | 'REASSIGN'>('UNCATEGORIZED');
  const [reassignCategoryId, setReassignCategoryId] = useState('');

  // Link Items Modal State
  const [linkingCategory, setLinkingCategory] = useState<MaterialCategory | null>(null);
  const [linkItemSearch, setLinkItemSearch] = useState('');
  const [selectedLinkItemIds, setSelectedLinkItemIds] = useState<string[]>([]);
  const [linkPage, setLinkPage] = useState(1);
  const [linkPageSize, setLinkPageSize] = useState(100);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setNotification({ text, type });
    setTimeout(() => {
      setNotification(prev => (prev?.text === text ? null : prev));
    }, 3500);
  };

  // Match helper: determine whether an item belongs to a given MaterialCategory
  const isItemLinkedToCategory = (item: InventoryItem, cat: MaterialCategory): boolean => {
    if (item.categoryId) {
      return item.categoryId === cat.id;
    }
    if (item.categoryCode && item.categoryCode.trim().toUpperCase() === cat.code.trim().toUpperCase()) {
      return true;
    }
    const rawCat = (item.category || '').trim().toLowerCase();
    return Boolean(rawCat && rawCat === cat.name.trim().toLowerCase());
  };

  // Compute per-category statistics and uncategorized items in O(N + C)
  const { categoryStatsMap, uncategorizedStats } = useMemo(() => {
    const statsMap: Record<
      string,
      {
        linkedItems: InventoryItem[];
        itemCount: number;
        totalStock: number;
        totalValue: number;
      }
    > = {};

    const catById = new Map<string, MaterialCategory>();
    const catByCodeUpper = new Map<string, MaterialCategory>();
    const catByNameLower = new Map<string, MaterialCategory>();

    materialCategories.forEach(cat => {
      statsMap[cat.id] = {
        linkedItems: [],
        itemCount: 0,
        totalStock: 0,
        totalValue: 0,
      };
      catById.set(cat.id, cat);
      if (cat.code) catByCodeUpper.set(cat.code.trim().toUpperCase(), cat);
      if (cat.name) catByNameLower.set(cat.name.trim().toLowerCase(), cat);
    });

    const uncategorizedItems: InventoryItem[] = [];
    let uncatStock = 0;
    let uncatValue = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let matchedCat: MaterialCategory | undefined;
      if (item.categoryId && item.categoryId !== '__UNCATEGORIZED__') {
        matchedCat = catById.get(item.categoryId);
      } else if (!item.categoryId) {
        if (item.categoryCode) {
          matchedCat = catByCodeUpper.get(item.categoryCode.trim().toUpperCase());
        }
        if (!matchedCat && item.category) {
          matchedCat = catByNameLower.get(item.category.trim().toLowerCase());
        }
      }

      if (matchedCat && statsMap[matchedCat.id]) {
        const entry = statsMap[matchedCat.id];
        entry.linkedItems.push(item);
        entry.itemCount += 1;
        entry.totalStock += item.currentStock;
        entry.totalValue += item.currentStock * item.unitPrice;
      } else {
        uncategorizedItems.push(item);
        uncatStock += item.currentStock;
        uncatValue += item.currentStock * item.unitPrice;
      }
    }

    return {
      categoryStatsMap: statsMap,
      uncategorizedStats: {
        items: uncategorizedItems,
        itemCount: uncategorizedItems.length,
        totalStock: uncatStock,
        totalValue: uncatValue,
      },
    };
  }, [materialCategories, items]);

  const totalCategorizedItems = items.length - uncategorizedStats.itemCount;
  const totalCategorizedValue = useMemo(
    () =>
      Object.values(categoryStatsMap).reduce((sum, st) => sum + st.totalValue, 0),
    [categoryStatsMap]
  );

  // Filtered categories by search query
  const filteredCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return materialCategories;
    return materialCategories.filter(
      cat =>
        cat.code.toLowerCase().includes(q) ||
        cat.name.toLowerCase().includes(q) ||
        (cat.description || '').toLowerCase().includes(q)
    );
  }, [materialCategories, searchQuery]);

  // Handlers for Add / Edit modal
  const handleOpenCreate = () => {
    setEditingCategory(null);
    setCode('');
    setName('');
    setDescription('');
    setFormError('');
    setIsFormOpen(true);
  };

  const handleOpenEdit = (cat: MaterialCategory) => {
    setEditingCategory(cat);
    setCode(cat.code);
    setName(cat.name);
    setDescription(cat.description || '');
    setFormError('');
    setIsFormOpen(true);
  };

  const handleSuggestCode = () => {
    const usedCodes = new Set(
      materialCategories
        .filter(c => c.id !== editingCategory?.id)
        .map(c => c.code.trim().toUpperCase())
    );
    const suggested = generateCategoryCodeFromName(name || 'Danh mục mới', usedCodes);
    setCode(suggested);
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const trimmedCode = code.trim().toUpperCase();
    const trimmedName = name.trim();

    if (!trimmedCode) {
      setFormError('Vui lòng nhập Mã danh mục (VD: DM-CD, DM-TB...).');
      return;
    }
    if (!trimmedName) {
      setFormError('Vui lòng nhập Tên danh mục vật tư.');
      return;
    }

    if (editingCategory) {
      const res = updateMaterialCategory(editingCategory.id, {
        code: trimmedCode,
        name: trimmedName,
        description: description.trim(),
      });
      if (!res.success) {
        setFormError(res.error || 'Không thể cập nhật danh mục.');
        return;
      }
      showToast(`Đã cập nhật danh mục [${trimmedCode}] ${trimmedName} và đồng bộ các vật tư liên kết.`);
    } else {
      const res = addMaterialCategory({
        code: trimmedCode,
        name: trimmedName,
        description: description.trim(),
      });
      if (!res.success) {
        setFormError(res.error || 'Không thể thêm danh mục mới.');
        return;
      }
      showToast(`Đã thêm danh mục mới [${trimmedCode}] ${trimmedName}.`);
    }

    setIsFormOpen(false);
    setEditingCategory(null);
  };

  // Handlers for Delete modal
  const handleOpenDelete = (cat: MaterialCategory) => {
    const otherCats = materialCategories.filter(c => c.id !== cat.id);
    setCategoryToDelete(cat);
    if (otherCats.length > 0) {
      setDeleteMode('REASSIGN');
      setReassignCategoryId(otherCats[0].id);
    } else {
      setDeleteMode('UNCATEGORIZED');
      setReassignCategoryId('');
    }
  };

  const handleConfirmDelete = () => {
    if (!categoryToDelete) return;
    const targetReassign =
      deleteMode === 'REASSIGN' && reassignCategoryId ? reassignCategoryId : undefined;
    const res = deleteMaterialCategory(categoryToDelete.id, targetReassign);
    if (!res.success) {
      showToast(res.error || 'Không thể xóa danh mục vật tư.', 'error');
      return;
    }
    showToast(`Đã xóa danh mục [${categoryToDelete.code}] ${categoryToDelete.name}.`);
    setCategoryToDelete(null);
  };

  // Navigate to Inventory filtered by category
  const handleViewCategoryItems = (categoryName: string) => {
    resetFilterCriteria();
    updateFilter('categories', [categoryName]);
    if (onNavigateToInventoryWithCategory) {
      onNavigateToInventoryWithCategory(categoryName);
    }
  };

  // Handlers for Link Items modal
  const handleOpenLinkModal = (cat: MaterialCategory) => {
    const precomputed = categoryStatsMap[cat.id]?.linkedItems;
    const currentlyLinkedIds = precomputed
      ? precomputed.map(it => it.id)
      : items.filter(it => isItemLinkedToCategory(it, cat)).map(it => it.id);
    setLinkingCategory(cat);
    setSelectedLinkItemIds(currentlyLinkedIds);
    setLinkItemSearch('');
    setLinkPage(1);
  };

  const selectedLinkSet = useMemo(() => new Set(selectedLinkItemIds), [selectedLinkItemIds]);

  const toggleItemInLinkModal = (itemId: string) => {
    setSelectedLinkItemIds(prev => {
      const nextSet = new Set(prev);
      if (nextSet.has(itemId)) {
        nextSet.delete(itemId);
      } else {
        nextSet.add(itemId);
      }
      return Array.from(nextSet);
    });
  };

  const handleSaveItemLinks = () => {
    if (!linkingCategory) return;
    const { linkedCount, unlinkedCount } = linkItemsToCategoryBatch(
      linkingCategory.id,
      selectedLinkItemIds
    );

    showToast(
      `Đã cập nhật liên kết cho danh mục [${linkingCategory.code}]: gắn ${linkedCount} vật tư${
        unlinkedCount > 0 ? `, gỡ ${unlinkedCount} vật tư` : ''
      }.`
    );
    setLinkingCategory(null);
  };

  const filteredModalItems = useMemo(() => {
    if (!linkingCategory) return [];
    const q = linkItemSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      it =>
        it.code.toLowerCase().includes(q) ||
        it.name.toLowerCase().includes(q) ||
        (it.category || '').toLowerCase().includes(q) ||
        (it.categoryCode || '').toLowerCase().includes(q)
    );
  }, [items, linkingCategory, linkItemSearch]);

  const linkTotalPages = Math.max(1, Math.ceil(filteredModalItems.length / linkPageSize));
  const safeLinkPage = Math.min(linkPage, linkTotalPages);
  const paginatedModalItems = useMemo(() => {
    const start = (safeLinkPage - 1) * linkPageSize;
    return filteredModalItems.slice(start, start + linkPageSize);
  }, [filteredModalItems, safeLinkPage, linkPageSize]);

  const allFilteredSelected = useMemo(() => {
    if (filteredModalItems.length === 0) return false;
    for (let i = 0; i < filteredModalItems.length; i++) {
      if (!selectedLinkSet.has(filteredModalItems[i].id)) return false;
    }
    return true;
  }, [filteredModalItems, selectedLinkSet]);

  const handleToggleAllFiltered = () => {
    setSelectedLinkItemIds(prev => {
      const nextSet = new Set(prev);
      if (allFilteredSelected) {
        for (let i = 0; i < filteredModalItems.length; i++) {
          nextSet.delete(filteredModalItems[i].id);
        }
      } else {
        for (let i = 0; i < filteredModalItems.length; i++) {
          nextSet.add(filteredModalItems[i].id);
        }
      }
      return Array.from(nextSet);
    });
  };

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
            <FolderTree className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Quản Lý Danh Mục Vật Tư
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Thiết lập mã danh mục, tên danh mục và liên kết trực tiếp với từng vật tư, thiết bị trong kho
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-xs whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm danh mục mới</span>
          </button>
        </div>
      </div>

      {/* Inline Toast Feedback */}
      {notification && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center justify-between gap-3 ${
            notification.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{notification.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="text-slate-400 hover:text-slate-700 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs text-slate-500 font-medium">Tổng số danh mục đang quản lý</div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900 tabular-nums">
              {materialCategories.length}
            </span>
            <span className="text-xs text-slate-500">danh mục chuẩn hóa</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs text-slate-500 font-medium">Vật tư đã liên kết danh mục</div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-indigo-700 tabular-nums">
              {totalCategorizedItems}
              <span className="text-sm font-normal text-slate-400"> / {items.length}</span>
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {uncategorizedStats.itemCount > 0
                ? `${uncategorizedStats.itemCount} chưa phân loại`
                : 'Đã phân loại 100%'}
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs text-slate-500 font-medium">Tổng giá trị vật tư theo danh mục</div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900 tabular-nums">
              {formatCurrency(totalCategorizedValue)}
            </span>
            <Boxes className="w-4 h-4 text-slate-400" />
          </div>
        </div>
      </div>

      {/* Search & Filter Strip */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Tìm theo mã danh mục, tên danh mục hoặc mô tả..."
            className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 focus:bg-white border border-slate-200 focus:border-indigo-500 rounded-lg outline-none transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="text-xs text-slate-500">
          Hiển thị <strong className="text-slate-800 tabular-nums">{filteredCategories.length}</strong> /{' '}
          <span className="tabular-nums">{materialCategories.length}</span> danh mục
        </div>
      </div>

      {/* Categories Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {filteredCategories.length === 0 ? (
          <div className="p-12 text-center">
            <FolderTree className="w-8 h-8 text-slate-300 mx-auto mb-2.5" />
            <h3 className="text-sm font-semibold text-slate-800">
              Không tìm thấy danh mục vật tư nào
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              {searchQuery
                ? 'Không có danh mục nào khớp với từ khóa tìm kiếm. Hãy thử từ khóa khác.'
                : 'Chưa có danh mục vật tư nào. Nhấn "Thêm danh mục mới" để khởi tạo.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/90 border-b border-slate-200 text-slate-600 font-semibold text-[11px] uppercase tracking-wider">
                  <th className="py-3 px-4 w-36">Mã danh mục</th>
                  <th className="py-3 px-4 min-w-[220px]">Tên danh mục &amp; Mô tả</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Vật tư liên kết</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Tổng SL tồn</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Tổng giá trị tồn</th>
                  <th className="py-3 px-4 text-center whitespace-nowrap">Liên kết vật tư</th>
                  <th className="py-3 px-4 text-center whitespace-nowrap">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCategories.map(cat => {
                  const st = categoryStatsMap[cat.id] || {
                    linkedItems: [],
                    itemCount: 0,
                    totalStock: 0,
                    totalValue: 0,
                  };

                  return (
                    <tr key={cat.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Code */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="font-mono font-bold text-indigo-700 bg-indigo-50/70 px-2.5 py-1 rounded border border-indigo-100">
                          {cat.code}
                        </span>
                      </td>

                      {/* Name & Description */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 text-sm">
                          {cat.name}
                        </div>
                        {cat.description ? (
                          <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                            {cat.description}
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Chưa có ghi chú mô tả
                          </div>
                        )}
                      </td>

                      {/* Linked Item Count */}
                      <td className="py-3.5 px-4 text-right tabular-nums whitespace-nowrap">
                        <span className="font-bold text-slate-900 text-sm">
                          {formatNumber(st.itemCount)}
                        </span>
                        <span className="text-slate-500 ml-1">mặt hàng</span>
                      </td>

                      {/* Total Stock */}
                      <td className="py-3.5 px-4 text-right tabular-nums whitespace-nowrap font-semibold text-slate-800">
                        {formatNumber(st.totalStock)}
                      </td>

                      {/* Total Value */}
                      <td className="py-3.5 px-4 text-right tabular-nums whitespace-nowrap font-semibold text-slate-900">
                        {formatCurrency(st.totalValue)}
                      </td>

                      {/* Link / View Items */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenLinkModal(cat)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors whitespace-nowrap"
                            title="Chọn các vật tư trong kho để liên kết vào danh mục này"
                          >
                            <Link2 className="w-3.5 h-3.5" />
                            <span>Gán vật tư</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleViewCategoryItems(cat.name)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
                            title="Mở bảng vật tư lọc riêng theo danh mục này"
                          >
                            <span>Xem ({st.itemCount})</span>
                            <ExternalLink className="w-3 h-3 text-slate-400" />
                          </button>
                        </div>
                      </td>

                      {/* Edit / Delete Actions */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <div className="inline-flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(cat)}
                            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                            title="Sửa mã hoặc tên danh mục"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenDelete(cat)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Xóa danh mục vật tư"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {/* Uncategorized row if any items have no matching category */}
                {uncategorizedStats.itemCount > 0 && !searchQuery && (
                  <tr className="bg-amber-50/40 hover:bg-amber-50/70 transition-colors">
                    <td className="py-3.5 px-4 whitespace-nowrap font-mono text-xs text-amber-800 font-semibold">
                      CHƯA GÁN
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-amber-900">
                        Chưa phân loại danh mục
                      </div>
                      <div className="text-xs text-amber-700/90 mt-0.5">
                        Các vật tư chưa được gán vào danh mục chuẩn — nhấn &ldquo;Gán vật tư&rdquo; ở danh mục tương ứng để phân loại
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right tabular-nums font-bold text-amber-900 whitespace-nowrap">
                      {formatNumber(uncategorizedStats.itemCount)} mặt hàng
                    </td>
                    <td className="py-3.5 px-4 text-right tabular-nums font-semibold text-amber-900 whitespace-nowrap">
                      {formatNumber(uncategorizedStats.totalStock)}
                    </td>
                    <td className="py-3.5 px-4 text-right tabular-nums font-semibold text-amber-900 whitespace-nowrap">
                      {formatCurrency(uncategorizedStats.totalValue)}
                    </td>
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleViewCategoryItems('Chưa phân loại')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-900 bg-white hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors whitespace-nowrap"
                      >
                        <span>Xem vật tư ({uncategorizedStats.itemCount})</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </td>
                    <td className="py-3.5 px-4 text-center text-slate-400">—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL 1: Add / Edit Material Category */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
                  {editingCategory ? <Edit2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {editingCategory ? 'Chỉnh Sửa Danh Mục Vật Tư' : 'Thêm Danh Mục Vật Tư Mới'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {editingCategory
                      ? 'Mọi thay đổi mã hoặc tên sẽ tự động cập nhật sang các vật tư đang liên kết'
                      : 'Khai báo mã định danh và tên danh mục chuẩn để phân nhóm vật tư'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="p-5 space-y-4">
              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tên danh mục vật tư *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="VD: Cơ điện & Vật tư công trình, Thiết bị đo lường..."
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:border-indigo-500 outline-none font-medium"
                  required
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Mã danh mục *
                  </label>
                  <button
                    type="button"
                    onClick={handleSuggestCode}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    <Wand2 className="w-3 h-3" />
                    <span>Gợi ý mã từ tên danh mục</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  placeholder="VD: DM-CD, DM-TB, DM-AT..."
                  className="w-full px-3 py-2 text-xs font-mono font-bold border border-slate-200 rounded-lg focus:border-indigo-500 outline-none uppercase"
                  required
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Mã danh mục là duy nhất, viết hoa không dấu để tra cứu và đồng bộ nhanh.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Mô tả / Ghi chú phạm vi vật tư
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="VD: Nhóm cáp điện hạ thế, tủ bảng điện, ống luồn dây và phụ kiện đấu nối..."
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:border-indigo-500 outline-none"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-xs whitespace-nowrap"
                >
                  {editingCategory ? 'Lưu thay đổi' : 'Thêm danh mục'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Delete Category Confirmation (with Reassignment Option) */}
      {categoryToDelete && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-200 bg-rose-50/60 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Xóa Danh Mục Vật Tư
                  </h3>
                  <p className="text-xs text-slate-600">
                    [{categoryToDelete.code}] {categoryToDelete.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCategoryToDelete(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {(() => {
                const linkedCount = categoryStatsMap[categoryToDelete.id]?.itemCount || 0;
                const otherCats = materialCategories.filter(c => c.id !== categoryToDelete.id);

                if (linkedCount === 0) {
                  return (
                    <p className="text-slate-700 leading-relaxed">
                      Danh mục <strong className="text-slate-900">[{categoryToDelete.code}] {categoryToDelete.name}</strong> hiện không có mặt hàng nào đang liên kết. Bạn có chắc chắn muốn xóa danh mục này khỏi hệ thống?
                    </p>
                  );
                }

                return (
                  <div className="space-y-3">
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900">
                      Hiện có <strong className="font-bold tabular-nums">{linkedCount}</strong> vật tư / thiết bị đang liên kết với danh mục{' '}
                      <strong>[{categoryToDelete.code}] {categoryToDelete.name}</strong>. Vui lòng chọn cách xử lý các vật tư này sau khi xóa:
                    </div>

                    {otherCats.length > 0 && (
                      <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50">
                        <input
                          type="radio"
                          name="deleteCatMode"
                          checked={deleteMode === 'REASSIGN'}
                          onChange={() => setDeleteMode('REASSIGN')}
                          className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                        />
                        <div className="flex-1 space-y-2">
                          <div className="font-semibold text-slate-800">
                            Chuyển toàn bộ {linkedCount} vật tư sang danh mục khác
                          </div>
                          {deleteMode === 'REASSIGN' && (
                            <select
                              value={reassignCategoryId}
                              onChange={e => setReassignCategoryId(e.target.value)}
                              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white outline-none focus:border-indigo-500 font-medium"
                            >
                              {otherCats.map(c => (
                                <option key={c.id} value={c.id}>
                                  [{c.code}] {c.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </label>
                    )}

                    <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50">
                      <input
                        type="radio"
                        name="deleteCatMode"
                        checked={deleteMode === 'UNCATEGORIZED'}
                        onChange={() => setDeleteMode('UNCATEGORIZED')}
                        className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <div className="font-semibold text-slate-800">
                          Đặt các vật tư này về trạng thái &ldquo;Chưa phân loại&rdquo;
                        </div>
                        <div className="text-slate-500 mt-0.5">
                          Giữ nguyên tồn kho và thẻ kho của vật tư, bạn có thể phân loại lại bất kỳ lúc nào.
                        </div>
                      </div>
                    </label>
                  </div>
                );
              })()}

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCategoryToDelete(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors shadow-xs whitespace-nowrap"
                >
                  Xác nhận xóa danh mục
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Bulk Link / Assign Items to Category */}
      {linkingCategory && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
                  <Link2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Liên Kết Vật Tư Với Danh Mục [{linkingCategory.code}]
                  </h3>
                  <p className="text-xs text-slate-500">
                    Danh mục: <strong className="text-slate-800">{linkingCategory.name}</strong> &bull; Đang chọn{' '}
                    <strong className="text-indigo-600 tabular-nums">{selectedLinkItemIds.length}</strong> vật tư
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLinkingCategory(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-b border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={linkItemSearch}
                  onChange={e => {
                    setLinkItemSearch(e.target.value);
                    setLinkPage(1);
                  }}
                  placeholder="Tìm vật tư theo mã SKU, tên vật tư hoặc danh mục hiện tại..."
                  className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 focus:bg-white border border-slate-200 focus:border-indigo-500 rounded-lg outline-none"
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {filteredModalItems.length > 0 && (
                  <button
                    type="button"
                    onClick={handleToggleAllFiltered}
                    className="px-2.5 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {allFilteredSelected
                      ? `Bỏ chọn (${formatNumber(filteredModalItems.length)})`
                      : `Chọn tất cả (${formatNumber(filteredModalItems.length)})`}
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {paginatedModalItems.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  Không tìm thấy vật tư phù hợp.
                </div>
              ) : (
                paginatedModalItems.map(item => {
                  const checked = selectedLinkSet.has(item.id);
                  const belongedHere = isItemLinkedToCategory(item, linkingCategory);
                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleItemInLinkModal(item.id)}
                      className={`px-4 py-3 flex items-center justify-between gap-3 cursor-pointer text-xs transition-colors ${
                        checked ? 'bg-indigo-50/50 hover:bg-indigo-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {}}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 pointer-events-none"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-900">{item.code}</span>
                            <span className="font-semibold text-slate-800 truncate">{item.name}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                            <span>
                              Danh mục hiện tại:{' '}
                              <strong className={belongedHere ? 'text-indigo-700' : 'text-slate-700'}>
                                {item.categoryCode ? `[${item.categoryCode}] ` : ''}
                                {item.category || 'Chưa phân loại'}
                              </strong>
                            </span>
                            <span aria-hidden="true">&bull;</span>
                            <span className="tabular-nums">
                              Tồn: {formatNumber(item.currentStock)} {item.unit}
                            </span>
                          </div>
                        </div>
                      </div>

                      {onEditItem && (
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            setLinkingCategory(null);
                            onEditItem(item);
                          }}
                          className="px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:text-indigo-700 bg-white border border-slate-200 rounded-md shrink-0 whitespace-nowrap"
                        >
                          Chi tiết VT
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {filteredModalItems.length > linkPageSize && (
              <PaginationBar
                currentPage={safeLinkPage}
                totalItems={filteredModalItems.length}
                pageSize={linkPageSize}
                onPageChange={setLinkPage}
                onPageSizeChange={size => {
                  setLinkPageSize(size);
                  setLinkPage(1);
                }}
                pageSizeOptions={[50, 100, 200, 500]}
                itemLabel="vật tư"
                compact
              />
            )}

            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                Đã chọn <strong className="text-indigo-700 tabular-nums">{formatNumber(selectedLinkItemIds.length)}</strong> /{' '}
                <span className="tabular-nums">{formatNumber(items.length)}</span> vật tư
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLinkingCategory(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={handleSaveItemLinks}
                  className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-xs whitespace-nowrap"
                >
                  <Check className="w-4 h-4" />
                  <span>Lưu liên kết vật tư</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
