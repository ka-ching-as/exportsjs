export declare class CSVExport {
    elements: any;
    configuration: any;
    itemType: string;
    separator: string;
    delimiter: string;
    constructor(configuration: any, elements: any);
    escape(value: string): string;
    formatNumber(value: string): string;
    outputHeaders(columns: any[]): string;
    resolve(object: any, keypath: string): any;
    parametrizeString(string: string, object: any): string;
    evaluate(expression: string, object: any): string;
    outputRows(row: any, columns: any, element: any): string[];
    outputRowsForRegisterStatement(row: any, columns: any, statement: any): string[];
    outputRowForRegisterStatement(row: any, columns: any, statement: any): string | null;
    outputRowShared(row: any, columns: any, element: any, aggregates: any, overrides: any, count: number): string | null;
    outputRowsForSale(row: any, columns: any, sale: any): string[];
    outputRowForSale(row: any, columns: any, sale: any, filter?: any): string | null;
    export(): string;
}
