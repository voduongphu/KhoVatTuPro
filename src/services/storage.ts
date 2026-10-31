import { 
  User, 
  Warehouse, 
  MaterialItem, 
  InboundReceipt, 
  OutboundReceipt, 
  InventoryStockRecord,
  StockFilterParams 
} from '../types/inventory';

const STORAGE_KEYS = {
  USERS: 'vtp_inventory_users_v2',
  WAREHOUSES: 'vtp_inventory_warehouses_v2',
  MATERIALS: 'vtp_inventory_materials_v2',
  INBOUND: 'vtp_inventory_inbound_v2',
  OUTBOUND: 'vtp_inventory_outbound_v2',
  CURRENT_USER: 'vtp_inventory_current_user_v2',
  DELETED_INBOUND: 'vtp_deleted_inbound_ids_v2',
  DELETED_OUTBOUND: 'vtp_deleted_outbound_ids_v2',
  DELETED_MATERIALS: 'vtp_deleted_material_ids_v2',
  DELETED_USERS: 'vtp_deleted_user_ids_v2'
};

const LARGE_DATA_KEYS = new Set<string>([
  STORAGE_KEYS.INBOUND,
  STORAGE_KEYS.OUTBOUND,
  STORAGE_KEYS.MATERIALS
]);

const SEED_FLAG_KEY = 'vtp_inventory_seeded_flag_v4';
const IDB_NAME = 'vtp_inventory_idb_v2';
const IDB_STORE = 'kv_store';
const IDB_VERSION = 1;

// Seed Users
const DEFAULT_USERS: User[] = [
  {
    id: 'user-admin-01',
    username: 'Võ Dương Phú',
    fullName: 'Võ Dương Phú (Tổng Quản Trị)',
    role: 'admin',
    password: '1234567',
    email: 'voduongphu@gmail.com',
    phone: '0908 123 456',
    department: 'Ban Giám Đốc / QL Dự Án',
    isActive: true,
    createdAt: '2026-01-01T08:00:00Z'
  },
  {
    id: 'user-02',
    username: 'nguyenvanan',
    fullName: 'Nguyễn Văn An',
    role: 'manager',
    password: '123',
    email: 'an.nguyen@kho-vattu.vn',
    phone: '0912 345 678',
    department: 'Phòng Quản Lý Kho Bãi Cát Lái',
    isActive: true,
    createdAt: '2026-02-15T09:30:00Z'
  },
  {
    id: 'user-03',
    username: 'tranthimai',
    fullName: 'Trần Thị Mai',
    role: 'staff',
    password: '123',
    email: 'mai.tran@kho-vattu.vn',
    phone: '0987 654 321',
    department: 'Tổ Kiểm Kê & Nhập Xuất',
    isActive: true,
    createdAt: '2026-03-01T10:00:00Z'
  }
];

// Seed Kho Bãi
const DEFAULT_WAREHOUSES: Warehouse[] = [
  {
    id: 'wh-01',
    code: 'KB-CATLAI-01',
    name: 'Kho Tổng Trung Tâm Cát Lái',
    location: 'Khu công nghiệp Cát Lái 2, TP. Thủ Đức, TP.HCM',
    type: 'covered',
    capacityAreaM2: 15000,
    capacityTons: 20000,
    keeperName: 'Võ Dương Phú',
    phone: '0908 123 456',
    status: 'active',
    notes: 'Kho kín tiêu chuẩn chống ẩm, trang bị cầu trục 25 tấn',
    createdAt: '2026-01-10T08:00:00Z'
  },
  {
    id: 'wh-02',
    code: 'BAI-PHUMY-02',
    name: 'Bãi Cảng Phú Mỹ (Hàng Siêu Trường Siêu Trọng)',
    location: 'Cụm Cảng Quốc Tế Phú Mỹ, Bà Rịa - Vũng Tàu',
    type: 'open_yard',
    capacityAreaM2: 30000,
    capacityTons: 50000,
    keeperName: 'Nguyễn Văn An',
    phone: '0912 345 678',
    status: 'active',
    notes: 'Bãi ngoài trời chịu tải trọng cao cho kết cấu thép và thiết bị nặng',
    createdAt: '2026-01-15T08:00:00Z'
  },
  {
    id: 'wh-03',
    code: 'KHO-LANH-03',
    name: 'Kho Kỹ Thuật Điện & Tự Động Hóa',
    location: 'Khu Công Nghệ Cao, TP. Thủ Đức, TP.HCM',
    type: 'specialized',
    capacityAreaM2: 4000,
    capacityTons: 3500,
    keeperName: 'Trần Thị Mai',
    phone: '0987 654 321',
    status: 'active',
    notes: 'Kho phòng sạch điều hòa 22 độ C bảo quản vi mạch và cảm biến',
    createdAt: '2026-02-01T08:00:00Z'
  },
  {
    id: 'wh-04',
    code: 'BAI-DONGNAI-04',
    name: 'Bãi Trung Chuyển Vật Tư Đồng Nai',
    location: 'KCN Nhơn Trạch, Tỉnh Đồng Nai',
    type: 'transit',
    capacityAreaM2: 18000,
    capacityTons: 25000,
    keeperName: 'Đặng Tuấn Anh',
    phone: '0933 888 999',
    status: 'active',
    notes: 'Bãi trung chuyển dự án phục vụ các gói thầu xây dựng hạ tầng',
    createdAt: '2026-02-20T08:00:00Z'
  }
];

