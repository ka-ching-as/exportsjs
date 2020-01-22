declare class Searchable {
    barcode: string[];
    description: string[];
    id: string[];
    name: string[];
    constructor(product: any);
    addBarcodesFrom(product: any): void;
    addDescriptionFrom(product: any, descriptionKeys: string[]): void;
    addIdsFrom(product: any): void;
    addNamesFrom(product: any): void;
    validate(): void;
    toJSON(): any;
}
declare class Source {
    account: string;
    markets?: string[];
    shop?: string;
    constructor(source: any);
    validate(): void;
    toJSON(): any;
}
export declare class ElasticSearchProduct {
    id: string;
    raw: any;
    searchable: Searchable;
    source: Source;
    constructor(product: any, source: any);
    createDocumentId(product: any, source: Source): string;
    validate(): void;
    toJSON(): any;
}
export declare class ElasticSearchTransform {
    configuration: any;
    data: any;
    source: any;
    constructor(configuration: any, data: any, source: any);
    exportProduct(): any;
    getDocumentId(payload: any): string | undefined;
}
export {};
