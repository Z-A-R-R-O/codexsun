// apps/user/User.model.ts
import {Model as M} from "../../../../../../cortex/core/old/model";

export class User extends M {
    public static table = "users";

    public id!: M.pkType;
    public name!: M.strType;
    public email!: M.emailType;
    public password!: M.hashedType;
    public is_active!: M.boolType;
    public created_at!: M.tzType;
    public updated_at!: M.tzType;

}