// Seed Danh Mục Vật Tư Thiết Bị
const DEFAULT_MATERIALS: MaterialItem[] = [
  {
    id: 'mat-01',
    code: 'TB-VAL-200H',
    name: 'Van cầu áp lực cao Class 600 DN200',
    unit: 'Bộ',
    category: 'Đường ống công nghệ P&ID',
    drawingNo: 'DWG-PID-PIPE-04 Rev.C',
    manufacturer: 'Kitz Corporation (Japan)',
    supplier: 'Công ty CP Kỹ thuật PetroSteel',
    unitWeightKg: 312.5,
    specification: 'Body ASTM A216 WCB, Trim 316SS, Flanged ASME B16.5 CL600',
    minStockAlert: 2,
    notes: 'Van chuyên dụng cho tuyến ống dầu khí áp suất cao'
  },
  {
    id: 'mat-02',
    code: 'KC-BEAM-H350',
    name: 'Thép hình H-Beam H350x350x12x19 L=12m',
    unit: 'Cây',
    category: 'Kết cấu thép nhà xưởng chính',
    drawingNo: 'DWG-STR-BEAM-12 Rev.B',
    manufacturer: 'Posco E&C (Korea)',
    supplier: 'Tập đoàn Thép Hòa Phát',
    unitWeightKg: 1643.75,
    specification: 'Thép cường độ cao SM490YB, mạ kẽm nhúng nóng 85um',
    minStockAlert: 5,
    notes: 'Dầm giằng nhịp chính phân xưởng nhiệt luyện'
  },
  {
    id: 'mat-03',
    code: 'EL-PLC-S7-1500',
    name: 'Hệ thống tủ điện điều khiển PLC Siemens S7-1500',
    unit: 'Tủ',
    category: 'Hệ thống Điện & Tự động hóa',
    drawingNo: 'DWG-ELE-PLC-003',
    manufacturer: 'Siemens AG (Germany)',
    supplier: 'Công ty Thiết bị Điện Schneider VN',
    unitWeightKg: 425.0,
    specification: 'CPU 1517-3 PN/DP, Kèm module I/O phân tán ET200SP và UPS 5kVA',
    minStockAlert: 1,
    notes: 'Bảo quản môi trường khô ráo điều hòa độ ẩm < 60%'
  },
  {
    id: 'mat-04',
    code: 'TB-PUMP-75K',
    name: 'Máy bơm ly tâm trục ngang công nghiệp 75kW',
    unit: 'Bộ',
    category: 'Thiết bị cơ khí quay',
    drawingNo: 'DWG-MEC-PUMP-01',
    manufacturer: 'KSB Pumps (Germany)',
    supplier: 'Vingroup EPC Logistics',
    unitWeightKg: 1150.0,
    specification: 'Q=250m3/h, H=85m, Động cơ IE3 75kW 380V/50Hz, Phớt cơ khí kép',
    minStockAlert: 1,
    notes: 'Trang bị cảm biến rung động và nhiệt độ ổ bi'
  },
  {
    id: 'mat-05',
    code: 'VT-BLT-M36',
    name: 'Bộ bu lông neo móng cường độ cao Gr8.8 M36x1200',
    unit: 'Bộ',
    category: 'Hạng mục Nền móng & Bulong neo',
    drawingNo: 'DWG-CIV-FND-07',
    manufacturer: 'Nippon Steel (Japan)',
    supplier: 'PetroCons Global',
    unitWeightKg: 12.8,
    specification: 'Thép hợp kim cấp bền 8.8 mạ dacromet, kèm 2 đai ốc + 2 đệm phẳng',
    minStockAlert: 50,
    notes: 'Cung cấp theo chứng chỉ CO/CQ và thử tải kéo đứt'
  },
  {
    id: 'mat-06',
    code: 'VT-PIPE-A106-8',
    name: 'Ống thép đúc liền chịu nhiệt ASTM A106 Gr.B SCH40 8 inch',
    unit: 'Cây',
    category: 'Đường ống áp lực cao',
    drawingNo: 'DWG-PIP-HPT-09',
    manufacturer: 'JFE Steel (Japan)',
    supplier: 'Công ty CP Kỹ thuật PetroSteel',
    unitWeightKg: 255.4,
    specification: 'OD 219.1mm, Wall 8.18mm, L=6.0m, Sơn bảo vệ Bitumen',
    minStockAlert: 10,
    notes: 'Sử dụng cho tuyến ống cấp hơi quá nhiệt'
  }
];

