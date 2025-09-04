export interface Tenant {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: string; // ISO string for portability across engines
  updatedAt: string;
}
