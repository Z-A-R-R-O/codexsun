export class Validator {
    static isEmail(value: string): boolean {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }
}
