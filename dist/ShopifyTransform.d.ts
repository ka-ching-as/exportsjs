export declare class ShopifyTransform {
    data: any;
    configuration: any;
    constructor(configuration: any, data: any);
    exportStockEvent(): Promise<any>;
    private validateStockConfiguration;
}