// Seed Phiếu Nhập Kho ban đầu
const DEFAULT_INBOUND: InboundReceipt[] = [
  {
    id: 'in-rcp-01',
    receiptCode: 'PN-20261005-001',
    receiptDate: '2026-10-05',
    warehouseId: 'wh-01',
    warehouseName: 'Kho Tổng Trung Tâm Cát Lái',
    supplier: 'Công ty CP Kỹ thuật PetroSteel',
    manufacturer: 'Kitz Corporation (Japan)',
    shipment: 'SHP-PACIFIC-V04',
    packingListNo: 'PL-2026-OCT-001',
    delivererName: 'Tàu Vận Tải Viễn Dương Biển Đông 08',
    receiverName: 'Võ Dương Phú',
    driverVehicleNo: 'Cont 40HC - TCLU984321',
    notes: 'Hàng nhập khẩu chính ngạch đầy đủ CO/CQ từ cảng Cát Lái',
    packageCount: 2,
    totalQuantity: 20,
    totalWeightKg: 27550,
    totalAmount: 692000000,
    createdAt: '2026-10-05T09:15:00Z',
    createdBy: 'Võ Dương Phú',
    items: [
      {
        id: 'in-item-01',
        materialCode: 'TB-VAL-200H',
        materialName: 'Van cầu áp lực cao Class 600 DN200',
        unit: 'Bộ',
        packingListNo: 'PL-2026-OCT-001',
        shipment: 'SHP-PACIFIC-V04',
        manufacturer: 'Kitz Corporation (Japan)',
        supplier: 'Công ty CP Kỹ thuật PetroSteel',
        packageNo: 'PKG-01/15',
        packageName: 'Kiện cụm van áp lực cao DN200',
        category: 'Đường ống công nghệ P&ID',
        drawingNo: 'DWG-PID-PIPE-04 Rev.C',
        weightKg: 1250,
        quantity: 4,
        unitPrice: 45000000,
        totalPrice: 180000000,
        storageLocation: 'Khu A - Kệ 01',
        conditionNote: 'Nguyên đai kiện pallet gỗ khử trùng'
      },
      {
        id: 'in-item-02',
        materialCode: 'KC-BEAM-H350',
        materialName: 'Thép hình H-Beam H350x350x12x19 L=12m',
        unit: 'Cây',
        packingListNo: 'PL-2026-OCT-001',
        shipment: 'SHP-PACIFIC-V04',
        manufacturer: 'Posco E&C (Korea)',
        supplier: 'Tập đoàn Thép Hòa Phát',
        packageNo: 'PKG-02/15',
        packageName: 'Kiện dầm thép hình H-Beam H350',
        category: 'Kết cấu thép nhà xưởng chính',
        drawingNo: 'DWG-STR-BEAM-12 Rev.B',
        weightKg: 26300,
        quantity: 16,
        unitPrice: 32000000,
        totalPrice: 512000000,
        storageLocation: 'Bãi ngoài trời số 01',
        conditionNote: 'Mạ kẽm sáng bóng, không cong vênh'
      }
    ]
  },
  {
    id: 'in-rcp-02',
    receiptCode: 'PN-20261008-002',
    receiptDate: '2026-10-08',
    warehouseId: 'wh-03',
    warehouseName: 'Kho Kỹ Thuật Điện & Tự Động Hóa',
    supplier: 'Công ty Thiết bị Điện Schneider VN',
    manufacturer: 'Siemens AG (Germany)',
    shipment: 'SHP-MAERSK-L08',
    packingListNo: 'PL-2026-OCT-002',
    delivererName: 'Công ty TNHH Vận Tải Hàng Không Tân Sơn Nhất',
    receiverName: 'Nguyễn Văn An',
    driverVehicleNo: 'Xe tải thùng kín 51D-982.11',
    notes: 'Hàng thiết bị điện tử nhạy cảm, vận chuyển bằng xe giảm xóc bóng khí',
    packageCount: 1,
    totalQuantity: 2,
    totalWeightKg: 850,
    totalAmount: 560000000,
    createdAt: '2026-10-08T14:30:00Z',
    createdBy: 'Nguyễn Văn An',
    items: [
      {
        id: 'in-item-03',
        materialCode: 'EL-PLC-S7-1500',
        materialName: 'Hệ thống tủ điện điều khiển PLC Siemens S7-1500',
        unit: 'Tủ',
        packingListNo: 'PL-2026-OCT-002',
        shipment: 'SHP-MAERSK-L08',
        manufacturer: 'Siemens AG (Germany)',
        supplier: 'Công ty Thiết bị Điện Schneider VN',
        packageNo: 'BOX-03/08',
        packageName: 'Tủ điều khiển PLC biến tần trung thế',
        category: 'Hệ thống Điện & Tự động hóa',
        drawingNo: 'DWG-ELE-PLC-003',
        weightKg: 850,
        quantity: 2,
        unitPrice: 280000000,
        totalPrice: 560000000,
        storageLocation: 'Phòng sạch 01 - Kệ E',
        conditionNote: 'Đóng thùng gỗ kín, hút chân không túi nhôm'
      }
    ]
  },
  {
    id: 'in-rcp-03',
    receiptCode: 'PN-20260920-003',
    receiptDate: '2026-09-20',
    warehouseId: 'wh-02',
    warehouseName: 'Bãi Cảng Phú Mỹ (Hàng Siêu Trường Siêu Trọng)',
    supplier: 'Vingroup EPC Logistics',
    manufacturer: 'KSB Pumps (Germany)',
    shipment: 'SHP-EVERGREEN-E12',
    packingListNo: 'PL-2026-SEP-088',
    delivererName: 'Đoàn xe siêu trường siêu trọng Transimex',
    receiverName: 'Võ Dương Phú',
    driverVehicleNo: 'Đầu kéo Mooc lùn 72H-019.45',
    notes: 'Lô máy bơm giải nhiệt công suất lớn phục vụ tổ máy 1 & 2',
    packageCount: 1,
    totalQuantity: 3,
    totalWeightKg: 3450,
    totalAmount: 435000000,
    createdAt: '2026-09-20T10:00:00Z',
    createdBy: 'Võ Dương Phú',
    items: [
      {
        id: 'in-item-04',
        materialCode: 'TB-PUMP-75K',
        materialName: 'Máy bơm ly tâm trục ngang công nghiệp 75kW',
        unit: 'Bộ',
        packingListNo: 'PL-2026-SEP-088',
        shipment: 'SHP-EVERGREEN-E12',
        manufacturer: 'KSB Pumps (Germany)',
        supplier: 'Vingroup EPC Logistics',
        packageNo: 'CASE-01/04',
        packageName: 'Kiện máy bơm ly tâm trục ngang công nghiệp',
        category: 'Thiết bị cơ khí quay',
        drawingNo: 'DWG-MEC-PUMP-01',
        weightKg: 3450,
        quantity: 3,
        unitPrice: 145000000,
        totalPrice: 435000000,
        storageLocation: 'Khu bãi mái che Phú Mỹ',
        conditionNote: 'Kiện nguyên đai, bạt phủ chống tia UV'
      }
    ]
  },
  {
    id: 'in-rcp-04',
    receiptCode: 'PN-20260925-004',
    receiptDate: '2026-09-25',
    warehouseId: 'wh-01',
    warehouseName: 'Kho Tổng Trung Tâm Cát Lái',
    supplier: 'PetroCons Global',
    manufacturer: 'Nippon Steel (Japan)',
    shipment: 'SHP-COSCO-C09',
    packingListNo: 'PL-2026-SEP-089',
    delivererName: 'Công ty CP Tiếp Vận Quốc Tế Hàng Hải',
    receiverName: 'Trần Thị Mai',
    driverVehicleNo: 'Xe tải 15 tấn 60C-554.22',
    notes: 'Bu lông mạ cường độ cao và ống đúc áp lực',
    packageCount: 2,
    totalQuantity: 120,
    totalWeightKg: 6388,
    totalAmount: 185000000,
    createdAt: '2026-09-25T11:20:00Z',
    createdBy: 'Trần Thị Mai',
    items: [
      {
        id: 'in-item-05',
        materialCode: 'VT-BLT-M36',
        materialName: 'Bộ bu lông neo móng cường độ cao Gr8.8 M36x1200',
        unit: 'Bộ',
        packingListNo: 'PL-2026-SEP-089',
        shipment: 'SHP-COSCO-C09',
        manufacturer: 'Nippon Steel (Japan)',
        supplier: 'PetroCons Global',
        packageNo: 'CRATE-05/10',
        packageName: 'Kiện bu lông neo cọc móng M36',
        category: 'Hạng mục Nền móng & Bulong neo',
        drawingNo: 'DWG-CIV-FND-07',
        weightKg: 1280,
        quantity: 100,
        unitPrice: 450000,
        totalPrice: 45000000,
        storageLocation: 'Khu B - Kệ 04',
        conditionNote: 'Đóng trong thùng gỗ sồi hun trùng có dây đai thép'
      },
      {
        id: 'in-item-06',
        materialCode: 'VT-PIPE-A106-8',
        materialName: 'Ống thép đúc liền chịu nhiệt ASTM A106 Gr.B SCH40 8 inch',
        unit: 'Cây',
        packingListNo: 'PL-2026-SEP-089',
        shipment: 'SHP-COSCO-C09',
        manufacturer: 'JFE Steel (Japan)',
        supplier: 'Công ty CP Kỹ thuật PetroSteel',
        packageNo: 'BUNDLE-01/20',
        packageName: 'Kiện ống đúc tiêu chuẩn A106',
        category: 'Đường ống áp lực cao',
        drawingNo: 'DWG-PIP-HPT-09',
        weightKg: 5108,
        quantity: 20,
        unitPrice: 7000000,
        totalPrice: 140000000,
        storageLocation: 'Khu A - Giá ống số 2',
        conditionNote: 'Hai đầu bọc nắp nhựa bảo vệ ren vát mép hàn'
      }
    ]
  }
];

// Seed Phiếu Xuất Kho ban đầu
const DEFAULT_OUTBOUND: OutboundReceipt[] = [
  {
    id: 'out-rcp-01',
    issueCode: 'PX-20261010-001',
    issueDate: '2026-10-10',
    warehouseId: 'wh-01',
    warehouseName: 'Kho Tổng Trung Tâm Cát Lái',
    projectName: 'Dự Án Nhà Máy Điện Khí Nhơn Trạch 3 & 4',
    recipientDepartment: 'Ban Chỉ Huy Công Trường - Đội Lắp Đặt Số 2',
    recipientName: 'KS. Lê Hoàng Nam',
    issuerName: 'Võ Dương Phú',
    notes: 'Xuất cấp vật tư phục vụ lắp đặt móng thiết bị và dầm kết cấu trục A-C',
    packingListSummary: 'PL-2026-OCT-001, PL-2026-SEP-089',
    totalQuantity: 25,
    totalWeightKg: 7143.5,
    totalAmount: 182000000,
    createdAt: '2026-10-10T15:00:00Z',
    createdBy: 'Võ Dương Phú',
    items: [
      {
        id: 'out-item-01',
        materialCode: 'KC-BEAM-H350',
        materialName: 'Thép hình H-Beam H350x350x12x19 L=12m',
        unit: 'Cây',
        packingListNo: 'PL-2026-OCT-001',
        shipment: 'SHP-PACIFIC-V04',
        manufacturer: 'Posco E&C (Korea)',
        supplier: 'Tập đoàn Thép Hòa Phát',
        packageNo: 'PKG-02/15',
        packageName: 'Kiện dầm thép hình H-Beam H350',
        category: 'Kết cấu thép nhà xưởng chính',
        drawingNo: 'DWG-STR-BEAM-12 Rev.B',
        weightKg: 6575,
        quantity: 4,
        unitPrice: 32000000,
        totalPrice: 128000000,
        purpose: 'Lắp dựng khung nhà xưởng trục A'
      },
      {
        id: 'out-item-02',
        materialCode: 'VT-BLT-M36',
        materialName: 'Bộ bu lông neo móng cường độ cao Gr8.8 M36x1200',
        unit: 'Bộ',
        packingListNo: 'PL-2026-SEP-089',
        shipment: 'SHP-COSCO-C09',
        manufacturer: 'Nippon Steel (Japan)',
        supplier: 'PetroCons Global',
        packageNo: 'CRATE-05/10',
        packageName: 'Kiện bu lông neo cọc móng M36',
        category: 'Hạng mục Nền móng & Bulong neo',
        drawingNo: 'DWG-CIV-FND-07',
        weightKg: 256,
        quantity: 20,
        unitPrice: 450000,
        totalPrice: 9000000,
        purpose: 'Neo chân cột kết cấu thép giai đoạn 1'
      },
      {
        id: 'out-item-03',
        materialCode: 'TB-VAL-200H',
        materialName: 'Van cầu áp lực cao Class 600 DN200',
        unit: 'Bộ',
        packingListNo: 'PL-2026-OCT-001',
        shipment: 'SHP-PACIFIC-V04',
        manufacturer: 'Kitz Corporation (Japan)',
        supplier: 'Công ty CP Kỹ thuật PetroSteel',
        packageNo: 'PKG-01/15',
        packageName: 'Kiện cụm van áp lực cao DN200',
        category: 'Đường ống công nghệ P&ID',
        drawingNo: 'DWG-PID-PIPE-04 Rev.C',
        weightKg: 312.5,
        quantity: 1,
        unitPrice: 45000000,
        totalPrice: 45000000,
        purpose: 'Lắp thử nghiệm cụm van trạm bơm cấp dầu số 1'
      }
    ]
  }
];

