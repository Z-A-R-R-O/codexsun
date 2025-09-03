// apps/cxsun/src/user/user.validator.ts
import {
    IValidator,
    strType,
    boolType,
    emailType,
    hashedType,
    makeEmail,
    hashPassword,
} from "../../../../../cortex/core/IValidator";

export interface UserCreateInput {
    name: strType;
    email: emailType;
    password?: hashedType;
    is_active: boolType;
}

export interface UserUpdateInput {
    name?: strType;
    email?: emailType;
    password?: hashedType;
    is_active?: boolType;
}

export class UserValidator extends IValidator<UserCreateInput, UserUpdateInput> {
    validateCreate(data: any): UserCreateInput {
        return {
            name: this.requireString("Name", data?.name) as strType,
            email: makeEmail(this.requireString("Email", data?.email)) as emailType,
            password: data?.password
                ? (hashPassword(data.password) as hashedType)
                : undefined,
            is_active: typeof data?.is_active === "boolean" ? data.is_active : true,
        };
    }

    validateUpdate(data: any): UserUpdateInput {
        return {
            name: this.optionalString("Name", data?.name) as strType | undefined,
            email: data?.email ? (makeEmail(data.email) as emailType) : undefined,
            password: data?.password
                ? (hashPassword(data.password) as hashedType)
                : undefined,
            is_active:
                typeof data?.is_active === "boolean"
                    ? (data.is_active as boolType)
                    : undefined,
        };
    }
}
