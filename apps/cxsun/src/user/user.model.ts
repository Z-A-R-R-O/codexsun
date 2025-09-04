import { Model } from "../../../../cortex/core/old/model";
import {PrimaryKey, Email as EmailType, Str, Bool, DateTime, SoftDelete} from "../../../../cortex/core/types";
import { PrimaryKey as PK, Email, String, BooleanCol, DateTime as DateTimeCol, SoftDeleteCol } from "../../../../cortex/core/old/decorators";

export class User extends Model {
    public static table = "users";

    @PK()
    id!: PrimaryKey;

    @String()
    name!: Str;

    @Email()
    email!: EmailType;

    @String()
    password!: Str;

    @BooleanCol()
    is_active!: Bool;

    @DateTimeCol()
    created_at!: DateTime;

    @DateTimeCol()
    updated_at!: DateTime;

    @SoftDeleteCol()
    deleted_at!: SoftDelete;
}
