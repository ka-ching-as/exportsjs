export declare class ElasticSearchTransform {
    configuration: any;
    data: any;
    source: any;
    constructor(configuration: any, data: any, source: any);
    exportProduct(): any;
    getDocumentId(payload: any): string | undefined;
}