// ============================================================================
// High-Performance In-Memory Cache + IndexedDB Persistence Engine (100k+ rows)
// ============================================================================
const memoryCache = new Map<string, any>();
let idbPromise: Promise<IDBDatabase | null> | null = null;
let initPromise: Promise<void> | null = null;
let isHydrated = false;
let pendingWrites = new Set<Promise<void>>();

// Version counter cho cache tính toán tồn kho
let inventoryVersion = 1;
let cachedBaseVersion = -1;
let cachedBaseRecords: InventoryStockRecord[] = [];
let cachedFilterOptions: {
  availablePLs: string[];
  availableShipments: string[];
  availableMakers: string[];
  availableSuppliers: string[];
  availableCategories: string[];
  totalPLCount: number;
  totalShipmentCount: number;
} = {
  availablePLs: [],
  availableShipments: [],
  availableMakers: [],
  availableSuppliers: [],
  availableCategories: [],
  totalPLCount: 0,
  totalShipmentCount: 0
};

function openIDB(): Promise<IDBDatabase | null> {
  if (idbPromise) return idbPromise;
  if (typeof indexedDB === 'undefined') {
    idbPromise = Promise.resolve(null);
    return idbPromise;
  }

  idbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.warn('IndexedDB unavailable, using in-memory/localStorage fallback:', req.error);
        resolve(null);
      };
    } catch (e) {
      console.warn('IndexedDB open exception:', e);
      resolve(null);
    }
  });
  return idbPromise;
}

async function idbGetAll(db: IDBDatabase): Promise<Map<string, any>> {
  return new Promise((resolve) => {
    const map = new Map<string, any>();
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          map.set(String(cursor.key), cursor.value);
          cursor.continue();
        } else {
          resolve(map);
        }
      };
      cursorReq.onerror = () => resolve(map);
    } catch {
      resolve(map);
    }
  });
}

function idbPut(key: string, value: any): Promise<void> {
  const p = (async () => {
    const db = await openIDB();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  })();
  pendingWrites.add(p);
  p.finally(() => pendingWrites.delete(p));
  return p;
}

async function idbClear(): Promise<void> {
  const db = await openIDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function getItem<T>(key: string, defaultValue: T): T {
  // Ưu tiên tuyệt đối memoryCache (O(1), không bao giờ bị ghi đè bởi dữ liệu cũ khi vượt hạn mức 5MB của localStorage)
  if (memoryCache.has(key)) {
    return memoryCache.get(key) as T;
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null && raw !== undefined) {
      const parsed = JSON.parse(raw);
      memoryCache.set(key, parsed);
      return parsed;
    }
  } catch (err) {
    console.error(`Error loading key ${key}:`, err);
  }
  return defaultValue;
}

function setItem<T>(key: string, value: T): void {
  memoryCache.set(key, value);

  if (
    key === STORAGE_KEYS.INBOUND ||
    key === STORAGE_KEYS.OUTBOUND ||
    key === STORAGE_KEYS.WAREHOUSES ||
    key === STORAGE_KEYS.DELETED_INBOUND ||
    key === STORAGE_KEYS.DELETED_OUTBOUND
  ) {
    inventoryVersion++;
  }

  // Ghi bất đồng bộ xuống IndexedDB (hỗ trợ hàng trăm MB / >100.000 dòng mượt mà)
  void idbPut(key, value);

  // Chỉ đồng bộ localStorage đối với dữ liệu cấu hình nhỏ; xóa bản cũ ở localStorage cho bảng lớn để tránh dữ liệu lệch
  if (LARGE_DATA_KEYS.has(key)) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  } else {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
  }
}

interface AggEntry {
  warehouseId: string;
  warehouseName: string;
  materialCode: string;
  materialName: string;
  unit: string;
  packingListNo: string;
  shipment: string;
  manufacturer: string;
  supplier: string;
  packageNo: string;
  packageName: string;
  category: string;
  drawingNo: string;
  inboundQuantity: number;
  inboundWeightKg: number;
  outboundQuantity: number;
  outboundWeightKg: number;
  lastUpdated: string;
}

