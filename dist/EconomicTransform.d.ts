interface Account {
    account: number;
    description: string;
}
export declare class EconomicTransform {
    data: any;
    configuration: any;
    constructor(configuration: any, data: any);
    lookupVatCode(rate: number, type: string, isIncoming?: boolean): string | undefined;
    accountLookup(paymentType: string, cardType?: string): Account;
    accountDiffLookup(paymentType: string, comment: string, subType?: string): Account;
    accountDepositLookup(paymentType: string): Account;
    accountGenericLookup(type: "sale" | "return" | "expense", expenseCode?: string): Account;
    localize(input: any, language: string | undefined): string;
    outgoingOrderExport(): any;
    saleExport(): any;
    registerCloseStatementExport(): any;
    private addVoucher;
    private addGenericVoucher;
    private addForeignCurrencyVoucher;
    private getReconciliation;
    private registerCloseStatementTotalsExport;
    private handleCashRounding;
    private handleReconciliation;
    private addGenericVouchers;
    private registerCloseStatementDiffExport;
}
export {};
