export declare class ShopifyTransform {
    data: any;
    configuration: any;
    constructor(configuration: any, data: any);
    exportSale(): Promise<any>;
    exportStockEvent(): Promise<any>;
    private inventoryItemId;
    private shopifyProduct;
    private shopifyRequestOptions;
    private shopifyTaxLines;
    private ecommerceLines;
    private nonEcommerceLines;
    private shippingLines;
    private validateSalesConfiguration;
    private validateStockConfiguration;
    private validateSale;
}