function buildAggregatedRecords(
  inbounds: InboundReceipt[],
  outbounds: OutboundReceipt[],
  whMap: Map<string, string>,
  startDate?: string,
  endDate?: string
): InventoryStockRecord[] {
  const groupMap = new Map<string, AggEntry>();

  for (let i = 0; i < inbounds.length; i++) {
    const receipt = inbounds[i];
    if (startDate && receipt.receiptDate < startDate) continue;
    if (endDate && receipt.receiptDate > endDate) continue;

    const whName = receipt.warehouseName || whMap.get(receipt.warehouseId) || 'Kho mặc định';
    const items = receipt.items;
    const rDate = receipt.receiptDate;
    const whId = receipt.warehouseId;

    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      const pl = item.packingListNo || '';
      const shp = item.shipment || '';
      const mCode = item.materialCode || '';
      const pkgNo = item.packageNo || '';
      const dwg = item.drawingNo || '';
      const cat = item.category || '';
      const key = `${whId}__${pl}__${shp}__${mCode}__${pkgNo}__${dwg}__${cat}`;

      let entry = groupMap.get(key);
      if (!entry) {
        entry = {
          warehouseId: whId,
          warehouseName: whName,
          materialCode: mCode || 'N/A',
          materialName: item.materialName || 'Vật tư',
          unit: item.unit || 'Bộ',
          packingListNo: pl || 'N/A',
          shipment: shp || 'N/A',
          manufacturer: item.manufacturer || 'N/A',
          supplier: item.supplier || 'N/A',
          packageNo: pkgNo || 'N/A',
          packageName: item.packageName || '',
          category: cat || 'N/A',
          drawingNo: dwg || 'N/A',
          inboundQuantity: 0,
          inboundWeightKg: 0,
          outboundQuantity: 0,
          outboundWeightKg: 0,
          lastUpdated: rDate
        };
        groupMap.set(key, entry);
      }

      entry.inboundQuantity += Number(item.quantity) || 0;
      entry.inboundWeightKg += Number(item.weightKg) || 0;
      if (rDate > entry.lastUpdated) {
        entry.lastUpdated = rDate;
      }
    }
  }

  for (let i = 0; i < outbounds.length; i++) {
    const receipt = outbounds[i];
    if (startDate && receipt.issueDate < startDate) continue;
    if (endDate && receipt.issueDate > endDate) continue;

    const whName = receipt.warehouseName || whMap.get(receipt.warehouseId) || 'Kho mặc định';
    const items = receipt.items;
    const iDate = receipt.issueDate;
    const whId = receipt.warehouseId;

    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      const pl = item.packingListNo || '';
      const shp = item.shipment || '';
      const mCode = item.materialCode || '';
      const pkgNo = item.packageNo || '';
      const dwg = item.drawingNo || '';
      const cat = item.category || '';
      const key = `${whId}__${pl}__${shp}__${mCode}__${pkgNo}__${dwg}__${cat}`;

      let entry = groupMap.get(key);
      if (!entry) {
        entry = {
          warehouseId: whId,
          warehouseName: whName,
          materialCode: mCode || 'N/A',
          materialName: item.materialName || 'Vật tư',
          unit: item.unit || 'Bộ',
          packingListNo: pl || 'N/A',
          shipment: shp || 'N/A',
          manufacturer: item.manufacturer || 'N/A',
          supplier: item.supplier || 'N/A',
          packageNo: pkgNo || 'N/A',
          packageName: item.packageName || '',
          category: cat || 'N/A',
          drawingNo: dwg || 'N/A',
          inboundQuantity: 0,
          inboundWeightKg: 0,
          outboundQuantity: 0,
          outboundWeightKg: 0,
          lastUpdated: iDate
        };
        groupMap.set(key, entry);
      }

      entry.outboundQuantity += Number(item.quantity) || 0;
      entry.outboundWeightKg += Number(item.weightKg) || 0;
      if (iDate > entry.lastUpdated) {
        entry.lastUpdated = iDate;
      }
    }
  }

  const records: InventoryStockRecord[] = new Array(groupMap.size);
  let idx = 0;
  groupMap.forEach((e, key) => {
    const currentQty = e.inboundQuantity - e.outboundQuantity;
    const currentWeight = e.inboundWeightKg - e.outboundWeightKg;
    records[idx++] = {
      id: key,
      warehouseId: e.warehouseId,
      warehouseName: e.warehouseName,
      materialCode: e.materialCode,
      materialName: e.materialName,
      unit: e.unit,
      packingListNo: e.packingListNo,
      shipment: e.shipment,
      manufacturer: e.manufacturer,
      supplier: e.supplier,
      packageNo: e.packageNo,
      packageName: e.packageName,
      category: e.category,
      drawingNo: e.drawingNo,
      inboundQuantity: e.inboundQuantity,
      inboundWeightKg: Math.round(e.inboundWeightKg * 100) / 100,
      outboundQuantity: e.outboundQuantity,
      outboundWeightKg: Math.round(e.outboundWeightKg * 100) / 100,
      currentQuantity: currentQty,
      currentWeightKg: Math.round(currentWeight * 100) / 100,
      lastUpdated: e.lastUpdated
    };
  });

  return records;
}

