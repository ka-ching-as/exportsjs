export declare class SkipExport extends Error {
}
interface Account {
    account: number;
    description: string;
}
export declare class EconomicTransform {
    data: any;
    configuration: any;
    constructor(configuration: any, data: any);
    lookupVatCode(rate: number, type: string): string | undefined;
    accountLookup(paymentType: string): Account;
    accountDiffLookup(paymentType: string, comment: string): Account;
    accountDepositLookup(paymentType: string): Account;
    saleExport(): string;
    registerCloseStatementExport(): string;
}
export {};
