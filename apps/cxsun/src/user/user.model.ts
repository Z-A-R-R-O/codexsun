import { Model } from "../../../../cortex/core/model";
import { PrimaryKey, Email as EmailType, Str, Bool, DateTime } from "../../../../cortex/core/types";
import { PrimaryKey as PK, Email, String, BooleanCol, DateTime as DateTimeCol } from "../../../../cortex/core/decorators";

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
}
