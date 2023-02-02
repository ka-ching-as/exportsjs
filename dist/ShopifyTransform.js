"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShopifyTransform = void 0;
const _ = require("lodash");
const parsefullname = require("parse-full-name");
const cross_fetch_1 = require("cross-fetch");
const SkipExport_1 = require("./SkipExport");
var TaxType;
(function (TaxType) {
    TaxType["VAT"] = "vat";
    TaxType["SALES_TAX"] = "sales_tax";
})(TaxType || (TaxType = {}));
const apiVersion = "2021-04";
class ShopifyTransform {
    constructor(configuration, data) {
        this.data = data;
        this.configuration = configuration;
    }
    async exportNewsletterSignup() {
        var _a, _b;
        this.validateNewsletterConfiguration();
        const signup = this.data;
        const url = `https://${this.configuration.shopify_id}.myshopify.com/admin/api/${apiVersion}/customers/search.json?query=email:${signup.email}`;
        const response = await cross_fetch_1.fetch(url, this.shopifyRequestOptions());
        const responseJson = await response.json();
        if (responseJson.customers.length > 0) {
            const existingCustomer = responseJson.customers[0];
            const customerId = existingCustomer.id;
            if (existingCustomer.accepts_marketing === true) {
                throw new SkipExport_1.SkipExport("Customer is already signed up for email marketing");
            }
            const update = {
                customer: {
                    id: customerId,
                    accepts_marketing: true
                }
            };
            const putUrl = `https://${this.configuration.shopify_id}.myshopify.com/admin/api/${apiVersion}/customers/${customerId}.json`;
            const options = this.shopifyRequestOptions();
            options.body = JSON.stringify(update);
            options.method = "PUT";
            await cross_fetch_1.fetch(putUrl, options);
            throw new SkipExport_1.SkipExport("Customer is updated through a PUT request");
        }
        const customer = {
            email: signup.email,
            first_name: (_a = signup.first_name) !== null && _a !== void 0 ? _a : "-",
            last_name: (_b = signup.last_name) !== null && _b !== void 0 ? _b : "-",
            accepts_marketing: true
        };
        return { customer: customer };
    }
    async exportSale() {
        var _a, _b, _c;
        this.validateSalesConfiguration();
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
            const customerId = Number(sale.summary.customer.identifier);
            order.customer = { id: customerId };
            const url = `https://${this.configuration.shopify_id}.myshopify.com/admin/api/${apiVersion}/customers/${customerId}.json`;
            try {
                const response = await cross_fetch_1.fetch(url, this.shopifyRequestOptions());
                const customerResult = await response.json();
                order.buyer_accepts_marketing = (_a = customerResult.customer) === null || _a === void 0 ? void 0 : _a.accepts_marketing;
            }
            catch (error) {
                console.warn(`Failed looking up customer: ${error}`);
            }
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
        if (this.configuration.shop_sales !== true) {
            const shippingLine = this.shippingLines(sale, this.configuration.ecom_id)[0];
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
            shopifyShipping.country_code = shippingAddress.country_code || this.configuration.default_country_code;
            shopifyShipping.phone = shippingCustomerInfo.phone;
            if (shipping.method_id) {
                const shopifyShippingLine = {
                    code: shipping.method_id,
                    price: shippingLine.total,
                    title: shipping.method_id
                };
                const taxes = this.shopifyTaxLines(shippingLine.taxes);
                if (taxes.length > 0) {
                    shopifyShippingLine.tax_lines = taxes;
                }
                order.shipping_lines = [shopifyShippingLine];
            }
            order.shipping_address = shopifyShipping;
            order.email = shippingCustomerInfo.email;
        }
        else {
            order.fulfillment_status = "fulfilled";
            order.fulfillments = [
                {
                    "location_id": Number(locationId)
                }
            ];
        }
        const shopifyLineItems = [];
        const lineItems = (this.configuration.shop_sales === true) ? this.nonEcommerceLines(sale) : this.ecommerceLines(sale, this.configuration.ecom_id);
        for (const lineItem of lineItems) {
            let variantId = lineItem.variant_id;
            if (_.isNil(variantId)) {
                try {
                    const shopifyProduct = await this.shopifyProduct(lineItem.id);
                    if ((_c = (_b = shopifyProduct === null || shopifyProduct === void 0 ? void 0 : shopifyProduct.product) === null || _b === void 0 ? void 0 : _b.variants[0]) === null || _c === void 0 ? void 0 : _c.id) {
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
            const taxes = this.shopifyTaxLines(lineItem.taxes);
            if (taxes.length > 0) {
                shopifyLineItem.tax_lines = taxes;
            }
            shopifyLineItems.push(shopifyLineItem);
        }
        order.line_items = shopifyLineItems;
        order.tags = "ka-ching";
        order.financial_status = "paid";
        return { order: order };
    }
    async exportStockEvent() {
        this.validateStockConfiguration();
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
        const inventoryItemId = await this.inventoryItemId(productId, this.data.variant_id);
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
    }
    async inventoryItemId(productId, variantId) {
        var _a, _b, _c;
        let inventoryItemId = undefined;
        const configuration = this.configuration;
        if (!_.isNil(variantId)) {
            const url = `https://${configuration.shopify_id}.myshopify.com/admin/api/${apiVersion}/variants/${variantId}.json`;
            try {
                const response = await cross_fetch_1.fetch(url, this.shopifyRequestOptions());
                const shopifyVariantResult = await response.json();
                if ((_a = shopifyVariantResult === null || shopifyVariantResult === void 0 ? void 0 : shopifyVariantResult.variant) === null || _a === void 0 ? void 0 : _a.inventory_item_id) {
                    inventoryItemId = `${shopifyVariantResult.variant.inventory_item_id}`;
                }
            }
            catch (error) {
                console.info(`Got error when trying to get variant with id ${variantId} from Shopify: ${error.toString()}`);
            }
        }
        else {
            try {
                const shopifyProductResult = await this.shopifyProduct(productId);
                if ((_c = (_b = shopifyProductResult === null || shopifyProductResult === void 0 ? void 0 : shopifyProductResult.product) === null || _b === void 0 ? void 0 : _b.variants[0]) === null || _c === void 0 ? void 0 : _c.inventory_item_id) {
                    inventoryItemId = `${shopifyProductResult.product.variants[0].inventory_item_id}`;
                }
            }
            catch (error) {
                console.info(`Got error when trying to get product with id ${productId} from Shopify: ${error.toString()}`);
            }
        }
        return inventoryItemId;
    }
    async shopifyProduct(productId) {
        const url = `https://${this.configuration.shopify_id}.myshopify.com/admin/api/${apiVersion}/products/${productId}.json`;
        const response = await cross_fetch_1.fetch(url, this.shopifyRequestOptions());
        return await response.json();
    }
    shopifyRequestOptions() {
        const base64 = Buffer.from(`${this.configuration.api_key}:${this.configuration.password}`).toString("base64");
        const basicAuthValue = `Basic ${base64}`;
        const options = {
            headers: {
                Authorization: basicAuthValue
            }
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
    ecommerceLines(sale, ecomId) {
        return (sale.summary.line_items || []).filter((line) => {
            const behavior = line.behavior || {};
            return !_.isNil(line.ecom_id) && line.ecom_id === ecomId && _.isNil(behavior.shipping);
        });
    }
    nonEcommerceLines(sale) {
        return (sale.summary.line_items || []).filter((line) => {
            return _.isNil(line.ecom_id);
        });
    }
    shippingLines(sale, ecomId) {
        return (sale.summary.line_items || []).filter((line) => {
            const behavior = line.behavior || {};
            return !_.isNil(behavior.shipping) && !_.isNil(line.ecom_id) && line.ecom_id === ecomId;
        });
    }
    validateNewsletterConfiguration() {
        const configuration = this.configuration;
        if (_.isNil(configuration.api_key) || typeof (configuration.api_key) !== "string") {
            throw new Error("shopify api key is missing from configuration");
        }
        if (_.isNil(configuration.password) || typeof (configuration.password) !== "string") {
            throw new Error("shopify password is missing from configuration");
        }
        if (_.isNil(configuration.shopify_id) || typeof (configuration.shopify_id) !== "string") {
            throw new Error("shopify shop id is missing from configuration");
        }
    }
    validateSalesConfiguration() {
        const configuration = this.configuration;
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
        if (_.isNil(configuration.ecom_id) || typeof (configuration.ecom_id) !== "string") {
            throw new Error("shopify ecom_id is missing from configuration");
        }
    }
    validateStockConfiguration() {
        const configuration = this.configuration;
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
        if (this.configuration.shop_orders === true) {
            if (sale.voided) {
                throw new Error(`Sale is voided`);
            }
            const nonEcomLineItems = this.nonEcommerceLines(sale);
            if (nonEcomLineItems.length === 0) {
                throw new Error(`No non-ecommerce line items on sale`);
            }
        }
        else {
            if (sale.voided || sale.summary.is_return) {
                throw new Error(`Sale is either voided ${sale.voided} or is return ${sale.is_return}`);
            }
            const ecomLineItems = this.ecommerceLines(sale, this.configuration.ecom_id);
            if (ecomLineItems.length === 0) {
                throw new Error(`No ecommerce line items on sale`);
            }
            const ecomLineItemsWithoutProductId = ecomLineItems.filter((line) => { return !_.isNil(line.id); });
            if (ecomLineItemsWithoutProductId.length !== ecomLineItems.length) {
                throw new Error(`1 or more ecommerce lines are missing product id`);
            }
            const shippingLines = this.shippingLines(sale, this.configuration.ecom_id);
            if (shippingLines.length !== 1) {
                throw new Error(`Invalid number of shipping lines on sale ${shippingLines.length}`);
            }
        }
    }
}
exports.ShopifyTransform = ShopifyTransform;
//# sourceMappingURL=ShopifyTransform.js.map