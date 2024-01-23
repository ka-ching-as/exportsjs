export declare class CSVExport {
    elements: any;
    configuration: any;
    itemType: string;
    separator: string;
    delimiter: string;
    constructor(configuration: any, elementDict: any);
    private escape;
    private formatNumber;
    private removeNewLines;
    private outputHeaders;
    private outputRows;
    private outputRowsForRegisterStatement;
    private outputRowForRegisterStatement;
    private outputRowShared;
    private outputRowsForSale;
    private typeForSale;
    private outputRowForSale;
    private setInfoOnB2BCustomer;
    export(): string;
}