export const StorageService = {
  // Khởi tạo bất đồng bộ từ IndexedDB (tự động migrate từ localStorage nếu có)
  async init(): Promise<void> {
    if (isHydrated) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      const db = await openIDB();
      if (db) {
        const idbMap = await idbGetAll(db);
        idbMap.forEach((val, key) => {
          memoryCache.set(key, val);
        });
      }

      // Migrate dữ liệu từ localStorage nếu chưa có trong IndexedDB
      const allKeys = Object.values(STORAGE_KEYS);
      for (const key of allKeys) {
        if (!memoryCache.has(key)) {
          try {
            const raw = localStorage.getItem(key);
            if (raw !== null && raw !== undefined) {
              const parsed = JSON.parse(raw);
              memoryCache.set(key, parsed);
              void idbPut(key, parsed);
              if (LARGE_DATA_KEYS.has(key)) {
                localStorage.removeItem(key);
              }
            }
          } catch {
            // ignore corrupted localStorage item
          }
        }
      }

      this.ensureInitialized();
      inventoryVersion++;
      isHydrated = true;
    })();

    return initPromise;
  },

  async flush(): Promise<void> {
    if (pendingWrites.size > 0) {
      await Promise.all(Array.from(pendingWrites));
    }
  },

  ensureInitialized(): void {
    // 1. Users
    if (!memoryCache.has(STORAGE_KEYS.USERS) && localStorage.getItem(STORAGE_KEYS.USERS) === null) {
      const deletedUserIds = new Set(getItem<string[]>(STORAGE_KEYS.DELETED_USERS, []));
      setItem(STORAGE_KEYS.USERS, DEFAULT_USERS.filter(u => !deletedUserIds.has(u.id) && !deletedUserIds.has(u.username)));
    }

    // 2. Warehouses
    if (!memoryCache.has(STORAGE_KEYS.WAREHOUSES) && localStorage.getItem(STORAGE_KEYS.WAREHOUSES) === null) {
      setItem(STORAGE_KEYS.WAREHOUSES, DEFAULT_WAREHOUSES);
    }

    // 3. Materials
    if (!memoryCache.has(STORAGE_KEYS.MATERIALS) && localStorage.getItem(STORAGE_KEYS.MATERIALS) === null) {
      const deletedMatIds = new Set(getItem<string[]>(STORAGE_KEYS.DELETED_MATERIALS, []));
      setItem(STORAGE_KEYS.MATERIALS, DEFAULT_MATERIALS.filter(m => !deletedMatIds.has(m.id) && !deletedMatIds.has(m.code)));
    }

    // 4. Inbound Receipts
    if (!memoryCache.has(STORAGE_KEYS.INBOUND) && localStorage.getItem(STORAGE_KEYS.INBOUND) === null) {
      const deletedInboundIds = new Set(getItem<string[]>(STORAGE_KEYS.DELETED_INBOUND, []));
      const initialInbound = DEFAULT_INBOUND.filter(r => !deletedInboundIds.has(r.id) && !deletedInboundIds.has(r.receiptCode));
      setItem(STORAGE_KEYS.INBOUND, initialInbound);
    }

    // 5. Outbound Receipts
    if (!memoryCache.has(STORAGE_KEYS.OUTBOUND) && localStorage.getItem(STORAGE_KEYS.OUTBOUND) === null) {
      const deletedOutboundIds = new Set(getItem<string[]>(STORAGE_KEYS.DELETED_OUTBOUND, []));
      const initialOutbound = DEFAULT_OUTBOUND.filter(r => !deletedOutboundIds.has(r.id) && !deletedOutboundIds.has(r.issueCode));
      setItem(STORAGE_KEYS.OUTBOUND, initialOutbound);
    }

    try {
      localStorage.setItem(SEED_FLAG_KEY, 'true');
    } catch {
      // ignore
    }
  },

  // USERS
  getUsers(): User[] {
    this.ensureInitialized();
    const users = getItem<User[]>(STORAGE_KEYS.USERS, []);
    const hasAdmin = users.some(u => u.username.toLowerCase() === 'võ dương phú' || u.username.toLowerCase() === 'vo duong phu');
    if (!hasAdmin && users.length === 0) {
      const next = [DEFAULT_USERS[0], ...users];
      setItem(STORAGE_KEYS.USERS, next);
      return next;
    }
    return users;
  },

  saveUsers(users: User[]): void {
    setItem(STORAGE_KEYS.USERS, users);
  },

  addUser(user: Omit<User, 'id' | 'createdAt'>): User {
    const users = [...this.getUsers()];
    const newUser: User = {
      ...user,
      id: `user-${Date.now()}`,
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    this.saveUsers(users);
    return newUser;
  },

  updateUser(id: string, updates: Partial<User>): User | null {
    const users = [...this.getUsers()];
    const index = users.findIndex(u => u.id === id);
    if (index === -1) return null;
    users[index] = { ...users[index], ...updates };
    this.saveUsers(users);
    return users[index];
  },

  deleteUser(id: string): boolean {
    const users = this.getUsers();
    const target = users.find(u => u.id === id);
    if (target && (target.username === 'Võ Dương Phú' || target.id === 'user-admin-01')) {
      return false;
    }
    const filtered = users.filter(u => u.id !== id);
    this.saveUsers(filtered);
    return true;
  },

  resetPassword(userId: string, newPass: string): boolean {
    const users = [...this.getUsers()];
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return false;
    users[idx] = { ...users[idx], password: newPass };
    this.saveUsers(users);
    return true;
  },

  // WAREHOUSES
  getWarehouses(): Warehouse[] {
    this.ensureInitialized();
    return getItem<Warehouse[]>(STORAGE_KEYS.WAREHOUSES, []);
  },

  saveWarehouses(whs: Warehouse[]): void {
    setItem(STORAGE_KEYS.WAREHOUSES, whs);
  },

  addWarehouse(wh: Omit<Warehouse, 'id' | 'createdAt'>): Warehouse {
    const whs = [...this.getWarehouses()];
    const newWh: Warehouse = {
      ...wh,
      id: `wh-${Date.now()}`,
      createdAt: new Date().toISOString()
    };
    whs.push(newWh);
    this.saveWarehouses(whs);
    return newWh;
  },

  updateWarehouse(id: string, updates: Partial<Warehouse>): Warehouse | null {
    const whs = [...this.getWarehouses()];
    const idx = whs.findIndex(w => w.id === id);
    if (idx === -1) return null;
    whs[idx] = { ...whs[idx], ...updates };
    this.saveWarehouses(whs);
    return whs[idx];
  },

  deleteWarehouse(id: string): boolean {
    const whs = this.getWarehouses();
    const filtered = whs.filter(w => w.id !== id);
    this.saveWarehouses(filtered);
    return true;
  },

  // MATERIALS
  getMaterials(): MaterialItem[] {
    this.ensureInitialized();
    return getItem<MaterialItem[]>(STORAGE_KEYS.MATERIALS, []);
  },

  saveMaterials(mats: MaterialItem[]): void {
    setItem(STORAGE_KEYS.MATERIALS, mats);
  },

  addMaterial(mat: Omit<MaterialItem, 'id'>): MaterialItem {
    const mats = [...this.getMaterials()];
    const newMat: MaterialItem = {
      ...mat,
      id: `mat-${Date.now()}`
    };
    mats.push(newMat);
    this.saveMaterials(mats);
    return newMat;
  },

  updateMaterial(id: string, updates: Partial<MaterialItem>): MaterialItem | null {
    const mats = [...this.getMaterials()];
    const idx = mats.findIndex(m => m.id === id);
    if (idx === -1) return null;
    mats[idx] = { ...mats[idx], ...updates };
    this.saveMaterials(mats);
    return mats[idx];
  },

  deleteMaterial(id: string): boolean {
    const mats = this.getMaterials();
    const filtered = mats.filter(m => m.id !== id);
    this.saveMaterials(filtered);
    return true;
  },

  deleteMaterials(ids: string[]): number {
    const idSet = new Set(ids);
    const mats = this.getMaterials();
    const filtered = mats.filter(m => !idSet.has(m.id));
    const deletedCount = mats.length - filtered.length;
    this.saveMaterials(filtered);
    return deletedCount;
  },

  deleteAllMaterials(): number {
    const count = this.getMaterials().length;
    this.saveMaterials([]);
    return count;
  },

  // O(N) Import danh mục vật tư dùng Map thay vì findIndex O(N^2)
  importMaterials(imported: Partial<MaterialItem>[], mode: 'upsert' | 'skip' = 'upsert'): { added: number; updated: number } {
    const materials = [...this.getMaterials()];
    const codeIndexMap = new Map<string, number>();
    for (let i = 0; i < materials.length; i++) {
      codeIndexMap.set(materials[i].code.toUpperCase(), i);
    }

    let added = 0;
    let updated = 0;
    const baseTs = Date.now();

    for (let i = 0; i < imported.length; i++) {
      const item = imported[i];
      const trimmedCode = (item.code || '').trim().toUpperCase();
      const trimmedName = (item.name || '').trim();
      if (!trimmedCode && !trimmedName) continue;

      const code = trimmedCode || `VT-${trimmedName.slice(0, 6).toUpperCase().replace(/\s+/g, '')}`;
      const existingIdx = codeIndexMap.get(code);

      if (existingIdx !== undefined) {
        if (mode === 'upsert') {
          const prev = materials[existingIdx];
          materials[existingIdx] = {
            ...prev,
            name: trimmedName || prev.name,
            unit: (item.unit || '').trim() || prev.unit || 'Bộ',
            category: (item.category || '').trim() || prev.category || 'Chung',
            drawingNo: (item.drawingNo || '').trim() || prev.drawingNo || '',
            manufacturer: (item.manufacturer || '').trim() || prev.manufacturer || '',
            supplier: (item.supplier || '').trim() || prev.supplier || '',
            unitWeightKg: item.unitWeightKg !== undefined && !isNaN(Number(item.unitWeightKg)) ? Number(item.unitWeightKg) : prev.unitWeightKg,
            specification: (item.specification || '').trim() || prev.specification || '',
            minStockAlert: item.minStockAlert !== undefined && !isNaN(Number(item.minStockAlert)) ? Number(item.minStockAlert) : prev.minStockAlert,
            notes: (item.notes || '').trim() || prev.notes || ''
          };
          updated++;
        }
      } else {
        const newIdx = materials.length;
        materials.push({
          id: `mat-${baseTs}-${i}`,
          code,
          name: trimmedName || code,
          unit: (item.unit || '').trim() || 'Bộ',
          category: (item.category || '').trim() || 'Chung',
          drawingNo: (item.drawingNo || '').trim() || '',
          manufacturer: (item.manufacturer || '').trim() || '',
          supplier: (item.supplier || '').trim() || '',
          unitWeightKg: Number(item.unitWeightKg) || 0,
          specification: (item.specification || '').trim() || '',
          minStockAlert: Number(item.minStockAlert) || 0,
          notes: (item.notes || '').trim() || ''
        });
        codeIndexMap.set(code, newIdx);
        added++;
      }
    }

    this.saveMaterials(materials);
    return { added, updated };
  },

  // INBOUND RECEIPTS
  getInboundReceipts(): InboundReceipt[] {
    this.ensureInitialized();
    const inbounds = getItem<InboundReceipt[]>(STORAGE_KEYS.INBOUND, []);
    const deletedList = getItem<string[]>(STORAGE_KEYS.DELETED_INBOUND, []);
    if (deletedList.length === 0) return inbounds;
    const deletedIds = new Set(deletedList);
    return inbounds.filter(r => !deletedIds.has(r.id) && !deletedIds.has(r.receiptCode));
  },

  saveInboundReceipts(inbounds: InboundReceipt[]): void {
    const deletedList = getItem<string[]>(STORAGE_KEYS.DELETED_INBOUND, []);
    if (deletedList.length === 0) {
      setItem(STORAGE_KEYS.INBOUND, inbounds);
      return;
    }
    const deletedIds = new Set(deletedList);
    const clean = inbounds.filter(r => !deletedIds.has(r.id) && !deletedIds.has(r.receiptCode));
    setItem(STORAGE_KEYS.INBOUND, clean);
  },

  addInboundReceipt(rcp: InboundReceipt): void {
    this.addInboundReceipts([rcp]);
  },

  // O(N) thêm hàng loạt phiếu nhập & đồng bộ danh mục vật tư với 100.000+ dòng
  addInboundReceipts(rcps: InboundReceipt[]): { addedCount: number; newMaterialsCount: number } {
    if (rcps.length === 0) return { addedCount: 0, newMaterialsCount: 0 };

    let deletedIds = getItem<string[]>(STORAGE_KEYS.DELETED_INBOUND, []);
    if (deletedIds.length > 0) {
      const rcpIds = new Set<string>();
      for (let i = 0; i < rcps.length; i++) {
        rcpIds.add(rcps[i].id);
        rcpIds.add(rcps[i].receiptCode);
      }
      deletedIds = deletedIds.filter(id => !rcpIds.has(id));
      setItem(STORAGE_KEYS.DELETED_INBOUND, deletedIds);
    }

    const existingInbounds = this.getInboundReceipts();
    const updatedInbounds = [...rcps, ...existingInbounds];
    this.saveInboundReceipts(updatedInbounds);

    // Tự động bổ sung mã vật tư mới vào danh mục bằng Hash Set O(1)
    const currentMaterials = [...this.getMaterials()];
    const existingMatCodes = new Set<string>();
    for (let i = 0; i < currentMaterials.length; i++) {
      existingMatCodes.add(currentMaterials[i].code.toUpperCase());
    }

    let newMaterialsCount = 0;
    const baseTs = Date.now();

    for (let rIdx = 0; rIdx < rcps.length; rIdx++) {
      const rcp = rcps[rIdx];
      const items = rcp.items;
      for (let iIdx = 0; iIdx < items.length; iIdx++) {
        const item = items[iIdx];
        const rawCode = (item.materialCode || '').trim();
        const rawName = (item.materialName || '').trim();
        if (!rawCode && !rawName) continue;

        const code = (rawCode || `VT-${rawName.slice(0, 6).toUpperCase().replace(/\s+/g, '')}`).toUpperCase();
        if (!existingMatCodes.has(code)) {
          existingMatCodes.add(code);
          const qty = Number(item.quantity) || 1;
          const weight = Number(item.weightKg) || 0;
          currentMaterials.push({
            id: `mat-auto-${baseTs}-${newMaterialsCount}`,
            code,
            name: rawName || code,
            unit: (item.unit || '').trim() || 'Bộ',
            category: (item.category || '').trim() || 'Chung',
            drawingNo: (item.drawingNo || '').trim() || '',
            manufacturer: (item.manufacturer || '').trim() || '',
            supplier: (item.supplier || '').trim() || '',
            unitWeightKg: weight && qty ? Math.round((weight / qty) * 100) / 100 : 0,
            specification: item.conditionNote || '',
            minStockAlert: 2,
            notes: `Tự động tạo từ phiếu nhập kho ${rcp.receiptCode} (${item.packingListNo || 'PL'})`
          });
          newMaterialsCount++;
        }
      }
    }

    if (newMaterialsCount > 0) {
      this.saveMaterials(currentMaterials);
    }

    return { addedCount: rcps.length, newMaterialsCount };
  },

  deleteInboundReceipt(id: string): boolean {
    const deletedIds = [...getItem<string[]>(STORAGE_KEYS.DELETED_INBOUND, [])];
    if (!deletedIds.includes(id)) {
      deletedIds.push(id);
      setItem(STORAGE_KEYS.DELETED_INBOUND, deletedIds);
    }

    const inbounds = this.getInboundReceipts();
    const filtered = inbounds.filter(i => i.id !== id && i.receiptCode !== id);
    setItem(STORAGE_KEYS.INBOUND, filtered);
    return true;
  },

  // OUTBOUND RECEIPTS
  getOutboundReceipts(): OutboundReceipt[] {
    this.ensureInitialized();
    const outbounds = getItem<OutboundReceipt[]>(STORAGE_KEYS.OUTBOUND, []);
    const deletedList = getItem<string[]>(STORAGE_KEYS.DELETED_OUTBOUND, []);
    if (deletedList.length === 0) return outbounds;
    const deletedIds = new Set(deletedList);
    return outbounds.filter(o => !deletedIds.has(o.id) && !deletedIds.has(o.issueCode));
  },

  saveOutboundReceipts(outbounds: OutboundReceipt[]): void {
    const deletedList = getItem<string[]>(STORAGE_KEYS.DELETED_OUTBOUND, []);
    if (deletedList.length === 0) {
      setItem(STORAGE_KEYS.OUTBOUND, outbounds);
      return;
    }
    const deletedIds = new Set(deletedList);
    const clean = outbounds.filter(o => !deletedIds.has(o.id) && !deletedIds.has(o.issueCode));
    setItem(STORAGE_KEYS.OUTBOUND, clean);
  },

  addOutboundReceipt(rcp: OutboundReceipt): void {
    this.addOutboundReceipts([rcp]);
  },

  addOutboundReceipts(rcps: OutboundReceipt[]): { addedCount: number } {
    if (rcps.length === 0) return { addedCount: 0 };

    let deletedIds = getItem<string[]>(STORAGE_KEYS.DELETED_OUTBOUND, []);
    if (deletedIds.length > 0) {
      const rcpIds = new Set<string>();
      for (let i = 0; i < rcps.length; i++) {
        rcpIds.add(rcps[i].id);
        rcpIds.add(rcps[i].issueCode);
      }
      deletedIds = deletedIds.filter(id => !rcpIds.has(id));
      setItem(STORAGE_KEYS.DELETED_OUTBOUND, deletedIds);
    }

    const existingOutbounds = this.getOutboundReceipts();
    const updatedOutbounds = [...rcps, ...existingOutbounds];
    this.saveOutboundReceipts(updatedOutbounds);
    return { addedCount: rcps.length };
  },

  deleteOutboundReceipt(id: string): boolean {
    const deletedIds = [...getItem<string[]>(STORAGE_KEYS.DELETED_OUTBOUND, [])];
    if (!deletedIds.includes(id)) {
      deletedIds.push(id);
      setItem(STORAGE_KEYS.DELETED_OUTBOUND, deletedIds);
    }

    const outbounds = this.getOutboundReceipts();
    const filtered = outbounds.filter(o => o.id !== id && o.issueCode !== id);
    setItem(STORAGE_KEYS.OUTBOUND, filtered);
    return true;
  },

  // Đảm bảo cache tồn kho gốc luôn mới nhất (O(1) nếu dữ liệu không đổi)
  ensureBaseInventoryCache(): InventoryStockRecord[] {
    if (cachedBaseVersion === inventoryVersion) {
      return cachedBaseRecords;
    }

    const inbounds = this.getInboundReceipts();
    const outbounds = this.getOutboundReceipts();
    const warehouses = this.getWarehouses();

    const whMap = new Map<string, string>();
    for (let i = 0; i < warehouses.length; i++) {
      whMap.set(warehouses[i].id, warehouses[i].name);
    }

    const records = buildAggregatedRecords(inbounds, outbounds, whMap);

    // Precompute filter options (giới hạn 150 gợi ý mỗi loại cho datalist để không gây lag DOM)
    const plSet = new Set<string>();
    const shpSet = new Set<string>();
    const makerSet = new Set<string>();
    const supSet = new Set<string>();
    const catSet = new Set<string>();

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (r.packingListNo && r.packingListNo !== 'N/A') plSet.add(r.packingListNo);
      if (r.shipment && r.shipment !== 'N/A') shpSet.add(r.shipment);
      if (r.manufacturer && r.manufacturer !== 'N/A') makerSet.add(r.manufacturer);
      if (r.supplier && r.supplier !== 'N/A') supSet.add(r.supplier);
      if (r.category && r.category !== 'N/A') catSet.add(r.category);
    }

    const takeFirst = (set: Set<string>, limit: number): string[] => {
      const out: string[] = [];
      for (const val of set) {
        out.push(val);
        if (out.length >= limit) break;
      }
      return out;
    };

    cachedBaseRecords = records;
    cachedFilterOptions = {
      availablePLs: takeFirst(plSet, 150),
      availableShipments: takeFirst(shpSet, 150),
      availableMakers: takeFirst(makerSet, 150),
      availableSuppliers: takeFirst(supSet, 150),
      availableCategories: takeFirst(catSet, 150),
      totalPLCount: plSet.size,
      totalShipmentCount: shpSet.size
    };
    cachedBaseVersion = inventoryVersion;

    return cachedBaseRecords;
  },

  getInventoryFilterOptions() {
    this.ensureBaseInventoryCache();
    return cachedFilterOptions;
  },

  // TÍNH TOÁN TỒN KHO & BÁO CÁO NHẬP - XUẤT - TỒN (NXT) TỐI ƯU CHO 100.000+ DÒNG
  calculateInventoryRecords(filter?: StockFilterParams): InventoryStockRecord[] {
    let baseRecords: InventoryStockRecord[];

    if (filter?.startDate || filter?.endDate) {
      const inbounds = this.getInboundReceipts();
      const outbounds = this.getOutboundReceipts();
      const warehouses = this.getWarehouses();
      const whMap = new Map<string, string>();
      for (let i = 0; i < warehouses.length; i++) {
        whMap.set(warehouses[i].id, warehouses[i].name);
      }
      baseRecords = buildAggregatedRecords(inbounds, outbounds, whMap, filter.startDate, filter.endDate);
    } else {
      baseRecords = this.ensureBaseInventoryCache();
    }

    if (!filter) return baseRecords;

    const whId = filter.warehouseId && filter.warehouseId !== 'all' ? filter.warehouseId : '';
    const plQ = filter.packingListNo && filter.packingListNo !== 'all' ? filter.packingListNo.toLowerCase().trim() : '';
    const shpQ = filter.shipment && filter.shipment !== 'all' ? filter.shipment.toLowerCase().trim() : '';
    const makerQ = filter.manufacturer && filter.manufacturer !== 'all' ? filter.manufacturer.toLowerCase().trim() : '';
    const supQ = filter.supplier && filter.supplier !== 'all' ? filter.supplier.toLowerCase().trim() : '';
    const pkgNoQ = filter.packageNo && filter.packageNo !== 'all' ? filter.packageNo.toLowerCase().trim() : '';
    const pkgNameQ = filter.packageName && filter.packageName !== 'all' ? filter.packageName.toLowerCase().trim() : '';
    const catQ = filter.category && filter.category !== 'all' ? filter.category.toLowerCase().trim() : '';
    const dwgQ = filter.drawingNo && filter.drawingNo !== 'all' ? filter.drawingNo.toLowerCase().trim() : '';
    const searchQ = filter.searchQuery ? filter.searchQuery.toLowerCase().trim() : '';

    if (!whId && !plQ && !shpQ && !makerQ && !supQ && !pkgNoQ && !pkgNameQ && !catQ && !dwgQ && !searchQ) {
      return baseRecords;
    }

    const result: InventoryStockRecord[] = [];
    for (let i = 0; i < baseRecords.length; i++) {
      const r = baseRecords[i];
      if (whId && r.warehouseId !== whId) continue;
      if (plQ && !r.packingListNo.toLowerCase().includes(plQ)) continue;
      if (shpQ && !r.shipment.toLowerCase().includes(shpQ)) continue;
      if (makerQ && !r.manufacturer.toLowerCase().includes(makerQ)) continue;
      if (supQ && !r.supplier.toLowerCase().includes(supQ)) continue;
      if (pkgNoQ && !r.packageNo.toLowerCase().includes(pkgNoQ)) continue;
      if (pkgNameQ && !r.packageName.toLowerCase().includes(pkgNameQ)) continue;
      if (catQ && !r.category.toLowerCase().includes(catQ)) continue;
      if (dwgQ && !r.drawingNo.toLowerCase().includes(dwgQ)) continue;
      if (searchQ) {
        const hit =
          r.materialName.toLowerCase().includes(searchQ) ||
          r.materialCode.toLowerCase().includes(searchQ) ||
          r.packingListNo.toLowerCase().includes(searchQ) ||
          r.shipment.toLowerCase().includes(searchQ) ||
          r.packageName.toLowerCase().includes(searchQ) ||
          r.packageNo.toLowerCase().includes(searchQ) ||
          r.drawingNo.toLowerCase().includes(searchQ) ||
          r.category.toLowerCase().includes(searchQ) ||
          r.manufacturer.toLowerCase().includes(searchQ) ||
          r.supplier.toLowerCase().includes(searchQ);
        if (!hit) continue;
      }
      result.push(r);
    }

    return result;
  },

  // Reset về dữ liệu gốc (cả IndexedDB và localStorage)
  async resetToDefault(): Promise<void> {
    memoryCache.clear();
    await idbClear();
    try {
      localStorage.removeItem(SEED_FLAG_KEY);
      Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
    } catch {
      // ignore
    }
    this.ensureInitialized();
    await this.flush();
    inventoryVersion++;
  }
};
