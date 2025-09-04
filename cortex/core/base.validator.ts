export abstract class BaseValidator<T> {
    abstract validateCreate(input: any): T;
    abstract validateUpdate(input: any): Partial<T>;
}
