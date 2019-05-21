"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
const parsefullname = require("parse-full-name");
const request = require("request-promise");
const SkipExport_1 = require("./SkipExport");
var TaxType;
(function (TaxType) {
    TaxType["VAT"] = "vat";
    TaxType["SALES_TAX"] = "sales_tax";
})(TaxType || (TaxType = {}));
class ShopifyTransform {
    constructor(configuration, data) {
        this.data = data;
        this.configuration = configuration;
    }
    exportSale() {
        return __awaiter(this, void 0, void 0, function* () {
            this.validateSalesConfiguration(this.configuration);
            this.validateSale(this.data);
            const sale = this.data;
            const locationId = this.configuration.location_id_map[sale.source.shop_id];
            if (_.isNil(locationId)) {
                throw new Error(`Unknown stock location id ${sale.source.shop_id} - couldn't resolve shopify location id`);
            }
            const order = {
                currency: sale.base_currency_code,
                location_id: Number(locationId)
            };
            if (sale.summary.customer && sale.summary.customer.identifier) {
                order.customer = { id: Number(sale.summary.customer.identifier) };
            }
            if (this.configuration.tax_type === TaxType.VAT) {
                order.taxes_included = true;
            }
            else {
                order.taxes_included = false;
            }
            if (sale.comment) {
                order.note_attributes = [{
                        name: "Basket comment",
                        value: sale.comment
                    }];
            }
            const shippingLine = this.shippingLines(sale)[0];
            const shipping = shippingLine.behavior.shipping;
            const shippingAddress = shipping.address;
            const shippingCustomerInfo = shipping.customer_info;
            const parsedName = parsefullname.parseFullName(shippingAddress.name);
            const shopifyShipping = {};
            shopifyShipping.first_name = parsedName.first || "";
            shopifyShipping.last_name = parsedName.last || "";
            shopifyShipping.address1 = shippingAddress.street;
            shopifyShipping.city = shippingAddress.city;
            shopifyShipping.zip = shippingAddress.postal_code;
            if (shippingAddress.country_code) {
                shopifyShipping.country_code = shippingAddress.country_code || this.configuration.default_country_code;
            }
            shopifyShipping.phone = shippingCustomerInfo.phone;
            if (shipping.method_id) {
                const shopifyShippingLine = {
                    code: shipping.method_id,
                    price: shippingLine.total,
                    title: shipping.method_id
                };
                const taxes = this.shopifyTaxLines(shippingLine.takes);
                if (taxes.length > 0) {
                    shopifyShippingLine.tax_lines = taxes;
                }
                order.shipping_lines = [shopifyShippingLine];
            }
            order.shipping_address = shopifyShipping;
            order.email = shippingCustomerInfo.email;
            const shopifyLineItems = [];
            for (const lineItem of this.ecommerceLines(sale)) {
                let variantId = lineItem.variant_id;
                if (_.isNil(variantId)) {
                    try {
                        const shopifyProduct = yield this.shopifyProduct(lineItem.id, this.configuration);
                        if (shopifyProduct &&
                            shopifyProduct.product &&
                            shopifyProduct.product.variants &&
                            shopifyProduct.product.variants[0] &&
                            shopifyProduct.product.variants[0].id) {
                            variantId = `${shopifyProduct.product.variants[0].id}`;
                        }
                    }
                    catch (error) {
                        console.info(`Got error when trying to get variant with id ${lineItem.id} from Shopify: ${error.toString()}`);
                    }
                }
                if (!variantId) {
                    throw new Error(`Couldn't find variant id in Shopify for product id ${lineItem.id}`);
                }
                const shopifyLineItem = {
                    price: lineItem.total,
                    quantity: lineItem.quantity,
                    variant_id: Number(variantId)
                };
                const taxes = this.shopifyTaxLines(shopifyLineItem.takes);
                if (taxes.length > 0) {
                    shopifyLineItem.tax_lines = taxes;
                }
                shopifyLineItems.push(shopifyLineItem);
            }
            order.line_items = shopifyLineItems;
            order.financial_status = "paid";
            return { order: order };
        });
    }
    exportStockEvent() {
        return __awaiter(this, void 0, void 0, function* () {
            this.validateStockConfiguration(this.configuration);
            if (_.isNil(this.data.stock_location_id)) {
                throw new Error("Missing stock location id");
            }
            const locationId = this.configuration.location_id_map[this.data.stock_location_id];
            if (_.isNil(locationId)) {
                throw new Error(`Unknown stock location id ${this.data.stock_location_id} - couldn't resolve shopify location id`);
            }
            const productId = this.data.product_id;
            if (_.isNil(productId)) {
                throw new Error("Missing product id");
            }
            if (_.isNaN(Number(productId))) {
                throw new SkipExport_1.SkipExport(`SkipExport - Non compatible Shopify id ${productId}`);
            }
            const inventoryItemId = yield this.inventoryItemId(productId, this.data.variant_id, this.configuration);
            if (_.isNil(inventoryItemId)) {
                throw new Error(`Failed to find inventory item id from product id ${productId} and variant id ${this.data.variant_id}`);
            }
            const result = {
                location_id: Number(locationId),
                inventory_item_id: Number(inventoryItemId),
            };
            const adjustment = this.data.adjustment;
            const newStockCount = this.data.new_stock_value;
            if (!_.isNil(adjustment)) {
                result.available_adjustment = adjustment;
            }
            else if (!_.isNil(newStockCount)) {
                result.available = newStockCount;
            }
            else {
                throw new Error(`Unhandled stock adjustment for stock event: ${this.data ? JSON.stringify(this.data) : this.data}`);
            }
            return result;
        });
    }
    inventoryItemId(productId, variantId, configuration) {
        return __awaiter(this, void 0, void 0, function* () {
            let inventoryItemId = undefined;
            if (!_.isNil(variantId)) {
                const url = `https://${configuration.shopify_id}.myshopify.com/admin/api/2019-04/variants/${variantId}.json`;
                try {
                    const shopifyVariantResult = yield request.get(url, this.shopifyRequestOptions(configuration));
                    if (shopifyVariantResult &&
                        shopifyVariantResult.variant &&
                        shopifyVariantResult.variant.inventory_item_id) {
                        inventoryItemId = `${shopifyVariantResult.variant.inventory_item_id}`;
                    }
                }
                catch (error) {
                    console.info(`Got error when trying to get variant with id ${variantId} from Shopify: ${error.toString()}`);
                }
            }
            else {
                try {
                    const shopifyProductResult = yield this.shopifyProduct(productId, configuration);
                    if (shopifyProductResult &&
                        shopifyProductResult.product &&
                        shopifyProductResult.product.variants &&
                        shopifyProductResult.product.variants[0] &&
                        shopifyProductResult.product.variants[0].inventory_item_id) {
                        inventoryItemId = `${shopifyProductResult.product.variants[0].inventory_item_id}`;
                    }
                }
                catch (error) {
                    console.info(`Got error when trying to get product with id ${productId} from Shopify: ${error.toString()}`);
                }
            }
            return inventoryItemId;
        });
    }
    shopifyProduct(productId, configuration) {
        return __awaiter(this, void 0, void 0, function* () {
            const url = `https://${configuration.shopify_id}.myshopify.com/admin/api/2019-04/products/${productId}.json`;
            return yield request.get(url, this.shopifyRequestOptions(configuration));
        });
    }
    shopifyRequestOptions(configuration) {
        const base64 = new Buffer(`${configuration.api_key}:${configuration.password}`).toString("base64");
        const basicAuthValue = `Basic ${base64}`;
        const options = {
            headers: {
                Authorization: basicAuthValue
            },
            json: true
        };
        return options;
    }
    shopifyTaxLines(taxes) {
        const result = (taxes || []).map((tax) => {
            return {
                price: tax.amount,
                rate: tax.rate,
                title: tax.name
            };
        });
        return result;
    }
    ecommerceLines(sale) {
        return (sale.summary.line_items || []).filter((line) => {
            const behavior = line.behavior || {};
            return !_.isNil(line.ecom_id) && _.isNil(behavior.shipping);
        });
    }
    shippingLines(sale) {
        return (sale.summary.line_items || []).filter((line) => {
            const behavior = line.behavior || {};
            return !_.isNil(behavior.shipping);
        });
    }
    validateSalesConfiguration(configuration) {
        if (_.isNil(configuration.api_key) || typeof (configuration.api_key) !== "string") {
            throw new Error("shopify api key is missing from configuration");
        }
        if (_.isNil(configuration.password) || typeof (configuration.password) !== "string") {
            throw new Error("shopify password is missing from configuration");
        }
        if (_.isNil(configuration.shopify_id) || typeof (configuration.shopify_id) !== "string") {
            throw new Error("shopify shop id is missing from configuration");
        }
        if (_.isNil(configuration.tax_type) || typeof (configuration.tax_type) !== "string" || (configuration.tax_type !== TaxType.VAT && configuration.tax_type !== TaxType.SALES_TAX)) {
            throw new Error("tax_type is invalid in configuration - must be present and either 'vat' or 'sales_tax'");
        }
        if (_.isNil(configuration.default_country_code) || typeof (configuration.default_country_code) !== "string") {
            throw new Error("default_country_code is missing from configuration");
        }
        if (_.isNil(configuration.location_id_map) || typeof (configuration.location_id_map) !== "object") {
            throw new Error("shopify location_id_map is missing from configuration");
        }
    }
    validateStockConfiguration(configuration) {
        if (_.isNil(configuration.api_key) || typeof (configuration.api_key) !== "string") {
            throw new Error("shopify api key is missing from configuration");
        }
        if (_.isNil(configuration.password) || typeof (configuration.password) !== "string") {
            throw new Error("shopify password is missing from configuration");
        }
        if (_.isNil(configuration.shopify_id) || typeof (configuration.shopify_id) !== "string") {
            throw new Error("shopify shop id is missing from configuration");
        }
        if (_.isNil(configuration.location_id_map) || typeof (configuration.location_id_map) !== "object") {
            throw new Error("shopify location_id_map is missing from configuration");
        }
    }
    validateSale(sale) {
        if (sale.voided || sale.summary.is_return) {
            throw new Error(`Sale is either voided ${sale.voided} or is return ${sale.is_return}`);
        }
        const ecomLineItems = this.ecommerceLines(sale);
        if (ecomLineItems.length === 0) {
            throw new Error(`No ecommerce line items on sale`);
        }
        const ecomLineItemsWithoutProductId = ecomLineItems.filter((line) => { return !_.isNil(line.id); });
        if (ecomLineItemsWithoutProductId.length !== ecomLineItems.length) {
            throw new Error(`1 or more ecommerce lines are missing product id`);
        }
        const shippingLines = this.shippingLines(sale);
        if (shippingLines.length !== 1) {
            throw new Error(`Invalid number of shipping lines on sale ${shippingLines.length}`);
        }
    }
}
exports.ShopifyTransform = ShopifyTransform;
//# sourceMappingURL=ShopifyTransform.js.map