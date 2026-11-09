import { InventoryItem, MaterialCategory, Transaction, User, Warehouse } from '../types/inventory';

export const INITIAL_WAREHOUSES: Warehouse[] = [
  {
    id: 'WH-01',
    code: 'KHO-01',
    name: 'Kho Tổng Trung Tâm',
    address: 'Trụ sở chính PTSC',
    manager: 'Quản trị viên',
    status: 'ACTIVE',
  },
];

export const INITIAL_CATEGORIES: MaterialCategory[] = [
  {
    id: 'CAT-DM-CD',
    code: 'DM-CD',
    name: 'Cơ điện & Vật tư công trình',
    description: 'Dây cáp điện, tủ điện, phụ kiện đấu nối và vật tư cơ điện công trình',
    createdAt: '2026-01-01 08:00',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'CAT-DM-CK',
    code: 'DM-CK',
    name: 'Cơ khí & Kết cấu thép',
    description: 'Ống thép, mặt bích, bu lông cường độ cao, que hàn và phụ kiện đường ống',
    createdAt: '2026-01-01 08:00',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'CAT-DM-TB',
    code: 'DM-TB',
    name: 'Thiết bị & Máy móc thi công',
    description: 'Máy hàn, máy phát điện, thiết bị đo kiểm, nâng hạ phục vụ dự án',
    createdAt: '2026-01-01 08:00',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'CAT-DM-CC',
    code: 'DM-CC',
    name: 'Công cụ & Dụng cụ cầm tay',
    description: 'Bộ đồ nghề cơ khí, máy mài, máy khoan cầm tay, dụng cụ lắp đặt',
    createdAt: '2026-01-01 08:00',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'CAT-DM-AT',
    code: 'DM-AT',
    name: 'An toàn & Bảo hộ lao động',
    description: 'Trang thiết bị BHLĐ, dây đai an toàn, bình chữa cháy, biển cảnh báo',
    createdAt: '2026-01-01 08:00',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

export const INITIAL_ITEMS: InventoryItem[] = [];

export const INITIAL_TRANSACTIONS: Transaction[] = [];

export const INITIAL_USERS: User[] = [
  {
    id: 'USR-ADMIN-VODUONGPHU',
    username: 'voduongphu@gmail.com',
    fullName: 'Võ Dương Phú (Admin)',
    role: 'ADMIN',
    email: 'voduongphu@gmail.com',
    phone: '0901.156.220',
    assignedWarehouseId: 'ALL',
    status: 'ACTIVE',
    createdAt: '2026-01-01 08:00',
    authProvider: 'google',
  },
  {
    id: 'USR-ADMIN',
    username: 'admin',
    password: 'admin123',
    fullName: 'Quản Trị Viên (Dự phòng)',
    role: 'ADMIN',
    email: 'voduongphu@gmail.com',
    phone: '0901.156.220',
    assignedWarehouseId: 'ALL',
    status: 'ACTIVE',
    createdAt: '2026-01-01 08:00',
    authProvider: 'local',
  },
];
