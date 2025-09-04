// import type { Tenant } from "./tenant.model";
//
// export class TenantValidator {
//   validateCreate(input: any): Omit<Tenant, "id" | "createdAt" | "updatedAt"> {
//     if (!input || typeof input !== "object") throw new Error("Invalid payload");
//     if (!input.name || typeof input.name !== "string") throw new Error("name is required");
//     if (!input.email || typeof input.email !== "string") throw new Error("email is required");
//     return {
//       name: input.name.trim(),
//       email: input.email.trim().toLowerCase(),
//       isActive: Boolean(input.isActive ?? false),
//     };
//   }
//
//   validateUpdate(input: any): Partial<Pick<Tenant, "name" | "email" | "isActive">> {
//     if (!input || typeof input !== "object") throw new Error("Invalid payload");
//     const patch: Partial<Pick<Tenant, "name" | "email" | "isActive">> = {};
//     if (input.name !== undefined) {
//       if (typeof input.name !== "string") throw new Error("name must be string");
//       patch.name = input.name.trim();
//     }
//     if (input.email !== undefined) {
//       if (typeof input.email !== "string") throw new Error("email must be string");
//       patch.email = input.email.trim().toLowerCase();
//     }
//     if (input.isActive !== undefined) {
//       patch.isActive = Boolean(input.isActive);
//     }
//     return patch;
//   }
// }
